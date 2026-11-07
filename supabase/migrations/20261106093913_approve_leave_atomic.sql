-- Approving leave clears the roster in ONE transaction, and is the only way to
-- approve leave.
--
-- Three problems this fixes.
--
-- 1. It was not atomic. `approveLeaveRequest` approved the request, then looked
--    up conflicting shifts, then deleted or unassigned them one at a time from
--    the browser. A failure, a closed tab or a lost connection between those
--    calls left leave approved with the employee still rostered.
--
-- 2. Published full-time shifts were never removed. Since PR #59
--    `sm_delete_shift` refuses a published shift (code SHIFT_PUBLISHED) because
--    a published shift is cancelled, not deleted. The leave path still called
--    delete, so every published full-time shift on approved leave failed: the
--    manager saw a "needs action" toast and the employee stayed rostered on a
--    day they were approved to be absent. They are now CANCELLED with a new
--    kickoff_cancel_code 'F' (A-E were taken) and the assignee is notified. The
--    slot is gone, and the manager re-creates or auto-schedules it.
--
-- 3. The approval status could be set directly. `leave_requests_manager_update`
--    let any manager in scope UPDATE status straight to 'approved', skipping all
--    of the above. Its WITH CHECK now refuses 'approved', so this function is
--    the only path. Reject ('rejected') and revoke ('cancelled') are untouched.
--
-- `sm_cancel_shift` keeps its signature and its 'E'. Its body moves to
-- `internal.cancel_shift_unchecked`, which takes the code as an argument, so the
-- cancel, its notifications and its trade cascade are written once. The internal
-- function performs NO permission check and is executable only by its owner; the
-- two callers each guard their own way (`shift.delete` for a manual cancel,
-- `leave.approve` plus `shift.delete` here).

-- ── 'F' joins the cancel codes ───────────────────────────────────────────────
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_kickoff_cancel_code_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_kickoff_cancel_code_check
  CHECK (kickoff_cancel_code = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text, 'E'::text, 'F'::text]));

-- ── the one cancel body, with the code as an argument ────────────────────────
-- Verbatim from sm_cancel_shift minus its `shift.delete` guard, which stays with
-- its callers.
CREATE OR REPLACE FUNCTION internal.cancel_shift_unchecked(
  p_shift_id         uuid,
  p_reason           text,
  p_cancel_code      text,
  p_expected_version integer DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift  public.shifts%ROWTYPE;
  v_state  text;
  v_note   text := NULLIF(btrim(p_reason), '');
  v_when   text;
  v_emp    uuid;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'SHIFT_NOT_FOUND', 'error', 'Shift not found');
  END IF;
  IF p_expected_version IS NOT NULL AND v_shift.version <> p_expected_version THEN
    RETURN jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT',
      'error', 'This shift was changed by someone else. Refresh and try again.');
  END IF;

  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled, v_shift.bidding_status);
  IF NOT public.fsm_op_is_legal(v_state, 'cancel') THEN
    RETURN jsonb_build_object('success', false, 'code', 'ILLEGAL_STATE', 'state', v_state,
      'error', CASE WHEN v_state IN ('S1', 'S2') THEN 'A draft is deleted, not cancelled.'
                    ELSE 'This shift can no longer be cancelled.' END);
  END IF;
  IF EXISTS (SELECT 1 FROM public.timesheets t WHERE t.shift_id = p_shift_id AND t.clock_in IS NOT NULL) THEN
    RETURN jsonb_build_object('success', false, 'code', 'SHIFT_WORKED',
      'error', 'Someone has clocked in to this shift. Correct it through the timesheet instead.');
  END IF;
  IF v_note IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED', 'error', 'Say why the shift is cancelled.');
  END IF;

  v_when := to_char(v_shift.shift_date, 'Dy FMDD Mon') || ' ' ||
            to_char(v_shift.start_time, 'HH24:MI') || '–' || to_char(v_shift.end_time, 'HH24:MI');

  -- Tell the assignee, and everyone whose trade this ends, before the trade
  -- cascade (trg_shift_end_trades) clears the records. Bidders are told by
  -- trg_bid_outcome_notification when their bids close.
  FOR v_emp IN
    SELECT DISTINCT x FROM (
      SELECT v_shift.assigned_employee_id
      UNION ALL
      SELECT so.offerer_id FROM public.swap_offers so JOIN public.shift_swaps sw ON sw.id = so.swap_request_id
       WHERE sw.requester_shift_id = p_shift_id AND sw.status IN ('OPEN', 'MANAGER_PENDING')
         AND so.status IN ('SUBMITTED', 'SELECTED')
      UNION ALL
      SELECT sw.requester_id FROM public.shift_swaps sw
       WHERE sw.target_shift_id = p_shift_id AND sw.status = 'MANAGER_PENDING'
      UNION ALL
      SELECT sw.requester_id FROM public.swap_offers so JOIN public.shift_swaps sw ON sw.id = so.swap_request_id
       WHERE so.offered_shift_id = p_shift_id AND so.status IN ('SUBMITTED', 'SELECTED')
         AND sw.status IN ('OPEN', 'MANAGER_PENDING')
    ) people(x)
    WHERE x IS NOT NULL
  LOOP
    PERFORM public.notify_user(
      v_emp,
      'shift_cancelled',
      'Shift cancelled',
      CASE WHEN v_emp = v_shift.assigned_employee_id
           THEN format('Your shift on %s was cancelled: %s', v_when, v_note)
           ELSE format('The shift on %s in your trade was cancelled, so the trade has ended: %s', v_when, v_note)
      END,
      p_shift_id,
      'shift',
      '/my-roster',
      'shift_cancelled:' || p_shift_id::text || ':' || v_emp::text
    );
  END LOOP;

  -- an unanswered offer ends with the shift
  UPDATE public.shift_offers
     SET status = 'Expired', responded_at = now(), response_notes = 'Shift cancelled: ' || v_note
   WHERE shift_id = p_shift_id AND status = 'Pending';

  UPDATE public.shifts SET
    lifecycle_status     = 'Cancelled'::public.shift_lifecycle,
    is_cancelled         = TRUE,
    cancelled_at         = now(),
    kickoff_cancel_code  = p_cancel_code,
    bidding_status       = 'not_on_bidding'::public.shift_bidding_status,
    fulfillment_status   = 'none'::public.shift_fulfillment_status,
    last_modified_by     = auth.uid(),
    last_modified_reason = v_note,
    updated_at           = now()
  WHERE id = p_shift_id;

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S10');
END;
$function$;

