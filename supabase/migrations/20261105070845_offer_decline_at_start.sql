-- ============================================================================
-- Offer decline at start; drop the client-side offer expiry path
-- (docs/design/shift-trading/03-bidding-fsm.md B-D9, B-D12)
--   * sm_reject_offer refuses once the shift has started (SHIFT_STARTED): the
--     minute timer owns an unanswered offer from then on (S10, code A).
--   * sm_expire_offer_now is dropped. The app called it when the offer countdown
--     hit zero and for declines inside the old 4h window; it put the shift back
--     to draft (S2), against B-D9 (expired offer -> S5). Offer expiry is the
--     timer's job alone (fn_process_offer_expirations).
--   * sm_reject_offer(uuid, uuid) is dropped: no caller; the app uses the
--     three-argument form.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sm_reject_offer(p_shift_id uuid, p_user_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_shift RECORD; v_state text;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_assignee_or(p_shift_id, p_user_id, 'shift.assign');
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
  END IF;

  IF v_shift.assigned_employee_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: You can only reject shifts offered to you');
  END IF;

  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);

  IF v_state != 'S3' THEN
    RETURN jsonb_build_object('success', false, 'error', format('sm_reject_offer requires state S3, current state is %s', v_state));
  END IF;

  -- After the start the minute timer owns an unanswered offer (S10, code A); B-D12
  IF COALESCE(v_shift.start_at, (v_shift.shift_date::text || ' ' || v_shift.start_time::text)::timestamp AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney')) <= now() THEN
    RETURN jsonb_build_object('success', false, 'code', 'SHIFT_STARTED',
      'error', 'This shift has already started and the offer can no longer be declined');
  END IF;

  UPDATE public.shifts SET
    assigned_employee_id = NULL,
    assigned_at          = NULL,
    assignment_status    = 'unassigned'::public.shift_assignment_status,
    assignment_outcome   = NULL,
    bidding_status       = 'on_bidding'::public.shift_bidding_status,
    fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
    last_rejected_by     = p_user_id,
    last_dropped_by      = NULL,
    last_modified_by     = p_user_id,
    updated_at           = NOW()
  WHERE id = p_shift_id;

  INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
  VALUES (p_shift_id, p_user_id, 'REJECTED', NOW(), jsonb_build_object('source', 'sm_reject_offer', 'reason', p_reason));

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S5');
END;
$function$;

DROP FUNCTION public.sm_expire_offer_now(uuid);
DROP FUNCTION public.sm_reject_offer(uuid, uuid);
