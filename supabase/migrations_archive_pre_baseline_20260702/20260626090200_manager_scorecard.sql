-- =====================================================================
-- Manager Scorecard — manager / roster-quality KPI reporting layer
-- =====================================================================
-- A single SECURITY DEFINER / STABLE function that returns ONE ROW of
-- manager-attributed roster-quality metrics (raw counts + rates) for a date
-- window and an optional org / dept / sub-dept scope.
--
-- This sits alongside the marketplace KPI layer
-- (20260625090200_marketplace_kpis.sql) and the per-employee performance
-- metrics, and deliberately MATCHES their conventions:
--   * org/dept/subdept array params (NULL = no filter) ANDed via `= ANY(...)`.
--   * SECURITY DEFINER, STABLE, search_path 'pg_catalog','public'.
--   * Every divide is guarded (CASE WHEN denom = 0 THEN 0 ...).
--   * Rates ROUND(...,2) and expressed as percentages (0..100).
--   * Always returns exactly one row (the CROSS JOIN of single-row CTEs).
--
-- LENS: this is the MANAGER / roster-quality lens (planning health), not the
-- marketplace/employee lens. Several rates are deliberately "manager-negative"
-- (HIGH = worse planning): emergency_fill_rate and a low avg_publish_lead_time.
--
-- DATA SOURCES (verified against src/platform/supabase/types.ts):
--   * public.shifts                — lifecycle_status (enum shift_lifecycle:
--                                    Draft|Published|InProgress|Completed|Cancelled),
--                                    assigned_employee_id, scheduled_start,
--                                    shift_date, published_at, bidding_open_at,
--                                    created_at, organization_id, department_id,
--                                    sub_department_id, deleted_at.
--   * public.shift_events          — (shift_id, employee_id, event_type, event_time)
--                                    PLUS, after migration 20260626090000 (parallel
--                                    agent; apply order guarantees these exist before
--                                    this migration runs): domain text
--                                    ('shift'|'assignment'|'offer'|'trade') and
--                                    actor_role text ('manager'|'employee'|'system').
--                                    Only actor_role is consumed here (action split).
--   * public.shift_bids            — (shift_id, employee_id, status text). Existence
--                                    of a row (any status) = the shift entered the
--                                    bidding marketplace.
--   * public.assignment_snapshots  — denormalized published-active assignment
--                                    episodes (created by 20260625090100, owned by a
--                                    parallel agent; READ ONLY here). One snapshot =
--                                    one published-active episode. Columns consumed:
--                                    shift_id, source ('publish_confirm'|'bid_win'|
--                                    'trade_approve'|'emergency'), end_reason
--                                    ('worked'|'dropped_std'|'dropped_late'|'no_show'|
--                                    'traded_out'|'reassigned'|NULL), and the
--                                    denormalized organization_id / department_id /
--                                    sub_department_id / shift_date used for scoping.
--
-- "Published" shift := lifecycle_status <> 'Draft' AND deleted_at IS NULL.
-- "Filled"  shift   := published shift with a non-null assigned_employee_id
--                      (assignment, NOT attendance — a no-show shift is filled).
-- "Open"    shift   := published shift that entered the marketplace as a
--                      posting: had >=1 OFFERED event OR >=1 shift_bids row OR
--                      went on bidding (bidding_open_at IS NOT NULL).
-- "Covered" open    := open shift that is currently filled.
--
-- GRAIN routing (per spec):
--   * shift-grain metrics (managed_published_shifts, filled, fill_rate,
--     open / covered / open_coverage_rate, avg_publish_lead_time_hours) scope
--     via the `shifts` table.
--   * snapshot-grain metrics (published_snapshots, distinct_shifts, churn_rate,
--     emergency_fill_count/_rate, reassignment_count) scope via the snapshot's
--     OWN denormalized org/dept/subdept + shift_date (NOT by joining shifts).
--   * event-grain metrics (manager/employee/system_actions) scope via
--     shift_events JOINed to shifts (window on shift_date + org/dept/subdept).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_manager_scorecard(
    p_from        date,
    p_to          date,
    p_org_ids     uuid[] DEFAULT NULL,
    p_dept_ids    uuid[] DEFAULT NULL,
    p_subdept_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
    -- ── Shift Fill Rate (shift-grain) ─────────────────────────────────
    managed_published_shifts   int,
    filled_shifts              int,
    fill_rate                  numeric,
    -- ── Open Shift Coverage Rate (shift-grain) ────────────────────────
    open_shifts                int,
    covered_open_shifts        int,
    open_coverage_rate         numeric,
    -- ── Assignment Churn Rate (snapshot-grain) ────────────────────────
    published_snapshots        int,
    distinct_shifts            int,
    churn_rate                 numeric,
    -- ── Emergency Fill (snapshot-grain; HIGH = manager-negative) ──────
    emergency_fill_count       int,
    emergency_fill_rate        numeric,
    -- ── Reassignment volume (snapshot-grain) ──────────────────────────
    reassignment_count         int,
    -- ── Publish Lead Time (shift-grain; LOW = manager-negative) ───────
    avg_publish_lead_time_hours numeric,
    -- ── Action split (event-grain, by actor_role) ────────────────────
    manager_actions            int,
    employee_actions           int,
    system_actions             int
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
    -- Every shift-grain metric (fill, coverage, publish lead time) is
    -- anchored here. Window: shift_date in [p_from, p_to]; org/dept/subdept
    -- ANDed. "Published" = lifecycle_status <> 'Draft' AND not soft-deleted.
    pub_shifts AS (
        SELECT
            s.id,
            s.assigned_employee_id,
            s.scheduled_start,
            s.published_at,
            s.bidding_open_at
        FROM shifts s
        WHERE s.deleted_at IS NULL
          AND s.lifecycle_status <> 'Draft'
          AND s.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR s.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id = ANY(p_subdept_ids))
    ),

    -- ── Per-shift open flag ───────────────────────────────────────────
    -- A shift is "open" (entered the marketplace as an unfilled posting) if
    -- it had >=1 OFFERED event OR >=1 shift_bids row OR went on bidding
    -- (bidding_open_at IS NOT NULL). "Covered" = open AND currently filled.
    shift_flags AS (
        SELECT
            ps.id,
            ps.assigned_employee_id,
            ps.scheduled_start,
            ps.published_at,
            (
                EXISTS (
                    SELECT 1 FROM shift_events e
                    WHERE e.shift_id = ps.id AND e.event_type = 'OFFERED'
                )
                OR EXISTS (
                    SELECT 1 FROM shift_bids b WHERE b.shift_id = ps.id
                )
                OR ps.bidding_open_at IS NOT NULL
            ) AS is_open
        FROM pub_shifts ps
    ),

    -- ── Shift Fill Rate + Open Shift Coverage + Publish Lead Time ─────
    -- avg_publish_lead_time_hours: average over published shifts of
    -- (scheduled_start - published_at) in hours. Rows with NULL
    -- scheduled_start / NULL published_at or a NEGATIVE delta (published
    -- after the shift was due to start) are discarded via the FILTER so they
    -- don't pollute the average. LOW lead time = manager-negative.
    shift_metrics AS (
        SELECT
            COUNT(*)::int                                                AS managed_published_shifts,
            COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL)::int
                                                                         AS filled_shifts,
            COUNT(*) FILTER (WHERE is_open)::int                         AS open_shifts,
            COUNT(*) FILTER (WHERE is_open AND assigned_employee_id IS NOT NULL)::int
                                                                         AS covered_open_shifts,
            AVG(
                EXTRACT(EPOCH FROM (scheduled_start - published_at)) / 3600.0
            ) FILTER (
                WHERE scheduled_start IS NOT NULL
                  AND published_at   IS NOT NULL
                  AND scheduled_start >= published_at
            )                                                            AS avg_publish_lead_time_hours
        FROM shift_flags
    ),

    -- ── Snapshot universe (Churn + Emergency Fill + Reassignment) ─────
    -- Snapshot-grain metrics are scoped by the snapshot's OWN denormalized
    -- org/dept/subdept + shift_date (NOT by joining shifts), per spec.
    -- One snapshot = one published-active assignment episode.
    snaps AS (
        SELECT
            asnp.shift_id,
            asnp.source,
            asnp.end_reason
        FROM assignment_snapshots asnp
        WHERE asnp.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR asnp.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR asnp.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR asnp.sub_department_id = ANY(p_subdept_ids))
    ),

    snapshot_metrics AS (
        SELECT
            COUNT(*)::int                                                AS published_snapshots,
            COUNT(DISTINCT shift_id)::int                               AS distinct_shifts,
            COUNT(*) FILTER (WHERE source = 'emergency')::int           AS emergency_fill_count,
            COUNT(*) FILTER (WHERE end_reason = 'reassigned')::int      AS reassignment_count
        FROM snaps
    ),

    -- ── Action split over enriched shift_events (event-grain) ─────────
    -- Window each event by joining its shift (shift_date + org/dept/subdept
    -- scope). actor_role is the manager/employee/system attribution added by
    -- migration 20260626090000. Events whose actor_role is NULL/other fall
    -- into none of the three buckets (the three counts need not sum to the
    -- total event count). Soft-deleted shifts are excluded.
    action_metrics AS (
        SELECT
            COUNT(*) FILTER (WHERE e.actor_role = 'manager')::int        AS manager_actions,
            COUNT(*) FILTER (WHERE e.actor_role = 'employee')::int       AS employee_actions,
            COUNT(*) FILTER (WHERE e.actor_role = 'system')::int         AS system_actions
        FROM shift_events e
        JOIN shifts s ON s.id = e.shift_id
        WHERE s.deleted_at IS NULL
          AND s.lifecycle_status <> 'Draft'
          AND s.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR s.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id = ANY(p_subdept_ids))
    )

    -- ── Single-row assembly with guarded divides + ROUND(...,2) ───────
    SELECT
        -- Shift Fill Rate
        sm.managed_published_shifts,
        sm.filled_shifts,
        CASE WHEN sm.managed_published_shifts = 0 THEN 0
             ELSE ROUND(sm.filled_shifts::numeric / sm.managed_published_shifts * 100, 2) END
                                                                         AS fill_rate,
        -- Open Shift Coverage Rate
        sm.open_shifts,
        sm.covered_open_shifts,
        CASE WHEN sm.open_shifts = 0 THEN 0
             ELSE ROUND(sm.covered_open_shifts::numeric / sm.open_shifts * 100, 2) END
                                                                         AS open_coverage_rate,
        -- Assignment Churn Rate, as a PERCENTAGE: extra owners per 100 shifts
        -- = (snapshots - distinct shifts) / distinct shifts * 100. (Can exceed
        -- 100 if shifts average >2 owners.)
        spm.published_snapshots,
        spm.distinct_shifts,
        CASE WHEN spm.distinct_shifts = 0 THEN 0
             ELSE ROUND(
                 (spm.published_snapshots - spm.distinct_shifts)::numeric
                 / spm.distinct_shifts * 100, 2) END                    AS churn_rate,
        -- Emergency Fill: count + rate over all snapshots in scope. HIGH rate =
        -- poor planning / short lead time (manager-negative).
        spm.emergency_fill_count,
        CASE WHEN spm.published_snapshots = 0 THEN 0
             ELSE ROUND(spm.emergency_fill_count::numeric
                        / spm.published_snapshots * 100, 2) END          AS emergency_fill_rate,
        -- Reassignment volume (snapshots ended by a manager reassignment)
        spm.reassignment_count,
        -- Average publish lead time (hours); NULL -> 0 when no resolvable shifts
        ROUND(COALESCE(sm.avg_publish_lead_time_hours, 0), 2)            AS avg_publish_lead_time_hours,
        -- Action split (event-grain, by actor_role)
        am.manager_actions,
        am.employee_actions,
        am.system_actions
    FROM shift_metrics     sm
    CROSS JOIN snapshot_metrics spm
    CROSS JOIN action_metrics   am;
END;
$function$;

COMMENT ON FUNCTION public.get_manager_scorecard(date, date, uuid[], uuid[], uuid[]) IS
'Single-row manager / roster-quality scorecard (fill / open-coverage / assignment-churn / emergency-fill / reassignment / publish-lead-time / manager-employee-system action split) for a [p_from,p_to] shift_date window, optionally scoped by org/dept/subdept arrays (NULL = no filter). Shift-grain metrics scope via shifts; churn/emergency/reassignment are snapshot-grain over assignment_snapshots; the action split is event-grain over shift_events.actor_role joined to shifts. emergency_fill_rate and a LOW avg_publish_lead_time_hours are manager-NEGATIVE (worse planning). SECURITY DEFINER / STABLE.';
