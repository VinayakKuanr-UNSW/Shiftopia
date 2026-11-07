-- sm_approve_leave decided "already started" from shifts.start_at, while
-- _shift_delete_refusal (which sm_delete_shift then applies) decides it from
-- shift_date + start_time in Australia/Sydney. Two definitions of the same fact:
-- wherever they disagreed, this function would pick a shift up as actionable and
-- then abort the whole approval when delete refused it as SHIFT_STARTED.
--
-- It now asks _shift_delete_refusal itself, so there is one definition and the
-- two cannot drift. That function also reports SHIFT_WORKED (a clock-in, or
-- InProgress/Completed), which is the other reason a shift is kept, so the
-- separate timesheet check is gone. SHIFT_PUBLISHED is not a refusal here: a
-- published shift is exactly what gets cancelled or unassigned.
CREATE OR REPLACE FUNCTION public.sm_approve_leave(
  p_request_id  uuid,
  p_approver_id uuid DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_req        public.leave_requests%ROWTYPE;
  v_approver   uuid;
  v_from       date;
  v_to         date;
  v_ft_minutes integer := 0;
  v_note       text;
  v_span       text;
  v_c          record;
  v_state      text;
  v_res        jsonb;
  v_resj       json;
  v_cancelled  int := 0;
  v_deleted    int := 0;
  v_unassigned int := 0;
  v_kept       int := 0;
BEGIN
  -- An explicit approver is honoured only for a system caller (service_role, the
  -- SQL tests). A signed-in manager is always themselves, never who they claim.
  v_approver := CASE WHEN public.sm_request_is_system()
                     THEN coalesce(p_approver_id, auth.uid())
                     ELSE auth.uid() END;

  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'REQUEST_NOT_FOUND',
      'error', 'Leave request not found.');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'code', 'NOT_PENDING',
      'error', format('This request is %s, so it can no longer be approved. Refresh to see its status.', v_req.status));
  END IF;
  IF v_approver IS NOT NULL AND v_req.employee_id = v_approver THEN
    RETURN jsonb_build_object('success', false, 'code', 'SELF_APPROVAL',
      'error', 'You cannot approve your own leave.');
  END IF;

  -- leave.approve where this employee works -- the same test as the RLS policy
  IF NOT public.sm_request_is_system() AND NOT EXISTS (
       SELECT 1 FROM hr.user_contracts uc
        WHERE uc.user_id = v_req.employee_id
          AND public.user_has_action_in_scope('leave.approve',
                uc.organization_id, uc.department_id, uc.sub_department_id)) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN',
      'error', 'Deciding this request is outside your access.');
  END IF;

  -- Leave dates are stored as UTC midnight of the intended day, which is what
  -- the browser sent as `start_date.split('T')[0]`. Read them back the same way:
  -- Sydney is always ahead of UTC, so a UTC-midnight stamp is the same calendar
  -- day in both zones, and that stays true across a daylight-saving change.
  v_from := (v_req.start_date AT TIME ZONE 'UTC')::date;
  v_to   := (v_req.end_date   AT TIME ZONE 'UTC')::date;

  -- Time in lieu is often part of a day ("leave two hours early"). Then nothing
  -- comes off the roster: the person still works the rest of it. Mirrors
  -- isPartialDayToil(requested_hours, rosteredSpanMinutes(fullTime)) in
  -- src/modules/toil/domain/toil-rules.ts, over the same shifts.
  SELECT coalesce(sum(CASE WHEN d <= 0 THEN d + 1440 ELSE d END), 0) INTO v_ft_minutes
  FROM (
    SELECT (EXTRACT(epoch FROM (s.end_time - s.start_time)) / 60)::int AS d
      FROM public.shifts s
     WHERE s.assigned_employee_id = v_req.employee_id
       AND s.shift_date BETWEEN v_from AND v_to
       AND s.lifecycle_status <> 'Cancelled'
       AND s.target_employment_type = 'FT'
       AND s.start_time IS NOT NULL AND s.end_time IS NOT NULL
       AND coalesce(public._shift_delete_refusal(s.*), '') NOT IN ('SHIFT_STARTED', 'SHIFT_WORKED')
  ) q;

  SELECT count(*) INTO v_kept
    FROM public.shifts s
   WHERE s.assigned_employee_id = v_req.employee_id
     AND s.shift_date BETWEEN v_from AND v_to
     AND s.lifecycle_status <> 'Cancelled'
     AND coalesce(public._shift_delete_refusal(s.*), '') IN ('SHIFT_STARTED', 'SHIFT_WORKED');

  UPDATE public.leave_requests
     SET status = 'approved', approved_by = v_approver, approval_date = now()
   WHERE id = p_request_id;
  -- trg_leave_balance_deduction deducts the balance, in this same transaction.

  IF v_req.leave_type = 'toil' AND v_ft_minutes > 0
     AND round(coalesce(v_req.requested_hours, 0) * 60) < v_ft_minutes THEN
    RETURN jsonb_build_object('success', true, 'request_id', p_request_id,
      'cancelled', 0, 'deleted', 0, 'unassigned', 0, 'kept', v_kept,
      'kept_partial_toil', true);
  END IF;

  v_span := CASE WHEN v_from = v_to THEN to_char(v_from, 'FMDD Mon YYYY')
                 ELSE to_char(v_from, 'FMDD Mon') || '-' || to_char(v_to, 'FMDD Mon YYYY') END;
  v_note := format('Employee on approved %s leave, %s', v_req.leave_type, v_span);

  -- Shifts that have started are never touched, worked or not: the database
  -- refuses to delete or unassign them, and the clock-in behind one is what
  -- payroll pays from. They are counted in `kept` for the manager to reconcile.
  FOR v_c IN
    SELECT s.id, s.target_employment_type, s.organization_id, s.department_id, s.sub_department_id,
           s.lifecycle_status, s.assignment_status, s.assignment_outcome,
           s.trading_status, s.is_cancelled, s.bidding_status, s.shift_date, s.start_time
      FROM public.shifts s
     WHERE s.assigned_employee_id = v_req.employee_id
       AND s.shift_date BETWEEN v_from AND v_to
       AND s.lifecycle_status <> 'Cancelled'
       AND coalesce(public._shift_delete_refusal(s.*), '') NOT IN ('SHIFT_STARTED', 'SHIFT_WORKED')
     ORDER BY s.shift_date, s.start_time
  LOOP
    v_state := public.get_shift_fsm_state(v_c.lifecycle_status, v_c.assignment_status,
      v_c.assignment_outcome, v_c.trading_status, v_c.is_cancelled, v_c.bidding_status);

    IF v_c.target_employment_type = 'FT' THEN
      IF v_state IN ('S1', 'S2') THEN
        -- a draft leaves no history worth keeping
        v_resj := public.sm_delete_shift(v_c.id, v_approver, v_note);
        IF NOT coalesce((v_resj->>'success')::boolean, false) THEN
          RAISE EXCEPTION 'Leave not approved: the draft shift on % could not be removed (%). Fix the shift, then approve again.',
            to_char(v_c.shift_date, 'FMDD Mon'), coalesce(v_resj->>'code', 'unknown');
        END IF;
        v_deleted := v_deleted + 1;
      ELSE
        -- A published full-time shift cannot be deleted and cannot go to bidding
        -- (bidding is for part-time and casual), so it is cancelled: code 'F',
        -- assignee notified, slot gone for the manager to re-create.
        IF NOT public.sm_request_is_system()
           AND NOT public.user_has_action_in_scope('shift.delete',
                     v_c.organization_id, v_c.department_id, v_c.sub_department_id) THEN
          RAISE EXCEPTION 'Leave not approved: removing the shift on % needs permission to cancel shifts.',
            to_char(v_c.shift_date, 'FMDD Mon');
        END IF;
        v_res := internal.cancel_shift_unchecked(v_c.id, v_note, 'F');
        IF NOT coalesce((v_res->>'success')::boolean, false) THEN
          RAISE EXCEPTION 'Leave not approved: the shift on % could not be cancelled (%). Fix the shift, then approve again.',
            to_char(v_c.shift_date, 'FMDD Mon'), coalesce(v_res->>'code', 'unknown');
        END IF;
        v_cancelled := v_cancelled + 1;
      END IF;
    ELSE
      -- Part-time and casual keep their coverage: unassigning a published shift
      -- puts it back on bidding (S5) for a teammate to pick up.
      IF v_state IN ('S6', 'S7') THEN
        RAISE EXCEPTION 'Leave not approved: the shift on % is in a swap. Resolve the swap first, then approve.',
          to_char(v_c.shift_date, 'FMDD Mon');
      END IF;
      v_res := public.sm_unassign_shift(v_c.id, v_approver);
      IF NOT coalesce((v_res->>'success')::boolean, false) THEN
        RAISE EXCEPTION 'Leave not approved: the shift on % could not be unassigned (%). Fix the shift, then approve again.',
          to_char(v_c.shift_date, 'FMDD Mon'), coalesce(v_res->>'error', 'unknown');
      END IF;
      v_unassigned := v_unassigned + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'request_id', p_request_id,
    'cancelled', v_cancelled, 'deleted', v_deleted, 'unassigned', v_unassigned,
    'kept', v_kept, 'kept_partial_toil', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.sm_approve_leave(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sm_approve_leave(uuid, uuid) TO authenticated, service_role;
