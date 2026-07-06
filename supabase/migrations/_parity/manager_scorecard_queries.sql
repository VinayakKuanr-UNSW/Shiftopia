-- =====================================================================
-- Manager Scorecard — standalone validation queries (NON-MIGRATION)
-- =====================================================================
-- PURPOSE: Hand-runnable, per-metric queries that reproduce each number
-- emitted by public.get_manager_scorecard(...). Run these against prod by
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
-- Replace the :p_* placeholders (psql \set or literal substitution) before
-- running.
--
-- ---------------------------------------------------------------------
-- GRAIN ROUTING (must match the RPC):
--   * shift-grain    -> scope via the `shifts` table (fill, coverage, lead time)
--   * snapshot-grain -> scope via assignment_snapshots' OWN denormalized
--                       org/dept/subdept + shift_date (churn, emergency, reassign)
--   * event-grain    -> scope via shift_events JOINed to shifts (action split)
--
-- CONVENTIONS used everywhere (see the RPC header for full detail):
--   "Published" shift := lifecycle_status <> 'Draft' AND deleted_at IS NULL
--   "Filled"   shift  := published shift with assigned_employee_id NOT NULL
--                        (ASSIGNMENT, not attendance — a no-show is filled)
--   "Open"     shift  := published shift that entered the marketplace as a
--                        posting: >=1 OFFERED event OR >=1 shift_bids row OR
--                        bidding_open_at IS NOT NULL (went on bidding)
--   "Covered"  open   := open shift that is CURRENTLY filled
--                        (is_open AND assigned_employee_id IS NOT NULL)
-- =====================================================================


-- =====================================================================
-- METRIC 1 — Shift Fill Rate = filled_shifts / managed_published_shifts
-- (shift-grain)
-- =====================================================================
SELECT
    COUNT(*)                                                          AS managed_published_shifts,
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
-- (shift-grain)
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
    COUNT(*) FILTER (WHERE is_open)                                       AS open_shifts,
    COUNT(*) FILTER (WHERE is_open AND assigned_employee_id IS NOT NULL)  AS covered_open_shifts,
    CASE WHEN COUNT(*) FILTER (WHERE is_open) = 0 THEN 0
         ELSE ROUND(
            COUNT(*) FILTER (WHERE is_open AND assigned_employee_id IS NOT NULL)::numeric
            / COUNT(*) FILTER (WHERE is_open) * 100, 2) END               AS open_coverage_rate
FROM flagged;


-- =====================================================================
-- METRIC 3 — Assignment Churn Rate (snapshot-grain)
-- churn_rate = (snapshots - distinct shift_id) / distinct shift_id * 100
-- A PERCENTAGE: extra owners per 100 shifts. Scoped by the SNAPSHOT's own
-- denormalized org/dept/subdept + shift_date (NOT by joining shifts).
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
    COUNT(*)                                                              AS published_snapshots,
    COUNT(DISTINCT shift_id)                                              AS distinct_shifts,
    CASE WHEN COUNT(DISTINCT shift_id) = 0 THEN 0
         ELSE ROUND(
            (COUNT(*) - COUNT(DISTINCT shift_id))::numeric
            / COUNT(DISTINCT shift_id) * 100, 2) END                      AS churn_rate
FROM snaps;


