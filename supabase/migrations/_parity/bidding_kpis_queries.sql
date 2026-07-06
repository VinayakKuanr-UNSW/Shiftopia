-- =====================================================================
-- Bidding-funnel KPI — standalone validation queries (NON-MIGRATION)
-- =====================================================================
-- PURPOSE: Hand-runnable, per-metric queries that reproduce each number
-- emitted by public.get_bidding_kpis(...). Run these against prod by hand
-- to validate the RPC's single-row output, or to debug a discrepancy.
--
-- DO NOT include this file in the migration apply path (it lives under
-- supabase/migrations/_parity/, which is excluded from `supabase db push`).
-- There is no SQL test harness; these are eyeball/diff aids only.
--
-- Every query below uses the SAME scope contract as the RPC:
--   * window : shift_date BETWEEN :p_from AND :p_to
--   * scope  : org/dept/subdept arrays, NULL = no filter, ANDed via = ANY(...)
--   * "open bidding shift" := non-deleted shift in window/scope that ENTERED
--        bidding, i.e. bidding_open_at IS NOT NULL OR has >=1 shift_bids row.
-- Replace the :p_* placeholders (psql \set or literal substitution) first.
--
-- ---------------------------------------------------------------------
-- DEFINITIONS (see the RPC header for full detail):
--   open_bidding_shift     := deleted_at IS NULL AND in window/scope AND
--                             (bidding_open_at IS NOT NULL
--                              OR EXISTS shift_bids row for it)
--   winners_selected/filled := open_bidding_shift AND assigned_employee_id NOT NULL
--   unfilled_open_shifts   := open_bidding_shift AND assigned_employee_id NULL
--   total_bids             := COUNT(shift_bids rows) over the open bidding shifts
--   avg_bids_per_open_shift := total_bids / open_bidding_shifts            (ratio)
--   open_shift_fill_rate   := winners_selected / open_bidding_shifts * 100  (%)
--   bid_success_rate       := winners_selected / total_bids * 100           (%)
--   unfilled_open_shift_rate := unfilled_open_shifts / open_bidding_shifts*100 (%)
-- =====================================================================


-- =====================================================================
-- The reusable "open bidding shift" universe (used by every metric below).
-- =====================================================================
-- WITH open_shifts AS (
--     SELECT s.id, s.assigned_employee_id
--     FROM shifts s
--     WHERE s.deleted_at IS NULL
--       AND s.shift_date BETWEEN :p_from AND :p_to
--       AND (:p_org_ids::uuid[]     IS NULL OR s.organization_id   = ANY(:p_org_ids::uuid[]))
--       AND (:p_dept_ids::uuid[]    IS NULL OR s.department_id     = ANY(:p_dept_ids::uuid[]))
--       AND (:p_subdept_ids::uuid[] IS NULL OR s.sub_department_id = ANY(:p_subdept_ids::uuid[]))
--       AND ( s.bidding_open_at IS NOT NULL
--             OR EXISTS (SELECT 1 FROM shift_bids b WHERE b.shift_id = s.id) )
-- )


-- =====================================================================
-- METRIC 1 — open_bidding_shifts (the funnel entry count)
-- =====================================================================
SELECT COUNT(*) AS open_bidding_shifts
FROM shifts s
WHERE s.deleted_at IS NULL
  AND s.shift_date BETWEEN :p_from AND :p_to
  AND (:p_org_ids::uuid[]     IS NULL OR s.organization_id   = ANY(:p_org_ids::uuid[]))
  AND (:p_dept_ids::uuid[]    IS NULL OR s.department_id     = ANY(:p_dept_ids::uuid[]))
  AND (:p_subdept_ids::uuid[] IS NULL OR s.sub_department_id = ANY(:p_subdept_ids::uuid[]))
  AND ( s.bidding_open_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM shift_bids b WHERE b.shift_id = s.id) );


-- =====================================================================
-- METRIC 2 — total_bids = COUNT(shift_bids rows) over the open bidding shifts
-- (counted ONLY over shifts that qualify as open bidding shifts, so the
--  average and bid_success_rate denominators stay consistent.)
-- =====================================================================
WITH open_shifts AS (
    SELECT s.id
    FROM shifts s
    WHERE s.deleted_at IS NULL
      AND s.shift_date BETWEEN :p_from AND :p_to
      AND (:p_org_ids::uuid[]     IS NULL OR s.organization_id   = ANY(:p_org_ids::uuid[]))
      AND (:p_dept_ids::uuid[]    IS NULL OR s.department_id     = ANY(:p_dept_ids::uuid[]))
      AND (:p_subdept_ids::uuid[] IS NULL OR s.sub_department_id = ANY(:p_subdept_ids::uuid[]))
      AND ( s.bidding_open_at IS NOT NULL
            OR EXISTS (SELECT 1 FROM shift_bids b WHERE b.shift_id = s.id) )
)
SELECT COUNT(b.id) AS total_bids
FROM shift_bids b
JOIN open_shifts os ON os.id = b.shift_id;


-- =====================================================================
-- METRIC 3 — winners_selected = open bidding shifts with a winner assigned
-- METRIC 4 — unfilled_open_shifts = open bidding shifts with NO winner
-- =====================================================================
SELECT
    COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL) AS winners_selected,
    COUNT(*) FILTER (WHERE s.assigned_employee_id IS NULL)     AS unfilled_open_shifts
