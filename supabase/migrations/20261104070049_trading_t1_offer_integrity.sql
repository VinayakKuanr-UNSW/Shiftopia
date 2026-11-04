-- ============================================================================
-- Trading T1 — offer integrity (docs/design/shift-trading/01-trading-fsm.md).
--   D9  no giveaways: swap_offers.offered_shift_id NOT NULL.
--   I2  <= 1 active offer per (request, peer).
--   I3  <= 1 active offer per offered shift — the HOLD (D2).
--   I5  <= 1 live request per requester shift.
--   Holds block drop and post; posting requires S4.
--   Offers are written only through sm_submit/decline/withdraw_swap_offer:
--   the client INSERT/UPDATE policies let a requester set an offer SELECTED
--   directly, skipping sm_accept_trade's compliance guard.
-- Both trade tables are empty on live, so the constraints need no cleanup.
-- ============================================================================

ALTER TABLE public.swap_offers ALTER COLUMN offered_shift_id SET NOT NULL;

CREATE UNIQUE INDEX swap_offers_one_active_per_peer
  ON public.swap_offers (swap_request_id, offerer_id)
  WHERE status IN ('SUBMITTED', 'SELECTED');

CREATE UNIQUE INDEX swap_offers_one_active_per_shift
  ON public.swap_offers (offered_shift_id)
  WHERE status IN ('SUBMITTED', 'SELECTED');

CREATE UNIQUE INDEX shift_swaps_one_live_per_shift
  ON public.shift_swaps (requester_shift_id)
  WHERE status IN ('OPEN', 'MANAGER_PENDING');

-- The hold: a shift named by an active offer. One owner for the rule.
CREATE OR REPLACE FUNCTION public.shift_is_held(p_shift_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.swap_offers
     WHERE offered_shift_id = p_shift_id
       AND status IN ('SUBMITTED', 'SELECTED'));
$function$;

