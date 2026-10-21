-- Access suites, step 2 of 3: grant (docs/architecture/access-suites-plan.md).
--
-- Step 1 took access away and used existing actions as stand-ins. This step gives every
-- suite page its own actions, swaps the stand-ins for them, and grants what the sheet
-- gives and the matrix lacked: gamma deletes shifts and publishes rosters in its
-- sub-department, and sees pay there; the Admin suite becomes actions zeta holds
-- instead of is_zeta() checks. Delta and epsilon gain view actions only.
--
-- Edited function bodies are pg_get_functiondef() copies with one statement changed.

-- ── 1. Actions ───────────────────────────────────────────────────────────────
INSERT INTO public.rbac_actions (code, description) VALUES
    ('template.view',       'View roster templates'),
    ('template.manage',     'Create, edit, publish and archive roster templates'),
    ('bid.view',            'View open bids and who bid'),
    ('swap.view',           'View swap requests and offers'),
    ('payroll.view',        'View gross pay and pay terms'),
    ('kpi.view',            'View KPI and performance'),
    ('availability.view',   'View team availability (the Grid)'),
    ('availability.manage', 'Set or request availability for an employee'),
    ('demand.view',         'View labor demand runs'),
    ('demand.manage',       'Run labor demand synthesis and edit demand templates'),
    ('compliance.view',     'View compliance rejections'),
    ('access.manage',       'Grant, change and revoke access certificates'),
    ('org.manage',          'Change organization structure and configuration'),
    -- Already defined; listed so a rebuild from the baseline, where the reference seed
    -- loads actions only after the migrations, can still grant them below.
    ('shift.delete',        'Delete shifts'),
    ('roster.publish',      'Publish roster')
ON CONFLICT (code) DO NOTHING;

-- ── 2. Who holds them ────────────────────────────────────────────────────────
INSERT INTO public.rbac_permissions (access_level, action_code, scope)
SELECT v.lvl::public.access_level, v.act, v.scp::public.rbac_scope
  FROM (VALUES
    -- gamma: the full Managerial suite, one sub-department
    ('gamma', 'template.view', 'SUB_DEPT'), ('gamma', 'template.manage', 'SUB_DEPT'),
    ('gamma', 'bid.view', 'SUB_DEPT'),      ('gamma', 'swap.view', 'SUB_DEPT'),
    ('gamma', 'payroll.view', 'SUB_DEPT'),  ('gamma', 'kpi.view', 'SUB_DEPT'),
    ('gamma', 'availability.view', 'SUB_DEPT'), ('gamma', 'availability.manage', 'SUB_DEPT'),
    ('gamma', 'shift.delete', 'SUB_DEPT'),  ('gamma', 'roster.publish', 'SUB_DEPT'),
    -- delta: view-only, one department
    ('delta', 'template.view', 'DEPT'), ('delta', 'bid.view', 'DEPT'), ('delta', 'swap.view', 'DEPT'),
    ('delta', 'payroll.view', 'DEPT'),  ('delta', 'kpi.view', 'DEPT'), ('delta', 'availability.view', 'DEPT'),
    -- epsilon: view-only, the organization
    ('epsilon', 'template.view', 'ORG'), ('epsilon', 'bid.view', 'ORG'), ('epsilon', 'swap.view', 'ORG'),
    ('epsilon', 'payroll.view', 'ORG'),  ('epsilon', 'kpi.view', 'ORG'), ('epsilon', 'availability.view', 'ORG'),
    -- zeta: the full Managerial suite and the Admin suite
    ('zeta', 'template.view', 'ORG'), ('zeta', 'template.manage', 'ORG'),
    ('zeta', 'bid.view', 'ORG'),      ('zeta', 'swap.view', 'ORG'),
    ('zeta', 'payroll.view', 'ORG'),  ('zeta', 'kpi.view', 'ORG'),
    ('zeta', 'availability.view', 'ORG'), ('zeta', 'availability.manage', 'ORG'),
    ('zeta', 'demand.view', 'ORG'),   ('zeta', 'demand.manage', 'ORG'),
    ('zeta', 'compliance.view', 'ORG'), ('zeta', 'access.manage', 'ORG'), ('zeta', 'org.manage', 'ORG')
  ) AS v(lvl, act, scp)
ON CONFLICT (access_level, action_code) DO NOTHING;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.rbac_permissions
                WHERE access_level IN ('delta', 'epsilon') AND action_code NOT LIKE '%.view') THEN
        RAISE EXCEPTION 'delta/epsilon hold a write action';
    END IF;
    IF EXISTS (SELECT 1 FROM public.rbac_permissions
                WHERE action_code IN ('demand.view', 'demand.manage', 'compliance.view', 'access.manage',
                                      'org.manage', 'contract.manage', 'user.edit')
                  AND access_level <> 'zeta') THEN
        RAISE EXCEPTION 'an Admin suite action is held below zeta';
    END IF;
END $$;

-- ── 2b. The Admin suite, by action rather than by level ──────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  -- Organization configuration (structure, pay periods, work rules, system config,
  -- cleanup rules). Admin suite: org.manage, which only zeta holds.
  RETURN public.holds_action('org.manage');
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND public.user_has_action_in_scope('org.manage', p_org_id);
$function$;

CREATE OR REPLACE FUNCTION public.can_grant_certificate(p_user_id uuid, p_org_id uuid, p_level access_level)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT auth.uid() IS NOT NULL AND public.holds_action('access.manage');
$function$;

CREATE OR REPLACE FUNCTION public.can_change_certificate(p_user_id uuid, p_org_id uuid, p_level access_level)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT public.holds_action('access.manage');
$function$;

