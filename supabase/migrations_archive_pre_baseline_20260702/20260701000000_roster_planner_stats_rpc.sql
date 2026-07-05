-- Roster Planner footer totals RPC.
--
-- Returns a SINGLE row of totals for the Roster Planner stats footer so that
-- every view (bucket / day / week / month) renders the same, server-truth
-- numbers instead of re-deriving them client-side per view.
--
-- Notes:
--   * Cancelled shifts are EXCLUDED from total/assigned/open and from the
--     net-minutes / unique-employees / est_cost aggregates. This matches the
--     day-view projection in `buildStats` (cancelled shifts are not counted).
--     `cancelled_shifts` and `published_shifts` are reported separately for
--     completeness.
--   * `est_cost` is BASE-RATE ONLY: net hours * rate, summed over assigned,
--     non-cancelled shifts, where rate = COALESCE(shift.actual_hourly_rate,
--     shift.remuneration_rate, role's remuneration-level hourly_rate_min, 0).
--     In current prod the shift-level rate columns are unpopulated, so the
--     role → remuneration_levels chain is the effective rate source. Penalty /
--     overtime / award loadings are NOT modeled in SQL — a full award cost
--     would require a persisted per-shift cost column.
--   * `budget_cost` is sourced from `department_budgets`, PRO-RATED by the
--     day-overlap between each budget's [period_start, period_end] and the
--     requested [p_start_date, p_end_date] window, so a week view against a
--     monthly budget shows ~1/4 of it. Scoped to the org (via departments) and
--     to p_department_ids when provided. Returns 0 when no budget row overlaps
--     — the UI hides Budget/Remaining unless budget_cost > 0 (never a fake
--     placeholder). Sub-department filtering is not applied: budgets are
--     department-level.
--   * SECURITY INVOKER (default) so RLS on `shifts` applies to the caller.
--   * Reuses the existing covering index `idx_shifts_summary_covering`
--     (created by 20260609110729_roster_summary_rpc_subgroup_granularity.sql);
--     no new index is created here.

DROP FUNCTION IF EXISTS public.get_roster_planner_stats(uuid,date,date,uuid[],uuid[]);

CREATE OR REPLACE FUNCTION public.get_roster_planner_stats(
  p_organization_id uuid,
  p_start_date date,
  p_end_date date,
  p_department_ids uuid[] DEFAULT NULL,
  p_sub_department_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  total_shifts int,
  assigned_shifts int,
  open_shifts int,
  published_shifts int,
  cancelled_shifts int,
  total_net_minutes bigint,
  unique_employees int,
  est_cost numeric,
  budget_cost numeric
)
LANGUAGE sql STABLE
-- Pin search_path (clears the function_search_path_mutable advisory). Safe here
-- anyway (SECURITY INVOKER), but explicit is best practice.
SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE NOT s.is_cancelled)::int AS total_shifts,
    COUNT(*) FILTER (WHERE NOT s.is_cancelled AND s.assigned_employee_id IS NOT NULL)::int AS assigned_shifts,
    COUNT(*) FILTER (WHERE NOT s.is_cancelled AND s.assigned_employee_id IS NULL)::int AS open_shifts,
    COUNT(*) FILTER (WHERE s.lifecycle_status IN ('Published','InProgress','Completed'))::int AS published_shifts,
    COUNT(*) FILTER (WHERE s.is_cancelled)::int AS cancelled_shifts,
    COALESCE(SUM(s.net_length_minutes) FILTER (WHERE NOT s.is_cancelled), 0)::bigint AS total_net_minutes,
    COUNT(DISTINCT s.assigned_employee_id) FILTER (WHERE NOT s.is_cancelled)::int AS unique_employees,
    COALESCE(SUM( (s.net_length_minutes/60.0) * COALESCE(s.actual_hourly_rate, s.remuneration_rate, rl.hourly_rate_min, 0) )
             FILTER (WHERE NOT s.is_cancelled AND s.assigned_employee_id IS NOT NULL), 0)::numeric AS est_cost,
    -- Pro-rated department budget overlapping the requested window (scalar subquery).
    (
      SELECT COALESCE(SUM(
        db.budgeted_cost
        * ( (LEAST(db.period_end, p_end_date) - GREATEST(db.period_start, p_start_date) + 1)::numeric
            / NULLIF((db.period_end - db.period_start + 1), 0) )
      ), 0)::numeric
      FROM public.department_budgets db
      JOIN public.departments d
        ON d.id = db.dept_id
       AND d.organization_id = p_organization_id
      WHERE db.period_start <= p_end_date
        AND db.period_end   >= p_start_date
        AND (p_department_ids IS NULL OR db.dept_id = ANY(p_department_ids))
    ) AS budget_cost
  FROM shifts s
  -- Rate fallback chain: shift rate cols are unpopulated in prod, so the
  -- assigned role's remuneration level supplies the effective base rate.
  -- Both joins are 1:1 on PKs, so they do not affect the COUNT aggregates.
  LEFT JOIN roles r ON r.id = s.role_id
  LEFT JOIN remuneration_levels rl ON rl.id = r.remuneration_level_id
  WHERE s.organization_id = p_organization_id
    AND s.shift_date BETWEEN p_start_date AND p_end_date
    AND s.deleted_at IS NULL
    AND (p_department_ids IS NULL OR s.department_id = ANY(p_department_ids))
    AND (p_sub_department_ids IS NULL OR s.sub_department_id = ANY(p_sub_department_ids));
$$;
