-- Migration: 20260807100300_unify_cost_rpcs_on_eba_engine.sql
-- Description: Points the three remaining cost-reporting RPCs at
--              fn_eba_shift_cost, so every cost surface in the app answers with
--              the same award rules as the per-shift cards.
--
-- WHAT EACH WAS DOING (measured against prod, 2026-08-07)
--   get_dept_insights_breakdown / get_insights_trend
--       net/60 * COALESCE(s.remuneration_rate, 0)
--       `remuneration_rate` is NULL on every shift in prod, so the Insights cost
--       breakdown and trend chart reported $0.00 for every department in every
--       period. COALESCE-to-0 made a missing rate indistinguishable from free
--       labour — the same failure shape as the planner footer's $0.00.
--   rpc_shift_coverage_stats
--       net/60 * COALESCE(s.remuneration_rate, 25)
--       A hardcoded $25/h: no classification, no casual loading, no penalties.
--
-- AFTER (6-31 Aug 2026, 156 shifts)
--   rpc_shift_coverage_stats        $41,477.14  — identical to the planner footer
--   get_dept_insights_breakdown     $484.96 for 2 assigned Casual L2 shifts,
--                                   i.e. 2 x $242.48, the exact per-card figure
--
-- The assigned-only filter is KEPT on the two insights functions: they report
-- what a period actually COST, and an unfilled shift cost nothing. That is the
-- opposite of the planner footer, which reports what a plan WILL cost and must
-- include unfilled shifts. Different questions, deliberately different filters.
-- `rpc_shift_coverage_stats` keeps its unfiltered total — it is a coverage /
-- demand view, not a spend view.
--
-- Now that trg_shift_employment_target_2_enforce guarantees an assigned member's
-- contract matches the shift's target, pricing an assigned shift off the target
-- is equivalent to pricing it off the person.

CREATE OR REPLACE FUNCTION public.get_dept_insights_breakdown(
    p_start_date date, p_end_date date,
    p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[])
RETURNS TABLE(dept_id uuid, dept_name text, shifts_total integer, shifts_assigned integer,
              fill_rate numeric, estimated_cost numeric, no_show_count integer, emergency_count integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        s.department_id,
        d.name,
        COUNT(*)::int,
        COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL)::int,
        ROUND(CASE WHEN COUNT(*)=0 THEN 0 ELSE COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL)::numeric/COUNT(*)*100 END,1),
        COALESCE(SUM(public.fn_eba_shift_cost(s)) FILTER (WHERE s.assigned_employee_id IS NOT NULL), 0),
        COUNT(*) FILTER (WHERE s.attendance_status='no_show' OR s.assignment_outcome='no_show')::int,
        COUNT(*) FILTER (WHERE s.emergency_assigned_at IS NOT NULL)::int
    FROM shifts s
    LEFT JOIN departments d ON d.id = s.department_id
    WHERE s.shift_date BETWEEN p_start_date AND p_end_date
      AND s.lifecycle_status != 'Draft'
      AND (p_org_ids  IS NULL OR s.organization_id = ANY(p_org_ids))
      AND (p_dept_ids IS NULL OR s.department_id   = ANY(p_dept_ids))
    GROUP BY s.department_id, d.name
    ORDER BY d.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_insights_trend(
    p_start_date date, p_end_date date,
    p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[])
RETURNS TABLE(period_date date, dept_id uuid, dept_name text, shifts_total integer,
              shifts_assigned integer, fill_rate numeric, estimated_cost numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        s.shift_date,
        s.department_id,
        d.name,
        COUNT(*)::int,
        COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL)::int,
        ROUND(CASE WHEN COUNT(*)=0 THEN 0 ELSE COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL)::numeric/COUNT(*)*100 END,1),
        COALESCE(SUM(public.fn_eba_shift_cost(s)) FILTER (WHERE s.assigned_employee_id IS NOT NULL), 0)
    FROM shifts s
    LEFT JOIN departments d ON d.id = s.department_id
    WHERE s.shift_date BETWEEN p_start_date AND p_end_date
      AND s.lifecycle_status != 'Draft'
      AND (p_org_ids  IS NULL OR s.organization_id = ANY(p_org_ids))
      AND (p_dept_ids IS NULL OR s.department_id   = ANY(p_dept_ids))
    GROUP BY s.shift_date, s.department_id, d.name
    ORDER BY s.shift_date, d.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_shift_coverage_stats(
    p_org_id uuid, p_date_from date, p_date_to date)
RETURNS TABLE(shift_date date, group_type text, sub_group_name text, role_id uuid,
              remuneration_level smallint, total_shifts bigint, assigned_shifts bigint,
              published_shifts bigint, total_net_minutes bigint, estimated_cost numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    s.shift_date,
    s.group_type,
    s.sub_group_name,
    s.role_id,
    s.remuneration_level,
    COUNT(*)                                                   AS total_shifts,
    COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL)  AS assigned_shifts,
    COUNT(*) FILTER (WHERE s.lifecycle_status = 'Published')    AS published_shifts,
    COALESCE(SUM(s.net_length_minutes), 0)::bigint              AS total_net_minutes,
    COALESCE(SUM(public.fn_eba_shift_cost(s)), 0)               AS estimated_cost
  FROM shifts s
  WHERE
    s.organization_id = p_org_id
    AND s.shift_date BETWEEN p_date_from AND p_date_to
    AND s.is_cancelled = false
    AND s.deleted_at IS NULL
  GROUP BY 1, 2, 3, 4, 5
  ORDER BY 1, 2, 3
$function$;

ALTER FUNCTION public.get_dept_insights_breakdown(date, date, uuid[], uuid[]) OWNER TO postgres;
ALTER FUNCTION public.get_insights_trend(date, date, uuid[], uuid[])          OWNER TO postgres;
ALTER FUNCTION public.rpc_shift_coverage_stats(uuid, date, date)              OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_dept_insights_breakdown(date, date, uuid[], uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_insights_trend(date, date, uuid[], uuid[])          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_shift_coverage_stats(uuid, date, date)              FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dept_insights_breakdown(date, date, uuid[], uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_insights_trend(date, date, uuid[], uuid[])          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_shift_coverage_stats(uuid, date, date)              TO authenticated, service_role;
