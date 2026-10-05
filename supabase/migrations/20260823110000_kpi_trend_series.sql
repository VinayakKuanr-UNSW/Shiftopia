-- ============================================================================
-- Band B — the trend series for all four KPI tabs.
--
-- get_kpi_behaviour_trend   attendance + cancellations, from assignment_snapshots
-- get_kpi_marketplace_trend bidding + swaps, from shifts / shift_bids / swap_requests
--
-- The behaviour trend uses the SAME aggregate expressions as
-- get_kpi_behaviour_summary, grouped by bucket instead of collapsed. Summing
-- any column across every bucket reproduces the headline figure exactly, so a
-- tile and the chart beneath it cannot disagree — verified against production.
--
-- Both bucket on the SHIFT DATE, never on when a bid or swap was created: a
-- bucket answers "what happened to the shifts scheduled that week", and
-- bucketing a bid by its own timestamp would separate it from its shift.
--
-- Grain is 'week' (default) or 'day'. A quarter is ~13 weeks or ~90 days, and
-- weekly is the readable default for a roster this size. p_grain is
-- WHITELISTED rather than interpolated — it reaches date_trunc.
--
-- Empty buckets are emitted as zero rows via generate_series, so a quiet week
-- draws a gap at zero rather than the line jumping over it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_kpi_behaviour_trend(
    p_from        date,
    p_to          date,
    p_grain       text   DEFAULT 'week',
    p_org_ids     uuid[] DEFAULT NULL::uuid[],
    p_dept_ids    uuid[] DEFAULT NULL::uuid[],
    p_subdept_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
    bucket_start           date,
    held                   integer,
    worked                 integer,
    no_show                integer,
    standard_cancellations integer,
    critical_cancellations integer,
    swapped_out            integer,
    on_time_in             integer,
    late_clock_in          integer,
    early_clock_out        integer,
    auto_clock_out         integer,
    attendance_compliant   integer,
    no_show_rate           numeric,
    attendance_compliance_rate numeric,
    standard_cancel_rate   numeric,
    critical_cancel_rate   numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_perm jsonb;
    v_allowed_org_ids uuid[]; v_allowed_dept_ids uuid[]; v_allowed_subdept_ids uuid[];
    v_org_ids uuid[]; v_dept_ids uuid[]; v_subdept_ids uuid[];
    v_grain text;
BEGIN
    IF NOT public.is_manager_or_above() THEN
        RAISE EXCEPTION 'insufficient_privilege: managerial access required for KPI aggregates';
    END IF;

    -- Whitelist, never interpolate: p_grain reaches date_trunc.
    v_grain := CASE lower(COALESCE(p_grain, 'week')) WHEN 'day' THEN 'day' ELSE 'week' END;

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
    WITH buckets AS (
        SELECT generate_series(
                   date_trunc(v_grain, p_from::timestamp),
                   date_trunc(v_grain, p_to::timestamp),
                   CASE v_grain WHEN 'day' THEN interval '1 day' ELSE interval '1 week' END
               )::date AS b
    ),
    agg AS (
        SELECT
            date_trunc(v_grain, s.shift_date::timestamp)::date                       AS b,
            COUNT(*)::int                                                            AS c_held,
            COUNT(*) FILTER (WHERE s.end_reason = 'worked')::int                     AS c_worked,
            COUNT(*) FILTER (WHERE s.end_reason = 'no_show')::int                    AS c_no_show,
            COUNT(*) FILTER (WHERE s.end_reason = 'dropped_std')::int                AS c_std,
            COUNT(*) FILTER (WHERE s.end_reason = 'dropped_late')::int               AS c_critical,
            COUNT(*) FILTER (WHERE s.end_reason = 'traded_out')::int                 AS c_swap,
            COUNT(*) FILTER (WHERE s.on_time_in     AND s.end_reason = 'worked')::int AS c_oti,
            COUNT(*) FILTER (WHERE s.late_in        AND s.end_reason = 'worked')::int AS c_li,
            COUNT(*) FILTER (WHERE s.early_out      AND s.end_reason = 'worked')::int AS c_eo,
            COUNT(*) FILTER (WHERE s.auto_clock_out AND s.end_reason = 'worked')::int AS c_aco,
            COUNT(*) FILTER (WHERE s.end_reason = 'worked'
                             AND NOT s.late_in AND NOT s.early_out)::int              AS c_compliant
        FROM public.assignment_snapshots s
        WHERE s.shift_date BETWEEN p_from AND p_to
          AND (array_length(v_org_ids,1)     IS NULL OR s.organization_id    = ANY(v_org_ids))
          AND (array_length(v_dept_ids,1)    IS NULL OR s.department_id     = ANY(v_dept_ids))
          AND (array_length(v_subdept_ids,1) IS NULL OR s.sub_department_id = ANY(v_subdept_ids))
        GROUP BY 1
    )
    SELECT
        b.b,
        COALESCE(a.c_held, 0),
        COALESCE(a.c_worked, 0),
        COALESCE(a.c_no_show, 0),
        COALESCE(a.c_std, 0),
        COALESCE(a.c_critical, 0),
        COALESCE(a.c_swap, 0),
        COALESCE(a.c_oti, 0),
        COALESCE(a.c_li, 0),
        COALESCE(a.c_eo, 0),
        COALESCE(a.c_aco, 0),
        COALESCE(a.c_compliant, 0),
        ROUND(CASE WHEN COALESCE(a.c_held,0)   = 0 THEN 0 ELSE a.c_no_show::numeric   / a.c_held   * 100 END, 2),
        ROUND(CASE WHEN COALESCE(a.c_worked,0) = 0 THEN 0 ELSE a.c_compliant::numeric / a.c_worked * 100 END, 2),
        ROUND(CASE WHEN COALESCE(a.c_held,0)   = 0 THEN 0 ELSE a.c_std::numeric       / a.c_held   * 100 END, 2),
        ROUND(CASE WHEN COALESCE(a.c_held,0)   = 0 THEN 0 ELSE a.c_critical::numeric  / a.c_held   * 100 END, 2)
    FROM buckets b
    LEFT JOIN agg a ON a.b = b.b
    ORDER BY b.b;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_kpi_behaviour_trend(date, date, text, uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_kpi_behaviour_trend(date, date, text, uuid[], uuid[], uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_kpi_marketplace_trend(
    p_from        date,
    p_to          date,
    p_grain       text   DEFAULT 'week',
    p_org_ids     uuid[] DEFAULT NULL::uuid[],
    p_dept_ids    uuid[] DEFAULT NULL::uuid[],
    p_subdept_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
    bucket_start        date,
    open_shifts         integer,
    bids_placed         integer,
    winners_selected    integer,
    award_rate          numeric,
    swaps_initiated     integer,
    swaps_completed     integer,
    swaps_rejected      integer,
    swaps_cancelled     integer,
    swap_completion_rate numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_perm jsonb;
    v_allowed_org_ids uuid[]; v_allowed_dept_ids uuid[]; v_allowed_subdept_ids uuid[];
    v_org_ids uuid[]; v_dept_ids uuid[]; v_subdept_ids uuid[];
    v_grain text;
BEGIN
    IF NOT public.is_manager_or_above() THEN
        RAISE EXCEPTION 'insufficient_privilege: managerial access required for KPI aggregates';
    END IF;

    -- Whitelist, never interpolate: p_grain reaches date_trunc.
    v_grain := CASE lower(COALESCE(p_grain, 'week')) WHEN 'day' THEN 'day' ELSE 'week' END;

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
    WITH buckets AS (
        SELECT generate_series(
                   date_trunc(v_grain, p_from::timestamp),
                   date_trunc(v_grain, p_to::timestamp),
                   CASE v_grain WHEN 'day' THEN interval '1 day' ELSE interval '1 week' END
               )::date AS b
    ),
    scoped_shifts AS (
        SELECT s.id, date_trunc(v_grain, s.shift_date::timestamp)::date AS b, s.bidding_status
        FROM public.shifts s
        WHERE s.shift_date BETWEEN p_from AND p_to
          AND s.deleted_at IS NULL
          AND (array_length(v_org_ids,1)     IS NULL OR s.organization_id    = ANY(v_org_ids))
          AND (array_length(v_dept_ids,1)    IS NULL OR s.department_id     = ANY(v_dept_ids))
          AND (array_length(v_subdept_ids,1) IS NULL OR s.sub_department_id = ANY(v_subdept_ids))
    ),
    bid_agg AS (
        SELECT ss.b,
               COUNT(DISTINCT ss.id) FILTER (
                   WHERE ss.bidding_status NOT IN ('not_on_bidding', 'bidding_closed_no_winner')
                      OR sb.id IS NOT NULL
               )::int                                                    AS open_shifts,
               COUNT(sb.id)::int                                         AS bids_placed,
               COUNT(DISTINCT sb.shift_id) FILTER (WHERE sb.status = 'accepted')::int AS winners
        FROM scoped_shifts ss
        LEFT JOIN public.shift_bids sb ON sb.shift_id = ss.id
        GROUP BY ss.b
    ),
    swap_agg AS (
        SELECT ss.b,
               COUNT(sr.id)::int                                              AS initiated,
               COUNT(*) FILTER (WHERE sr.status = 'approved')::int            AS completed,
               COUNT(*) FILTER (WHERE sr.status = 'rejected')::int            AS rejected,
               COUNT(*) FILTER (WHERE sr.status = 'cancelled')::int           AS cancelled
        FROM scoped_shifts ss
        JOIN public.swap_requests sr ON sr.original_shift_id = ss.id
        GROUP BY ss.b
    )
    SELECT
        bk.b,
        COALESCE(ba.open_shifts, 0),
        COALESCE(ba.bids_placed, 0),
        COALESCE(ba.winners, 0),
        ROUND(CASE WHEN COALESCE(ba.open_shifts,0) = 0 THEN 0
                   ELSE ba.winners::numeric / ba.open_shifts * 100 END, 2),
        COALESCE(sa.initiated, 0),
        COALESCE(sa.completed, 0),
        COALESCE(sa.rejected, 0),
        COALESCE(sa.cancelled, 0),
        ROUND(CASE WHEN COALESCE(sa.initiated,0) = 0 THEN 0
                   ELSE sa.completed::numeric / sa.initiated * 100 END, 2)
    FROM buckets bk
    LEFT JOIN bid_agg  ba ON ba.b = bk.b
    LEFT JOIN swap_agg sa ON sa.b = bk.b
    ORDER BY bk.b;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_kpi_marketplace_trend(date, date, text, uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_kpi_marketplace_trend(date, date, text, uuid[], uuid[], uuid[]) TO authenticated, service_role;
