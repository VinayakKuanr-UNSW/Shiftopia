-- Shift deletion: permanent, never in the past, never bypassed. Auditing removed.
--
-- Decisions (2026-10-04), mapped in docs/modules/shift-removal-pathways.md:
--   * All deletes are PERMANENT. No archive, no soft-delete state.
--   * A shift whose start (Sydney) has passed is NEVER deleted — from any path:
--     RPC, bulk, sub-group/template/roster delete, FK cascade, cron. The one
--     exception is purging a user from the database (delete_user_entirely).
--   * FULL-TIME shifts never enter bidding, trading or cancellation, and are
--     never unassigned — they are deleted (future only) or changed in the
--     Office/leave workflows.
--   * All auditing is removed until the feature set is frozen. KEPT:
--     shift_events — it is the event source for the KPI, Performance,
--     scorecard and cancellation-report pages (9 functions read it).
--
-- Every function body below was read from production (pg_get_functiondef) on
-- 2026-10-04, not from older migration files.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Past shifts are never deleted (one trigger, every pathway)
-- ─────────────────────────────────────────────────────────────────────────────
-- Was: `IF TG_OP = 'DELETE' THEN RETURN OLD` (every delete allowed) and an
-- "allow soft deletion" exception. Both gone.

CREATE OR REPLACE FUNCTION public.fn_prevent_locked_shift_modification()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift_start timestamptz;
BEGIN
  v_shift_start := (OLD.shift_date || ' ' || OLD.start_time)::timestamp AT TIME ZONE 'Australia/Sydney';

  IF TG_OP = 'DELETE' THEN
    -- Purging a user from the database deletes everything of theirs, past
    -- included. Set only by delete_user_entirely, which only the database
    -- (no signed-in user) can call.
    IF current_setting('app.shift_purge', true) = 'user' THEN
      RETURN OLD;
    END IF;
    IF v_shift_start <= now() THEN
      RAISE EXCEPTION 'Shift % has already started (Sydney time) and cannot be deleted.', OLD.id
        USING HINT = 'SHIFT_STARTED';
    END IF;
    RETURN OLD;
  END IF;

  IF v_shift_start <= NOW() THEN
    -- EXCEPTION 1: Allow unlinking from template
    IF (OLD.template_id IS NOT NULL AND NEW.template_id IS NULL) THEN
      RETURN NEW;
    END IF;
    -- EXCEPTION 2: Allow unlinking roster_template_id
    IF (OLD.roster_template_id IS NOT NULL AND NEW.roster_template_id IS NULL) THEN
      RETURN NEW;
    END IF;
    -- EXCEPTION 3: Allow operational updates (attendance, lifecycle, actuals, notes, updated_at)
    -- We only block changes to the core scheduling fields after a shift starts.
    IF (
      OLD.shift_date IS NOT DISTINCT FROM NEW.shift_date AND
      OLD.start_time IS NOT DISTINCT FROM NEW.start_time AND
      OLD.end_time IS NOT DISTINCT FROM NEW.end_time AND
      OLD.assigned_employee_id IS NOT DISTINCT FROM NEW.assigned_employee_id AND
      OLD.department_id IS NOT DISTINCT FROM NEW.department_id AND
      OLD.role_id IS NOT DISTINCT FROM NEW.role_id AND
      OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id AND
      OLD.assignment_status IS NOT DISTINCT FROM NEW.assignment_status
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Cannot modify a shift schedule that has already started (Sydney Time). Shift ID: %', OLD.id;
  END IF;
  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. No soft-delete state
-- ─────────────────────────────────────────────────────────────────────────────
-- 0 rows have deleted_at set (checked). The column stays because many reads
-- filter on it; the CHECK makes any writer still setting it fail loudly
-- instead of quietly hiding a shift (e.g. the gateway's legacy 'delete' op).

ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_no_soft_delete CHECK (deleted_at IS NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A permanent delete takes its dependents with it
-- ─────────────────────────────────────────────────────────────────────────────
-- These five blocked any delete of a shift that had rows in them (RESTRICT /
-- NO ACTION). Every other child table already cascades.

ALTER TABLE public.planning_requests    DROP CONSTRAINT planning_requests_shift_id_fkey,
  ADD CONSTRAINT planning_requests_shift_id_fkey    FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;
ALTER TABLE public.cancellation_history DROP CONSTRAINT cancellation_history_shift_id_fkey,
  ADD CONSTRAINT cancellation_history_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;
ALTER TABLE public.attendance_records   DROP CONSTRAINT attendance_records_shift_id_fkey,
  ADD CONSTRAINT attendance_records_shift_id_fkey   FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;
ALTER TABLE public.assignment_decisions DROP CONSTRAINT assignment_decisions_shift_id_fkey,
  ADD CONSTRAINT assignment_decisions_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;
ALTER TABLE public.assignment_events    DROP CONSTRAINT assignment_events_shift_id_fkey,
  ADD CONSTRAINT assignment_events_shift_id_fkey    FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Full-time shifts: no bidding, no trading, no cancelling, no unassigning
-- ─────────────────────────────────────────────────────────────────────────────
-- Enforced on the row, so drop, unassign, publish-unassigned, trade/swap
-- request and manager cancel all fail for FT whichever function attempts it.
-- Only TRANSITIONS are refused: 0 FT rows are in any of these states today.

CREATE OR REPLACE FUNCTION public.fn_full_time_shift_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_was_bidding boolean := false;
  v_was_trading boolean := false;
  v_was_cancelled boolean := false;
BEGIN
  IF NEW.target_employment_type IS DISTINCT FROM 'FT' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_was_bidding := OLD.is_on_bidding OR OLD.bidding_status::text = 'on_bidding';
    v_was_trading := OLD.trading_status::text <> 'NoTrade';
    v_was_cancelled := OLD.is_cancelled;
  END IF;

  IF (NEW.is_on_bidding OR NEW.bidding_status::text = 'on_bidding') AND NOT v_was_bidding THEN
    RAISE EXCEPTION 'Full-time shifts cannot be put up for bidding.' USING HINT = 'FT_NO_BIDDING';
  END IF;
  IF NEW.trading_status::text <> 'NoTrade' AND NOT v_was_trading THEN
    RAISE EXCEPTION 'Full-time shifts cannot be traded.' USING HINT = 'FT_NO_TRADING';
  END IF;
  IF NEW.is_cancelled AND NOT v_was_cancelled THEN
    RAISE EXCEPTION 'Full-time shifts cannot be cancelled. Delete the shift instead.' USING HINT = 'FT_NO_CANCEL';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.assigned_employee_id IS NOT NULL AND NEW.assigned_employee_id IS NULL THEN
    RAISE EXCEPTION 'Full-time shifts cannot be unassigned. Delete the shift instead.' USING HINT = 'FT_NO_UNASSIGN';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_full_time_shift_rules
  BEFORE INSERT OR UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.fn_full_time_shift_rules();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Delete commands: permanent, authorised, explicit about why they refuse
-- ─────────────────────────────────────────────────────────────────────────────
-- Who may delete: the same rule the shift gateway applies to every other
-- manager write — admin, or an active gamma+ access certificate. A NULL caller
-- is the database itself (cron, SQL editor, service role).

CREATE OR REPLACE FUNCTION public._can_manage_shifts()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NULL
      OR public.is_admin()
      OR EXISTS (
           SELECT 1 FROM public.app_access_certificates c
            WHERE c.user_id = auth.uid() AND c.is_active = true
              AND c.access_level IN ('gamma', 'delta', 'epsilon', 'zeta'));
$function$;
REVOKE EXECUTE ON FUNCTION public._can_manage_shifts() FROM PUBLIC, anon, authenticated;

-- Why one shift cannot be deleted, or NULL if it can. Mirrors the trigger so
-- the RPCs answer with a code instead of an exception.
CREATE OR REPLACE FUNCTION public._shift_delete_refusal(p_shift public.shifts)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_shift.actual_start IS NOT NULL
      OR p_shift.lifecycle_status::text IN ('InProgress', 'Completed') THEN 'SHIFT_WORKED'
    WHEN (p_shift.shift_date || ' ' || p_shift.start_time)::timestamp AT TIME ZONE 'Australia/Sydney' <= now()
      THEN 'SHIFT_STARTED'
  END;
$function$;
REVOKE EXECUTE ON FUNCTION public._shift_delete_refusal(public.shifts) FROM PUBLIC, anon, authenticated;

-- sm_delete_shift gains an optional expected version (the roster's delete was
-- version-checked through the gateway; it now comes here). Old 3-arg form dropped.
DROP FUNCTION IF EXISTS public.sm_delete_shift(uuid, uuid, text);

CREATE FUNCTION public.sm_delete_shift(
  p_shift_id uuid,
  p_user_id uuid DEFAULT NULL::uuid,
  p_reason text DEFAULT NULL::text,
  p_expected_version integer DEFAULT NULL::integer
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_refusal text;
BEGIN
  IF NOT public._can_manage_shifts() THEN
    RETURN json_build_object('success', false, 'shift_id', p_shift_id,
      'error', 'You are not allowed to delete shifts.', 'code', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'shift_id', p_shift_id,
      'error', 'Shift not found', 'code', 'SHIFT_NOT_FOUND');
  END IF;

  IF p_expected_version IS NOT NULL AND v_shift.version <> p_expected_version THEN
    RETURN json_build_object('success', false, 'shift_id', p_shift_id,
      'error', 'This shift was changed by someone else. Refresh and try again.', 'code', 'VERSION_CONFLICT');
  END IF;

  v_refusal := public._shift_delete_refusal(v_shift);
  IF v_refusal = 'SHIFT_WORKED' THEN
    RETURN json_build_object('success', false, 'shift_id', p_shift_id,
      'error', 'This shift has been worked, so it cannot be deleted. Correct it through the timesheet instead.',
      'code', v_refusal);
  ELSIF v_refusal = 'SHIFT_STARTED' THEN
    RETURN json_build_object('success', false, 'shift_id', p_shift_id,
      'error', 'This shift has already started, so it cannot be deleted.', 'code', v_refusal);
  END IF;

  DELETE FROM public.shifts WHERE id = p_shift_id;

  RETURN json_build_object('success', true, 'shift_id', p_shift_id, 'message', 'Shift deleted');
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.sm_delete_shift(uuid, uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sm_delete_shift(uuid, uuid, text, integer) TO authenticated, service_role;

-- Bulk: was a SOFT delete of any ids, unauthorised. Now permanent, authorised,
-- and per-item: one started shift refuses itself, not the whole batch.
CREATE OR REPLACE FUNCTION public.sm_bulk_delete_shifts(
  p_shift_ids uuid[],
  p_deleted_by uuid DEFAULT auth.uid(),
  p_reason text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_id uuid;
  v_shift public.shifts%ROWTYPE;
  v_refusal text;
  v_deleted uuid[] := '{}';
  v_failed jsonb := '[]'::jsonb;
BEGIN
  IF NOT public._can_manage_shifts() THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not allowed to delete shifts.',
      'total_requested', COALESCE(array_length(p_shift_ids, 1), 0), 'success_count', 0);
  END IF;

  FOREACH v_id IN ARRAY COALESCE(p_shift_ids, '{}') LOOP
    SELECT * INTO v_shift FROM public.shifts WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', 'Shift not found');
      CONTINUE;
    END IF;
    v_refusal := public._shift_delete_refusal(v_shift);
    IF v_refusal IS NOT NULL THEN
      v_failed := v_failed || jsonb_build_object('id', v_id, 'reason',
        CASE v_refusal WHEN 'SHIFT_WORKED' THEN 'Already worked' ELSE 'Already started' END);
      CONTINUE;
    END IF;
    DELETE FROM public.shifts WHERE id = v_id;
    v_deleted := v_deleted || v_id;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'total_requested', COALESCE(array_length(p_shift_ids, 1), 0),
    'success_count', COALESCE(array_length(v_deleted, 1), 0),
    'failure_count', jsonb_array_length(v_failed),
    'deleted_ids', to_jsonb(v_deleted),
    'failed', v_failed
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.sm_bulk_delete_shifts(uuid[], uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sm_bulk_delete_shifts(uuid[], uuid, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Deleting a user: database only, and everything of theirs goes
-- ─────────────────────────────────────────────────────────────────────────────
-- Was callable by any signed-in user (zeta check inside), and only UNASSIGNED
-- their shifts. From the database auth.uid() is NULL, so the zeta check made it
-- impossible to run there at all. Now: refuses any signed-in caller; deletes
-- the user's shifts (past included — the purge is the one exception to §1).

CREATE OR REPLACE FUNCTION public.delete_user_entirely(user_uuid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Users can only be deleted from the database, not from the app.';
  END IF;

  -- 1. The user's own shifts, past included.
  PERFORM set_config('app.shift_purge', 'user', true);
  DELETE FROM public.shifts WHERE assigned_employee_id = user_uuid;
  PERFORM set_config('app.shift_purge', '', true);

  -- 2. Other people's rows that merely name them: unlink.
  UPDATE public.shifts
     SET cancelled_by_user_id = NULLIF(cancelled_by_user_id, user_uuid),
         published_by_user_id = NULLIF(published_by_user_id, user_uuid),
         emergency_assigned_by = NULLIF(emergency_assigned_by, user_uuid),
         dropped_by_id = NULLIF(dropped_by_id, user_uuid)
   WHERE cancelled_by_user_id = user_uuid OR published_by_user_id = user_uuid
      OR emergency_assigned_by = user_uuid OR dropped_by_id = user_uuid;
  UPDATE public.timesheets SET approved_by = NULL WHERE approved_by = user_uuid;
  UPDATE public.rosters SET published_by = NULL, created_by = NULL WHERE published_by = user_uuid OR created_by = user_uuid;
  UPDATE public.availabilities SET approved_by = NULL WHERE approved_by = user_uuid;
  UPDATE public.shift_swaps SET approved_by = NULL WHERE approved_by = user_uuid;
  UPDATE public.leave_requests SET approved_by = NULL WHERE approved_by = user_uuid;
  UPDATE public.roster_templates
     SET last_edited_by = NULL, published_by = NULL, created_by = NULL
   WHERE last_edited_by = user_uuid OR published_by = user_uuid OR created_by = user_uuid;
  UPDATE public.app_access_certificates SET created_by = NULL WHERE created_by = user_uuid;
  UPDATE public.roster_template_batches SET applied_by = NULL WHERE applied_by = user_uuid;
  UPDATE public.shift_bids SET reviewed_by = NULL WHERE reviewed_by = user_uuid;

  -- 3. Their own records.
  DELETE FROM public.employee_leave_balances WHERE employee_id = user_uuid;
  DELETE FROM public.cancellation_history WHERE employee_id = user_uuid;
  DELETE FROM public.attendance_records WHERE employee_id = user_uuid;
  DELETE FROM public.autoschedule_assignments WHERE employee_id = user_uuid;
  DELETE FROM public.leave_requests WHERE employee_id = user_uuid;
  DELETE FROM public.template_shifts WHERE assigned_employee_id = user_uuid;
  DELETE FROM public.app_access_certificates WHERE user_id = user_uuid;
  DELETE FROM public.user_contracts WHERE user_id = user_uuid;

  -- 4. The profile (remaining CASCADEs), then the login.
  DELETE FROM public.profiles WHERE id = user_uuid;
  DELETE FROM auth.users WHERE id = user_uuid;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.delete_user_entirely(uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Remove the archive, the audit trails, the cleanup job and test harness
-- ─────────────────────────────────────────────────────────────────────────────

-- Dead-shift cleanup: broken since 2026-08-04 (stale timesheet_review_queue
-- reference) and archived through the table dropped below.
SELECT cron.unschedule(jobid) FROM cron.job WHERE command ILIKE '%cleanup_dead_shifts_batch%';
DROP FUNCTION IF EXISTS public.cleanup_dead_shifts_batch(boolean, integer);

-- Archive.
DROP FUNCTION IF EXISTS public._archive_shift_before_delete(uuid, uuid, text, text);
DROP TABLE IF EXISTS public.deleted_shifts;

-- Shift audit read paths (the History / lifecycle timelines). The shift_events
-- ledger itself stays — see header.
DROP FUNCTION IF EXISTS public.get_shift_event_timeline(uuid);
DROP FUNCTION IF EXISTS public.get_employee_event_timeline(uuid, integer);
DROP FUNCTION IF EXISTS public.get_shift_lifecycle(uuid);

-- Leave audit trail.
DROP TRIGGER IF EXISTS trg_capture_leave_event ON public.leave_requests;
DROP FUNCTION IF EXISTS public.fn_capture_leave_event();
DROP TABLE IF EXISTS public.leave_request_events;

-- Timesheet audit trail. diag.rbac_ladder_violations names the table in a
-- CASE; recreated without that branch first.
CREATE OR REPLACE VIEW diag.rbac_ladder_violations AS
SELECT p.polrelid::regclass::text AS tbl,
       p.polname                  AS policy_name,
       CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                     WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                     ELSE 'ALL' END AS cmd,
       CASE
         WHEN p.polrelid = 'public.demand_templates'::regclass
           THEN 'accepted: table has no tenant column (COMMENT ON TABLE)'
         ELSE 'VIOLATION'
       END AS verdict
  FROM pg_policy p
 WHERE (COALESCE(pg_get_expr(p.polqual, p.polrelid), '')
     || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'access_level'
   AND (COALESCE(pg_get_expr(p.polqual, p.polrelid), '')
     || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ '''(gamma|delta|epsilon|zeta)'''
   AND (COALESCE(pg_get_expr(p.polqual, p.polrelid), '')
     || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')) !~ 'user_has_action_in_scope';

DROP TRIGGER IF EXISTS trg_timesheet_provenance ON public.timesheets;
DROP FUNCTION IF EXISTS public.fn_timesheet_provenance();
DROP TRIGGER IF EXISTS trg_timesheet_audit_append_only ON public.timesheet_audit_log;
DROP FUNCTION IF EXISTS public.fn_timesheet_audit_append_only();
DROP TABLE IF EXISTS public.timesheet_audit_log;

-- Unauthorised / unused deleters, and the test harness (callable by any
-- signed-in user, several DELETE FROM shifts).
DROP FUNCTION IF EXISTS public.admin_delete_shift_rpc(uuid, uuid);
DROP FUNCTION IF EXISTS public.cleanup_test_shifts();
DROP FUNCTION IF EXISTS public.test_all_transitions();
DROP FUNCTION IF EXISTS public.test_create_shifts(integer, text, interval);
DROP FUNCTION IF EXISTS public.test_transition_matrix_v3();
DROP FUNCTION IF EXISTS public.test_time_boundaries_v3();
DROP FUNCTION IF EXISTS public.test_identity_and_permissions_v3();
DROP FUNCTION IF EXISTS public.test_reentrancy_and_idempotency_v3();
DROP FUNCTION IF EXISTS public.test_concurrency_races_v3();
