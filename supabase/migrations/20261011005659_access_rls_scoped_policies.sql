-- ============================================================================
-- Access matrix, step 2c: table policies ask about the row's PLACE.
--
-- Each policy below OR'd a scope-free helper into its manager branch —
-- is_manager_or_above() (gamma or above anywhere), user_has_delta_access()
-- (delta or above anywhere), is_admin() (epsilon anywhere, or the legacy
-- flag). Permissive policies OR together, so that branch let a manager of one
-- sub-department read and write every other department's rows (decisions 1
-- and 4). Each is now the matrix action over the row's own place:
--
--   shifts            the broad insert/delete/update policies dropped; the
--                     *_rbac policies already state the scoped rule. The
--                     assignee's own UPDATE branch is kept as it was.
--   rosters           rosters_select_certificates dropped (any certificate in
--                     the org, alpha included, read every roster)
--   shift_bids        bid.assign over the bid's shift
--   shift_bid_windows bid.close over the shift
--   shift_swaps       swap.approve over the requester's shift
--   swap_offers       the legacy-flag manager read becomes swap.approve
--   swap_requests     swap.approve over the request's org/dept
--   shift_offers      shift.assign over the shift
--   planning_*        shift.assign over the request's shift
--   compliance snapshots  shift.view over the shift
--   timesheets        timesheet.view to read, timesheet.approve to write, over
--                     the shift (or the employee's contracts when there is no
--                     shift); the dead get_my_role() policy dropped
--   attendance_records    the same, over the shift
--   roster_shift_assignments  roster.view / roster.edit over the employee
--   bulk_assign_idempotency / actual_labor_attendance   no place on the row:
--                     holds shift.assign / shift.edit somewhere
--
-- Every policy is recreated from its live text with only the helper call
-- substituted, so the owner/employee branches are byte-identical.
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.rewrite_policy(p_schema text, p_table text, p_policy text, p_from text, p_to text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record; v_qual text; v_check text; v_sql text;
BEGIN
    SELECT * INTO r FROM pg_policies WHERE schemaname = p_schema AND tablename = p_table AND policyname = p_policy;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'policy %.% / % not found', p_schema, p_table, p_policy;
    END IF;
    IF coalesce(r.qual, '') !~ p_from AND coalesce(r.with_check, '') !~ p_from THEN
        RAISE EXCEPTION 'policy %.% / % does not contain %', p_schema, p_table, p_policy, p_from;
    END IF;
    v_qual  := regexp_replace(r.qual, p_from, p_to, 'g');
    v_check := regexp_replace(r.with_check, p_from, p_to, 'g');
    EXECUTE format('DROP POLICY %I ON %I.%I', p_policy, p_schema, p_table);
    v_sql := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
                    p_policy, p_schema, p_table, r.permissive, r.cmd, array_to_string(r.roles, ', '));
    IF v_qual  IS NOT NULL THEN v_sql := v_sql || format(' USING (%s)', v_qual); END IF;
    IF v_check IS NOT NULL THEN v_sql := v_sql || format(' WITH CHECK (%s)', v_check); END IF;
    EXECUTE v_sql;
END $$;

-- swap offers carry only the swap id
CREATE OR REPLACE FUNCTION public.can_act_on_swap(p_action text, p_swap_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.shift_swaps ss
          JOIN public.shifts s ON s.id = ss.requester_shift_id
         WHERE ss.id = p_swap_id
           AND public.user_has_action_in_scope(p_action, s.organization_id, s.department_id, s.sub_department_id));
$function$;

-- planning offers carry only the request id
CREATE OR REPLACE FUNCTION public.can_act_on_planning_request(p_action text, p_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.planning_requests pr
         WHERE pr.id = p_request_id
           AND public.can_act_on_shift(p_action, pr.shift_id));
$function$;

