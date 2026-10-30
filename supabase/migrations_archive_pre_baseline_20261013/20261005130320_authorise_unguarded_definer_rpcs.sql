-- ─────────────────────────────────────────────────────────────────────────────
-- APPLIED TO PROD 2026-10-05 via the Supabase MCP (ledger version
-- 20261005130320). Do not re-run against production. Rollback-only dry-run:
-- guard injected exactly once into all 29 functions; an alpha employee was
-- refused publish (42501), create shift, add roster subgroup, save template,
-- mark_shift_no_show and notify_user, and the template cascade delete returned
-- -1 with nothing deleted; the org admin still published (S2 → S4) and a
-- no-JWT (cron) call still published. Post-apply, with one of James's shifts
-- handed to a colleague inside a rolled-back transaction, James was refused
-- accept / decline / accept-as-colleague / drop / check-in / unassign / expire
-- on it (42501 each), while the colleague passed the guard on their own shift.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- Authorise the SECURITY DEFINER RPCs that wrote with no check on the caller.
--
-- A 2026-10-05 sweep of the 210 definer functions signed-in users can EXECUTE
-- found 72 that write (INSERT/UPDATE/DELETE) with no authorisation in their
-- body, and nothing on public.shifts checks the caller either (no trigger does).
-- Definer functions bypass RLS, so each was a direct door. Proven with a
-- rollback-only probe: an alpha employee called sm_publish_shift on a manager's
-- draft and it went S2 → S4. Several trust an actor id the caller supplies
-- (p_user_id / p_employee_id), and sm_accept_offer / sm_decline_offer never
-- check that the offer was made to that actor at all.
--
-- The shift gateway (sm_apply_shift_op) and sm_delete_shift were already
-- guarded (gamma+ certificate or admin); these functions predate that convention
-- or bypass it.
--
-- Three remedies:
--  1. The 26 function signatures the app calls — plus publish_shift (reached
--     through bulk_publish_shifts) — keep EXECUTE and get a guard as the FIRST
--     statement of their existing body (injected below, logic otherwise
--     byte-for-byte unchanged; the guard therefore survives anyone who later
--     edits from pg_get_functiondef):
--       * manager operations need the RBAC action over the shift's / roster's /
--         template's own scope (user_has_action_in_scope — the same ladder the
--         UI uses: shift.publish, shift.assign, shift.edit, shift.create,
--         bid.close, roster.edit);
--       * employee operations need the caller to BE the actor and the shift's
--         assignee — or a manager holding shift.assign over it.
--     Requests with no end-user JWT (pg_cron, SQL, the service role) pass, so
--     background jobs and edge functions are unaffected. Delegating wrappers
--     (bulk_publish_shifts, publish_template_range, sm_bulk_*) inherit the
--     guard through the function they call: the JWT context propagates.
--  2. 36 functions (and 5 unused overloads) that nothing calls — not the client,
--     the edge functions, the Python services, cron, or an invoker function —
--     lose EXECUTE for client roles. Definer callers still reach them.
--  3. notify_user is called by five SECURITY INVOKER notification triggers; they
--     become SECURITY DEFINER (they read no identity) so notify_user can lose
--     client EXECUTE too — it let anyone send any user any notification.
-- acknowledge_broadcast / mark_broadcast_read are the intended (not yet wired)
-- write path for acknowledgements, so they keep EXECUTE and are bound to the
-- caller instead.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Guard helpers ────────────────────────────────────────────────────────
-- A request with no end-user JWT: pg_cron, direct SQL, the service role.
CREATE FUNCTION public.sm_request_is_system()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT auth.role() IS NULL OR auth.role() = 'service_role';
$$;

