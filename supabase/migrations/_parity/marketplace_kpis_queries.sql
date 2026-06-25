-- =====================================================================
-- Marketplace KPI — standalone validation queries (NON-MIGRATION)
-- =====================================================================
-- PURPOSE: Hand-runnable, per-metric queries that reproduce each number
-- emitted by public.get_marketplace_kpis(...). Run these against prod by
-- hand to validate the RPC's single-row output, or to debug a discrepancy.
--
-- DO NOT include this file in the migration apply path (it lives under
-- supabase/migrations/_parity/, which is excluded from `supabase db push`).
-- There is no SQL test harness; these are eyeball/diff aids only.
--
-- Every query below uses the SAME scope contract as the RPC:
--   * window  : shift_date BETWEEN :p_from AND :p_to
--   * scope   : org/dept/subdept arrays, NULL = no filter, ANDed via = ANY(...)
--   * publish : lifecycle_status <> 'Draft' AND deleted_at IS NULL
-- Replace the :p_* placeholders (psql \set or literal substitution) before running.
--
-- ---------------------------------------------------------------------
-- CONVENTIONS used everywhere (see the RPC header for full detail):
--   "Published" shift := lifecycle_status <> 'Draft' AND deleted_at IS NULL
--   "Filled"   shift  := published shift with assigned_employee_id NOT NULL
--                        (ASSIGNMENT, not attendance — a no-show is filled)
--   "Open"     shift  := published shift that entered the marketplace as a
--                        posting: >=1 OFFERED event OR >=1 shift_bids row OR
--                        bidding_open_at IS NOT NULL (went on bidding)
--   "Covered"  open   := open shift that is currently filled
--   "Marketplace-used" shift := >=1 OFFERED event OR >=1 shift_bids row OR
--                               >=1 shift_swaps row
-- =====================================================================


-- =====================================================================
-- METRIC 1 — Shift Fill Rate = filled_published_shifts / published_shifts
-- =====================================================================
SELECT
    COUNT(*)                                                          AS published_shifts,
    COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL)          AS filled_shifts,
    CASE WHEN COUNT(*) = 0 THEN 0
         ELSE ROUND(COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL)::numeric
                    / COUNT(*) * 100, 2) END                          AS fill_rate
FROM shifts s
WHERE s.deleted_at IS NULL
  AND s.lifecycle_status <> 'Draft'
  AND s.shift_date BETWEEN :p_from AND :p_to
  AND (:p_org_ids::uuid[]     IS NULL OR s.organization_id   = ANY(:p_org_ids::uuid[]))
  AND (:p_dept_ids::uuid[]    IS NULL OR s.department_id     = ANY(:p_dept_ids::uuid[]))
  AND (:p_subdept_ids::uuid[] IS NULL OR s.sub_department_id = ANY(:p_subdept_ids::uuid[]));


-- =====================================================================
-- METRIC 2 — Open Shift Coverage Rate = covered_open_shifts / open_shifts
-- open    := had >=1 OFFERED event OR >=1 shift_bids row OR went on bidding
-- covered := open AND currently filled
-- =====================================================================
WITH scoped AS (
    SELECT s.id, s.assigned_employee_id, s.bidding_open_at
    FROM shifts s
    WHERE s.deleted_at IS NULL
      AND s.lifecycle_status <> 'Draft'
      AND s.shift_date BETWEEN :p_from AND :p_to
      AND (:p_org_ids::uuid[]     IS NULL OR s.organization_id   = ANY(:p_org_ids::uuid[]))
      AND (:p_dept_ids::uuid[]    IS NULL OR s.department_id     = ANY(:p_dept_ids::uuid[]))
      AND (:p_subdept_ids::uuid[] IS NULL OR s.sub_department_id = ANY(:p_subdept_ids::uuid[]))
),
flagged AS (
    SELECT
        sc.id,
        sc.assigned_employee_id,
        ( EXISTS (SELECT 1 FROM shift_events e WHERE e.shift_id = sc.id AND e.event_type = 'OFFERED')
          OR EXISTS (SELECT 1 FROM shift_bids b WHERE b.shift_id = sc.id)
          OR sc.bidding_open_at IS NOT NULL ) AS is_open
    FROM scoped sc
)
SELECT
    COUNT(*) FILTER (WHERE is_open)                                        AS open_shifts,
    COUNT(*) FILTER (WHERE is_open AND assigned_employee_id IS NOT NULL)   AS covered_open_shifts,
    CASE WHEN COUNT(*) FILTER (WHERE is_open) = 0 THEN 0
         ELSE ROUND(
            COUNT(*) FILTER (WHERE is_open AND assigned_employee_id IS NOT NULL)::numeric
            / COUNT(*) FILTER (WHERE is_open) * 100, 2) END                AS open_coverage_rate