CREATE OR REPLACE FUNCTION public.can_read_certificates_in(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT public.holds_action('access.manage');
$function$;

CREATE OR REPLACE FUNCTION public.can_write_contract(p_user_id uuid, p_org_id uuid, p_level access_level)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND public.user_has_action_in_scope('contract.manage', p_org_id);
$function$;

-- ── 3–4. Generated: functions and policies edited in place ──────────────────
-- 3a. KPI: the managerial roll-ups ask for kpi.view (they already clamp to the caller's
--     scope tree). Was is_manager_or_above(), the same set of levels.
CREATE OR REPLACE FUNCTION public.get_kpi_behaviour_summary(p_from date, p_to date, p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[], p_subdept_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(held integer, worked integer, no_show integer, standard_cancellations integer, critical_cancellations integer, swapped_out integer, reassigned integer, emergency_assigned integer, on_time_in integer, on_time_out integer, early_clock_in integer, late_clock_in integer, early_clock_out integer, late_clock_out integer, auto_clock_out integer, attendance_compliant integer, employees integer, no_show_rate numeric, on_time_in_rate numeric, on_time_out_rate numeric, early_clock_in_rate numeric, late_clock_in_rate numeric, early_clock_out_rate numeric, late_clock_out_rate numeric, auto_clock_out_rate numeric, attendance_compliance_rate numeric, standard_cancel_rate numeric, critical_cancel_rate numeric, total_cancel_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_perm jsonb;
    v_allowed_org_ids uuid[]; v_allowed_dept_ids uuid[]; v_allowed_subdept_ids uuid[];
    v_org_ids uuid[]; v_dept_ids uuid[]; v_subdept_ids uuid[];
BEGIN
    IF NOT public.holds_action('kpi.view') THEN
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
    WITH agg AS (
        SELECT
            COUNT(*)::int                                                            AS c_held,
            COUNT(*) FILTER (WHERE s.end_reason = 'worked')::int                     AS c_worked,
            COUNT(*) FILTER (WHERE s.end_reason = 'no_show')::int                    AS c_no_show,
            COUNT(*) FILTER (WHERE s.end_reason = 'dropped_std')::int                AS c_std,
            COUNT(*) FILTER (WHERE s.end_reason = 'dropped_late')::int               AS c_critical,
            COUNT(*) FILTER (WHERE s.end_reason = 'traded_out')::int                 AS c_swap,
            COUNT(*) FILTER (WHERE s.end_reason = 'reassigned')::int                 AS c_reassigned,
            COUNT(*) FILTER (WHERE s.source = 'emergency')::int                      AS c_emergency,
            COUNT(*) FILTER (WHERE s.on_time_in     AND s.end_reason = 'worked')::int AS c_oti,
            COUNT(*) FILTER (WHERE s.on_time_out    AND s.end_reason = 'worked')::int AS c_oto,
            COUNT(*) FILTER (WHERE s.early_in       AND s.end_reason = 'worked')::int AS c_ei,
            COUNT(*) FILTER (WHERE s.late_in        AND s.end_reason = 'worked')::int AS c_li,
            COUNT(*) FILTER (WHERE s.early_out      AND s.end_reason = 'worked')::int AS c_eo,
            COUNT(*) FILTER (WHERE s.late_out       AND s.end_reason = 'worked')::int AS c_lo,
            COUNT(*) FILTER (WHERE s.auto_clock_out AND s.end_reason = 'worked')::int AS c_aco,
            COUNT(*) FILTER (WHERE s.end_reason = 'worked'
                             AND NOT s.late_in AND NOT s.early_out)::int              AS c_compliant,
            COUNT(DISTINCT s.employee_id)::int                                        AS c_employees
        FROM public.assignment_snapshots s
        WHERE s.shift_date BETWEEN p_from AND p_to
          AND (array_length(v_org_ids,1)     IS NULL OR s.organization_id    = ANY(v_org_ids))
          AND (array_length(v_dept_ids,1)    IS NULL OR s.department_id     = ANY(v_dept_ids))
          AND (array_length(v_subdept_ids,1) IS NULL OR s.sub_department_id = ANY(v_subdept_ids))
    )
    SELECT
        a.c_held, a.c_worked, a.c_no_show, a.c_std, a.c_critical, a.c_swap, a.c_reassigned,
        a.c_emergency, a.c_oti, a.c_oto, a.c_ei, a.c_li, a.c_eo, a.c_lo, a.c_aco,
        a.c_compliant, a.c_employees,
        ROUND(CASE WHEN a.c_held   = 0 THEN 0 ELSE a.c_no_show::numeric   / a.c_held   * 100 END, 2),
        ROUND(CASE WHEN a.c_worked = 0 THEN 0 ELSE a.c_oti::numeric       / a.c_worked * 100 END, 2),
        ROUND(CASE WHEN a.c_worked = 0 THEN 0 ELSE a.c_oto::numeric       / a.c_worked * 100 END, 2),
        ROUND(CASE WHEN a.c_worked = 0 THEN 0 ELSE a.c_ei::numeric        / a.c_worked * 100 END, 2),
        ROUND(CASE WHEN a.c_worked = 0 THEN 0 ELSE a.c_li::numeric        / a.c_worked * 100 END, 2),
        ROUND(CASE WHEN a.c_worked = 0 THEN 0 ELSE a.c_eo::numeric        / a.c_worked * 100 END, 2),
        ROUND(CASE WHEN a.c_worked = 0 THEN 0 ELSE a.c_lo::numeric        / a.c_worked * 100 END, 2),
        ROUND(CASE WHEN a.c_worked = 0 THEN 0 ELSE a.c_aco::numeric       / a.c_worked * 100 END, 2),
        ROUND(CASE WHEN a.c_worked = 0 THEN 0 ELSE a.c_compliant::numeric / a.c_worked * 100 END, 2),
        ROUND(CASE WHEN a.c_held   = 0 THEN 0 ELSE a.c_std::numeric       / a.c_held   * 100 END, 2),
        ROUND(CASE WHEN a.c_held   = 0 THEN 0 ELSE a.c_critical::numeric  / a.c_held   * 100 END, 2),
        ROUND(CASE WHEN a.c_held   = 0 THEN 0 ELSE (a.c_std + a.c_critical)::numeric / a.c_held * 100 END, 2)
    FROM agg a;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_kpi_behaviour_trend(p_from date, p_to date, p_grain text DEFAULT 'week'::text, p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[], p_subdept_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(bucket_start date, held integer, worked integer, no_show integer, standard_cancellations integer, critical_cancellations integer, swapped_out integer, on_time_in integer, late_clock_in integer, early_clock_out integer, auto_clock_out integer, attendance_compliant integer, no_show_rate numeric, attendance_compliance_rate numeric, standard_cancel_rate numeric, critical_cancel_rate numeric)
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
    IF NOT public.holds_action('kpi.view') THEN
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

CREATE OR REPLACE FUNCTION public.get_kpi_marketplace_trend(p_from date, p_to date, p_grain text DEFAULT 'week'::text, p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[], p_subdept_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(bucket_start date, open_shifts integer, bids_placed integer, winners_selected integer, award_rate numeric, swaps_initiated integer, swaps_completed integer, swaps_rejected integer, swaps_cancelled integer, swap_completion_rate numeric)
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
    IF NOT public.holds_action('kpi.view') THEN
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

CREATE OR REPLACE FUNCTION public.get_quarterly_performance_report(p_year integer, p_quarter integer, p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[], p_subdept_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(employee_id uuid, employee_name text, total_offers integer, accepted integer, rejected integer, expired integer, assigned integer, emergency_assigned integer, cancel_standard integer, cancel_late integer, swap_out integer, late_clock_in integer, early_clock_out integer, no_show integer, completed integer, acceptance_rate numeric, rejection_rate numeric, ignorance_rate numeric, cancel_rate numeric, late_cancel_rate numeric, swap_rate numeric, reliability_score numeric, late_clock_in_rate numeric, early_clock_out_rate numeric, no_show_rate numeric, drop_rate numeric, total_bids integer, bids_accepted integer, bid_success_rate numeric, assignment_changes integer, trade_requests integer, trade_completion_rate numeric, trade_cancellation_rate numeric, attendance_compliance_rate numeric, performance_score numeric, engagement_score numeric, standard_drop_rate numeric, urgent_drop_rate numeric, early_clock_in integer, late_clock_out integer, early_clock_in_rate numeric, late_clock_out_rate numeric, on_time_in integer, on_time_out integer, on_time_in_rate numeric, on_time_out_rate numeric, auto_clock_out integer, auto_clock_out_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_start date;
    v_end   date;
    v_perm  jsonb;
    v_allowed_org_ids     uuid[];
    v_allowed_dept_ids    uuid[];
    v_allowed_subdept_ids uuid[];
    v_org_ids     uuid[];
    v_dept_ids    uuid[];
    v_subdept_ids uuid[];
BEGIN
    IF NOT public.holds_action('kpi.view') THEN
        RAISE EXCEPTION 'insufficient_privilege: managerial access required for performance reports';
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

    IF array_length(v_allowed_org_ids, 1) IS NULL THEN
        -- Manager flag is set but no Type Y scope resolved (e.g. cert data
        -- inconsistency) — fail closed to zero rows rather than everyone.
        RETURN;
    END IF;

    v_org_ids := CASE WHEN p_org_ids IS NULL THEN v_allowed_org_ids
                      ELSE ARRAY(SELECT unnest(p_org_ids) INTERSECT SELECT unnest(v_allowed_org_ids)) END;
    v_dept_ids := CASE WHEN p_dept_ids IS NULL THEN v_allowed_dept_ids
                       ELSE ARRAY(SELECT unnest(p_dept_ids) INTERSECT SELECT unnest(v_allowed_dept_ids)) END;
    v_subdept_ids := CASE WHEN p_subdept_ids IS NULL THEN v_allowed_subdept_ids
                          ELSE ARRAY(SELECT unnest(p_subdept_ids) INTERSECT SELECT unnest(v_allowed_subdept_ids)) END;

    SELECT qdr.v_start, qdr.v_end INTO v_start, v_end
    FROM quarter_date_range(p_year, p_quarter) qdr;

    RETURN QUERY
    WITH
    -- Offer behaviour from episodes view
    offer_agg AS (
        SELECT
            ep.employee_id AS emp_id,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.terminal_outcome <> 'unassigned')::int                           AS total_offers_sent,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.had_accept AND ep.terminal_outcome <> 'unassigned')::int          AS total_accepted,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.terminal_outcome = 'rejected')::int AS total_rejected,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.terminal_outcome = 'ignored')::int  AS total_expired,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.had_accept AND ep.terminal_outcome IN ('cancelled_standard','cancelled_late','no_show'))::int AS dropped_count
        FROM v_shift_assignment_episodes ep
        WHERE ep.shift_date BETWEEN v_start AND v_end
          AND ep.terminal_outcome != 'shift_deleted'
          AND (array_length(v_org_ids,1)     IS NULL OR ep.organization_id    = ANY(v_org_ids))
          AND (array_length(v_dept_ids,1)    IS NULL OR ep.department_id     = ANY(v_dept_ids))
          AND (array_length(v_subdept_ids,1) IS NULL OR ep.sub_department_id = ANY(v_subdept_ids))
        GROUP BY ep.employee_id
    ),

    -- Assignment, Reliability, Attendance from assignment_snapshots
    snap_agg AS (
        SELECT
            snap.employee_id AS emp_id,
            COUNT(*) FILTER (WHERE snap.source != 'emergency')::int                  AS assigned_count,
            COUNT(*) FILTER (WHERE snap.source = 'emergency')::int                    AS emergency_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'worked')::int                   AS completed_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'dropped_std')::int              AS cancel_standard_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'dropped_late')::int             AS cancel_late_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'traded_out')::int               AS swap_out_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'no_show')::int                  AS no_show_count,
            COUNT(*) FILTER (WHERE snap.late_in AND snap.end_reason = 'worked')::int  AS late_clock_in_count,
            COUNT(*) FILTER (WHERE snap.early_out AND snap.end_reason = 'worked')::int AS early_clock_out_count,
            COUNT(*) FILTER (WHERE snap.early_in AND snap.end_reason = 'worked')::int  AS early_clock_in_count,
            COUNT(*) FILTER (WHERE snap.late_out AND snap.end_reason = 'worked')::int  AS late_clock_out_count,
            COUNT(*) FILTER (WHERE snap.on_time_in AND snap.end_reason = 'worked')::int AS on_time_in_count,
            COUNT(*) FILTER (WHERE snap.on_time_out AND snap.end_reason = 'worked')::int AS on_time_out_count,
            COUNT(*) FILTER (WHERE snap.auto_clock_out AND snap.end_reason = 'worked')::int AS auto_clock_out_count,
            COUNT(*)::int                                                             AS held_count,

            -- Assignment Changes: standard cancel, late cancel, no show, traded out, reassigned
            COUNT(*) FILTER (WHERE snap.end_reason IS NOT NULL AND snap.end_reason != 'worked')::int AS assignment_changes,
            -- Compliant count (for Attendance percentage): completed/worked AND neither late check-in nor early check-out
            COUNT(*) FILTER (WHERE snap.end_reason = 'worked' AND NOT snap.late_in AND NOT snap.early_out)::int AS compliant_count,

            -- Standard drops (TTS > 24 hours)
            COUNT(*) FILTER (WHERE snap.end_reason = 'dropped_std' AND (snap.scheduled_start - snap.ended_at) > interval '24 hours')::int AS standard_drop_count,
            -- Urgent drops (4 hours < TTS <= 24 hours)
            COUNT(*) FILTER (WHERE snap.end_reason = 'dropped_std' AND (snap.scheduled_start - snap.ended_at) <= interval '24 hours')::int AS urgent_drop_count
        FROM assignment_snapshots snap
        WHERE snap.shift_date BETWEEN v_start AND v_end
          AND (array_length(v_org_ids,1)     IS NULL OR snap.organization_id    = ANY(v_org_ids))
          AND (array_length(v_dept_ids,1)    IS NULL OR snap.department_id     = ANY(v_dept_ids))
          AND (array_length(v_subdept_ids,1) IS NULL OR snap.sub_department_id = ANY(v_subdept_ids))
        GROUP BY snap.employee_id
    ),

    -- Bidding metrics
    bid_agg AS (
        SELECT
            sb.employee_id AS emp_id,
            COUNT(*)::int                                       AS total_bids,
            COUNT(*) FILTER (WHERE sb.status = 'accepted')::int AS bids_accepted
        FROM shift_bids sb
        JOIN shifts s ON s.id = sb.shift_id
        WHERE s.shift_date BETWEEN v_start AND v_end
          AND (array_length(v_org_ids,1)     IS NULL OR s.organization_id    = ANY(v_org_ids))
          AND (array_length(v_dept_ids,1)    IS NULL OR s.department_id     = ANY(v_dept_ids))
          AND (array_length(v_subdept_ids,1) IS NULL OR s.sub_department_id = ANY(v_subdept_ids))
        GROUP BY sb.employee_id
    ),

    -- Trading metrics
    trade_agg AS (
        SELECT
            sr.requested_by_employee_id AS emp_id,
            COUNT(*)::int AS trade_requests,
            COUNT(*) FILTER (WHERE sr.status = 'approved')::int AS trades_approved,
            COUNT(*) FILTER (WHERE sr.status = 'cancelled')::int AS trades_cancelled
        FROM swap_requests sr
        JOIN shifts s ON s.id = sr.original_shift_id
        WHERE s.shift_date BETWEEN v_start AND v_end
          AND (array_length(v_org_ids,1)     IS NULL OR s.organization_id    = ANY(v_org_ids))
          AND (array_length(v_dept_ids,1)    IS NULL OR s.department_id     = ANY(v_dept_ids))
          AND (array_length(v_subdept_ids,1) IS NULL OR s.sub_department_id = ANY(v_subdept_ids))
        GROUP BY sr.requested_by_employee_id
    ),

    all_emps AS (
        SELECT emp_id FROM offer_agg
        UNION
        SELECT emp_id FROM snap_agg
        UNION
        SELECT emp_id FROM bid_agg
        UNION
        SELECT emp_id FROM trade_agg
    ),

    raw_metrics AS (
        SELECT
            ae.emp_id                                               AS employee_id,
            COALESCE(prof.full_name, ae.emp_id::text)::text        AS employee_name,
            COALESCE(oa.total_offers_sent,    0)::int              AS total_offers,
            COALESCE(oa.total_accepted,       0)::int              AS accepted,
            COALESCE(oa.total_rejected,       0)::int              AS rejected,
            COALESCE(oa.total_expired,        0)::int              AS expired,
            COALESCE(sa.assigned_count,       0)::int              AS assigned,
            COALESCE(sa.emergency_count,      0)::int              AS emergency_assigned,
            COALESCE(sa.cancel_standard_count,0)::int              AS cancel_standard,
            COALESCE(sa.cancel_late_count,    0)::int              AS cancel_late,
            COALESCE(sa.swap_out_count,       0)::int              AS swap_out,
            COALESCE(sa.late_clock_in_count,  0)::int              AS late_clock_in,
            COALESCE(sa.early_clock_out_count,0)::int              AS early_clock_out,
            COALESCE(sa.no_show_count,        0)::int              AS no_show,
            COALESCE(sa.completed_count,      0)::int              AS completed,

            -- Offer rates
            ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
                  ELSE oa.total_accepted::numeric/oa.total_offers_sent*100 END,2)::numeric AS acceptance_rate,
            ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
                  ELSE oa.total_rejected::numeric/oa.total_offers_sent*100 END,2)::numeric AS rejection_rate,
            ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
                  ELSE oa.total_expired::numeric/oa.total_offers_sent*100 END,2)::numeric  AS ignorance_rate,

            -- Assignment/cancellation rates
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.cancel_standard_count,0)::numeric/sa.held_count*100 END,2)::numeric AS cancel_rate,
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.cancel_late_count,0)::numeric/sa.held_count*100 END,2)::numeric AS late_cancel_rate,
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.swap_out_count,0)::numeric/sa.held_count*100 END,2)::numeric AS swap_rate,

            -- Reliability
            GREATEST(0,LEAST(100,ROUND(
                100
                -CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                      ELSE (COALESCE(sa.cancel_standard_count,0)+COALESCE(sa.cancel_late_count,0))::numeric/sa.held_count*30 END
                -CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                      ELSE COALESCE(sa.cancel_late_count,0)::numeric/sa.held_count*20 END
                -CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0 ELSE COALESCE(sa.no_show_count,0)::numeric/sa.held_count*40 END
                -CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                      ELSE COALESCE(sa.late_clock_in_count,0)::numeric/sa.completed_count*5 END
                -CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                      ELSE COALESCE(sa.early_clock_out_count,0)::numeric/sa.completed_count*5 END
            ,2)))::numeric AS reliability_score,

            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.late_clock_in_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS late_clock_in_rate,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.early_clock_out_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS early_clock_out_rate,
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.no_show_count,0)::numeric/sa.held_count*100 END,2)::numeric AS no_show_rate,
            ROUND(CASE WHEN COALESCE(oa.total_accepted,0)=0 THEN 0
                  ELSE COALESCE(oa.dropped_count,0)::numeric/oa.total_accepted*100 END,2)::numeric AS drop_rate,

            COALESCE(ba.total_bids, 0)::int AS total_bids,
            COALESCE(ba.bids_accepted, 0)::int AS bids_accepted,
            ROUND(CASE WHEN COALESCE(ba.total_bids,0)=0 THEN 0
                  ELSE ba.bids_accepted::numeric/ba.total_bids*100 END, 2)::numeric AS bid_success_rate,

            COALESCE(sa.assignment_changes, 0)::int AS assignment_changes,
            COALESCE(ta.trade_requests, 0)::int AS trade_requests,
            ROUND(CASE WHEN COALESCE(ta.trade_requests,0)=0 THEN 0
                  ELSE ta.trades_approved::numeric/ta.trade_requests*100 END, 2)::numeric AS trade_completion_rate,
            ROUND(CASE WHEN COALESCE(ta.trade_requests,0)=0 THEN 0
                  ELSE ta.trades_cancelled::numeric/ta.trade_requests*100 END, 2)::numeric AS trade_cancellation_rate,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE sa.compliant_count::numeric/sa.completed_count*100 END, 2)::numeric AS attendance_compliance_rate,

            -- Standard and Urgent Drop rates
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE sa.standard_drop_count::numeric/sa.held_count*100 END,2)::numeric AS standard_drop_rate,
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE sa.urgent_drop_count::numeric/sa.held_count*100 END,2)::numeric AS urgent_drop_rate,

            COALESCE(sa.early_clock_in_count, 0)::int AS early_clock_in,
            COALESCE(sa.late_clock_out_count, 0)::int AS late_clock_out,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.early_clock_in_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS early_clock_in_rate,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.late_clock_out_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS late_clock_out_rate,

            -- New attendance fields
            COALESCE(sa.on_time_in_count, 0)::int AS on_time_in,
            COALESCE(sa.on_time_out_count, 0)::int AS on_time_out,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.on_time_in_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS on_time_in_rate,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.on_time_out_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS on_time_out_rate,

            -- Auto clock-out: denominator = worked snapshots
            COALESCE(sa.auto_clock_out_count, 0)::int AS auto_clock_out,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.auto_clock_out_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS auto_clock_out_rate
        FROM all_emps ae
        LEFT JOIN profiles      prof ON prof.id   = ae.emp_id
        LEFT JOIN offer_agg     oa   ON oa.emp_id = ae.emp_id
        LEFT JOIN snap_agg      sa   ON sa.emp_id = ae.emp_id
        LEFT JOIN bid_agg       ba   ON ba.emp_id = ae.emp_id
        LEFT JOIN trade_agg     ta   ON ta.emp_id = ae.emp_id
    )
    SELECT
        rm.employee_id,
        rm.employee_name,
        rm.total_offers,
        rm.accepted,
        rm.rejected,
        rm.expired,
        rm.assigned,
        rm.emergency_assigned,
        rm.cancel_standard,
        rm.cancel_late,
        rm.swap_out,
        rm.late_clock_in,
        rm.early_clock_out,
        rm.no_show,
        rm.completed,
        rm.acceptance_rate,
        rm.rejection_rate,
        rm.ignorance_rate,
        rm.cancel_rate,
        rm.late_cancel_rate,
        rm.swap_rate,
        rm.reliability_score,
        rm.late_clock_in_rate,
        rm.early_clock_out_rate,
        rm.no_show_rate,
        rm.drop_rate,
        rm.total_bids,
        rm.bids_accepted,
        rm.bid_success_rate,

        rm.assignment_changes,
        rm.trade_requests,
        rm.trade_completion_rate,
        rm.trade_cancellation_rate,
        rm.attendance_compliance_rate,
        -- performance_score: weighted sum of Reliability, Acceptance, Attendance, Bid Success
        ROUND(
            (rm.reliability_score * 0.35) +
            (rm.acceptance_rate * 0.25) +
            (rm.attendance_compliance_rate * 0.20) +
            (rm.bid_success_rate * 0.20),
            2
        )::numeric AS performance_score,
        -- engagement_score: marketplace activity per shift actually worked, not a raw
        -- point count. GREATEST(completed,1) avoids div-by-0 for employees with no
        -- worked shifts yet; the *30 scale means a raw ratio of ~3.33 activity-points
        -- per shift worked reaches the 100 ceiling — a starting default, not a
        -- precisely product-validated constant. Normalizing this way (vs. the old
        -- bids*8 + trades*12 + offers*10 point count) stops the score from simply
        -- tracking tenure length / shift volume.
        GREATEST(0, LEAST(100, ROUND(
            (rm.total_bids + rm.trade_requests * 1.5 + rm.total_offers * 1.25)
            / GREATEST(rm.completed, 1)
            * 30,
            2
        )))::numeric AS engagement_score,

        rm.standard_drop_rate,
        rm.urgent_drop_rate,

        rm.early_clock_in,
        rm.late_clock_out,
        rm.early_clock_in_rate,
        rm.late_clock_out_rate,

        -- New attendance fields
        rm.on_time_in,
        rm.on_time_out,
        rm.on_time_in_rate,
        rm.on_time_out_rate,

        -- Auto clock-out
        rm.auto_clock_out,
        rm.auto_clock_out_rate
    FROM raw_metrics rm
    ORDER BY employee_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_cancellation_reason_breakdown(p_from date, p_to date, p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[], p_subdept_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(reason_code text, reason_label text, total integer, standard_count integer, critical_count integer, emergent_count integer, share_pct numeric, avg_notice_hours numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_perm jsonb;
    v_allowed_org_ids uuid[]; v_allowed_dept_ids uuid[]; v_allowed_subdept_ids uuid[];
    v_org_ids uuid[]; v_dept_ids uuid[]; v_subdept_ids uuid[];
BEGIN
    IF NOT public.holds_action('kpi.view') THEN
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

CREATE OR REPLACE FUNCTION public.get_employee_quarterly_performance(p_employee_id uuid, p_year integer, p_quarter integer)
 RETURNS TABLE(employee_id uuid, total_offers integer, accepted integer, rejected integer, expired integer, assigned integer, emergency_assigned integer, completed integer, no_show integer, swap_out integer, acceptance_rate numeric, rejection_rate numeric, ignorance_rate numeric, cancel_rate numeric, late_cancel_rate numeric, no_show_rate numeric, swap_rate numeric, reliability_score numeric, late_clock_in_rate numeric, early_clock_out_rate numeric, attendance_compliance_rate numeric, total_bids integer, bids_accepted integer, bid_success_rate numeric, trade_requests integer, performance_score numeric, engagement_score numeric, calculated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_start date;
    v_end   date;
BEGIN
    IF NOT (p_employee_id = auth.uid() OR public.can_act_on_employee('kpi.view', p_employee_id)) THEN
        RAISE EXCEPTION 'insufficient_privilege: may only view your own performance, or requires managerial access';
    END IF;

    SELECT qdr.v_start, qdr.v_end INTO v_start, v_end
    FROM quarter_date_range(p_year, p_quarter) qdr;

    RETURN QUERY
    WITH
    offer_agg AS (
        SELECT
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.terminal_outcome <> 'unassigned')::int                  AS total_offers_sent,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.had_accept AND ep.terminal_outcome <> 'unassigned')::int AS total_accepted,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.terminal_outcome = 'rejected')::int                     AS total_rejected,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.terminal_outcome = 'ignored')::int                      AS total_expired
        FROM v_shift_assignment_episodes ep
        WHERE ep.employee_id = p_employee_id
          AND ep.shift_date BETWEEN v_start AND v_end
          AND ep.terminal_outcome != 'shift_deleted'
    ),
    snap_agg AS (
        SELECT
            COUNT(*) FILTER (WHERE snap.source != 'emergency')::int                   AS assigned_count,
            COUNT(*) FILTER (WHERE snap.source = 'emergency')::int                    AS emergency_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'worked')::int                   AS completed_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'dropped_std')::int              AS cancel_standard_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'dropped_late')::int             AS cancel_late_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'traded_out')::int               AS swap_out_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'no_show')::int                  AS no_show_count,
            COUNT(*) FILTER (WHERE snap.late_in AND snap.end_reason = 'worked')::int  AS late_clock_in_count,
            COUNT(*) FILTER (WHERE snap.early_out AND snap.end_reason = 'worked')::int AS early_clock_out_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'worked' AND NOT snap.late_in AND NOT snap.early_out)::int AS compliant_count,
            COUNT(*)::int                                                             AS held_count
        FROM assignment_snapshots snap
        WHERE snap.employee_id = p_employee_id
          AND snap.shift_date BETWEEN v_start AND v_end
    ),
    bid_agg AS (
        SELECT
            COUNT(*)::int                                       AS total_bids,
            COUNT(*) FILTER (WHERE sb.status = 'accepted')::int AS bids_accepted
        FROM shift_bids sb
        JOIN shifts s ON s.id = sb.shift_id
        WHERE sb.employee_id = p_employee_id
          AND s.shift_date BETWEEN v_start AND v_end
    ),
    trade_agg AS (
        SELECT COUNT(*)::int AS trade_requests
        FROM swap_requests sr
        JOIN shifts s ON s.id = sr.original_shift_id
        WHERE sr.requested_by_employee_id = p_employee_id
          AND s.shift_date BETWEEN v_start AND v_end
    ),
    raw_metrics AS (
        SELECT
            COALESCE(oa.total_offers_sent, 0)::int AS total_offers,
            COALESCE(oa.total_accepted,    0)::int AS accepted,
            COALESCE(oa.total_rejected,    0)::int AS rejected,
            COALESCE(oa.total_expired,     0)::int AS expired,
            COALESCE(sa.assigned_count,    0)::int AS assigned,
            COALESCE(sa.emergency_count,   0)::int AS emergency_assigned,
            COALESCE(sa.completed_count,   0)::int AS completed,
            COALESCE(sa.no_show_count,     0)::int AS no_show,
            COALESCE(sa.swap_out_count,    0)::int AS swap_out,

            ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
                  ELSE oa.total_accepted::numeric/oa.total_offers_sent*100 END,2)::numeric AS acceptance_rate,
            ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
                  ELSE oa.total_rejected::numeric/oa.total_offers_sent*100 END,2)::numeric AS rejection_rate,
            ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
                  ELSE oa.total_expired::numeric/oa.total_offers_sent*100 END,2)::numeric  AS ignorance_rate,

            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.cancel_standard_count,0)::numeric/sa.held_count*100 END,2)::numeric AS cancel_rate,
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.cancel_late_count,0)::numeric/sa.held_count*100 END,2)::numeric AS late_cancel_rate,
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.no_show_count,0)::numeric/sa.held_count*100 END,2)::numeric AS no_show_rate,
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.swap_out_count,0)::numeric/sa.held_count*100 END,2)::numeric AS swap_rate,

            GREATEST(0,LEAST(100,ROUND(
                100
                -CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                      ELSE (COALESCE(sa.cancel_standard_count,0)+COALESCE(sa.cancel_late_count,0))::numeric/sa.held_count*30 END
                -CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                      ELSE COALESCE(sa.cancel_late_count,0)::numeric/sa.held_count*20 END
                -CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0 ELSE COALESCE(sa.no_show_count,0)::numeric/sa.held_count*40 END
                -CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                      ELSE COALESCE(sa.late_clock_in_count,0)::numeric/sa.completed_count*5 END
                -CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                      ELSE COALESCE(sa.early_clock_out_count,0)::numeric/sa.completed_count*5 END
            ,2)))::numeric AS reliability_score,

            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.late_clock_in_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS late_clock_in_rate,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.early_clock_out_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS early_clock_out_rate,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE sa.compliant_count::numeric/sa.completed_count*100 END, 2)::numeric AS attendance_compliance_rate,

            COALESCE(ba.total_bids, 0)::int AS total_bids,
            COALESCE(ba.bids_accepted, 0)::int AS bids_accepted,
            ROUND(CASE WHEN COALESCE(ba.total_bids,0)=0 THEN 0
                  ELSE ba.bids_accepted::numeric/ba.total_bids*100 END, 2)::numeric AS bid_success_rate,

            COALESCE(ta.trade_requests, 0)::int AS trade_requests
        FROM offer_agg oa, snap_agg sa, bid_agg ba, trade_agg ta
    )
    SELECT
        p_employee_id,
        rm.total_offers,
        rm.accepted,
        rm.rejected,
        rm.expired,
        rm.assigned,
        rm.emergency_assigned,
        rm.completed,
        rm.no_show,
        rm.swap_out,
        rm.acceptance_rate,
        rm.rejection_rate,
        rm.ignorance_rate,
        rm.cancel_rate,
        rm.late_cancel_rate,
        rm.no_show_rate,
        rm.swap_rate,
        rm.reliability_score,
        rm.late_clock_in_rate,
        rm.early_clock_out_rate,
        rm.attendance_compliance_rate,
        rm.total_bids,
        rm.bids_accepted,
        rm.bid_success_rate,
        rm.trade_requests,
        -- Same weighting as get_quarterly_performance_report(): keep these two in sync.
        ROUND(
            (rm.reliability_score * 0.35) +
            (rm.acceptance_rate * 0.25) +
            (rm.attendance_compliance_rate * 0.20) +
            (rm.bid_success_rate * 0.20),
            2
        )::numeric AS performance_score,
        GREATEST(0, LEAST(100, ROUND(
            (rm.total_bids + rm.trade_requests * 1.5 + rm.total_offers * 1.25)
            / GREATEST(rm.completed, 1)
            * 30,
            2
        )))::numeric AS engagement_score,
        now() AS calculated_at
    FROM raw_metrics rm;
