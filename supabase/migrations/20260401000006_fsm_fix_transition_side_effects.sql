-- ============================================================
-- FSM Migration 6: Fix critical transition side-effects found
--                  in formal FSM validation (2026-04-01)
--
-- Issues fixed:
--   C1  — sm_reject_offer: S3→S5 (was incorrectly returning S1)
--   C2  — Trade-cancel/reject/expire: must reset trading_status='NoTrade'
--   C3  — mark_no_show: must also set lifecycle_status='Completed' → S13
--   C5  — sm_publish_shift (S2→S4): must explicitly clear assignment_outcome
--   L1  — sm_emergency_assign self-loop S4→S4: must set assigned_employee_id
--   MT1 — CLOCK_IN from S9/S10: must set trading_status='NoTrade' → S11
--   MT2 — CANCEL from S9/S10: must set is_cancelled=TRUE
--   RC2 — mark_no_show: add FOR UPDATE locking before mutating
-- ============================================================


-- ============================================================
-- C1 — sm_reject_offer
--
-- Previous behaviour (broken): set assignment_status='unassigned' but
-- left bidding_status='not_on_bidding', which violates Rule 5 of
-- validate_shift_state_invariants (Published+unassigned needs an active
-- bidding_status).  Also, the S3 offer-rejection should produce S5
-- (Published + Bidding), NOT S1 (Draft).
--
-- Fixed behaviour:
--   • Valid source state: S3 only
--   • Clears assignment: assigned_employee_id=NULL, assignment_status='unassigned',
--     assignment_outcome=NULL
--   • Reopens bidding: bidding_status='on_bidding', is_on_bidding=TRUE
--   • Increments bidding_iteration (the offer was for the current iteration)
--   • Produces S5
-- ============================================================
CREATE OR REPLACE FUNCTION public.sm_reject_offer(
  p_shift_id  uuid,
  p_user_id   uuid DEFAULT auth.uid(),
  p_reason    text DEFAULT 'Offer rejected'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift  RECORD;
  v_state  text;
BEGIN
  -- Lock the row
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
  END IF;

  -- Derive current FSM state
  v_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status,
    v_shift.assignment_status,
    v_shift.assignment_outcome,
    v_shift.trading_status,
    v_shift.is_cancelled
  );

  IF v_state != 'S3' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   format('sm_reject_offer requires state S3 (Published+Offered), current state is %s', v_state)
    );
  END IF;

  UPDATE public.shifts
  SET
    assigned_employee_id = NULL,
    assignment_status    = 'unassigned'::public.shift_assignment_status,
    assignment_outcome   = NULL,
    bidding_status       = 'on_bidding'::public.shift_bidding_status,
    is_on_bidding        = TRUE,
    -- Increment iteration so the next round of bids is fresh
    bidding_iteration    = COALESCE(bidding_iteration, 1) + 1,
    fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
    last_modified_by     = p_user_id,
    updated_at           = NOW()
  WHERE id = p_shift_id;

  INSERT INTO public.shift_audit_events (
    shift_id, event_category, event_type, performed_by_id, metadata
  ) VALUES (
    p_shift_id,
    'assignment',
    'offer_rejected',
    p_user_id,
    jsonb_build_object(
      'reason',          p_reason,
      'from_state',      v_state,
      'to_state',        'S5',
      'prev_employee',   v_shift.assigned_employee_id,
      'new_iteration',   COALESCE(v_shift.bidding_iteration, 1) + 1
    )
  );

  RETURN jsonb_build_object(
    'success',    true,
    'from_state', v_state,
    'to_state',   'S5'
  );
END;
$$;