FROM flagged;


-- =====================================================================
-- METRIC 3 — Assignment Churn Rate
--   = (count(snapshots) - count(distinct shift_id)) / count(distinct shift_id)
-- "Extra owners beyond the first." Snapshot-grain: scoped by the snapshot's
-- OWN denormalized org/dept/subdept + shift_date (NOT by joining shifts).
-- S2 drafts / offer-only / rejected / ignored are excluded upstream by the
-- assignment_snapshots writer, so no extra filtering is needed here.
-- =====================================================================
WITH snaps AS (
    SELECT asnp.shift_id
    FROM assignment_snapshots asnp
    WHERE asnp.shift_date BETWEEN :p_from AND :p_to
      AND (:p_org_ids::uuid[]     IS NULL OR asnp.organization_id   = ANY(:p_org_ids::uuid[]))
      AND (:p_dept_ids::uuid[]    IS NULL OR asnp.department_id     = ANY(:p_dept_ids::uuid[]))
      AND (:p_subdept_ids::uuid[] IS NULL OR asnp.sub_department_id = ANY(:p_subdept_ids::uuid[]))
)
SELECT
    COUNT(*)                                                AS published_snapshots,
    COUNT(DISTINCT shift_id)                                AS distinct_filled_shifts,
    CASE WHEN COUNT(DISTINCT shift_id) = 0 THEN 0
         ELSE ROUND(
            (COUNT(*) - COUNT(DISTINCT shift_id))::numeric
            / COUNT(DISTINCT shift_id), 2) END              AS churn_rate
FROM snaps;


-- =====================================================================
-- METRIC 4 — Average Time To Fill (hours)
-- =====================================================================
-- DEFINITION / open_started_at CHOICE (documented per the brief):
--   Ideal: avg(became_active_at - the latest preceding S5/publish-open moment).
--   There is no first-class "bidding opened" event in shift_events (the enum
--   shift_event_type has OFFERED/ACCEPTED/REJECTED/IGNORED/... but NO
--   BIDDING_OPENED), so we use the pragmatic snapshot-grain version:
--
--   For each snapshot, open_started_at :=
--     1) MAX(shift_events.event_time) over OFFERED events for that shift that
--        are STRICTLY BEFORE became_active_at  (the most recent preceding
--        "posted/offered to the marketplace" signal), ELSE
--     2) shifts.bidding_open_at   (the column set when a shift is put on bidding), ELSE
--     3) shifts.published_at, ELSE
--     4) shifts.created_at.
--   time_to_fill_hours := (became_active_at - open_started_at) in hours.
--   Snapshots whose open moment is unresolvable, or where the gap is negative
--   (open AFTER active — clock skew / backfilled events), are EXCLUDED from the
--   average so they don't pollute it. The RPC returns 0 when no snapshot
--   qualifies (guarded COALESCE).
--
-- This query reproduces both the per-snapshot breakdown (comment out the final
-- aggregate to inspect rows) and the single averaged number.
WITH snaps AS (
    SELECT asnp.shift_id, asnp.became_active_at
    FROM assignment_snapshots asnp
    WHERE asnp.shift_date BETWEEN :p_from AND :p_to
      AND (:p_org_ids::uuid[]     IS NULL OR asnp.organization_id   = ANY(:p_org_ids::uuid[]))
      AND (:p_dept_ids::uuid[]    IS NULL OR asnp.department_id     = ANY(:p_dept_ids::uuid[]))
      AND (:p_subdept_ids::uuid[] IS NULL OR asnp.sub_department_id = ANY(:p_subdept_ids::uuid[]))
),
ttf AS (
    SELECT
        sn.shift_id,
        sn.became_active_at,
        COALESCE(
            ( SELECT MAX(e.event_time)
              FROM shift_events e
              WHERE e.shift_id = sn.shift_id
                AND e.event_type = 'OFFERED'
                AND e.event_time < sn.became_active_at ),
            sh.bidding_open_at,
            sh.published_at,
            sh.created_at
        ) AS open_started_at
    FROM snaps sn
    LEFT JOIN shifts sh ON sh.id = sn.shift_id
)
SELECT
    ROUND(COALESCE(AVG(
        EXTRACT(EPOCH FROM (became_active_at - open_started_at)) / 3600.0
    ) FILTER (
        WHERE open_started_at IS NOT NULL
          AND became_active_at IS NOT NULL
          AND became_active_at >= open_started_at
    ), 0), 2) AS avg_time_to_fill_hours