END;
$function$;

-- 3b. Pay terms follow payroll.view at the shift's place. Gamma gains its own
--     sub-department (it ran the Payroll page blind); delta and epsilon keep their scope.
CREATE OR REPLACE FUNCTION public.shift_pay_terms(s shifts)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
#variable_conflict use_column
DECLARE
    v_uid uuid := auth.uid();
    t     record;
BEGIN
    IF s.user_contract_id IS NULL OR s.assigned_employee_id IS NULL OR v_uid IS NULL THEN
        RETURN NULL;
    END IF;
    IF s.assigned_employee_id <> v_uid AND NOT public.user_has_action_in_scope('payroll.view', s.organization_id, s.department_id, s.sub_department_id) THEN
        RETURN NULL;
    END IF;

    SELECT * INTO t FROM internal.shift_pay_terms(s);
    RETURN jsonb_build_object(
        'pay_basis',         t.pay_basis,
        'employment_type',   t.employment_type,
        'substantive_level', t.substantive_level,
        'paid_level',        t.paid_level,
        'higher_duties',     t.higher_duties,
        'base_rate',         round(t.base_rate, 4));
END;
$function$;

CREATE OR REPLACE FUNCTION public.shift_pay_terms_for(s shifts, p_employee uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
#variable_conflict use_column
DECLARE
    v_uid uuid := auth.uid();
    t     record;
BEGIN
    IF p_employee IS NULL OR v_uid IS NULL THEN
        RETURN NULL;
    END IF;
    IF p_employee <> v_uid AND NOT public.user_has_action_in_scope('payroll.view', s.organization_id, s.department_id, s.sub_department_id) THEN
        RETURN NULL;
    END IF;

    SELECT * INTO t FROM internal.prospective_pay_terms(s, p_employee);
    RETURN jsonb_build_object(
        'pay_basis',         t.pay_basis,
        'employment_type',   t.employment_type,
        'substantive_level', t.substantive_level,
        'paid_level',        t.paid_level,
        'higher_duties',     t.higher_duties,
        'base_rate',         round(t.base_rate, 4));
END;
$function$;

-- 3c. Templates: editing one at its place is template.manage (gamma there, zeta anywhere).
CREATE OR REPLACE FUNCTION public.auth_can_create_template(p_organization_id uuid, p_department_id uuid, p_sub_department_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    RETURN public.user_has_action_in_scope('template.manage', p_organization_id, p_department_id, p_sub_department_id);
END;
$function$;

-- 3d. Recomputing an organization's fairness ledger is organization configuration.
--     Was any gamma+ of that organization — and zeta only by accident of the org match.
CREATE OR REPLACE FUNCTION public.request_fairness_ledger_recompute(p_org_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rows integer;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;

    IF NOT public.user_has_action_in_scope('org.manage', p_org_id) THEN
        RAISE EXCEPTION 'not authorised to recompute the fairness ledger for this organization'
            USING ERRCODE = '42501';
    END IF;

    SELECT public.recompute_fairness_ledger(p_org_id, p_as_of) INTO v_rows;
    RETURN v_rows;
END $function$;

-- 4a. Availability (the Grid): its own actions replace the step-1 stand-ins.
ALTER POLICY "availability_exceptions_select" ON public.availability_exceptions
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR can_act_on_employee('availability.view'::text, profile_id)));
ALTER POLICY "availability_exceptions_insert" ON public.availability_exceptions
  WITH CHECK ((((profile_id = ( SELECT auth.uid() AS uid)) AND (severity = ANY (ARRAY['SOFT'::text, 'PREFERENCE'::text]))) OR can_act_on_employee('availability.manage'::text, profile_id)));
ALTER POLICY "availability_exceptions_update" ON public.availability_exceptions
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR can_act_on_employee('availability.manage'::text, profile_id)))
  WITH CHECK ((((profile_id = ( SELECT auth.uid() AS uid)) AND (severity = ANY (ARRAY['SOFT'::text, 'PREFERENCE'::text]))) OR can_act_on_employee('availability.manage'::text, profile_id)));