-- ============================================================
-- C2 — sm_cancel_trade_request  (S9 → S4)
--
-- Must reset trading_status = 'NoTrade' before returning to S4.
-- Also validates source state is S9.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sm_cancel_trade_request(
  p_shift_id uuid,
  p_user_id  uuid DEFAULT auth.uid(),
  p_reason   text DEFAULT 'Trade request cancelled'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift RECORD;
  v_state text;
BEGIN
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
  END IF;

  v_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status,
    v_shift.assignment_status,
    v_shift.assignment_outcome,
    v_shift.trading_status,
    v_shift.is_cancelled
  );

  IF v_state != 'S9' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   format('sm_cancel_trade_request requires state S9 (TradeRequested), current state is %s', v_state)
    );
  END IF;

  UPDATE public.shifts
  SET
    trading_status   = 'NoTrade'::public.shift_trading,
    last_modified_by = p_user_id,
    updated_at       = NOW()
  WHERE id = p_shift_id;

  INSERT INTO public.shift_audit_events (
    shift_id, event_category, event_type, performed_by_id, metadata
  ) VALUES (
    p_shift_id,
    'trade',
    'trade_request_cancelled',
    p_user_id,
    jsonb_build_object(
      'reason',     p_reason,
      'from_state', v_state,
      'to_state',   'S4'
    )
  );

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S4');
END;
$$;


-- ============================================================
-- C2 — sm_reject_trade  (S10 → S4)
--
-- Must reset trading_status = 'NoTrade' before returning to S4.
-- Also validates source state is S10.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sm_reject_trade(
  p_shift_id uuid,
  p_user_id  uuid DEFAULT auth.uid(),
  p_reason   text DEFAULT 'Trade rejected'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift RECORD;
  v_state text;
BEGIN
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
  END IF;

  v_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status,
    v_shift.assignment_status,
    v_shift.assignment_outcome,
    v_shift.trading_status,
    v_shift.is_cancelled
  );

  IF v_state != 'S10' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   format('sm_reject_trade requires state S10 (TradeAccepted), current state is %s', v_state)
    );
  END IF;

  UPDATE public.shifts
  SET
    trading_status   = 'NoTrade'::public.shift_trading,
    last_modified_by = p_user_id,
    updated_at       = NOW()
  WHERE id = p_shift_id;

  INSERT INTO public.shift_audit_events (
    shift_id, event_category, event_type, performed_by_id, metadata
  ) VALUES (
    p_shift_id,
    'trade',
    'trade_rejected',
    p_user_id,
    jsonb_build_object(
      'reason',     p_reason,
      'from_state', v_state,
      'to_state',   'S4'
    )
  );

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S4');
END;
$$;


-- ============================================================
-- C2 — sm_expire_trade  (S9 or S10 → S4)
--
-- System-initiated expiry (e.g. scheduled job).
-- Resets trading_status = 'NoTrade' from either trade sub-state.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sm_expire_trade(
  p_shift_id uuid,
  p_user_id  uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift RECORD;
  v_state text;
BEGIN
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
  END IF;

  v_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status,
    v_shift.assignment_status,
    v_shift.assignment_outcome,
    v_shift.trading_status,
    v_shift.is_cancelled
  );

  IF v_state NOT IN ('S9', 'S10') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   format('sm_expire_trade requires state S9 or S10, current state is %s', v_state)
    );
  END IF;

  UPDATE public.shifts
  SET
    trading_status   = 'NoTrade'::public.shift_trading,
    last_modified_by = p_user_id,
    updated_at       = NOW()
  WHERE id = p_shift_id;

  INSERT INTO public.shift_audit_events (
    shift_id, event_category, event_type, performed_by_id, metadata
  ) VALUES (
    p_shift_id,
    'trade',
    'trade_expired',
    p_user_id,
    jsonb_build_object(
      'from_state', v_state,
      'to_state',   'S4'
    )
  );

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S4');
END;
$$;