FROM shifts s
WHERE s.deleted_at IS NULL
  AND s.shift_date BETWEEN :p_from AND :p_to
  AND (:p_org_ids::uuid[]     IS NULL OR s.organization_id   = ANY(:p_org_ids::uuid[]))
  AND (:p_dept_ids::uuid[]    IS NULL OR s.department_id     = ANY(:p_dept_ids::uuid[]))
  AND (:p_subdept_ids::uuid[] IS NULL OR s.sub_department_id = ANY(:p_subdept_ids::uuid[]))
  AND ( s.bidding_open_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM shift_bids b WHERE b.shift_id = s.id) );


-- =====================================================================
-- METRIC 5 — avg_bids_per_open_shift = total_bids / open_bidding_shifts (ratio)
-- METRIC 6 — open_shift_fill_rate    = winners_selected / open_bidding_shifts * 100
-- METRIC 7 — bid_success_rate        = winners_selected / total_bids * 100
-- METRIC 8 — unfilled_open_shift_rate = unfilled_open_shifts / open_bidding_shifts * 100
-- All-in-one: reproduces the full single-row RPC output with guarded divides.
-- =====================================================================
WITH open_shifts AS (
    SELECT s.id, s.assigned_employee_id
    FROM shifts s
    WHERE s.deleted_at IS NULL
      AND s.shift_date BETWEEN :p_from AND :p_to
      AND (:p_org_ids::uuid[]     IS NULL OR s.organization_id   = ANY(:p_org_ids::uuid[]))
      AND (:p_dept_ids::uuid[]    IS NULL OR s.department_id     = ANY(:p_dept_ids::uuid[]))
      AND (:p_subdept_ids::uuid[] IS NULL OR s.sub_department_id = ANY(:p_subdept_ids::uuid[]))
      AND ( s.bidding_open_at IS NOT NULL
            OR EXISTS (SELECT 1 FROM shift_bids b WHERE b.shift_id = s.id) )
),
bid_counts AS (
    SELECT COUNT(b.id) AS total_bids
    FROM shift_bids b
    JOIN open_shifts os ON os.id = b.shift_id
),
shift_metrics AS (
    SELECT
        COUNT(*)                                                  AS open_bidding_shifts,
        COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL)  AS winners_selected,
        COUNT(*) FILTER (WHERE assigned_employee_id IS NULL)      AS unfilled_open_shifts
    FROM open_shifts
)
SELECT
    sm.open_bidding_shifts,
    bc.total_bids,
    sm.winners_selected,
    sm.unfilled_open_shifts,
    CASE WHEN sm.open_bidding_shifts = 0 THEN 0
         ELSE ROUND(bc.total_bids::numeric / sm.open_bidding_shifts, 2)
    END AS avg_bids_per_open_shift,
    CASE WHEN sm.open_bidding_shifts = 0 THEN 0
         ELSE ROUND(sm.winners_selected::numeric / sm.open_bidding_shifts * 100, 2)
    END AS open_shift_fill_rate,
    CASE WHEN bc.total_bids = 0 THEN 0
         ELSE ROUND(sm.winners_selected::numeric / bc.total_bids * 100, 2)
    END AS bid_success_rate,
    CASE WHEN sm.open_bidding_shifts = 0 THEN 0
         ELSE ROUND(sm.unfilled_open_shifts::numeric / sm.open_bidding_shifts * 100, 2)
    END AS unfilled_open_shift_rate
FROM shift_metrics sm
CROSS JOIN bid_counts bc;


-- =====================================================================
-- EXAMPLE CALL — current quarter (Apr 1 .. Jun 30 2026), all scopes
-- =====================================================================
SELECT * FROM public.get_bidding_kpis(
    DATE '2026-04-01',   -- p_from
    DATE '2026-06-30',   -- p_to
    NULL,                -- p_org_ids     (no org filter)
    NULL,                -- p_dept_ids    (no dept filter)
    NULL                 -- p_subdept_ids (no sub-dept filter)
);

-- Scoped example: one org, one quarter.
-- SELECT * FROM public.get_bidding_kpis(
--     DATE '2026-04-01', DATE '2026-06-30',
--     ARRAY['00000000-0000-0000-0000-000000000000']::uuid[],
--     NULL, NULL
-- );


-- =====================================================================
-- WORKED CHECK against the canonical example dataset
-- =====================================================================
-- Dataset: 4 OPEN BIDDING SHIFTS in window/scope, with bids 3 + 5 + 0 + 2
--   = 10 total bids; 3 of the 4 shifts got a winner (assigned_employee_id
--   NOT NULL); 1 shift is unfilled. (The shift with 0 bids is still "open"
--   because it was posted to bidding, i.e. bidding_open_at IS NOT NULL.)
--
--   open_bidding_shifts      = 4
--   total_bids               = 3 + 5 + 0 + 2          = 10
--   winners_selected         = 3
--   unfilled_open_shifts     = 4 - 3                  = 1
--   avg_bids_per_open_shift  = 10 / 4                 = 2.50
--   open_shift_fill_rate     = 3  / 4  * 100          = 75.00
--   bid_success_rate         = 3  / 10 * 100          = 30.00
--   unfilled_open_shift_rate = 1  / 4  * 100          = 25.00
--
-- The all-in-one query (METRIC 5-8) and the RPC both emit exactly:
--   open_bidding_shifts=4, total_bids=10, winners_selected=3,
--   unfilled_open_shifts=1, avg_bids_per_open_shift=2.50,
--   open_shift_fill_rate=75.00, bid_success_rate=30.00,
--   unfilled_open_shift_rate=25.00
--
-- Self-consistency: open_bidding_shifts = winners_selected + unfilled_open_shifts
--   (4 = 3 + 1), and open_shift_fill_rate + unfilled_open_shift_rate = 100
--   (75 + 25), since every open shift is either filled or unfilled.
-- =====================================================================