ALTER POLICY "availability_exceptions_delete" ON public.availability_exceptions
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR can_act_on_employee('availability.manage'::text, profile_id)));
ALTER POLICY "availability_requests_select" ON public.availability_requests
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR can_act_on_employee('availability.view'::text, profile_id)));
ALTER POLICY "availability_requests_insert" ON public.availability_requests
  WITH CHECK ((can_act_on_employee('availability.manage'::text, profile_id) AND (requested_by = ( SELECT auth.uid() AS uid))));
ALTER POLICY "availability_requests_update" ON public.availability_requests
  USING (can_act_on_employee('availability.manage'::text, profile_id))
  WITH CHECK (can_act_on_employee('availability.manage'::text, profile_id));
ALTER POLICY "availability_rules_select" ON public.availability_rules
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR can_act_on_employee('availability.view'::text, profile_id)));
ALTER POLICY "availability_slots_select" ON public.availability_slots
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR can_act_on_employee('availability.view'::text, profile_id)));

-- 4b. KPI, payroll, templates, bids and swaps read through their own view actions.
ALTER POLICY "perf_metrics_self_or_manager_read" ON public.employee_performance_metrics
  USING (((employee_id = ( SELECT auth.uid() AS uid)) OR can_act_on_employee('kpi.view'::text, employee_id)));