REVOKE ALL ON FUNCTION internal.cancel_shift_unchecked(uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION internal.cancel_shift_unchecked(uuid, text, text, integer) FROM anon, authenticated;

-- ── sm_cancel_shift keeps its signature; it is now the guard plus a delegate ──
CREATE OR REPLACE FUNCTION public.sm_cancel_shift(
  p_shift_id         uuid,
  p_reason           text,
  p_expected_version integer DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  -- cancelling replaces deleting for a published shift, so it needs the same right
  IF NOT public.sm_request_is_system() AND (auth.uid() IS NULL OR EXISTS (
       SELECT 1 FROM public.shifts s
        WHERE s.id = p_shift_id
          AND NOT public.user_has_action_in_scope('shift.delete', s.organization_id, s.department_id, s.sub_department_id))) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'You are not allowed to cancel shifts.');
  END IF;

  RETURN internal.cancel_shift_unchecked(p_shift_id, p_reason, 'E', p_expected_version);
END;
$function$;

-- ── approving leave, atomically ───────────────────────────────────────────────
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

  -- leave.approve where this employee works — the same test as the RLS policy
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
       AND s.start_at > now()
       AND s.lifecycle_status NOT IN ('InProgress', 'Completed')
       AND s.start_time IS NOT NULL AND s.end_time IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.timesheets t
                        WHERE t.shift_id = s.id AND t.clock_in IS NOT NULL)
  ) q;

  SELECT count(*) INTO v_kept
    FROM public.shifts s
   WHERE s.assigned_employee_id = v_req.employee_id
     AND s.shift_date BETWEEN v_from AND v_to
     AND s.lifecycle_status <> 'Cancelled'
     AND (s.start_at <= now()
          OR s.lifecycle_status IN ('InProgress', 'Completed')
          OR EXISTS (SELECT 1 FROM public.timesheets t
                      WHERE t.shift_id = s.id AND t.clock_in IS NOT NULL));

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
                 ELSE to_char(v_from, 'FMDD Mon') || '–' || to_char(v_to, 'FMDD Mon YYYY') END;
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
       AND s.start_at > now()
       AND s.lifecycle_status NOT IN ('InProgress', 'Completed')
       AND NOT EXISTS (SELECT 1 FROM public.timesheets t
                        WHERE t.shift_id = s.id AND t.clock_in IS NOT NULL)
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

-- ── approving outside that function is no longer possible ────────────────────
-- USING is unchanged. WITH CHECK is new: a manager may still reject ('rejected')
-- and revoke ('cancelled'), but 'approved' is reachable only through
-- sm_approve_leave, which is SECURITY DEFINER and so is not subject to this.
DROP POLICY IF EXISTS leave_requests_manager_update ON public.leave_requests;
CREATE POLICY leave_requests_manager_update ON public.leave_requests
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM hr.user_contracts target_uc
     WHERE target_uc.user_id = leave_requests.employee_id
       AND public.user_has_action_in_scope('leave.approve',
             target_uc.organization_id, target_uc.department_id, target_uc.sub_department_id)))
  WITH CHECK (status IS DISTINCT FROM 'approved' AND EXISTS (
    SELECT 1 FROM hr.user_contracts target_uc
     WHERE target_uc.user_id = leave_requests.employee_id
       AND public.user_has_action_in_scope('leave.approve',
             target_uc.organization_id, target_uc.department_id, target_uc.sub_department_id)));

COMMENT ON FUNCTION public.sm_approve_leave(uuid, uuid) IS
  'Approve a leave request and clear the roster for it in one transaction: full-time drafts are deleted, published full-time shifts cancelled (code F, assignee notified), part-time and casual shifts unassigned back to bidding, started shifts kept and reported. The only way to set leave_requests.status to approved.';

COMMENT ON FUNCTION internal.cancel_shift_unchecked(uuid, text, text, integer) IS
  'The cancel body shared by sm_cancel_shift (code E) and sm_approve_leave (code F). Performs NO permission check — each caller guards its own. Executable only by its owner.';