CREATE FUNCTION public.sm_require_scope(p_action text, p_org_id uuid, p_dept_id uuid, p_sub_dept_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.sm_request_is_system() THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL
     AND (public.user_has_action_in_scope(p_action, p_org_id, p_dept_id, p_sub_dept_id)
          OR public.sm_legacy_manager(auth.uid())) THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'Not authorised: % is not granted to you in this scope', p_action
    USING ERRCODE = '42501';
END;
$$;

-- Manager action over an existing shift. An unknown shift passes through so the
-- function reports "not found" itself.
CREATE FUNCTION public.sm_require_shift_action(p_shift_id uuid, p_action text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE s record;
BEGIN
  IF public.sm_request_is_system() THEN RETURN; END IF;
  SELECT organization_id, department_id, sub_department_id INTO s FROM public.shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM public.sm_require_scope(p_action, s.organization_id, s.department_id, s.sub_department_id);
END;
$$;

-- Employee acting on their own shift (actor, when given, must be the caller, and
-- the caller must be the assignee) — or a manager holding p_manager_action.
CREATE FUNCTION public.sm_require_assignee_or(p_shift_id uuid, p_actor uuid, p_manager_action text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.sm_request_is_system() THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL
     AND (p_actor IS NULL OR p_actor = auth.uid())
     AND EXISTS (SELECT 1 FROM public.shifts WHERE id = p_shift_id AND assigned_employee_id = auth.uid()) THEN
    RETURN;
  END IF;
  PERFORM public.sm_require_shift_action(p_shift_id, p_manager_action);
END;
$$;

-- Shift creation from a payload: the roster (by id, or via its sub-group) is
-- authoritative, falling back to the payload's own placement keys.
CREATE FUNCTION public.sm_require_shift_data_action(p_shift_data jsonb, p_action text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_roster uuid; v_org uuid; v_dept uuid; v_sub uuid;
BEGIN
  IF public.sm_request_is_system() THEN RETURN; END IF;
  v_roster := NULLIF(p_shift_data->>'roster_id', '')::uuid;
  IF v_roster IS NULL AND NULLIF(p_shift_data->>'roster_subgroup_id', '') IS NOT NULL THEN
    SELECT g.roster_id INTO v_roster
      FROM public.roster_subgroups sg JOIN public.roster_groups g ON g.id = sg.roster_group_id
     WHERE sg.id = (p_shift_data->>'roster_subgroup_id')::uuid;
  END IF;
  IF v_roster IS NOT NULL THEN
    SELECT organization_id, department_id, sub_department_id INTO v_org, v_dept, v_sub
      FROM public.rosters WHERE id = v_roster;
  END IF;
  v_org  := COALESCE(v_org,  NULLIF(p_shift_data->>'organization_id', '')::uuid);
  v_dept := COALESCE(v_dept, NULLIF(p_shift_data->>'department_id', '')::uuid);
  v_sub  := COALESCE(v_sub,  NULLIF(p_shift_data->>'sub_department_id', '')::uuid);
  PERFORM public.sm_require_scope(p_action, v_org, v_dept, v_sub);
END;
$$;

CREATE FUNCTION public.sm_require_roster_action(p_roster_id uuid, p_action text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE r record;
BEGIN
  IF public.sm_request_is_system() THEN RETURN; END IF;
  SELECT organization_id, department_id, sub_department_id INTO r FROM public.rosters WHERE id = p_roster_id;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM public.sm_require_scope(p_action, r.organization_id, r.department_id, r.sub_department_id);
END;
$$;

-- Template authority — the same rule as the template tables' write policies
-- (can_edit_template, 20261005123709). Unknown templates pass through.
CREATE FUNCTION public.sm_require_template_edit(p_template_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.sm_request_is_system() THEN RETURN; END IF;
  IF p_template_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.roster_templates WHERE id = p_template_id) THEN RETURN; END IF;
  IF public.can_edit_template(p_template_id) THEN RETURN; END IF;
  RAISE EXCEPTION 'Not authorised to change this template' USING ERRCODE = '42501';
END;
$$;

-- Applying a template creates shifts in the target scope, resolved exactly as
-- apply_template_to_date_range_v2 resolves it.
CREATE FUNCTION public.sm_require_template_apply(p_template_id uuid, p_target_dept_id uuid, p_target_sub_dept_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE t record;
BEGIN
  IF public.sm_request_is_system() THEN RETURN; END IF;
  SELECT organization_id, department_id, sub_department_id INTO t FROM public.roster_templates WHERE id = p_template_id;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM public.sm_require_scope('shift.create', t.organization_id,
                                  COALESCE(p_target_dept_id, t.department_id),
                                  COALESCE(p_target_sub_dept_id, t.sub_department_id));
END;
$$;

-- Capturing a roster as a template creates a template in that sub-department —
-- the same rule as roster_templates_insert, plus the manager gate it updates with.
CREATE FUNCTION public.sm_require_template_create_in(p_sub_department_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_org uuid; v_dept uuid;
BEGIN
  IF public.sm_request_is_system() THEN RETURN; END IF;
  SELECT d.organization_id, sd.department_id INTO v_org, v_dept
    FROM public.sub_departments sd JOIN public.departments d ON d.id = sd.department_id
   WHERE sd.id = p_sub_department_id;
  IF public.auth_can_manage_templates()
     OR public.auth_can_create_template(v_org, v_dept, p_sub_department_id) THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'Not authorised to create templates here' USING ERRCODE = '42501';
END;
$$;

-- The caller may only act for themselves (or be a system request).
CREATE FUNCTION public.sm_require_self(p_actor uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.sm_request_is_system() THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND p_actor = auth.uid() THEN RETURN; END IF;
  RAISE EXCEPTION 'Not authorised to act for another user' USING ERRCODE = '42501';
END;
$$;

-- ── 2. Inject a guard as the first statement of each function ───────────────
DO $inject$
DECLARE
  g        record;
  v_def    text;
  v_tag    text;
  v_start  int;
  v_body   text;
  v_at     int;
  v_head   text;
BEGIN
  FOR g IN SELECT * FROM (VALUES
    -- manager operations on an existing shift
    ('public.sm_publish_shift(uuid,uuid)',                         $g$PERFORM public.sm_require_shift_action(p_shift_id, 'shift.publish');$g$),
    ('public.publish_shift(uuid,uuid)',                            $g$PERFORM public.sm_require_shift_action(p_shift_id, 'shift.publish');$g$),
    ('public.sm_unpublish_shift(uuid,uuid,text)',                  $g$PERFORM public.sm_require_shift_action(p_shift_id, 'shift.publish');$g$),
    ('public.sm_manager_cancel(uuid,uuid,text)',                   $g$PERFORM public.sm_require_shift_action(p_shift_id, 'shift.edit');$g$),
    ('public.sm_move_shift(uuid,text,text,uuid,uuid,date,uuid)',   $g$PERFORM public.sm_require_shift_action(p_shift_id, 'shift.edit');$g$),
    ('public.sm_close_bidding(uuid,uuid,text)',                    $g$PERFORM public.sm_require_shift_action(p_shift_id, 'bid.close');$g$),
    ('public.sm_emergency_assign(uuid,uuid,text,uuid)',            $g$PERFORM public.sm_require_shift_action(p_shift_id, 'shift.assign');$g$),
    ('public.sm_unassign_shift(uuid,uuid)',                        $g$PERFORM public.sm_require_shift_action(p_shift_id, 'shift.assign');$g$),
    -- employee operations on their own shift (or a manager)
    ('public.sm_accept_offer(uuid,uuid)',                          $g$PERFORM public.sm_require_assignee_or(p_shift_id, p_user_id, 'shift.assign');$g$),
    ('public.sm_decline_offer(uuid,uuid)',                         $g$PERFORM public.sm_require_assignee_or(p_shift_id, p_user_id, 'shift.assign');$g$),
    ('public.sm_reject_offer(uuid,uuid)',                          $g$PERFORM public.sm_require_assignee_or(p_shift_id, p_user_id, 'shift.assign');$g$),
    ('public.sm_reject_offer(uuid,uuid,text)',                     $g$PERFORM public.sm_require_assignee_or(p_shift_id, p_user_id, 'shift.assign');$g$),
    ('public.sm_expire_offer_now(uuid)',                           $g$PERFORM public.sm_require_assignee_or(p_shift_id, NULL, 'shift.assign');$g$),
    ('public.sm_employee_drop_shift(uuid,uuid,text,text)',         $g$PERFORM public.sm_require_assignee_or(p_shift_id, p_employee_id, 'shift.assign');$g$),
    ('public.sm_request_trade(uuid,uuid,uuid)',                    $g$PERFORM public.sm_require_assignee_or(p_shift_id, p_user_id, 'shift.assign');$g$),
    ('public.check_in_shift(uuid,double precision,double precision)', $g$PERFORM public.sm_require_assignee_or(p_shift_id, NULL, 'shift.edit');$g$),
    ('public.withdraw_bid_rpc(uuid,uuid)',                         $g$IF NOT public.sm_request_is_system() AND p_employee_id IS DISTINCT FROM auth.uid() THEN PERFORM public.sm_require_shift_action((SELECT b.shift_id FROM public.shift_bids b WHERE b.id = p_bid_id), 'bid.assign'); END IF;$g$),
    -- creation and roster structure
    ('public.sm_create_shift(jsonb,uuid)',                         $g$PERFORM public.sm_require_shift_data_action(p_shift_data, 'shift.create');$g$),
    ('public.add_roster_subgroup_range(uuid,uuid,uuid,text,text,date,date)', $g$PERFORM public.sm_require_scope('roster.edit', p_org_id, p_dept_id, p_sub_dept_id);$g$),
    ('public.delete_roster_subgroup_v2(uuid,uuid,text,text,date,date)',      $g$PERFORM public.sm_require_scope('roster.edit', p_org_id, p_dept_id, NULL);$g$),
    ('public.rename_roster_subgroup_v2(uuid,uuid,text,text,text,date,date)', $g$PERFORM public.sm_require_scope('roster.edit', p_org_id, p_dept_id, NULL);$g$),
    ('public.sm_clear_template_application(uuid,uuid,uuid)',       $g$PERFORM public.sm_require_roster_action(p_roster_id, 'roster.edit');$g$),
    -- templates
    ('public.save_template_full(uuid,integer,text,text,jsonb,uuid)', $g$PERFORM public.sm_require_template_edit(p_template_id);$g$),
    ('public.delete_template_shifts_cascade(uuid)',                $g$PERFORM public.sm_require_template_edit(p_template_id);$g$),
    ('public.undo_template_batch(uuid,uuid)',                      $g$PERFORM public.sm_require_template_edit((SELECT b.template_id FROM public.roster_template_batches b WHERE b.id = p_batch_id));$g$),
    ('public.apply_template_to_date_range_v2(uuid,date,date,uuid,text,uuid,uuid,boolean)', $g$PERFORM public.sm_require_template_apply(p_template_id, p_target_department_id, p_target_sub_department_id);$g$),
    ('public.capture_roster_as_template(date,date,uuid,text)',     $g$PERFORM public.sm_require_template_create_in(p_sub_department_id);$g$),
    -- broadcasts: acknowledge / read only for yourself
    ('public.acknowledge_broadcast(uuid,uuid)',                    $g$PERFORM public.sm_require_self(employee_uuid);$g$),
    ('public.mark_broadcast_read(uuid,uuid)',                      $g$PERFORM public.sm_require_self(employee_uuid);$g$)
  ) AS t(sig, guard)
  LOOP
    v_def := pg_get_functiondef(g.sig::regprocedure);
    IF v_def ~ 'sm_require_' THEN
      RAISE EXCEPTION 'guard injection: % is already guarded', g.sig;
    END IF;
    -- the body opens at "AS $tag$"
    v_tag   := (regexp_match(v_def, E'\nAS (\\$[A-Za-z_]*\\$)'))[1];
    v_start := position(E'\nAS ' || v_tag in v_def) + length(E'\nAS ' || v_tag);
    v_body  := substr(v_def, v_start);
    -- first BEGIN of the block: the end of the DECLARE section
    v_at    := regexp_instr(v_body, '\mBEGIN\M', 1, 1, 1, 'i');
    v_head  := substr(v_body, 1, v_at - 1);
    -- refuse if that BEGIN sits inside a line comment, a string or a block comment
    IF v_at = 0
       OR substring(v_head from '[^\n]*$') ~ '--'
       OR (length(v_head) - length(replace(v_head, '''', ''))) % 2 = 1
       OR (v_head ~ '/\*' AND v_head !~ '\*/') THEN
      RAISE EXCEPTION 'guard injection: cannot place the guard safely in %', g.sig;
    END IF;
    EXECUTE substr(v_def, 1, v_start - 1) || v_head
         || E'\n  -- authz guard (20261005 rpc guards): reject callers without authority before any work\n  '
         || g.guard
         || substr(v_body, v_at);
  END LOOP;
END
$inject$;

-- ── 3. Unused functions and overloads: no client EXECUTE ────────────────────
DO $revoke$
DECLARE f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN (
         'add_roster_shift', 'assign_employee_to_shift', 'assign_shift_employee', 'bid_on_shift_rpc',
         'cancel_shift', 'compute_employee_quarter_metrics', 'compute_prediction_outcomes',
         'create_profile_for_user', 'create_swap_rpc', 'delete_roster_subgroup', 'emergency_assign_shift',
         'employee_cancel_shift', 'get_or_create_roster_day', 'mark_shift_no_show',
         'process_shift_time_transitions', 'process_shift_timers', 'publish_roster_day', 'publish_shift',
         'reject_shift_offer', 'rename_roster_subgroup', 'request_shift_trade', 'request_trade',
         'select_bid_winner', 'select_bidding_winner', 'set_roster_day_status', 'sm_approve_trade',
         'sm_cancel_shift', 'sm_cancel_trade_request', 'sm_complete_shift', 'sm_employee_cancel',
         'sm_expire_trade', 'sm_mark_no_show', 'sm_reject_trade', 'sm_update_shift',
         'unpublish_roster_day', 'update_shift_lifecycle_status')
    UNION ALL
    SELECT unnest(ARRAY[
      'public.add_roster_subgroup_range(uuid,text,text,date,date)',
      'public.capture_roster_as_template(date,date,uuid,text,uuid)',
      'public.undo_template_batch(uuid)',
      'public.sm_request_trade(uuid,uuid)',
      'public.sm_accept_trade(uuid,uuid)']::regprocedure[])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END
$revoke$;

-- ── 4. notify_user: only triggers and definer functions call it ─────────────
ALTER FUNCTION public.trg_bidding_expired_notification_fn()      SECURITY DEFINER SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_emergency_assignment_notification_fn() SECURITY DEFINER SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_offer_expired_notification_fn()        SECURITY DEFINER SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_swap_expired_notification_fn()         SECURITY DEFINER SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_timesheet_decision()                   SECURITY DEFINER SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.trg_bidding_expired_notification_fn()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_emergency_assignment_notification_fn() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_offer_expired_notification_fn()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_swap_expired_notification_fn()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_timesheet_decision()                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_user(uuid, text, text, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_user(uuid, text, text, text, uuid, text, text, text) TO service_role;

-- ── Grants for the helpers (revoke last: CREATE re-applies default grants) ───
DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.sm_request_is_system()',
    'public.sm_require_scope(text,uuid,uuid,uuid)',
    'public.sm_require_shift_action(uuid,text)',
    'public.sm_require_assignee_or(uuid,uuid,text)',
    'public.sm_require_shift_data_action(jsonb,text)',
    'public.sm_require_roster_action(uuid,text)',
    'public.sm_require_template_edit(uuid)',
    'public.sm_require_template_apply(uuid,uuid,uuid)',
    'public.sm_require_template_create_in(uuid)',
    'public.sm_require_self(uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END
$grants$;