CREATE OR REPLACE FUNCTION public.sm_submit_swap_offer(p_swap_id uuid, p_offered_shift_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_caller   uuid := auth.uid();
  v_swap     public.shift_swaps%ROWTYPE;
  v_shift    public.shifts%ROWTYPE;
  v_req      public.shifts%ROWTYPE;
  v_offer_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated', 'code', 'UNAUTHENTICATED');
  END IF;

  SELECT * INTO v_swap FROM public.shift_swaps WHERE id = p_swap_id FOR UPDATE;
  IF NOT FOUND OR v_swap.status <> 'OPEN' THEN
    RETURN json_build_object('success', false, 'error', 'This trade is no longer open for offers', 'code', 'SWAP_NOT_OPEN');
  END IF;
  IF v_swap.requester_id = v_caller OR v_swap.requester_shift_id = p_offered_shift_id THEN
    RETURN json_build_object('success', false, 'error', 'You cannot offer on your own trade', 'code', 'INVALID_OFFER');
  END IF;

  SELECT * INTO v_req FROM public.shifts WHERE id = v_swap.requester_shift_id;
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_offered_shift_id FOR UPDATE;
  IF NOT FOUND OR v_shift.assigned_employee_id IS DISTINCT FROM v_caller THEN
    RETURN json_build_object('success', false, 'error', 'You can only offer one of your own shifts', 'code', 'INVALID_OFFER');
  END IF;
  IF public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status,
       v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled) <> 'S4' THEN
    RETURN json_build_object('success', false, 'error', 'Only a confirmed shift that is not being traded can be offered', 'code', 'INVALID_OFFER');
  END IF;
  IF COALESCE(v_shift.start_at, (v_shift.shift_date::text || ' ' || v_shift.start_time::text)::timestamp
                                AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney')) <= now()
     OR COALESCE(v_req.start_at, (v_req.shift_date::text || ' ' || v_req.start_time::text)::timestamp
                                AT TIME ZONE COALESCE(v_req.timezone, 'Australia/Sydney')) <= now() THEN
    RETURN json_build_object('success', false, 'error', 'Time locked: a shift has already started', 'code', 'TIME_LOCKED');
  END IF;
  IF public.shift_is_held(p_offered_shift_id) THEN
    RETURN json_build_object('success', false, 'error', 'That shift is already offered in a trade', 'code', 'SHIFT_ALREADY_OFFERED');
  END IF;
  IF EXISTS (SELECT 1 FROM public.swap_offers
              WHERE swap_request_id = p_swap_id AND offerer_id = v_caller
                AND status IN ('SUBMITTED', 'SELECTED')) THEN
    RETURN json_build_object('success', false, 'error', 'You already have an offer on this trade', 'code', 'OFFER_EXISTS');
  END IF;

  INSERT INTO public.swap_offers (swap_request_id, offerer_id, offered_shift_id, status)
  VALUES (p_swap_id, v_caller, p_offered_shift_id, 'SUBMITTED')
  RETURNING id INTO v_offer_id;

  RETURN json_build_object('success', true, 'offer_id', v_offer_id);
EXCEPTION WHEN unique_violation THEN
  -- a concurrent submit won the race for the same peer slot or the same shift
  RETURN json_build_object('success', false, 'error', 'That shift or offer slot was just taken', 'code', 'SHIFT_ALREADY_OFFERED');
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
  SELECT * INTO v_offer FROM public.swap_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Offer not found', 'code', 'OFFER_NOT_FOUND');
  END IF;
  SELECT * INTO v_swap FROM public.shift_swaps WHERE id = v_offer.swap_request_id FOR UPDATE;
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

-- T1 covers withdrawal while the trade is open (S6). Withdrawal from manager
-- review (S7) is T2.
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
  SELECT * INTO v_offer FROM public.swap_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND OR v_offer.offerer_id IS DISTINCT FROM auth.uid() THEN
    RETURN json_build_object('success', false, 'error', 'Offer not found', 'code', 'OFFER_NOT_FOUND');
  END IF;
  SELECT * INTO v_swap FROM public.shift_swaps WHERE id = v_offer.swap_request_id FOR UPDATE;
  IF v_swap.status <> 'OPEN' OR v_offer.status <> 'SUBMITTED' THEN
    RETURN json_build_object('success', false, 'error', 'This offer can no longer be withdrawn', 'code', 'OFFER_NOT_WITHDRAWABLE');
  END IF;

  UPDATE public.swap_offers SET status = 'WITHDRAWN', updated_at = now() WHERE id = p_offer_id;
  RETURN json_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_employee_drop_shift(p_shift_id uuid, p_employee_id uuid DEFAULT auth.uid(), p_reason text DEFAULT NULL::text, p_reason_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_shift          RECORD;
    v_state          text;
    v_reason         public.cancellation_reasons%ROWTYPE;
    v_notice         interval;
    v_notice_hours   numeric;
    v_is_critical    boolean;
    v_urgency        text;
    v_event_type     public.shift_event_type;
    -- Standard vs critical. NOT the same line as the emergent lockout.
    v_cancel_cutoff  constant interval := interval '24 hours';
    -- Urgent vs emergent. Mirrors EMERGENT_WINDOW_MS in bidding-urgency.ts.
    v_emergent_cutoff constant interval := interval '4 hours';
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_assignee_or(p_shift_id, p_employee_id, 'shift.assign');
    SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
    END IF;

    IF v_shift.assigned_employee_id IS DISTINCT FROM p_employee_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You are not assigned to this shift');
    END IF;

    v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status,
                                          v_shift.assignment_outcome, v_shift.trading_status,
                                          v_shift.is_cancelled);

    IF v_state NOT IN ('S3', 'S4') THEN
        RETURN jsonb_build_object('success', false,
            'error', format('sm_employee_drop_shift requires state S3 or S4, current state is %s', v_state));
    END IF;

    IF public.shift_is_held(p_shift_id) THEN
        RETURN jsonb_build_object('success', false, 'code', 'TRADE_IN_PROGRESS',
            'error', 'This shift is offered in a trade — withdraw the offer before dropping it');
    END IF;

    IF p_reason_code IS NOT NULL THEN
        SELECT * INTO v_reason
        FROM public.cancellation_reasons
        WHERE code = p_reason_code AND is_active;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false,
                'error', format('Unknown cancellation reason: %s', p_reason_code));
        END IF;

        IF v_reason.requires_note AND COALESCE(btrim(p_reason), '') = '' THEN
            RETURN jsonb_build_object('success', false,
                'error', format('Reason "%s" requires a note', v_reason.label));
        END IF;
    END IF;

    v_notice       := v_shift.start_at - now();
    v_notice_hours := ROUND(EXTRACT(epoch FROM v_notice)::numeric / 3600, 2);
    v_is_critical  := v_shift.start_at IS NOT NULL AND v_notice <= v_cancel_cutoff;
    v_urgency      := CASE
                          WHEN v_shift.start_at IS NULL             THEN 'normal'
                          WHEN v_notice <= v_emergent_cutoff        THEN 'emergent'
                          WHEN v_notice <= v_cancel_cutoff          THEN 'urgent'
                          ELSE 'normal'
                      END;
    v_event_type   := CASE WHEN v_is_critical THEN 'LATE_CANCELLED' ELSE 'CANCELLED' END::public.shift_event_type;

    PERFORM set_config('app.audit.employee_drop', '1', true);

    UPDATE public.shifts SET
        assigned_employee_id = NULL,
        assigned_at          = NULL,
        assignment_status    = 'unassigned'::public.shift_assignment_status,
        assignment_outcome   = NULL,
        bidding_status       = 'on_bidding'::public.shift_bidding_status,
        fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
        last_dropped_by      = p_employee_id,
        last_rejected_by     = NULL,
        last_modified_by     = p_employee_id,
        updated_at           = NOW()
    WHERE id = p_shift_id;

    PERFORM set_config('app.audit.employee_drop', '0', true);

    INSERT INTO public.shift_events
        (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
    VALUES (
        p_shift_id,
        p_employee_id,
        p_employee_id,
        v_event_type,
        now(),
        jsonb_build_object(
            'op',           'employee_drop',
            'from_state',   v_state,
            'to_state',     'S5',
            'cancellation', CASE WHEN v_is_critical THEN 'critical' ELSE 'standard' END,
            'urgency',      v_urgency,
            'notice_hours', v_notice_hours,
            'source',       'sm_employee_drop_shift'
        )
        || CASE WHEN p_reason_code IS NOT NULL
                THEN jsonb_build_object('reason_code', p_reason_code) ELSE '{}'::jsonb END
        || CASE WHEN COALESCE(btrim(p_reason), '') <> ''
                THEN jsonb_build_object('reason_note', btrim(p_reason)) ELSE '{}'::jsonb END,
        'employee',
        'assignment'
    )
    ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;

    RETURN jsonb_build_object(
        'success',      true,
        'from_state',   v_state,
        'to_state',     'S5',
        'cancellation', CASE WHEN v_is_critical THEN 'critical' ELSE 'standard' END,
        'urgency',      v_urgency,
        'notice_hours', v_notice_hours
    );
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

-- Offers are written only by the definer functions above (and the existing
-- sm_accept_trade / process_shift_timers).
DROP POLICY "Employees can make offers" ON public.swap_offers;
DROP POLICY "Employees can update own offers" ON public.swap_offers;
DROP POLICY "Request owner can update offer status" ON public.swap_offers;
REVOKE INSERT, UPDATE, DELETE ON public.swap_offers FROM authenticated, anon;

REVOKE ALL ON FUNCTION public.shift_is_held(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sm_submit_swap_offer(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sm_decline_swap_offer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sm_withdraw_swap_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_is_held(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_submit_swap_offer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_decline_swap_offer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_withdraw_swap_offer(uuid) TO authenticated;
