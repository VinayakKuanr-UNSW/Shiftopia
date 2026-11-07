-- A published full-time shift could be neither deleted nor cancelled.
--
-- fn_full_time_shift_rules has refused to cancel ANY full-time shift since it
-- was written ("delete the shift instead"), because an FT shift belongs to one
-- salaried person: it is removed, never left behind as an orphan. PR #59 then
-- made a published shift undeletable ("cancel it instead"). A published FT shift
-- satisfied neither rule, so nothing could remove it -- which is why approving
-- leave over one has been failing.
--
-- The narrowest fix: FT_NO_CANCEL still refuses every cancel, EXCEPT the one the
-- approved-leave path performs. It is NOT enough to key that exception on
-- kickoff_cancel_code = 'F', because RLS lets clients UPDATE public.shifts
-- directly -- shifts_update_rbac for a manager and shifts_update_own for the
-- ASSIGNEE -- so any employee could then cancel their own full-time shift by
-- writing the code themselves. The exception is keyed instead on a
-- transaction-local setting that only internal.cancel_shift_unchecked sets, one
-- statement at a time. A PostgREST request is a single transaction carrying a
-- single statement, so a client cannot set it and then write the row.
-- supabase/tests/approve_leave_atomic.sql part 3 holds that line.
--
-- A manual cancel of a published full-time shift is still refused. That gap is
-- left alone deliberately: nothing in this change decides it.

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
  -- shift. Scoped to the transaction and cleared immediately after.
  IF p_cancel_code = 'F' THEN
    PERFORM set_config('app.ft_cancel_reason', 'approved_leave', true);
  END IF;

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

  IF p_cancel_code = 'F' THEN
    PERFORM set_config('app.ft_cancel_reason', '', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S10');
END;
$function$;

REVOKE ALL ON FUNCTION internal.cancel_shift_unchecked(uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION internal.cancel_shift_unchecked(uuid, text, text, integer) FROM anon, authenticated;

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
  -- The one exception: approved leave over a PUBLISHED full-time shift, which
  -- cannot be deleted (PR #59). internal.cancel_shift_unchecked sets this for
  -- the single UPDATE it then runs; a client cannot set it and write in the same
  -- statement, so writing kickoff_cancel_code='F' by hand is still refused.
  IF NEW.is_cancelled AND NOT v_was_cancelled
     AND coalesce(current_setting('app.ft_cancel_reason', true), '') <> 'approved_leave' THEN
    RAISE EXCEPTION 'Full-time shifts cannot be cancelled. Delete the shift instead.' USING HINT = 'FT_NO_CANCEL';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.assigned_employee_id IS NOT NULL AND NEW.assigned_employee_id IS NULL THEN
    RAISE EXCEPTION 'Full-time shifts cannot be unassigned. Delete the shift instead.' USING HINT = 'FT_NO_UNASSIGN';
  END IF;
  RETURN NEW;
END;
$function$;
