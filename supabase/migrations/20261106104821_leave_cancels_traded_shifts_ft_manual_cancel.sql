-- 1. A manager may cancel a published full-time shift (code E), the same way
--    as any other published shift. FT_NO_CANCEL now refuses only cancels that
--    did not come through internal.cancel_shift_unchecked.
-- 2. Approving leave over a shift in a trade (S6/S7) cancels it with code F.
--    Before, trg_leave_end_trades ended the trade as the leave was approved,
--    and the shift was then unassigned back to bidding like any other. It is
--    cancelled BEFORE the approval so that cancel_shift_unchecked still sees
--    the live trade and tells the other person it has ended;
--    trg_shift_end_trades then releases their shift.

CREATE OR REPLACE FUNCTION internal.cancel_shift_unchecked(p_shift_id uuid, p_reason text, p_cancel_code text, p_expected_version integer DEFAULT NULL::integer)
 RETURNS jsonb
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

  UPDATE public.shift_offers
     SET status = 'Expired', responded_at = now(), response_notes = 'Shift cancelled: ' || v_note
   WHERE shift_id = p_shift_id AND status = 'Pending';

  -- Lets trg_full_time_shift_rules allow this one statement through for an FT
  -- shift. Every caller of this function has already checked authority; a
  -- client writing shifts directly never has it set.
  PERFORM set_config('app.ft_cancel_reason', 'internal_cancel', true);

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

  PERFORM set_config('app.ft_cancel_reason', '', true);

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S10');
END;
$function$;

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
    v_was_bidding := OLD.bidding_status::text IN ('on_bidding','on_bidding_normal','on_bidding_urgent');
    v_was_trading := OLD.trading_status::text <> 'NoTrade';
    v_was_cancelled := OLD.is_cancelled;
  END IF;

  IF (NEW.bidding_status::text IN ('on_bidding','on_bidding_normal','on_bidding_urgent')) AND NOT v_was_bidding THEN
    RAISE EXCEPTION 'Full-time shifts cannot be put up for bidding.' USING HINT = 'FT_NO_BIDDING';
  END IF;
  IF NEW.trading_status::text <> 'NoTrade' AND NOT v_was_trading THEN
    RAISE EXCEPTION 'Full-time shifts cannot be traded.' USING HINT = 'FT_NO_TRADING';
  END IF;
  -- A full-time shift is cancelled only through internal.cancel_shift_unchecked
  -- (manager cancel, code E; approved leave, code F), which sets this for the
  -- one UPDATE it runs. A client writing is_cancelled by hand is still refused.
  IF NEW.is_cancelled AND NOT v_was_cancelled
     AND coalesce(current_setting('app.ft_cancel_reason', true), '') <> 'internal_cancel' THEN
    RAISE EXCEPTION 'Full-time shifts cannot be cancelled. Delete the shift instead.' USING HINT = 'FT_NO_CANCEL';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.assigned_employee_id IS NOT NULL AND NEW.assigned_employee_id IS NULL THEN
    RAISE EXCEPTION 'Full-time shifts cannot be unassigned. Delete the shift instead.' USING HINT = 'FT_NO_UNASSIGN';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_approve_leave(p_request_id uuid, p_approver_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
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
  v_partial    boolean;
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
  v_partial := v_req.leave_type = 'toil' AND v_ft_minutes > 0
               AND round(coalesce(v_req.requested_hours, 0) * 60) < v_ft_minutes;

  SELECT count(*) INTO v_kept
    FROM public.shifts s
   WHERE s.assigned_employee_id = v_req.employee_id
     AND s.shift_date BETWEEN v_from AND v_to
     AND s.lifecycle_status <> 'Cancelled'
     AND coalesce(public._shift_delete_refusal(s.*), '') IN ('SHIFT_STARTED', 'SHIFT_WORKED');

  v_span := CASE WHEN v_from = v_to THEN to_char(v_from, 'FMDD Mon YYYY')
                 ELSE to_char(v_from, 'FMDD Mon') || '-' || to_char(v_to, 'FMDD Mon YYYY') END;
  v_note := format('Employee on approved %s leave, %s', v_req.leave_type, v_span);

  -- A shift in a trade (S6/S7) is cancelled with code F, and this must happen
  -- BEFORE the approval below: trg_leave_end_trades ends the trade as the leave
  -- is approved, and cancel_shift_unchecked finds who to tell ("the trade has
  -- ended") from the trade while it is still live. trg_shift_end_trades then
  -- releases the other person's shift back to S4.
  IF NOT v_partial THEN
    FOR v_c IN
      SELECT s.id, s.organization_id, s.department_id, s.sub_department_id, s.shift_date
        FROM public.shifts s
       WHERE s.assigned_employee_id = v_req.employee_id
         AND s.shift_date BETWEEN v_from AND v_to
         AND s.lifecycle_status = 'Published'
         AND NOT s.is_cancelled
         AND s.trading_status::text <> 'NoTrade'
         AND coalesce(public._shift_delete_refusal(s.*), '') NOT IN ('SHIFT_STARTED', 'SHIFT_WORKED')
       ORDER BY s.shift_date, s.start_time
    LOOP
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
    END LOOP;
  END IF;

  UPDATE public.leave_requests
     SET status = 'approved', approved_by = v_approver, approval_date = now()
   WHERE id = p_request_id;
  -- trg_leave_balance_deduction deducts the balance, in this same transaction.

  IF v_partial THEN
    RETURN jsonb_build_object('success', true, 'request_id', p_request_id,
      'cancelled', 0, 'deleted', 0, 'unassigned', 0, 'kept', v_kept,
      'kept_partial_toil', true);
  END IF;

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
      -- puts it back on bidding (S5) for a teammate to pick up. An offer it made
      -- into someone else's trade was already withdrawn by trg_leave_end_trades.
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