DO $acl$
DECLARE f text;
BEGIN
    FOREACH f IN ARRAY ARRAY['public.can_act_on_swap(text,uuid)', 'public.can_act_on_planning_request(text,uuid)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
    END LOOP;
END
$acl$;

-- ── shifts / rosters ────────────────────────────────────────────────────────
DROP POLICY shifts_delete_managers ON public.shifts;
DROP POLICY shifts_insert_managers ON public.shifts;
SELECT pg_temp.rewrite_policy('public', 'shifts', 'shifts_update_access',
    ' OR has_permission\(\( SELECT auth\.uid\(\) AS uid\), sub_department_id, ''Gamma''::text\) OR user_has_delta_access\(\( SELECT auth\.uid\(\) AS uid\)\)',
    '');
ALTER POLICY shifts_update_access ON public.shifts RENAME TO shifts_update_own;
DROP POLICY rosters_select_certificates ON public.rosters;

-- ── bids / bid windows ──────────────────────────────────────────────────────
SELECT pg_temp.rewrite_policy('public', 'shift_bids', p, 'user_has_delta_access\(\( SELECT auth\.uid\(\) AS uid\)\)',
                              'public.can_act_on_shift(''bid.assign''::text, shift_id)')
  FROM unnest(ARRAY['bids_delete_own', 'bids_select_scoped', 'bids_update_own']) AS p;
SELECT pg_temp.rewrite_policy('public', 'shift_bid_windows', 'bid_windows_write_manager', 'is_manager_or_above\(\)',
                              'public.can_act_on_shift(''bid.close''::text, shift_id)');

-- ── swaps ───────────────────────────────────────────────────────────────────
SELECT pg_temp.rewrite_policy('public', 'shift_swaps', p, 'user_has_delta_access\(\( SELECT auth\.uid\(\) AS uid\)\)',
                              'public.can_act_on_shift(''swap.approve''::text, requester_shift_id)')
  FROM unnest(ARRAY['swaps_delete_own', 'swaps_select_scoped', 'swaps_update_involved']) AS p;
SELECT pg_temp.rewrite_policy('public', 'swap_requests', p, 'is_manager_or_above\(\)',
                              'public.user_has_action_in_scope(''swap.approve''::text, organization_id, department_id)')
  FROM unnest(ARRAY['swap_requests_insert_own', 'swap_requests_update_involved']) AS p;
DROP POLICY "Managers can view offers" ON public.swap_offers;
CREATE POLICY swap_offers_select_manager ON public.swap_offers
    AS PERMISSIVE FOR SELECT TO authenticated
    USING (public.can_act_on_swap('swap.approve'::text, swap_request_id));

-- ── offers / planning ───────────────────────────────────────────────────────
SELECT pg_temp.rewrite_policy('public', 'shift_offers', p, 'is_manager_or_above\(\)',
                              'public.can_act_on_shift(''shift.assign''::text, shift_id)')
  FROM unnest(ARRAY['shift_offers_delete_manager', 'shift_offers_insert_manager',
                    'shift_offers_select_own_or_manager', 'shift_offers_update_own_or_manager']) AS p;
SELECT pg_temp.rewrite_policy('public', 'planning_requests', 'Users can view relevant planning requests', 'is_manager_or_above\(\)',
                              'public.can_act_on_shift(''shift.assign''::text, shift_id)');
SELECT pg_temp.rewrite_policy('public', 'planning_offers', 'Users can view relevant planning offers', 'is_manager_or_above\(\)',
                              'public.can_act_on_planning_request(''shift.assign''::text, request_id)');

-- ── compliance snapshots ────────────────────────────────────────────────────
SELECT pg_temp.rewrite_policy('public', 'shift_compliance_snapshots', 'compliance_snapshots_self_or_manager_select', 'is_manager_or_above\(\)',
                              'public.can_act_on_shift(''shift.view''::text, shift_id)');

-- ── timesheets / attendance ─────────────────────────────────────────────────
DROP POLICY timesheets_member_select ON public.timesheets;  -- get_my_role() is legacy; timesheets_self_select covers it
SELECT pg_temp.rewrite_policy('public', 'timesheets', 'timesheets_manager_select', 'is_manager_or_above\(\)',
                              'public.can_act_on_timesheet(''timesheet.view''::text, shift_id, profile_id)');
SELECT pg_temp.rewrite_policy('public', 'timesheets', 'timesheets_admin_all', 'is_admin\(\)',
                              'public.can_act_on_timesheet(''timesheet.approve''::text, shift_id, profile_id)');
ALTER POLICY timesheets_admin_all ON public.timesheets RENAME TO timesheets_manager_write;
SELECT pg_temp.rewrite_policy('public', 'attendance_records', 'attendance_manager_write', 'is_manager_or_above\(\)',
                              'public.can_act_on_timesheet(''timesheet.approve''::text, shift_id, employee_id)');
SELECT pg_temp.rewrite_policy('public', 'attendance_records', 'attendance_self_or_manager_read', 'is_manager_or_above\(\)',
                              'public.can_act_on_timesheet(''timesheet.view''::text, shift_id, employee_id)');

-- ── roster assignments (dormant table) ──────────────────────────────────────
SELECT pg_temp.rewrite_policy('public', 'roster_shift_assignments', p, 'auth_can_manage_rosters\(\)',
                              'public.can_act_on_employee(''roster.edit''::text, employee_id)')
  FROM unnest(ARRAY['roster_assignments_delete', 'roster_assignments_insert', 'roster_assignments_update']) AS p;
SELECT pg_temp.rewrite_policy('public', 'roster_shift_assignments', 'roster_assignments_select_own_or_manager', 'is_manager_or_above\(\)',
                              'public.can_act_on_employee(''roster.view''::text, employee_id)');

-- ── rows with no place ──────────────────────────────────────────────────────
SELECT pg_temp.rewrite_policy('public', 'bulk_assign_idempotency', p, 'is_manager_or_above\(\)',
                              'public.holds_action(''shift.assign''::text)')
  FROM unnest(ARRAY['Managers can delete bulk assign idempotency', 'Managers can insert bulk assign idempotency',
                    'Managers can update bulk assign idempotency', 'Managers can view bulk assign idempotency']) AS p;
SELECT pg_temp.rewrite_policy('public', 'actual_labor_attendance', 'managers_insert_actual_labor_attendance', 'is_manager_or_above\(\)',
                              'public.holds_action(''shift.edit''::text)');

-- ── Verify ──────────────────────────────────────────────────────────────────
DO $verify$
DECLARE v_left text;
BEGIN
    SELECT string_agg(schemaname || '.' || tablename || '/' || policyname, ', ') INTO v_left
      FROM pg_policies
     WHERE tablename IN ('shifts', 'rosters', 'shift_bids', 'shift_bid_windows', 'shift_swaps', 'swap_requests',
                         'swap_offers', 'shift_offers', 'planning_requests', 'planning_offers',
                         'shift_compliance_snapshots', 'timesheets', 'attendance_records',
                         'roster_shift_assignments', 'bulk_assign_idempotency', 'actual_labor_attendance')
       AND coalesce(qual, '') || ' ' || coalesce(with_check, '')
           ~ '(is_manager_or_above|user_has_delta_access|is_admin|auth_can_manage_rosters|has_permission|get_my_role)\(|legacy_system_role';
    IF v_left IS NOT NULL THEN
        RAISE EXCEPTION 'access matrix step 2c: scope-free policies remain: %', v_left;
    END IF;
END
$verify$;