FROM ttf;
-- Per-snapshot breakdown (uncomment to inspect which rows feed the average):
-- SELECT shift_id, open_started_at, became_active_at,
--        ROUND(EXTRACT(EPOCH FROM (became_active_at - open_started_at))/3600.0, 2) AS hrs
-- FROM ttf ORDER BY hrs DESC NULLS LAST;


-- =====================================================================
-- METRIC 5 — Marketplace Utilization Rate
--   = shifts_using_marketplace / marketplace_eligible_shifts
-- eligible := published shifts (in scope/window)
-- using    := >=1 OFFERED event OR >=1 shift_bids row OR >=1 shift_swaps row
-- =====================================================================
WITH scoped AS (
    SELECT s.id
    FROM shifts s
    WHERE s.deleted_at IS NULL
      AND s.lifecycle_status <> 'Draft'
      AND s.shift_date BETWEEN :p_from AND :p_to
      AND (:p_org_ids::uuid[]     IS NULL OR s.organization_id   = ANY(:p_org_ids::uuid[]))
      AND (:p_dept_ids::uuid[]    IS NULL OR s.department_id     = ANY(:p_dept_ids::uuid[]))
      AND (:p_subdept_ids::uuid[] IS NULL OR s.sub_department_id = ANY(:p_subdept_ids::uuid[]))
)
SELECT
    COUNT(*)                                                          AS marketplace_eligible_shifts,
    COUNT(*) FILTER (WHERE
        EXISTS (SELECT 1 FROM shift_events e WHERE e.shift_id = sc.id AND e.event_type = 'OFFERED')
        OR EXISTS (SELECT 1 FROM shift_bids  b WHERE b.shift_id = sc.id)
        OR EXISTS (SELECT 1 FROM shift_swaps sw WHERE sw.requester_shift_id = sc.id)
    )                                                                AS marketplace_used_shifts,
    CASE WHEN COUNT(*) = 0 THEN 0
         ELSE ROUND(
            COUNT(*) FILTER (WHERE
                EXISTS (SELECT 1 FROM shift_events e WHERE e.shift_id = sc.id AND e.event_type = 'OFFERED')
                OR EXISTS (SELECT 1 FROM shift_bids  b WHERE b.shift_id = sc.id)
                OR EXISTS (SELECT 1 FROM shift_swaps sw WHERE sw.requester_shift_id = sc.id)
            )::numeric / COUNT(*) * 100, 2) END                      AS marketplace_utilization_rate
FROM scoped sc;


-- =====================================================================
-- METRIC 6 — Offer funnel over RESOLVED offers (event-sourced)
-- =====================================================================
-- SOURCE: public.shift_events (the immutable ledger), event_type IN
--   ('ACCEPTED','REJECTED','IGNORED'). IGNORED = expired / auto-retracted offer.
-- "Resolved" excludes still-pending OFFERED (no terminal event yet).
-- accept_rate = ACCEPTED / resolved, reject_rate = REJECTED / resolved,
-- ignore_rate = IGNORED / resolved. The three rates sum to 100.
-- Scoped by joining shifts for the window + org/dept/subdept.
SELECT
    COUNT(*) FILTER (WHERE e.event_type IN ('ACCEPTED','REJECTED','IGNORED')) AS offers_resolved,
    CASE WHEN COUNT(*) FILTER (WHERE e.event_type IN ('ACCEPTED','REJECTED','IGNORED')) = 0 THEN 0
         ELSE ROUND(COUNT(*) FILTER (WHERE e.event_type = 'ACCEPTED')::numeric
              / COUNT(*) FILTER (WHERE e.event_type IN ('ACCEPTED','REJECTED','IGNORED')) * 100, 2) END
                                                                             AS offer_accept_rate,
    CASE WHEN COUNT(*) FILTER (WHERE e.event_type IN ('ACCEPTED','REJECTED','IGNORED')) = 0 THEN 0
         ELSE ROUND(COUNT(*) FILTER (WHERE e.event_type = 'REJECTED')::numeric
              / COUNT(*) FILTER (WHERE e.event_type IN ('ACCEPTED','REJECTED','IGNORED')) * 100, 2) END
                                                                             AS offer_reject_rate,
    CASE WHEN COUNT(*) FILTER (WHERE e.event_type IN ('ACCEPTED','REJECTED','IGNORED')) = 0 THEN 0
         ELSE ROUND(COUNT(*) FILTER (WHERE e.event_type = 'IGNORED')::numeric
              / COUNT(*) FILTER (WHERE e.event_type IN ('ACCEPTED','REJECTED','IGNORED')) * 100, 2) END
                                                                             AS offer_ignore_rate
