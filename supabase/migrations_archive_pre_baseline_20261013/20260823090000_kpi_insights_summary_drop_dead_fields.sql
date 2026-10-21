-- ============================================================================
-- KPI consolidation — remove the four fields of get_insights_summary that no
-- longer describe anything real.
--
--   compliance_failures    was the literal 0. Every caller rendered it as a
--                          headline KPI with threshold colouring, so the card
--                          structurally could not be non-zero.
--   last_minute_changes    was COALESCE(v_emergency, 0) — the SAME value as
--                          shifts_emergency, returned under a second name with
--                          a subtitle ("edits/unassigns within 24h") that
--                          described a metric nobody computed.
--   avg_reliability_score  read employee_performance_metrics, a snapshot table
--   avg_swap_rate          whose last calculated_at is 2026-07-30 and whose
--                          only writer (a Refresh button) no longer exists.
--                          The live equivalents come from
--                          get_quarterly_performance_report.
--
-- Nothing here changes a number that was correct. Callers are updated in the
-- same release; InsightsSummary drops the four keys.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_insights_summary(
    p_start_date  date,
    p_end_date    date,
    p_org_ids     uuid[] DEFAULT NULL::uuid[],
    p_dept_ids    uuid[] DEFAULT NULL::uuid[],
    p_subdept_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
DECLARE
    v_total       int; v_published   int; v_assigned    int;
    v_cancelled   int; v_completed   int; v_no_show     int;
    v_emergency   int; v_sched_hrs   numeric; v_cost      numeric;
    v_comp_over   int;
BEGIN
    SELECT
        COUNT(*)                                                             ,
        COUNT(*) FILTER (WHERE s.is_published = true)                       ,
        COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL)           ,
        COUNT(*) FILTER (WHERE s.is_cancelled = true)                       ,
        COUNT(*) FILTER (WHERE s.lifecycle_status = 'Completed')            ,
        COUNT(*) FILTER (WHERE s.attendance_status = 'no_show'
                            OR s.assignment_outcome = 'no_show')            ,
        COUNT(*) FILTER (WHERE s.emergency_assigned_at IS NOT NULL)          ,
        COALESCE(SUM(COALESCE(s.net_length_minutes,0)::numeric / 60)
            FILTER (WHERE s.assigned_employee_id IS NOT NULL), 0)           ,
        COALESCE(SUM(public.fn_eba_shift_cost(s))
            FILTER (WHERE s.assigned_employee_id IS NOT NULL), 0)
    INTO
        v_total, v_published, v_assigned, v_cancelled,
        v_completed, v_no_show, v_emergency, v_sched_hrs, v_cost
    FROM shifts s
    WHERE s.shift_date BETWEEN p_start_date AND p_end_date
      AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
      AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
      AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids));

    -- compliance_override = true means a manager approved despite a warning
    SELECT COUNT(*) FILTER (WHERE s.compliance_override = true)
    INTO v_comp_over
    FROM shifts s
    WHERE s.shift_date BETWEEN p_start_date AND p_end_date
      AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
      AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
      AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids));

    RETURN json_build_object(
        'shifts_total',          COALESCE(v_total, 0),
        'shifts_published',      COALESCE(v_published, 0),
        'shifts_assigned',       COALESCE(v_assigned, 0),
        'shifts_unassigned',     GREATEST(0, COALESCE(v_total,0) - COALESCE(v_assigned,0) - COALESCE(v_cancelled,0)),
        'shifts_cancelled',      COALESCE(v_cancelled, 0),
        'shifts_completed',      COALESCE(v_completed, 0),
        'shifts_no_show',        COALESCE(v_no_show, 0),
        'shifts_emergency',      COALESCE(v_emergency, 0),
        'scheduled_hours',       COALESCE(v_sched_hrs, 0),
        'estimated_cost',        COALESCE(v_cost, 0),
        -- assigned / TOTAL. The card subtitle must name `shifts_total` as the
        -- denominator: it previously read "{assigned} / {published}", which in
        -- production rendered "47 / 8 published" under a figure of 83.9%.
        'shift_fill_rate',       CASE WHEN COALESCE(v_total,0) = 0 THEN 0
                                      ELSE ROUND(v_assigned::numeric / v_total * 100, 1) END,
        'compliance_overrides',  COALESCE(v_comp_over, 0),
        'no_show_rate',          CASE WHEN COALESCE(v_assigned,0) = 0 THEN 0
                                      ELSE ROUND(v_no_show::numeric / v_assigned * 100, 1) END
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_insights_summary(date, date, uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_insights_summary(date, date, uuid[], uuid[], uuid[]) TO authenticated, service_role;