-- ============================================================
-- C3 + RC2 — sm_mark_no_show  (S11 → S13)
--
-- Fixes:
--   RC2: uses SELECT … FOR UPDATE before mutating
--   C3:  also sets lifecycle_status='Completed' so the resulting
--        column combination maps to S13 via get_shift_fsm_state()
--
-- Valid source state: S11 (InProgress + assigned)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sm_mark_no_show(
  p_shift_id uuid,
  p_user_id  uuid DEFAULT auth.uid(),
  p_reason   text DEFAULT 'Employee no-show'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift RECORD;
  v_state text;
BEGIN
  -- RC2: lock the row before reading / mutating
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
  END IF;

  v_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status,
    v_shift.assignment_status,
    v_shift.assignment_outcome,
    v_shift.trading_status,
    v_shift.is_cancelled
  );

  IF v_state != 'S11' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   format('sm_mark_no_show requires state S11 (InProgress), current state is %s', v_state)
    );
  END IF;

  -- C3: set both assignment_outcome AND lifecycle_status so S13 is produced
  UPDATE public.shifts
  SET
    assignment_outcome = 'no_show'::public.shift_assignment_outcome,
    lifecycle_status   = 'Completed'::public.shift_lifecycle,
    last_modified_by   = p_user_id,
    updated_at         = NOW()
  WHERE id = p_shift_id;

  INSERT INTO public.shift_audit_events (
    shift_id, event_category, event_type, performed_by_id, metadata
  ) VALUES (
    p_shift_id,
    'shift_lifecycle',
    'no_show',
    p_user_id,
    jsonb_build_object(
      'reason',     p_reason,
      'from_state', v_state,
      'to_state',   'S13'
    )
  );

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S13');
END;
$$;


-- ============================================================
-- C5 — sm_publish_shift  (S2 → S4)
--
-- When publishing a Draft+Assigned shift (S2), any stale
-- assignment_outcome must be cleared to NULL so the invariant
-- trigger accepts the resulting S4 combination:
--   Published + assigned + outcome=confirmed
--
-- Full rewrite of the publish function to be FSM-aware.
-- Valid source states: S1 (Draft+Unassigned → S5) or S2 (Draft+Assigned → S4)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sm_publish_shift(
  p_shift_id uuid,
  p_user_id  uuid DEFAULT auth.uid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift      RECORD;
  v_state      text;
  v_to_state   text;
BEGIN
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
  END IF;

  v_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status,
    v_shift.assignment_status,
    v_shift.assignment_outcome,
    v_shift.trading_status,
    v_shift.is_cancelled
  );

  -- Idempotency: if already in a published state, return success
  IF v_state IN ('S3', 'S4', 'S5') THEN
    RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', v_state, 'message', 'Shift is already published');
  END IF;

  IF v_state NOT IN ('S1', 'S2') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   format('sm_publish_shift requires state S1 or S2 (Draft), current state is %s', v_state)
    );
  END IF;

  IF v_state = 'S2' THEN
    -- S2 → S4: Draft+Assigned → Published+Confirmed
    -- C5: explicitly clear any stale assignment_outcome, then set 'confirmed'
    v_to_state := 'S4';

    UPDATE public.shifts
    SET
      lifecycle_status   = 'Published'::public.shift_lifecycle,
      assignment_outcome = 'confirmed'::public.shift_assignment_outcome,
      bidding_status     = 'not_on_bidding'::public.shift_bidding_status,
      is_on_bidding      = FALSE,
      fulfillment_status = 'scheduled'::public.shift_fulfillment_status,
      last_modified_by   = p_user_id,
      updated_at         = NOW()
    WHERE id = p_shift_id;

  ELSE
    -- S1 → S5: Draft+Unassigned → Published+Bidding
    v_to_state := 'S5';

    UPDATE public.shifts
    SET
      lifecycle_status   = 'Published'::public.shift_lifecycle,
      assignment_status  = 'unassigned'::public.shift_assignment_status,
      assignment_outcome = NULL,
      bidding_status     = 'on_bidding'::public.shift_bidding_status,
      is_on_bidding      = TRUE,
      fulfillment_status = 'bidding'::public.shift_fulfillment_status,
      last_modified_by   = p_user_id,
      updated_at         = NOW()
    WHERE id = p_shift_id;
  END IF;

  INSERT INTO public.shift_audit_events (
    shift_id, event_category, event_type, performed_by_id, metadata
  ) VALUES (
    p_shift_id,
    'shift_lifecycle',
    'shift_published',
    p_user_id,
    jsonb_build_object(
      'from_state', v_state,
      'to_state',   v_to_state
    )
  );

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', v_to_state);
END;
$$;