FROM shift_events e
JOIN shifts s ON s.id = e.shift_id
WHERE e.event_type IN ('ACCEPTED','REJECTED','IGNORED')
  AND s.deleted_at IS NULL
  AND s.shift_date BETWEEN :p_from AND :p_to
  AND (:p_org_ids::uuid[]     IS NULL OR s.organization_id   = ANY(:p_org_ids::uuid[]))
  AND (:p_dept_ids::uuid[]    IS NULL OR s.department_id     = ANY(:p_dept_ids::uuid[]))
  AND (:p_subdept_ids::uuid[] IS NULL OR s.sub_department_id = ANY(:p_subdept_ids::uuid[]));


-- =====================================================================
-- METRIC 7 — Trade funnel over shift_swaps in window
-- =====================================================================
-- SOURCE: public.shift_swaps, scoped by joining the requester's shift
--   (requester_shift_id) for the window + org/dept/subdept.
--
-- TRADE STATUS -> BUCKET MAPPING (over enum swap_request_status, whose members
-- are exactly: OPEN | OFFER_SELECTED | MANAGER_PENDING | APPROVED | REJECTED |
-- CANCELLED | EXPIRED — verified in src/platform/supabase/types.ts):
--   completed   := APPROVED
--   cancelled   := REJECTED + CANCELLED
--                  (this schema has NO 'WITHDRAWN' member; CANCELLED is the
--                   requester-withdrew value, so it joins REJECTED in the
--                   "cancellation" bucket)
--   expired     := EXPIRED
--   in-flight   := OPEN, OFFER_SELECTED, MANAGER_PENDING  (counted in `total`
--                  denominator but in NONE of the three terminal buckets — so
--                  the three rates do NOT necessarily sum to 100)
-- completion_rate = APPROVED/total, cancellation_rate = (REJECTED+CANCELLED)/total,
-- expiry_rate = EXPIRED/total.
SELECT
    COUNT(*)                                                          AS trades_initiated,
    CASE WHEN COUNT(*) = 0 THEN 0
         ELSE ROUND(COUNT(*) FILTER (WHERE ss.status = 'APPROVED')::numeric
              / COUNT(*) * 100, 2) END                                AS trade_completion_rate,
    CASE WHEN COUNT(*) = 0 THEN 0
         ELSE ROUND(COUNT(*) FILTER (WHERE ss.status IN ('REJECTED','CANCELLED'))::numeric
              / COUNT(*) * 100, 2) END                                AS trade_cancellation_rate,
    CASE WHEN COUNT(*) = 0 THEN 0
         ELSE ROUND(COUNT(*) FILTER (WHERE ss.status = 'EXPIRED')::numeric
              / COUNT(*) * 100, 2) END                                AS trade_expiry_rate
FROM shift_swaps ss
JOIN shifts s ON s.id = ss.requester_shift_id
WHERE s.deleted_at IS NULL
  AND s.shift_date BETWEEN :p_from AND :p_to
  AND (:p_org_ids::uuid[]     IS NULL OR s.organization_id   = ANY(:p_org_ids::uuid[]))
  AND (:p_dept_ids::uuid[]    IS NULL OR s.department_id     = ANY(:p_dept_ids::uuid[]))
  AND (:p_subdept_ids::uuid[] IS NULL OR s.sub_department_id = ANY(:p_subdept_ids::uuid[]));


-- =====================================================================
-- EXAMPLE CALL — current quarter, no org/dept/subdept filter
-- =====================================================================
-- Uses the existing quarter_date_range(year, quarter) helper (returns v_start,
-- v_end dates) to build the current-quarter [from, to] window, then calls the
-- RPC. The whole single-row result is returned.
SELECT k.*
FROM quarter_date_range(
        date_part('year',    now())::int,
        date_part('quarter', now())::int
     ) qdr
CROSS JOIN LATERAL public.get_marketplace_kpis(
        qdr.v_start,   -- p_from
        qdr.v_end,     -- p_to
        NULL,          -- p_org_ids     (all orgs)
        NULL,          -- p_dept_ids    (all depts)
        NULL           -- p_subdept_ids (all sub-depts)
     ) k;

-- Example scoped call (single org, explicit window):
-- SELECT * FROM public.get_marketplace_kpis(
--     DATE '2026-04-01',
--     DATE '2026-06-30',
--     ARRAY['00000000-0000-0000-0000-000000000000']::uuid[],  -- p_org_ids
--     NULL,
--     NULL
-- );