ALTER POLICY "perf_snapshots_self_or_manager_read" ON public.employee_performance_snapshots
  USING (((employee_id = ( SELECT auth.uid() AS uid)) OR can_act_on_employee('kpi.view'::text, employee_id)));
ALTER POLICY "payroll_records_self_or_manager_select" ON public.shift_payroll_records
  USING (((EXISTS ( SELECT 1
   FROM shifts s
  WHERE ((s.id = shift_payroll_records.shift_id) AND (s.assigned_employee_id = ( SELECT auth.uid() AS uid))))) OR can_act_on_shift('payroll.view'::text, shift_id)));
ALTER POLICY "roster_templates_select" ON public.roster_templates
  USING (((status = 'published'::template_status) OR user_has_action_in_scope('template.view'::text, organization_id, department_id, sub_department_id)));
ALTER POLICY "bids_select_scoped" ON public.shift_bids
  USING (((employee_id = ( SELECT auth.uid() AS uid)) OR can_act_on_shift('bid.view'::text, shift_id)));
ALTER POLICY "swaps_select_scoped" ON public.shift_swaps
  USING (((requester_id = ( SELECT auth.uid() AS uid)) OR (target_id = ( SELECT auth.uid() AS uid)) OR can_act_on_shift('swap.view'::text, requester_shift_id) OR user_has_swap_offer(( SELECT auth.uid() AS uid), id) OR user_has_access_to_swap(( SELECT auth.uid() AS uid), requester_shift_id)));