-- ============================================================
-- L1 — sm_emergency_assign self-loop S4 → S4
--
-- Previous version (migration 4) only allowed S5 as source.
-- The FSM allows S4→S4 (re-assign an already-confirmed shift
-- in an emergency).  Additionally, p_employee_id was set via
-- `assigned_employee_id = p_employee_id` but the emergency_source
-- write-once logic must still fire.
--
-- Full rewrite extending valid source states to {S4, S5}.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sm_emergency_assign(
  p_shift_id    uuid,
  p_employee_id uuid,
  p_reason      text DEFAULT 'Emergency assignment',
  p_user_id     uuid DEFAULT auth.uid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift  RECORD;
  v_state  text;
  v_tts    int;
BEGIN
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
  END IF;

  v_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status,
    v_shift.assignment_status,
    v_shift.assignment_outcome,
    v_shift.trading_status,
    v_shift.is_cancelled
  );

  -- L1: valid from S4 (self-loop re-assign) or S5 (open → assigned)
  IF v_state NOT IN ('S4', 'S5') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   format('sm_emergency_assign requires state S4 or S5, current state is %s', v_state)
    );
  END IF;

  v_tts := EXTRACT(EPOCH FROM (v_shift.scheduled_start - NOW()))::int;

  -- L1: always set assigned_employee_id = p_employee_id (was already correct in
  -- migration 4 but now also handles the S4 self-loop path explicitly)
  UPDATE public.shifts
  SET
    assigned_employee_id  = p_employee_id,
    assigned_at           = NOW(),
    assignment_status     = 'assigned'::public.shift_assignment_status,
    assignment_outcome    = 'confirmed'::public.shift_assignment_outcome,
    -- write-once: never overwrite an already-set emergency_source
    emergency_source      = public.set_emergency_source('EMERGENCY_ASSIGN', v_tts, v_shift.emergency_source),
    bidding_status        = 'not_on_bidding'::public.shift_bidding_status,
    is_on_bidding         = FALSE,
    fulfillment_status    = 'scheduled'::public.shift_fulfillment_status,
    confirmed_at          = NOW(),
    compliance_checked_at = NOW(),
    last_modified_by      = p_user_id,
    updated_at            = NOW()
  WHERE id = p_shift_id;

  INSERT INTO public.shift_audit_events (
    shift_id, event_category, event_type, performed_by_id, metadata
  ) VALUES (
    p_shift_id,
    'shift_lifecycle',
    'emergency_assign',
    p_user_id,
    jsonb_build_object(
      'reason',      p_reason,
      'from_state',  v_state,
      'to_state',    'S4',
      'assigned_to', p_employee_id,
      'tts_sec',     v_tts,
      'self_loop',   (v_state = 'S4')
    )
  );

  RETURN jsonb_build_object(
    'success',     true,
    'from_state',  v_state,
    'to_state',    'S4',
    'assigned_to', p_employee_id
  );
END;
$$;


-- ============================================================
-- MT1 — sm_clock_in  (S4 → S11, and now also S9/S10 → S11)
--
-- When clocking in from S9 (TradeRequested) or S10 (TradeAccepted)
-- the function must also reset trading_status = 'NoTrade' so that
-- the resulting S11 combination is valid (InProgress requires
-- NoTrade per cross-field rule 3 in the invariants trigger).
-- ============================================================
CREATE OR REPLACE FUNCTION public.sm_clock_in(
  p_shift_id uuid,
  p_user_id  uuid DEFAULT auth.uid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift RECORD;
  v_state text;
BEGIN
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
  END IF;

  v_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status,
    v_shift.assignment_status,
    v_shift.assignment_outcome,
    v_shift.trading_status,
    v_shift.is_cancelled
  );

  -- MT1: valid from S4, S9 or S10
  IF v_state NOT IN ('S4', 'S9', 'S10') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   format('sm_clock_in requires state S4, S9 or S10, current state is %s', v_state)
    );
  END IF;

  UPDATE public.shifts
  SET
    lifecycle_status = 'InProgress'::public.shift_lifecycle,
    -- MT1: clear any pending trade when clocking in from S9/S10
    trading_status   = 'NoTrade'::public.shift_trading,
    last_modified_by = p_user_id,
    updated_at       = NOW()
  WHERE id = p_shift_id;

  INSERT INTO public.shift_audit_events (
    shift_id, event_category, event_type, performed_by_id, metadata
  ) VALUES (
    p_shift_id,
    'shift_lifecycle',
    'clock_in',
    p_user_id,
    jsonb_build_object(
      'from_state',    v_state,
      'to_state',      'S11',
      'trade_cleared', v_state IN ('S9', 'S10')
    )
  );

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S11');
END;
$$;


