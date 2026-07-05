-- =====================================================================
-- Marketplace KPI reporting layer
-- =====================================================================
-- A single SECURITY DEFINER / STABLE function that returns ONE ROW of
-- marketplace health metrics (raw counts + rates) for a date window and an
-- optional org / dept / sub-dept scope.
--
-- This sits alongside the per-employee performance metrics
-- (20260618041231_perf_event_sourced_reads.sql, 20260624090100_episode_metrics_rewrite.sql)
-- and deliberately MATCHES their conventions:
--   * org/dept/subdept array params (NULL = no filter) ANDed via `= ANY(...)`.
--   * SECURITY DEFINER, STABLE, search_path 'pg_catalog','public'.
--   * Every divide is guarded (CASE WHEN denom = 0 THEN 0 ...).
--   * Rates ROUND(...,2) and expressed as percentages (0..100), except
--     fill_rate / open_coverage_rate / utilization which are also 0..100 %.
--   * Offer behaviour is EPISODE-sourced (v_shift_assignment_episodes): an offer
--     is an episode with had_offer (a real S3 OFFERED). This is deliberate — a raw
--     ACCEPTED event is also emitted for bid-wins and trade-confirms, so counting
--     raw events would over-count the acceptance rate.
--
-- DATA SOURCES (verified against src/platform/supabase/types.ts):
--   * public.shifts            — lifecycle_status (enum shift_lifecycle:
--                                Draft|Published|InProgress|Completed|Cancelled),
--                                assigned_employee_id, scheduled_start, shift_date,
--                                published_at, created_at, bidding_open_at,
--                                organization_id, department_id, sub_department_id,
--                                deleted_at.
--   * public.shift_events      — (shift_id, employee_id, event_type, event_time).
--   * public.shift_bids        — (shift_id, employee_id, status text). Existence
--                                of a row (any status) = the shift entered the
--                                bidding marketplace.
--   * public.shift_swaps       — (requester_id, requester_shift_id,
--                                status enum swap_request_status:
--                                OPEN|OFFER_SELECTED|MANAGER_PENDING|APPROVED|
--                                REJECTED|CANCELLED|EXPIRED).
--   * public.assignment_snapshots — denormalized published-active assignment
--                                episodes (created by migration 20260625090100,
--                                owned by a parallel agent; READ ONLY here). One
--                                snapshot = one published-active episode; S2
--                                drafts / offer-only / rejected / ignored are
--                                excluded by design upstream.
--
-- "Published" shift  := published_at IS NOT NULL AND deleted_at IS NULL (EVER
--                       published — survives a revert-to-Draft from offer/bidding
--                       expiry, so unfilled-then-reverted shifts still count).
-- "Filled"  shift    := published shift with a non-null assigned_employee_id
--                       (assignment, NOT attendance — a no-show shift is filled).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_marketplace_kpis(
    p_from        date,
    p_to          date,
    p_org_ids     uuid[] DEFAULT NULL,
    p_dept_ids    uuid[] DEFAULT NULL,
    p_subdept_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
    -- ── Shift Fill Rate ────────────────────────────────────────────────
    published_shifts             int,
    filled_shifts                int,
    fill_rate                    numeric,
    -- ── Open Shift Coverage Rate ──────────────────────────────────────
    open_shifts                  int,
    covered_open_shifts          int,
    open_coverage_rate           numeric,
    -- ── Assignment Churn Rate (snapshot-grain) ────────────────────────
    published_snapshots          int,
    distinct_filled_shifts       int,
    churn_rate                   numeric,
    -- ── Average Time To Fill (snapshot-grain) ─────────────────────────
    avg_time_to_fill_hours       numeric,
    -- ── Marketplace Utilization Rate ──────────────────────────────────
    marketplace_eligible_shifts  int,
    marketplace_used_shifts      int,
    marketplace_utilization_rate numeric,
    -- ── Offer funnel (resolved offers, event-sourced) ─────────────────
    offers_resolved              int,
    offer_accept_rate            numeric,
    offer_reject_rate            numeric,
    offer_ignore_rate            numeric,
    -- ── Trade funnel (shift_swaps in window) ──────────────────────────
    trades_initiated             int,
    trade_completion_rate        numeric,
    trade_rejection_rate         numeric,
    trade_cancellation_rate      numeric,
    trade_expiry_rate            numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    RETURN QUERY
    WITH
    -- ── Scoped published shift universe ───────────────────────────────
    -- Every shift-grain metric (fill, coverage, marketplace utilization,
    -- and the per-shift inputs to time-to-fill) is anchored here.
    -- Window: shift_date in [p_from, p_to]; org/dept/subdept ANDed.
    -- "Published" = lifecycle_status <> 'Draft' AND not soft-deleted.
    pub_shifts AS (
        SELECT
            s.id,
            s.assigned_employee_id,
            s.scheduled_start,
            s.shift_date,
            s.bidding_open_at,
            s.published_at,
            s.created_at,
            s.organization_id,
            s.department_id,
            s.sub_department_id
        FROM shifts s
        WHERE s.deleted_at IS NULL
          -- "published" = EVER published (published_at is set on first publish and
          -- survives a revert-to-Draft from offer-expiry / bidding-expiry). Using
          -- lifecycle_status <> 'Draft' would wrongly DROP shifts that were published,
          -- failed to fill, and reverted (e.g. a bidding shift that expired unfilled),
          -- inflating the fill rate. published_at IS NOT NULL keeps them in scope.
          AND s.published_at IS NOT NULL
          AND s.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR s.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id = ANY(p_subdept_ids))
    ),

    -- ── Per-shift marketplace touch flags ─────────────────────────────
    -- A shift "used the marketplace" if it had >=1 OFFERED event OR >=1
    -- shift_bids row OR >=1 shift_swaps row. A shift is "open" (entered the
    -- marketplace as an unfilled posting) if it had >=1 OFFERED event OR
    -- >=1 shift_bids row OR went on bidding (bidding_open_at IS NOT NULL).
    -- Trades alone do NOT make a shift "open" (a trade is a hand-off of an
    -- already-filled shift), but DO count toward marketplace utilization.
    shift_flags AS (
        SELECT
            ps.id,
            ps.assigned_employee_id,
            -- had an OFFERED event in the ledger
            EXISTS (
                SELECT 1 FROM shift_events e
                WHERE e.shift_id = ps.id AND e.event_type = 'OFFERED'
            ) AS had_offer,
            -- had at least one bid (any status)
            EXISTS (
                SELECT 1 FROM shift_bids b WHERE b.shift_id = ps.id
            ) AS had_bid,
            -- had at least one swap initiated against it as the requester's shift
            EXISTS (
                SELECT 1 FROM shift_swaps sw WHERE sw.requester_shift_id = ps.id
            ) AS had_swap,
            -- ever went on bidding (column set when a shift is posted to bidding)
            (ps.bidding_open_at IS NOT NULL) AS went_on_bidding
        FROM pub_shifts ps
    ),

    -- ── Shift Fill Rate + Open Shift Coverage Rate + Marketplace Util ──
    shift_metrics AS (
        SELECT
            COUNT(*)::int                                              AS published_shifts,
            COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL)::int
                                                                       AS filled_shifts,
            -- open = entered marketplace as a posting
            COUNT(*) FILTER (WHERE had_offer OR had_bid OR went_on_bidding)::int
                                                                       AS open_shifts,
            -- covered = open AND currently filled
            COUNT(*) FILTER (
                WHERE (had_offer OR had_bid OR went_on_bidding)
                  AND assigned_employee_id IS NOT NULL
            )::int                                                     AS covered_open_shifts,
            -- marketplace-eligible = all published shifts in scope
            COUNT(*)::int                                              AS marketplace_eligible_shifts,
            -- marketplace-used = touched offer / bid / swap
            COUNT(*) FILTER (WHERE had_offer OR had_bid OR had_swap)::int
                                                                       AS marketplace_used_shifts
        FROM shift_flags
    ),

    -- ── Snapshot universe (Assignment Churn + Average Time To Fill) ───
    -- Snapshot-grain metrics are scoped by the snapshot's OWN denormalized
    -- org/dept/subdept + shift_date (NOT by joining shifts), per spec.
    -- One snapshot = one published-active assignment episode.
    snaps AS (
        SELECT
            asnp.shift_id,
            asnp.became_active_at,
            asnp.scheduled_start
        FROM assignment_snapshots asnp
        WHERE asnp.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR asnp.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR asnp.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR asnp.sub_department_id = ANY(p_subdept_ids))
    ),

    -- Per-snapshot time-to-fill: hours from the marketplace-open moment to the
    -- moment the assignment became active.
    --   open_started_at := the latest shift_events.event_time STRICTLY BEFORE
    --                      became_active_at among OFFERED events for that shift
    --                      (the most recent preceding "posted/offered" signal).
    --   Fallbacks (when no preceding OFFERED event exists): the shift's
    --   bidding_open_at, then published_at, then created_at. All read from the
    --   `shifts` row (no org/dept scope needed — we already have the snapshot).
    -- Negative / NULL deltas are discarded (NULLIF guard) so a snapshot whose
    -- open moment can't be established does not pollute the average.
    ttf AS (
        SELECT
            sn.shift_id,
            sn.became_active_at,
            COALESCE(
                (
                    SELECT MAX(e.event_time)
                    FROM shift_events e
                    WHERE e.shift_id   = sn.shift_id
                      AND e.event_type = 'OFFERED'
                      AND e.event_time < sn.became_active_at
                ),
                sh.bidding_open_at,
                sh.published_at,
                sh.created_at
            ) AS open_started_at
        FROM snaps sn
        LEFT JOIN shifts sh ON sh.id = sn.shift_id
    ),

    snapshot_metrics AS (
        SELECT
            COUNT(*)::int                          AS published_snapshots,
            COUNT(DISTINCT shift_id)::int          AS distinct_filled_shifts
        FROM snaps
    ),

    ttf_metrics AS (
        SELECT
            -- average over snapshots with a resolvable, non-negative open->active gap
            AVG(
                EXTRACT(EPOCH FROM (became_active_at - open_started_at)) / 3600.0
            ) FILTER (
                WHERE open_started_at IS NOT NULL
                  AND became_active_at IS NOT NULL
                  AND became_active_at >= open_started_at
            ) AS avg_time_to_fill_hours
        FROM ttf
    ),

    -- ── Offer funnel over RESOLVED offers (event-sourced) ─────────────
    -- Resolved = ACCEPTED + REJECTED + IGNORED (an OFFERED with no terminal
    -- event is still pending and is excluded). Scoped by joining shifts for
    -- the window + org/dept/subdept. The three rates sum to 100.
    -- ── Offer funnel — EPISODE-sourced (an offer = an S3 OFFERED in an episode) ──
    -- IMPORTANT: a raw ACCEPTED event is emitted for offer-accepts AND for bid-wins
    -- (select_winner sets assignment_outcome='confirmed') AND for trade-confirms.
    -- Counting raw ACCEPTED events therefore OVER-counts the acceptance rate. The
    -- offer funnel must count only episodes that carried a real S3 offer (had_offer):
    --   accepted = had_offer AND had_accept       (the offer was accepted — even if
    --                                               later dropped/swapped; that's a
    --                                               separate cancellation event)
    --   ignored  = had_offer AND not accepted AND terminal_outcome='ignored'
    --   rejected = had_offer AND not accepted AND terminal_outcome NOT IN ('ignored','open')
    --   resolved = accepted + rejected + ignored  (a still-outstanding offer with
    --              terminal_outcome='open' is pending and excluded)
    offer_metrics AS (
        SELECT
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.had_accept)::int AS accepted,
            COUNT(*) FILTER (WHERE ep.had_offer AND NOT ep.had_accept
                                   AND ep.terminal_outcome NOT IN ('ignored','open'))::int AS rejected,
            COUNT(*) FILTER (WHERE ep.had_offer AND NOT ep.had_accept
                                   AND ep.terminal_outcome = 'ignored')::int AS ignored,
            COUNT(*) FILTER (WHERE ep.had_offer
                                   AND (ep.had_accept OR ep.terminal_outcome <> 'open'))::int AS resolved
        FROM v_shift_assignment_episodes ep
        WHERE ep.shift_date BETWEEN p_from AND p_to
          AND ep.terminal_outcome <> 'shift_deleted'
          AND (p_org_ids     IS NULL OR ep.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR ep.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR ep.sub_department_id = ANY(p_subdept_ids))
    ),

    -- ── Trade funnel over shift_swaps in window ───────────────────────
    -- Scoped by joining the requester's shift (requester_shift_id) for the
    -- window + org/dept/subdept. Bucket mapping over swap_request_status:
    --   completed   := APPROVED    (the trade went through)
    --   rejected    := REJECTED    (the manager rejected the trade)
    --   cancelled   := CANCELLED   (the requester withdrew the trade)
    --   expired     := EXPIRED
    --   (OPEN / OFFER_SELECTED / MANAGER_PENDING are still in-flight: counted
    --    in the denominator `total` but in none of the four terminal buckets,
    --    so the four rates need not sum to 100.)
    trade_metrics AS (
        SELECT
            COUNT(*)::int                                                  AS total,
            COUNT(*) FILTER (WHERE ss.status = 'APPROVED')::int            AS completed,
            COUNT(*) FILTER (WHERE ss.status = 'REJECTED')::int            AS rejected,
            COUNT(*) FILTER (WHERE ss.status = 'CANCELLED')::int           AS cancelled,
            COUNT(*) FILTER (WHERE ss.status = 'EXPIRED')::int             AS expired
        FROM shift_swaps ss
        JOIN shifts s ON s.id = ss.requester_shift_id
        WHERE s.deleted_at IS NULL
          AND s.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR s.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id = ANY(p_subdept_ids))
    )

    -- ── Single-row assembly with guarded divides + ROUND(...,2) ───────
    SELECT
        -- Fill Rate
        sm.published_shifts,
        sm.filled_shifts,
        CASE WHEN sm.published_shifts = 0 THEN 0
             ELSE ROUND(sm.filled_shifts::numeric / sm.published_shifts * 100, 2) END
                                                                       AS fill_rate,
        -- Open Shift Coverage Rate
        sm.open_shifts,
        sm.covered_open_shifts,
        CASE WHEN sm.open_shifts = 0 THEN 0
             ELSE ROUND(sm.covered_open_shifts::numeric / sm.open_shifts * 100, 2) END
                                                                       AS open_coverage_rate,
        -- Assignment Churn Rate, as a PERCENTAGE: extra owners per 100 published
        -- shifts = (snapshots - distinct shifts) / distinct shifts * 100. (Expressed
        -- as a % so it aligns with the UI formatting + thresholds; can exceed 100 if
        -- shifts average >2 owners.)
        spm.published_snapshots,
        spm.distinct_filled_shifts,
        CASE WHEN spm.distinct_filled_shifts = 0 THEN 0
             ELSE ROUND(
                 (spm.published_snapshots - spm.distinct_filled_shifts)::numeric
                 / spm.distinct_filled_shifts * 100, 2) END           AS churn_rate,
        -- Average Time To Fill (hours); NULL -> 0 when no resolvable snapshots
        ROUND(COALESCE(tm.avg_time_to_fill_hours, 0), 2)              AS avg_time_to_fill_hours,
        -- Marketplace Utilization Rate
        sm.marketplace_eligible_shifts,
        sm.marketplace_used_shifts,
        CASE WHEN sm.marketplace_eligible_shifts = 0 THEN 0
             ELSE ROUND(sm.marketplace_used_shifts::numeric
                        / sm.marketplace_eligible_shifts * 100, 2) END AS marketplace_utilization_rate,
        -- Offer funnel (resolved)
        om.resolved                                                   AS offers_resolved,
        CASE WHEN om.resolved = 0 THEN 0
             ELSE ROUND(om.accepted::numeric / om.resolved * 100, 2) END AS offer_accept_rate,
        CASE WHEN om.resolved = 0 THEN 0
             ELSE ROUND(om.rejected::numeric / om.resolved * 100, 2) END AS offer_reject_rate,
        CASE WHEN om.resolved = 0 THEN 0
             ELSE ROUND(om.ignored::numeric  / om.resolved * 100, 2) END AS offer_ignore_rate,
        -- Trade funnel
        trm.total                                                     AS trades_initiated,
        CASE WHEN trm.total = 0 THEN 0
             ELSE ROUND(trm.completed::numeric / trm.total * 100, 2) END AS trade_completion_rate,
        CASE WHEN trm.total = 0 THEN 0
             ELSE ROUND(trm.rejected::numeric / trm.total * 100, 2) END AS trade_rejection_rate,
        CASE WHEN trm.total = 0 THEN 0
             ELSE ROUND(trm.cancelled::numeric / trm.total * 100, 2) END AS trade_cancellation_rate,
        CASE WHEN trm.total = 0 THEN 0
             ELSE ROUND(trm.expired::numeric / trm.total * 100, 2) END AS trade_expiry_rate
    FROM shift_metrics    sm
    CROSS JOIN snapshot_metrics spm
    CROSS JOIN ttf_metrics      tm
    CROSS JOIN offer_metrics    om
    CROSS JOIN trade_metrics    trm;
END;
$function$;

COMMENT ON FUNCTION public.get_marketplace_kpis(date, date, uuid[], uuid[], uuid[]) IS
'Single-row marketplace KPIs (fill / open-coverage / churn / time-to-fill / utilization / offer funnel / trade funnel) for a [p_from,p_to] shift_date window, optionally scoped by org/dept/subdept arrays (NULL = no filter). Offer behaviour is event-sourced from shift_events; churn & time-to-fill are snapshot-grain over assignment_snapshots; trades over shift_swaps (APPROVED=completed, REJECTED=rejected [manager rejected], CANCELLED=cancelled [requester withdrew], EXPIRED=expired). SECURITY DEFINER / STABLE.';
