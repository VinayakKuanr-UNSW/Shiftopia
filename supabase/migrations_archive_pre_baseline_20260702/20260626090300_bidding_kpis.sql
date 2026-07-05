-- =====================================================================
-- Bidding-funnel KPI reporting layer
-- =====================================================================
-- A single SECURITY DEFINER / STABLE function that returns ONE ROW of
-- bidding-marketplace funnel metrics (raw counts + rates) for a date
-- window and an optional org / dept / sub-dept scope.
--
-- This sits alongside the broader marketplace KPIs
-- (20260625090200_marketplace_kpis.sql) and the per-employee performance
-- metrics, and deliberately MATCHES their conventions:
--   * org/dept/subdept array params (NULL = no filter) ANDed via `= ANY(...)`.
--   * SECURITY DEFINER, STABLE, search_path 'pg_catalog','public'.
--   * Every divide is guarded (CASE WHEN denom = 0 THEN 0 ...).
--   * Rates ROUND(...,2) and expressed as percentages (0..100).
--   * avg_bids_per_open_shift is a plain ratio (NOT a %), also ROUND(...,2).
--   * Exactly ONE row is always returned (CROSS JOIN of single-row CTEs).
--
-- DATA SOURCES (verified against src/platform/supabase/types.ts):
--   * public.shifts     — assigned_employee_id, shift_date, published_at,
--                         bidding_open_at, organization_id, department_id,
--                         sub_department_id, deleted_at.
--                         `bidding_open_at` (verified — same column used by
--                         the marketplace KPI fn and sm_decline_offer) is the
--                         "posted to bidding" timestamp; it is NON-NULL once a
--                         shift has entered the bidding marketplace.
--   * public.shift_bids — (id, shift_id, employee_id, status text, ...).
--                         One row = one bid placed. Row existence (any status)
--                         means the shift received that bid.
--
-- -------------------------------------------------------------------------
-- FUNNEL DEFINITIONS (implemented EXACTLY as specified)
-- -------------------------------------------------------------------------
-- open_bidding_shift     := non-deleted shift in window/scope that ENTERED
--                           bidding, i.e.
--                             bidding_open_at IS NOT NULL
--                             OR EXISTS (a shift_bids row for it).
--                           (A shift posted to bidding with ZERO bids still
--                            counts as open.)
-- winners_selected/filled := open_bidding_shift AND assigned_employee_id
--                           IS NOT NULL (it got a winner).
-- unfilled_open_shifts   := open_bidding_shift AND assigned_employee_id
--                           IS NULL.
-- total_bids             := COUNT of shift_bids rows across the open bidding
--                           shifts in window/scope.
-- avg_bids_per_open_shift := total_bids / open_bidding_shifts.
-- open_shift_fill_rate   := winners_selected / open_bidding_shifts * 100.
-- bid_success_rate       := winners_selected / total_bids * 100. (Winners are
--                           the winning bids — exactly one per filled bidding
--                           shift — over all bids placed.)
-- unfilled_open_shift_rate := unfilled_open_shifts / open_bidding_shifts*100.
--
-- NOTE on consistency: total_bids is counted ONLY over shifts that qualify as
-- open_bidding_shifts (the same scoped/windowed universe), so the per-shift
-- average and the bid_success_rate denominators always agree.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_bidding_kpis(
    p_from        date,
    p_to          date,
    p_org_ids     uuid[] DEFAULT NULL,
    p_dept_ids    uuid[] DEFAULT NULL,
    p_subdept_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
    open_bidding_shifts      int,
    total_bids               int,
    winners_selected         int,
    unfilled_open_shifts     int,
    avg_bids_per_open_shift  numeric,
    open_shift_fill_rate     numeric,
    bid_success_rate         numeric,
    unfilled_open_shift_rate numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    RETURN QUERY
    WITH
    -- ── Open bidding-shift universe ───────────────────────────────────
    -- Every non-deleted shift in [p_from, p_to] + org/dept/subdept scope
    -- that ENTERED bidding. A shift entered bidding if it has a
    -- bidding_open_at timestamp OR at least one shift_bids row exists for
    -- it (covers the case where the open timestamp was never stamped but a
    -- bid was still recorded). Shifts with zero bids that WERE posted to
    -- bidding (bidding_open_at IS NOT NULL) remain in scope.
    open_shifts AS (
        SELECT
            s.id,
            s.assigned_employee_id
        FROM shifts s
        WHERE s.deleted_at IS NULL
          AND s.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR s.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id = ANY(p_subdept_ids))
          AND (
                s.bidding_open_at IS NOT NULL
                OR EXISTS (SELECT 1 FROM shift_bids b WHERE b.shift_id = s.id)
              )
    ),

    -- ── Bids placed on the open bidding shifts ────────────────────────
    -- total_bids counts shift_bids rows (any status) ONLY for shifts that
    -- are in the open-bidding universe above, keeping every metric over a
    -- single consistent scope.
    bid_counts AS (
        SELECT COUNT(b.id)::int AS total_bids
        FROM shift_bids b
        JOIN open_shifts os ON os.id = b.shift_id
    ),

    -- ── Single-row shift-grain aggregate ──────────────────────────────
    shift_metrics AS (
        SELECT
            COUNT(*)::int AS open_bidding_shifts,
            COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL)::int
                AS winners_selected,
            COUNT(*) FILTER (WHERE assigned_employee_id IS NULL)::int
                AS unfilled_open_shifts
        FROM open_shifts
    )

    -- ── Single-row assembly with guarded divides + ROUND(...,2) ───────
    SELECT
        sm.open_bidding_shifts,
        bc.total_bids,
        sm.winners_selected,
        sm.unfilled_open_shifts,
        -- avg bids per open shift (plain ratio, not a percentage)
        CASE WHEN sm.open_bidding_shifts = 0 THEN 0
             ELSE ROUND(bc.total_bids::numeric / sm.open_bidding_shifts, 2)
        END AS avg_bids_per_open_shift,
        -- fill rate: winners / open shifts * 100
        CASE WHEN sm.open_bidding_shifts = 0 THEN 0
             ELSE ROUND(sm.winners_selected::numeric
                        / sm.open_bidding_shifts * 100, 2)
        END AS open_shift_fill_rate,
        -- bid success rate: winners (winning bids) / all bids placed * 100
        CASE WHEN bc.total_bids = 0 THEN 0
             ELSE ROUND(sm.winners_selected::numeric
                        / bc.total_bids * 100, 2)
        END AS bid_success_rate,
        -- unfilled open-shift rate: unfilled / open shifts * 100
        CASE WHEN sm.open_bidding_shifts = 0 THEN 0
             ELSE ROUND(sm.unfilled_open_shifts::numeric
                        / sm.open_bidding_shifts * 100, 2)
        END AS unfilled_open_shift_rate
    FROM shift_metrics sm
    CROSS JOIN bid_counts bc;
END;
$function$;

COMMENT ON FUNCTION public.get_bidding_kpis(date, date, uuid[], uuid[], uuid[]) IS
'Single-row bidding-funnel KPIs (open bidding shifts / total bids / winners / unfilled, plus avg_bids_per_open_shift, open_shift_fill_rate, bid_success_rate, unfilled_open_shift_rate) for a [p_from,p_to] shift_date window, optionally scoped by org/dept/subdept arrays (NULL = no filter). An "open bidding shift" entered bidding (bidding_open_at IS NOT NULL OR has a shift_bids row); total_bids is counted only over those shifts. All divides guarded; rates are percentages ROUND(...,2). SECURITY DEFINER / STABLE.';