ALTER POLICY "swap_offers_select_manager" ON public.swap_offers
  USING (can_act_on_swap('swap.view'::text, swap_request_id));

-- 4c. Admin suite tables answer to their actions at the row's place (zeta holds them).
ALTER POLICY "authenticated_read_synthesis_runs" ON public.synthesis_runs
  USING (user_has_action_in_scope('demand.view', organization_id, department_id, sub_department_id));
ALTER POLICY "authenticated_write_synthesis_runs" ON public.synthesis_runs
  WITH CHECK (user_has_action_in_scope('demand.manage', organization_id, department_id, sub_department_id));
ALTER POLICY "authenticated_update_synthesis_runs" ON public.synthesis_runs
  USING (user_has_action_in_scope('demand.manage', organization_id, department_id, sub_department_id))
  WITH CHECK (user_has_action_in_scope('demand.manage', organization_id, department_id, sub_department_id));
ALTER POLICY "manager_insert_demand_tensor" ON public.demand_tensor
  WITH CHECK ((EXISTS (SELECT 1 FROM public.synthesis_runs sr WHERE sr.id = demand_tensor.synthesis_run_id AND public.user_has_action_in_scope('demand.manage', sr.organization_id, sr.department_id, sr.sub_department_id))));
ALTER POLICY "manager_update_demand_tensor" ON public.demand_tensor
  USING ((EXISTS (SELECT 1 FROM public.synthesis_runs sr WHERE sr.id = demand_tensor.synthesis_run_id AND public.user_has_action_in_scope('demand.manage', sr.organization_id, sr.department_id, sr.sub_department_id))));
