-- ============================================================================
-- Trading T5 — hardening from the scenario matrix
-- (docs/design/shift-trading/02-scenario-matrix.csv).
--   shift_swaps is written only by its definer functions. The client could
--   delete its own live request (offers cascaded away, both shifts stuck in
--   S6/S7), mark it CANCELLED without releasing the shifts, insert one in any
--   state, and a manager could mark one APPROVED without the swap. The app only
--   reads the table. (ST-033, ST-091, ST-102)
--   sm_approve_peer_swap refuses once either shift has started. (ST-100)
--   decline / withdraw lock request-then-offer like sm_accept_trade, so racing
--   an accept serializes instead of deadlocking. (ST-043, ST-044)
--   Posting a shift already in a trade answers TRADE_IN_PROGRESS. (ST-019)
-- ============================================================================

DROP POLICY swaps_insert_own ON public.shift_swaps;
DROP POLICY swaps_update_involved ON public.shift_swaps;
DROP POLICY swaps_delete_own ON public.shift_swaps;
REVOKE INSERT, UPDATE, DELETE ON public.shift_swaps FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.sm_approve_peer_swap(p_requester_shift_id uuid, p_offered_shift_id uuid, p_requester_id uuid, p_offerer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_requester_shift shifts%ROWTYPE;
  v_offered_shift shifts%ROWTYPE;
  v_batch uuid := gen_random_uuid();
  v_performer_name text;
  v_performer_role text; 
BEGIN
  SELECT * INTO v_requester_shift FROM shifts WHERE id = p_requester_shift_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requester shift not found';
  END IF;

  IF p_offered_shift_id IS NOT NULL THEN
    SELECT * INTO v_offered_shift FROM shifts WHERE id = p_offered_shift_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Offered shift not found';
    END IF;
  END IF;

  -- D1: a trade is pre-start only. The expiry sweep normally ends it at the
  -- earlier start; this closes the window before the next sweep runs.
  IF COALESCE(v_requester_shift.start_at, (v_requester_shift.shift_date::text || ' ' || v_requester_shift.start_time::text)::timestamp
                AT TIME ZONE COALESCE(v_requester_shift.timezone, 'Australia/Sydney')) <= now()
     OR (p_offered_shift_id IS NOT NULL
         AND COALESCE(v_offered_shift.start_at, (v_offered_shift.shift_date::text || ' ' || v_offered_shift.start_time::text)::timestamp
                AT TIME ZONE COALESCE(v_offered_shift.timezone, 'Australia/Sydney')) <= now()) THEN
    RAISE EXCEPTION 'TIME_LOCKED: a shift in this trade has already started' USING ERRCODE = 'check_violation';
  END IF;

  SELECT 
    COALESCE(full_name, first_name || ' ' || last_name, 'Unknown User'),
    COALESCE(legacy_system_role::text, 'manager') 
  INTO v_performer_name, v_performer_role
  FROM profiles
  WHERE id = auth.uid();

  v_performer_name := COALESCE(v_performer_name, 'Unknown User');
  v_performer_role := COALESCE(v_performer_role, 'manager');
  
  IF v_performer_role NOT IN ('admin', 'manager', 'team_lead', 'team_member') THEN
      v_performer_role := 'manager';
  END IF;

  UPDATE shifts 
  SET assigned_employee_id = p_offerer_id,
      assignment_outcome = 'confirmed',
      updated_at = NOW(),
      trade_requested_at = NULL,
      trading_status = 'NoTrade'
  WHERE id = p_requester_shift_id;

  IF p_offered_shift_id IS NOT NULL THEN
    UPDATE shifts 
    SET assigned_employee_id = p_requester_id,
        assignment_outcome = 'confirmed',
        updated_at = NOW(),
        trade_requested_at = NULL,
        trading_status = 'NoTrade'
    WHERE id = p_offered_shift_id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_decline_swap_offer(p_offer_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_offer public.swap_offers%ROWTYPE;
  v_swap  public.shift_swaps%ROWTYPE;
BEGIN
  -- Lock the request, then the offer (sm_accept_trade's order; no deadlock).
  SELECT sw.* INTO v_swap FROM public.shift_swaps sw
    JOIN public.swap_offers so ON so.swap_request_id = sw.id
   WHERE so.id = p_offer_id
     FOR UPDATE OF sw;
  SELECT * INTO v_offer FROM public.swap_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Offer not found', 'code', 'OFFER_NOT_FOUND');
  END IF;
  IF v_swap.requester_id IS DISTINCT FROM auth.uid()
     AND NOT public.can_act_on_shift('swap.approve', v_swap.requester_shift_id) THEN
    RETURN json_build_object('success', false, 'error', 'Only the trade''s owner can decline an offer', 'code', 'FORBIDDEN');
  END IF;
  IF v_swap.status <> 'OPEN' OR v_offer.status <> 'SUBMITTED' THEN
    RETURN json_build_object('success', false, 'error', 'This offer can no longer be declined', 'code', 'OFFER_NOT_SUBMITTED');
  END IF;

  UPDATE public.swap_offers SET status = 'REJECTED', updated_at = now() WHERE id = p_offer_id;
  RETURN json_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_withdraw_swap_offer(p_offer_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_offer public.swap_offers%ROWTYPE;
  v_swap  public.shift_swaps%ROWTYPE;
BEGIN
  -- Lock the request, then the offer: the same order as sm_accept_trade, so a
  -- withdraw racing an accept serializes instead of deadlocking.
  SELECT sw.* INTO v_swap FROM public.shift_swaps sw
    JOIN public.swap_offers so ON so.swap_request_id = sw.id
   WHERE so.id = p_offer_id
     FOR UPDATE OF sw;
  SELECT * INTO v_offer FROM public.swap_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND OR v_offer.offerer_id IS DISTINCT FROM auth.uid() THEN
    RETURN json_build_object('success', false, 'error', 'Offer not found', 'code', 'OFFER_NOT_FOUND');
  END IF;
  IF v_swap.status = 'OPEN' AND v_offer.status = 'SUBMITTED' THEN
    -- S6: only this offer ends; the request stays open for others.
    UPDATE public.swap_offers SET status = 'WITHDRAWN', updated_at = now() WHERE id = p_offer_id;
    RETURN json_build_object('success', true);
  END IF;

  IF v_swap.status = 'MANAGER_PENDING' AND v_offer.status = 'SELECTED' THEN
    -- S7: withdrawing the accepted offer ends the trade; both shifts back to S4.
    UPDATE public.swap_offers SET status = 'WITHDRAWN', updated_at = now() WHERE id = p_offer_id;
    UPDATE public.shift_swaps SET status = 'CANCELLED', status_changed_at = now(), updated_at = now()
     WHERE id = v_swap.id;
    UPDATE public.shifts SET trading_status = 'NoTrade', trade_requested_at = NULL, updated_at = now()
     WHERE id IN (v_swap.requester_shift_id, v_swap.target_shift_id);
    RETURN json_build_object('success', true);
  END IF;

  RETURN json_build_object('success', false, 'error', 'This offer can no longer be withdrawn', 'code', 'OFFER_NOT_WITHDRAWABLE');
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_create_swap_request(p_requester_shift_id uuid, p_target_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_caller  uuid := auth.uid();
  v_shift   shifts%ROWTYPE;
  v_start   timestamptz;
  v_swap_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated', 'code', 'UNAUTHENTICATED');
  END IF;

  SELECT * INTO v_shift FROM shifts WHERE id = p_requester_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Shift not found', 'code', 'SHIFT_NOT_FOUND');
  END IF;

  IF v_shift.assigned_employee_id IS DISTINCT FROM v_caller AND NOT public.can_act_on_shift('swap.approve', v_shift.id) THEN
    RETURN json_build_object('success', false, 'error', 'You are not assigned to this shift', 'code', 'FORBIDDEN');
  END IF;

  v_start := COALESCE(
    v_shift.start_at,
    (v_shift.shift_date::text || ' ' || v_shift.start_time::text)::timestamp
      AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney')
  );
  IF v_start IS NOT NULL AND v_start <= now() THEN
    RETURN json_build_object('success', false, 'error', 'Time locked: shift has already started', 'code', 'TIME_LOCKED');
  END IF;

  IF v_shift.trading_status IS DISTINCT FROM 'NoTrade' THEN
    RETURN json_build_object('success', false, 'error', 'This shift is already in a trade', 'code', 'TRADE_IN_PROGRESS');
  END IF;

  IF public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status,
       v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled) <> 'S4' THEN
    RETURN json_build_object('success', false, 'error', 'Only a confirmed shift can be posted for trade', 'code', 'INVALID_STATE');
  END IF;

  IF public.shift_is_held(p_requester_shift_id) THEN
    RETURN json_build_object('success', false, 'error', 'This shift is offered in another trade — withdraw that offer first', 'code', 'TRADE_IN_PROGRESS');
  END IF;

  IF EXISTS (
    SELECT 1 FROM shift_swaps
    WHERE requester_shift_id = p_requester_shift_id
      AND status IN ('OPEN', 'MANAGER_PENDING')
  ) THEN
    RETURN json_build_object('success', false, 'error', 'An active swap already exists for this shift', 'code', 'SWAP_EXISTS');
  END IF;

  INSERT INTO shift_swaps (requester_id, requester_shift_id, target_id, reason, status)
  VALUES (v_caller, p_requester_shift_id, p_target_id, p_reason, 'OPEN')
  RETURNING id INTO v_swap_id;

  UPDATE shifts
  SET trading_status = 'TradeRequested', trade_requested_at = now()
  WHERE id = p_requester_shift_id;

  RETURN json_build_object('success', true, 'swap_id', v_swap_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$function$;
