-- Migration: 20260807100100_planner_stats_use_eba_cost_engine.sql
-- Description: Points the planner footer's scheduled_cost / actual_cost at
--              fn_eba_estimate_shift_cost (20260807100000) instead of the flat
--              rate x hours introduced in 20260807090000.
--
-- Effect on the live roster (156 shifts, 6-31 Aug 2026):
--     flat rate x hours   $37,838.45
--     full award rules    $41,477.14   (+$3,638.69, +9.6%)
-- The difference is the cl 41 weekend loading the flat calculation could not see:
--     weekday  $1,455.33/day
--     Saturday $1,758.56/day   (+25% on the ordinary portion)
--     Sunday   $2,061.74/day   (+50%)
--
-- `est_cost` remains an alias of `scheduled_cost` for backward compatibility.

DROP FUNCTION IF EXISTS public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]);

CREATE OR REPLACE FUNCTION public.get_roster_planner_stats(
    p_organization_id uuid, p_start_date date, p_end_date date,
    p_department_ids uuid[] DEFAULT NULL::uuid[], p_sub_department_ids uuid[] DEFAULT NULL::uuid[])
RETURNS TABLE(total_shifts integer, assigned_shifts integer, open_shifts integer,
              published_shifts integer, cancelled_shifts integer, total_net_minutes bigint,
              unique_employees integer, est_cost numeric, budget_cost numeric,
              scheduled_cost numeric, actual_cost numeric, actual_net_minutes bigint,
              costed_shifts integer, uncosted_shifts integer, actual_shifts integer)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  WITH scoped AS (
      SELECT
          s.*,
          COALESCE(
              s.actual_hourly_rate,
              s.remuneration_rate,
              (
                  SELECT er.paid_hourly_rate
                    FROM public.eba_rate er
                   WHERE er.classification = 'LEVEL_' || s.remuneration_level::text
                     AND er.employment_basis = CASE
                             WHEN s.target_employment_type = 'Casual' THEN 'casual'
                             ELSE 'permanent'
                         END
                     AND er.effective_from <= s.shift_date
                   ORDER BY er.effective_from DESC
                   LIMIT 1
              )
          ) AS resolved_rate,
          CASE
              WHEN ts.start_time IS NOT NULL AND ts.end_time IS NOT NULL THEN
                  GREATEST(0, (EXTRACT(EPOCH FROM (
                      (s.shift_date + ts.end_time)
                        + CASE WHEN ts.end_time <= ts.start_time
                               THEN INTERVAL '1 day' ELSE INTERVAL '0' END
                        - (s.shift_date + ts.start_time)
                  )) / 60)::int - COALESCE(s.unpaid_break_minutes, 0))
              WHEN s.actual_start IS NOT NULL AND s.actual_end IS NOT NULL THEN
                  GREATEST(0, (EXTRACT(EPOCH FROM (s.actual_end - s.actual_start)) / 60)::int
                              - COALESCE(s.unpaid_break_minutes, 0))
              ELSE NULL
          END AS worked_minutes
      FROM public.shifts s
      LEFT JOIN LATERAL (
          SELECT t.start_time, t.end_time
            FROM public.timesheets t
           WHERE t.shift_id = s.id
           ORDER BY t.start_time NULLS LAST
           LIMIT 1
      ) ts ON TRUE
      WHERE s.organization_id = p_organization_id
        AND s.shift_date BETWEEN p_start_date AND p_end_date
        AND s.deleted_at IS NULL
        AND (p_department_ids IS NULL OR s.department_id = ANY(p_department_ids))
        AND (p_sub_department_ids IS NULL OR s.sub_department_id = ANY(p_sub_department_ids))
  ),
  priced AS (
      SELECT
          scoped.*,
          -- Full award pricing: cl 41 penalties, cl 41.4 non-cumulative loadings,
          -- cl 42 tiered overtime + PH floor, cl 43 night allowance, cl 28.1 meal,
          -- cl 12/56.2 minimum engagement, overnight midnight split.
          public.fn_eba_estimate_shift_cost(
              shift_date, start_time, net_length_minutes, scheduled_length_minutes,
              resolved_rate, target_employment_type,
              COALESCE(target_requires_flexible, false), COALESCE(is_training, false)
          ) AS sched_shift_cost,
          CASE WHEN worked_minutes IS NULL THEN NULL ELSE
              public.fn_eba_estimate_shift_cost(
                  shift_date, start_time, worked_minutes, scheduled_length_minutes,
                  resolved_rate, target_employment_type,
                  COALESCE(target_requires_flexible, false), COALESCE(is_training, false)
              )
          END AS actual_shift_cost
      FROM scoped
  )
  SELECT
      COUNT(*) FILTER (WHERE NOT is_cancelled)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND assigned_employee_id IS NOT NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND assigned_employee_id IS NULL)::int,
      COUNT(*) FILTER (WHERE lifecycle_status IN ('Published','InProgress','Completed'))::int,
      COUNT(*) FILTER (WHERE is_cancelled)::int,
      COALESCE(SUM(net_length_minutes) FILTER (WHERE NOT is_cancelled), 0)::bigint,
      COUNT(DISTINCT assigned_employee_id) FILTER (WHERE NOT is_cancelled)::int,
      COALESCE(SUM(sched_shift_cost) FILTER (WHERE NOT is_cancelled), 0)::numeric,
      (
        SELECT COALESCE(SUM(
          db.budgeted_cost
          * ( (LEAST(db.period_end, p_end_date) - GREATEST(db.period_start, p_start_date) + 1)::numeric
              / NULLIF((db.period_end - db.period_start + 1), 0) )
        ), 0)::numeric
        FROM public.department_budgets db
        JOIN public.departments d ON d.id = db.dept_id AND d.organization_id = p_organization_id
        WHERE db.period_start <= p_end_date AND db.period_end >= p_start_date
          AND (p_department_ids IS NULL OR db.dept_id = ANY(p_department_ids))
      ),
      COALESCE(SUM(sched_shift_cost) FILTER (WHERE NOT is_cancelled), 0)::numeric,
      COALESCE(SUM(actual_shift_cost) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL), 0)::numeric,
      COALESCE(SUM(worked_minutes) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL), 0)::bigint,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND resolved_rate IS NOT NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND resolved_rate IS NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL)::int
  FROM priced;
$function$;

ALTER FUNCTION public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]) OWNER TO postgres;

COMMENT ON FUNCTION public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]) IS
    'Roster Planner footer totals. scheduled_cost = the roster as planned (all live shifts, filled or not); actual_cost = what was worked. Both priced by fn_eba_estimate_shift_cost, the SQL port of the TypeScript EBA engine, so the footer agrees with the per-shift cards to the cent on ordinary/weekend/PH/night/overtime shifts.';

REVOKE ALL ON FUNCTION public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]) TO service_role;