-- ============================================================
-- MT2 — sm_cancel_shift  (any non-terminal → S15)
--
-- Adds explicit handling for S9/S10: must still mark is_cancelled=TRUE
-- (the existing cancel function may not have covered these states).
-- Also validates the shift is not already cancelled or completed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sm_cancel_shift(
  p_shift_id uuid,
  p_user_id  uuid DEFAULT auth.uid(),
  p_reason   text DEFAULT 'Shift cancelled'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift RECORD;
  v_state text;
BEGIN
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
  END IF;

  v_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status,
    v_shift.assignment_status,
    v_shift.assignment_outcome,
    v_shift.trading_status,
    v_shift.is_cancelled
  );

  -- Cannot cancel from terminal states
  IF v_state IN ('S13', 'S15') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   format('sm_cancel_shift cannot cancel a shift already in terminal state %s', v_state)
    );
  END IF;

  -- MT2: for S9/S10, also clear the trade relationship so the
  -- cancelled row doesn't violate cross-field rule 3 (trading_status
  -- requires assignment_status='assigned', which remains true here, but
  -- clearing it is cleaner and avoids confusion on the cancelled record).
  UPDATE public.shifts
  SET
    is_cancelled     = TRUE,
    trading_status   = CASE
                         WHEN trading_status != 'NoTrade' THEN 'NoTrade'::public.shift_trading
                         ELSE trading_status
                       END,
    last_modified_by = p_user_id,
    updated_at       = NOW()
  WHERE id = p_shift_id;

  INSERT INTO public.shift_audit_events (
    shift_id, event_category, event_type, performed_by_id, metadata
  ) VALUES (
    p_shift_id,
    'shift_lifecycle',
    'shift_cancelled',
    p_user_id,
    jsonb_build_object(
      'reason',        p_reason,
      'from_state',    v_state,
      'to_state',      'S15',
      'trade_cleared', v_state IN ('S9', 'S10')
    )
  );

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S15');
END;
$$;


-- ============================================================
-- Data integrity: back-fill any existing rows with broken
-- side-effect combinations that these fixes address.
-- All DML is idempotent and guarded by WHERE conditions.
-- tr_lock_past_shifts is disabled around DML (same pattern as migration 2).
-- ============================================================

ALTER TABLE public.shifts DISABLE TRIGGER tr_lock_past_shifts;

DO $$
BEGIN
  -- C3 back-fill: rows with assignment_outcome='no_show' but
  -- lifecycle_status != 'Completed'.  These were produced by the old
  -- mark_no_show that forgot to set lifecycle_status.
  UPDATE public.shifts
  SET
    lifecycle_status = 'Completed'::public.shift_lifecycle,
    updated_at       = NOW()
  WHERE assignment_outcome = 'no_show'
    AND lifecycle_status  != 'Completed'
    AND deleted_at IS NULL;

  IF FOUND THEN
    RAISE NOTICE 'C3 back-fill: corrected lifecycle_status to Completed for no_show rows';
  END IF;

  -- C2 back-fill: Published+assigned rows stuck in TradeRequested or
  -- TradeAccepted but lifecycle already moved past Published are an
  -- anomaly; clear trading_status so they match S4.
  -- (Only touches InProgress/Completed rows with stale trading_status.)
  UPDATE public.shifts
  SET
    trading_status = 'NoTrade'::public.shift_trading,
    updated_at     = NOW()
  WHERE trading_status != 'NoTrade'
    AND lifecycle_status IN ('InProgress', 'Completed')
    AND deleted_at IS NULL;

  IF FOUND THEN
    RAISE NOTICE 'C2 back-fill: cleared stale trading_status on InProgress/Completed rows';
  END IF;
END;
$$;

ALTER TABLE public.shifts ENABLE TRIGGER tr_lock_past_shifts;
