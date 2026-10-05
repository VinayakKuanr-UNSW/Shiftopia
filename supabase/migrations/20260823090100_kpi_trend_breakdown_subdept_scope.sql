-- ============================================================================
-- KPI consolidation — give get_insights_trend and get_dept_insights_breakdown
-- the p_subdept_ids parameter every other insights RPC already takes.
--
-- The Insights page has always passed a sub-department selection to
-- get_insights_summary while these two silently ignored it, so narrowing the
-- scope filter to a sub-department changed the KPI cards but not the trend
-- chart or the department table sitting beside them.
--
-- DROP + CREATE rather than CREATE OR REPLACE: a new argument list produces an
-- OVERLOAD, and two overloads that differ only by a defaulted trailing
-- argument make the PostgREST call ambiguous. Grants are restored below.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_insights_trend(date, date, uuid[], uuid[]);
DROP FUNCTION IF EXISTS public.get_dept_insights_breakdown(date, date, uuid[], uuid[]);

CREATE FUNCTION public.get_insights_trend(
    p_start_date  date,
    p_end_date    date,
    p_org_ids     uuid[] DEFAULT NULL::uuid[],
    p_dept_ids    uuid[] DEFAULT NULL::uuid[],
    p_subdept_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
    period_date     date,
    dept_id         uuid,
    dept_name       text,
    shifts_total    integer,
    shifts_assigned integer,
    fill_rate       numeric,
    estimated_cost  numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
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
      AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
      AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
      AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids))
    GROUP BY s.shift_date, s.department_id, d.name
    ORDER BY s.shift_date, d.name;
END;
$function$;

CREATE FUNCTION public.get_dept_insights_breakdown(
    p_start_date  date,
    p_end_date    date,
    p_org_ids     uuid[] DEFAULT NULL::uuid[],
    p_dept_ids    uuid[] DEFAULT NULL::uuid[],
    p_subdept_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
    dept_id         uuid,
    dept_name       text,
    shifts_total    integer,
    shifts_assigned integer,
    fill_rate       numeric,
    estimated_cost  numeric,
    no_show_count   integer,
    emergency_count integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
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
      AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
      AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
      AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids))
    GROUP BY s.department_id, d.name
    ORDER BY d.name;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_insights_trend(date, date, uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_insights_trend(date, date, uuid[], uuid[], uuid[]) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_dept_insights_breakdown(date, date, uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dept_insights_breakdown(date, date, uuid[], uuid[], uuid[]) TO authenticated, service_role;
