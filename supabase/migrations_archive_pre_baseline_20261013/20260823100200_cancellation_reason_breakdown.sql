-- ============================================================================
-- Per-reason cancellation distribution for KPI > Cancellations — the manager
-- half of the reason-capture feature.
--
-- Reads the CANCELLED / LATE_CANCELLED events sm_employee_drop_shift writes,
-- which is the only place a reason is recorded. Rows are scoped through the
-- SHIFT, not the event, because shift_events carries no org/dept columns.
--
-- LEFT JOIN onto cancellation_reasons so a code retired from the catalogue
-- still reports its historical cancellations instead of vanishing. Drops made
-- before reason capture existed surface as 'UNSPECIFIED' rather than being
-- dropped from the denominator, so the shares always total 100%.
--
-- Each row also splits standard / critical / emergent, so a manager sees not
-- just which reasons dominate but whether that reason tends to arrive with
-- notice. A non-zero emergent_count means a manager or override path was used:
-- self-service cannot reach inside the 4h window.
--
-- Verified in a rolled-back subtransaction with four seeded drops:
--   Illness   n=2 (1 standard 72h, 1 critical 10h)  50%  avg 41h
--   Transport n=1 (critical, emergent, 2h)          25%  avg 2h
--   Study     n=1 (standard, 100h)                  25%  avg 100h
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_cancellation_reason_breakdown(
    p_from        date,
    p_to          date,
    p_org_ids     uuid[] DEFAULT NULL::uuid[],
    p_dept_ids    uuid[] DEFAULT NULL::uuid[],
    p_subdept_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
    reason_code       text,
    reason_label      text,
    total             integer,
    standard_count    integer,
    critical_count    integer,
    emergent_count    integer,
    share_pct         numeric,
    avg_notice_hours  numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_perm jsonb;
    v_allowed_org_ids uuid[]; v_allowed_dept_ids uuid[]; v_allowed_subdept_ids uuid[];
    v_org_ids uuid[]; v_dept_ids uuid[]; v_subdept_ids uuid[];
BEGIN
    IF NOT public.is_manager_or_above() THEN
        RAISE EXCEPTION 'insufficient_privilege: managerial access required for KPI aggregates';
    END IF;

    v_perm := public.resolve_user_permissions();

    SELECT COALESCE(array_agg(DISTINCT (org->>'id')::uuid), ARRAY[]::uuid[])
      INTO v_allowed_org_ids
      FROM jsonb_array_elements(COALESCE(v_perm->'allowed_scope_tree'->'organizations', '[]'::jsonb)) org;

    SELECT COALESCE(array_agg(DISTINCT (dept->>'id')::uuid), ARRAY[]::uuid[])
      INTO v_allowed_dept_ids
      FROM jsonb_array_elements(COALESCE(v_perm->'allowed_scope_tree'->'organizations', '[]'::jsonb)) org,
           jsonb_array_elements(COALESCE(org->'departments', '[]'::jsonb)) dept;

    SELECT COALESCE(array_agg(DISTINCT (sd->>'id')::uuid), ARRAY[]::uuid[])
      INTO v_allowed_subdept_ids
      FROM jsonb_array_elements(COALESCE(v_perm->'allowed_scope_tree'->'organizations', '[]'::jsonb)) org,
           jsonb_array_elements(COALESCE(org->'departments', '[]'::jsonb)) dept,
           jsonb_array_elements(COALESCE(dept->'subdepartments', '[]'::jsonb)) sd;

    IF array_length(v_allowed_org_ids, 1) IS NULL THEN RETURN; END IF;

    v_org_ids := CASE WHEN p_org_ids IS NULL THEN v_allowed_org_ids
                      ELSE ARRAY(SELECT unnest(p_org_ids) INTERSECT SELECT unnest(v_allowed_org_ids)) END;
    v_dept_ids := CASE WHEN p_dept_ids IS NULL THEN v_allowed_dept_ids
                       ELSE ARRAY(SELECT unnest(p_dept_ids) INTERSECT SELECT unnest(v_allowed_dept_ids)) END;
    v_subdept_ids := CASE WHEN p_subdept_ids IS NULL THEN v_allowed_subdept_ids
                          ELSE ARRAY(SELECT unnest(p_subdept_ids) INTERSECT SELECT unnest(v_allowed_subdept_ids)) END;

    RETURN QUERY
    WITH drops AS (
        SELECT
            COALESCE(NULLIF(se.metadata->>'reason_code', ''), 'UNSPECIFIED') AS code,
            COALESCE(se.metadata->>'cancellation', 'standard')               AS kind,
            COALESCE(se.metadata->>'urgency', 'normal')                      AS urgency,
            NULLIF(se.metadata->>'notice_hours', '')::numeric                AS notice_hours
        FROM public.shift_events se
        JOIN public.shifts s ON s.id = se.shift_id
        WHERE se.event_type IN ('CANCELLED', 'LATE_CANCELLED')
          AND se.metadata->>'op' = 'employee_drop'
          AND s.shift_date BETWEEN p_from AND p_to
          AND (array_length(v_org_ids,1)     IS NULL OR s.organization_id    = ANY(v_org_ids))
          AND (array_length(v_dept_ids,1)    IS NULL OR s.department_id     = ANY(v_dept_ids))
          AND (array_length(v_subdept_ids,1) IS NULL OR s.sub_department_id = ANY(v_subdept_ids))
    ),
    grand AS (SELECT COUNT(*)::numeric AS n FROM drops)
    SELECT
        d.code,
        COALESCE(cr.label, initcap(replace(d.code, '_', ' ')))                      AS reason_label,
        COUNT(*)::int                                                                AS total,
        COUNT(*) FILTER (WHERE d.kind = 'standard')::int                             AS standard_count,
        COUNT(*) FILTER (WHERE d.kind = 'critical')::int                             AS critical_count,
        COUNT(*) FILTER (WHERE d.urgency = 'emergent')::int                          AS emergent_count,
        ROUND(CASE WHEN g.n = 0 THEN 0 ELSE COUNT(*)::numeric / g.n * 100 END, 1)    AS share_pct,
        ROUND(AVG(d.notice_hours), 1)                                                AS avg_notice_hours
    FROM drops d
    CROSS JOIN grand g
    LEFT JOIN public.cancellation_reasons cr ON cr.code = d.code
    GROUP BY d.code, cr.label, cr.sort_order, g.n
    ORDER BY COUNT(*) DESC, COALESCE(cr.sort_order, 1000), d.code;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_cancellation_reason_breakdown(date, date, uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_cancellation_reason_breakdown(date, date, uuid[], uuid[], uuid[]) TO authenticated, service_role;
