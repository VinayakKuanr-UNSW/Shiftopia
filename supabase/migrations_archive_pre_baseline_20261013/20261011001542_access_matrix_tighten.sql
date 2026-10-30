-- ============================================================================
-- Access matrix, step 2a (tightening only): gamma is its own sub-department,
-- the matrix is read-only to clients, and the policy rewrite gets its place
-- helpers. Agreed in the decision doc "Shiftopia Permission Matrix —
-- Decisions" (2026-10-11). The ADDITIONS that doc agreed (nine new actions,
-- gamma publishing rosters and deleting shifts, managers' own bids/swaps) are
-- a separate migration.
--
-- ── 1. GAMMA NARROWS TO ITS SUB-DEPARTMENT ──────────────────────────────────
-- Five gamma view actions read the whole department. The agreed matrix makes
-- every one the sub-department the certificate names.
--
-- ── 2. THE MATRIX CHANGES ONLY BY MIGRATION ─────────────────────────────────
-- Both tables already had SELECT-only RLS; the leftover write grants go too.
--
-- ── 3. user_has_action_in_scope READS CERTIFICATES ONLY ─────────────────────
-- Its contract branch is dead since 20261010234505 (a contract's
-- access_level is constrained NULL, so the join yields nothing). Removed so
-- the function every policy calls does one thing.
--
-- ── 4. PLACE HELPERS ────────────────────────────────────────────────────────
-- Many tables carry no organization/department/sub-department of their own:
-- they hang off a shift, an employee, a sub-department or a department. Each
-- helper resolves that place and asks user_has_action_in_scope, so every
-- policy can say "action X over this row's place". They answer only about
-- the caller.
-- ============================================================================

-- ── 1 ───────────────────────────────────────────────────────────────────────
DO $narrow$
DECLARE v_n int;
BEGIN
    UPDATE public.rbac_permissions
       SET scope = 'SUB_DEPT'
     WHERE access_level = 'gamma'
       AND action_code IN ('roster.view', 'shift.view', 'timesheet.view', 'user.view', 'broadcast.view')
       AND scope = 'DEPT';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 5 THEN
        RAISE EXCEPTION 'expected to narrow 5 gamma view rows, narrowed %', v_n;
    END IF;
END
$narrow$;

-- ── 2 ───────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.rbac_permissions FROM anon, authenticated;
REVOKE ALL ON public.rbac_actions     FROM anon, authenticated;
GRANT SELECT ON public.rbac_permissions TO authenticated;
GRANT SELECT ON public.rbac_actions     TO authenticated;

-- ── 3 ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_has_action_in_scope(p_action_code text, p_org_id uuid, p_dept_id uuid DEFAULT NULL::uuid, p_sub_dept_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM app_access_certificates ac
        JOIN rbac_permissions rp ON rp.access_level = ac.access_level
        WHERE ac.user_id = auth.uid()
          AND ac.is_active = true
          AND rp.action_code = p_action_code
          AND (
              ac.access_level = 'zeta' -- Global bypass for Zeta certs
              OR (ac.organization_id = p_org_id AND (
                  rp.scope = 'ORG'
                  OR (rp.scope = 'DEPT' AND ac.department_id = p_dept_id)
                  OR (rp.scope = 'SUB_DEPT' AND ac.sub_department_id = p_sub_dept_id)
              ))
          )
    );
$function$;

-- ── 4 ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_act_on_shift(p_action text, p_shift_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.shifts s
         WHERE s.id = p_shift_id
           AND public.user_has_action_in_scope(p_action, s.organization_id, s.department_id, s.sub_department_id));
$function$;

-- The place of an ACTIVE contract the employee holds — the reading
-- can_manage_employee_record already uses for user.edit.
CREATE OR REPLACE FUNCTION public.can_act_on_employee(p_action text, p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM hr.user_contracts uc
         WHERE uc.user_id = p_employee_id
           AND uc.status = 'Active'
           AND public.user_has_action_in_scope(p_action, uc.organization_id, uc.department_id, uc.sub_department_id));
$function$;

CREATE OR REPLACE FUNCTION public.can_act_in_subdept(p_action text, p_sub_department_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.sub_departments sd
          JOIN public.departments d ON d.id = sd.department_id
         WHERE sd.id = p_sub_department_id
           AND public.user_has_action_in_scope(p_action, d.organization_id, sd.department_id, sd.id));
$function$;

CREATE OR REPLACE FUNCTION public.can_act_in_dept(p_action text, p_department_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.departments d
         WHERE d.id = p_department_id
           AND public.user_has_action_in_scope(p_action, d.organization_id, d.id, NULL));
$function$;

-- A timesheet or attendance row: its shift's place when it has one, else the
-- employee's contracts (timesheets.shift_id is nullable).
CREATE OR REPLACE FUNCTION public.can_act_on_timesheet(p_action text, p_shift_id uuid, p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT CASE WHEN p_shift_id IS NOT NULL
                THEN public.can_act_on_shift(p_action, p_shift_id)
                ELSE public.can_act_on_employee(p_action, p_employee_id) END;
$function$;

-- Holds p_action at a non-SELF scope somewhere: for rows that carry no place
-- at all (idempotency keys and the like).
CREATE OR REPLACE FUNCTION public.holds_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.app_access_certificates ac
          JOIN public.rbac_permissions rp ON rp.access_level = ac.access_level
         WHERE ac.user_id = auth.uid()
           AND ac.is_active
           AND rp.action_code = p_action
           AND rp.scope <> 'SELF');
$function$;

CREATE OR REPLACE FUNCTION public.is_zeta()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.app_access_certificates ac
         WHERE ac.user_id = auth.uid() AND ac.is_active AND ac.access_level = 'zeta');
$function$;

-- Policies evaluate as the querying role, so authenticated needs EXECUTE.
DO $acl$
DECLARE f text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.can_act_on_shift(text,uuid)',
        'public.can_act_on_employee(text,uuid)',
        'public.can_act_in_subdept(text,uuid)',
        'public.can_act_in_dept(text,uuid)',
        'public.can_act_on_timesheet(text,uuid,uuid)',
        'public.holds_action(text)',
        'public.is_zeta()'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
    END LOOP;
END
$acl$;

-- ── Verify ──────────────────────────────────────────────────────────────────
DO $verify$
DECLARE v_failures text := '';
BEGIN
    IF EXISTS (SELECT 1 FROM public.rbac_permissions WHERE access_level = 'gamma' AND scope = 'DEPT') THEN
        v_failures := v_failures || 'gamma still has a DEPT row ; ';
    END IF;
    IF has_table_privilege('authenticated', 'public.rbac_permissions', 'INSERT,UPDATE,DELETE,TRUNCATE')
       OR has_table_privilege('anon', 'public.rbac_permissions', 'SELECT')
       OR has_table_privilege('authenticated', 'public.rbac_actions', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
        v_failures := v_failures || 'matrix still client-writable ; ';
    END IF;
    IF pg_get_functiondef('public.user_has_action_in_scope(text,uuid,uuid,uuid)'::regprocedure) ~ 'user_contracts' THEN
        v_failures := v_failures || 'user_has_action_in_scope still reads contracts ; ';
    END IF;
    IF has_function_privilege('anon', 'public.can_act_on_shift(text,uuid)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.can_act_on_shift(text,uuid)', 'EXECUTE') THEN
        v_failures := v_failures || 'helper ACL ; ';
    END IF;
    IF v_failures <> '' THEN
        RAISE EXCEPTION 'access matrix step 2a verification failed: %', v_failures;
    END IF;
END
$verify$;