-- =====================================================================
-- METRIC 4 — Emergency Fill (snapshot-grain)
-- emergency_fill_count = snapshots with source='emergency'
-- emergency_fill_rate  = emergency_fill_count / count(all snapshots) * 100
-- HIGH = poor planning / short lead time (manager-NEGATIVE). Same snapshot
-- universe as METRIC 3 (snapshot-grain scope).
-- =====================================================================
WITH snaps AS (
    SELECT asnp.source
    FROM assignment_snapshots asnp
    WHERE asnp.shift_date BETWEEN :p_from AND :p_to
      AND (:p_org_ids::uuid[]     IS NULL OR asnp.organization_id   = ANY(:p_org_ids::uuid[]))
      AND (:p_dept_ids::uuid[]    IS NULL OR asnp.department_id     = ANY(:p_dept_ids::uuid[]))
      AND (:p_subdept_ids::uuid[] IS NULL OR asnp.sub_department_id = ANY(:p_subdept_ids::uuid[]))
)
SELECT
    COUNT(*) FILTER (WHERE source = 'emergency')                          AS emergency_fill_count,
    CASE WHEN COUNT(*) = 0 THEN 0
         ELSE ROUND(
            COUNT(*) FILTER (WHERE source = 'emergency')::numeric
            / COUNT(*) * 100, 2) END                                      AS emergency_fill_rate
FROM snaps;


-- =====================================================================
-- METRIC 5 — Reassignment count (snapshot-grain)
-- reassignment_count = snapshots with end_reason='reassigned'
-- (a manager pulled the incumbent and re-owned the shift). Same snapshot
-- universe as METRIC 3/4.
-- =====================================================================
SELECT
    COUNT(*) FILTER (WHERE asnp.end_reason = 'reassigned')                AS reassignment_count
FROM assignment_snapshots asnp
WHERE asnp.shift_date BETWEEN :p_from AND :p_to
  AND (:p_org_ids::uuid[]     IS NULL OR asnp.organization_id   = ANY(:p_org_ids::uuid[]))
  AND (:p_dept_ids::uuid[]    IS NULL OR asnp.department_id     = ANY(:p_dept_ids::uuid[]))
  AND (:p_subdept_ids::uuid[] IS NULL OR asnp.sub_department_id = ANY(:p_subdept_ids::uuid[]));


-- =====================================================================
-- METRIC 6 — Average Publish Lead Time (hours) (shift-grain)
-- avg_publish_lead_time_hours = avg over published shifts of
--   (scheduled_start - published_at) in hours.
-- Rows with NULL scheduled_start / NULL published_at, or a NEGATIVE delta
-- (published AFTER the shift was due to start), are discarded by the FILTER.
-- LOW lead time = manager-NEGATIVE (last-minute publishing).
-- =====================================================================
SELECT
    ROUND(COALESCE(
        AVG(EXTRACT(EPOCH FROM (s.scheduled_start - s.published_at)) / 3600.0)
        FILTER (
            WHERE s.scheduled_start IS NOT NULL
              AND s.published_at   IS NOT NULL
              AND s.scheduled_start >= s.published_at
        ), 0), 2)                                                         AS avg_publish_lead_time_hours
FROM shifts s
WHERE s.deleted_at IS NULL
  AND s.lifecycle_status <> 'Draft'
  AND s.shift_date BETWEEN :p_from AND :p_to
  AND (:p_org_ids::uuid[]     IS NULL OR s.organization_id   = ANY(:p_org_ids::uuid[]))
  AND (:p_dept_ids::uuid[]    IS NULL OR s.department_id     = ANY(:p_dept_ids::uuid[]))
  AND (:p_subdept_ids::uuid[] IS NULL OR s.sub_department_id = ANY(:p_subdept_ids::uuid[]));


-- =====================================================================
-- METRIC 7 — Action split (event-grain, by actor_role)
-- manager_actions / employee_actions / system_actions =
--   COUNT(*) FILTER (WHERE actor_role = '...') over shift_events in scope.
-- Events windowed by JOINing their shift (shift_date + org/dept/subdept;
-- published, not soft-deleted). actor_role is the enrichment column added by
-- migration 20260626090000. NULL / other actor_role values fall into NONE of
-- the three buckets, so the three counts need not sum to the total event
-- count for the window.
-- =====================================================================
SELECT
    COUNT(*) FILTER (WHERE e.actor_role = 'manager')                      AS manager_actions,
    COUNT(*) FILTER (WHERE e.actor_role = 'employee')                     AS employee_actions,
    COUNT(*) FILTER (WHERE e.actor_role = 'system')                       AS system_actions