ALTER POLICY "manager_delete_demand_tensor" ON public.demand_tensor
  USING ((EXISTS (SELECT 1 FROM public.synthesis_runs sr WHERE sr.id = demand_tensor.synthesis_run_id AND public.user_has_action_in_scope('demand.manage', sr.organization_id, sr.department_id, sr.sub_department_id))));
ALTER POLICY "demand_forecasts_delete_run_manager" ON public.demand_forecasts
  USING ((EXISTS (SELECT 1 FROM public.synthesis_runs sr WHERE sr.id = demand_forecasts.synthesis_run_id AND public.user_has_action_in_scope('demand.manage', sr.organization_id, sr.department_id, sr.sub_department_id))));
ALTER POLICY "manager_insert_demand_templates" ON public.demand_templates
  WITH CHECK (holds_action('demand.manage'::text));
ALTER POLICY "manager_update_demand_templates" ON public.demand_templates
  USING (holds_action('demand.manage'::text));
ALTER POLICY "manager_delete_demand_templates" ON public.demand_templates
  USING (holds_action('demand.manage'::text));
ALTER POLICY "managers_read_compliance_rejections" ON public.compliance_rejections
  USING (can_act_on_employee('compliance.view'::text, employee_id));

-- 4d. A department's budget is changed at the department's place by someone who edits
--     rosters there — zeta today (gamma's reach is one sub-department, delta only views).
ALTER POLICY "dept_budgets_admin_write" ON public.department_budgets
  USING (can_act_in_dept('roster.edit'::text, dept_id))
  WITH CHECK (can_act_in_dept('roster.edit'::text, dept_id));
ALTER POLICY "dept_budgets_admin_write" ON public.department_budgets RENAME TO dept_budgets_manager_write;