FROM shift_events e
JOIN shifts s ON s.id = e.shift_id
WHERE s.deleted_at IS NULL
  AND s.lifecycle_status <> 'Draft'
  AND s.shift_date BETWEEN :p_from AND :p_to
  AND (:p_org_ids::uuid[]     IS NULL OR s.organization_id   = ANY(:p_org_ids::uuid[]))
  AND (:p_dept_ids::uuid[]    IS NULL OR s.department_id     = ANY(:p_dept_ids::uuid[]))
  AND (:p_subdept_ids::uuid[] IS NULL OR s.sub_department_id = ANY(:p_subdept_ids::uuid[]));


-- =====================================================================
-- EXAMPLE CALL — current quarter, whole-org (no scope filter)
-- =====================================================================
-- The RPC bundles all seven metrics above into a single row. For the
-- current calendar quarter:
SELECT *
FROM public.get_manager_scorecard(
    date_trunc('quarter', CURRENT_DATE)::date,                 -- p_from: first day of this quarter
    (date_trunc('quarter', CURRENT_DATE) + interval '3 months - 1 day')::date,  -- p_to: last day of this quarter
    NULL,   -- p_org_ids     (NULL = all orgs)
    NULL,   -- p_dept_ids    (NULL = all depts)
    NULL    -- p_subdept_ids (NULL = all sub-depts)
);

-- Scoped example: a single org for the same window
-- SELECT *
-- FROM public.get_manager_scorecard(
--     date_trunc('quarter', CURRENT_DATE)::date,
--     (date_trunc('quarter', CURRENT_DATE) + interval '3 months - 1 day')::date,
--     ARRAY['00000000-0000-0000-0000-000000000000']::uuid[],   -- p_org_ids
--     NULL,
--     NULL
-- );


-- =====================================================================
-- NOTES
-- =====================================================================
-- (a) ACTION-SPLIT SOURCE. manager/employee/system_actions are sourced
--     exclusively from public.shift_events.actor_role, the attribution
--     column added by migration 20260626090000 (domain text + actor_role
--     text). Apply order guarantees that column exists before
--     20260626090200 runs. The split is intentionally NOT derived from
--     event_type heuristics — actor_role is the single source of truth for
--     "who drove this event". Because actor_role can be NULL or hold a value
--     outside {manager, employee, system}, the three FILTERed counts need
--     not sum to the total number of in-scope events; they are independent
--     buckets, not a partition.
--
-- (b) EMERGENCY-FILL INTERPRETATION. emergency_fill_rate is a
--     manager-NEGATIVE signal: a high rate means a large share of filled
--     episodes were last-minute emergency assignments (source='emergency'),
--     i.e. the roster was published with too little lead time or coverage
--     gaps that had to be plugged reactively. Read it together with METRIC 6
--     (avg_publish_lead_time_hours, where LOW is also manager-negative): both
--     point at short-notice planning. By contrast, in the marketplace/employee
--     lens a fill is "good"; here the LENS is roster QUALITY, so the rate is
--     framed as a cost, not a win.
--
-- (c) GRAIN MISMATCH IS DELIBERATE. distinct_shifts (snapshot-grain, scoped
--     by the snapshot's denormalized columns) will NOT in general equal
--     filled_shifts (shift-grain, scoped via `shifts`). Snapshots only exist
--     for shifts that reached published-active assignment, can lag the live
--     shifts table, and are scoped by their own denormalized copy of
--     org/dept/subdept + shift_date. Do not expect the two to reconcile 1:1.
--
-- (d) ALWAYS ONE ROW. The RPC CROSS JOINs three single-row aggregate CTEs
--     (shift / snapshot / action), so it returns exactly one row even when
--     every input set is empty — all counts 0 and all guarded rates 0.
-- =====================================================================
