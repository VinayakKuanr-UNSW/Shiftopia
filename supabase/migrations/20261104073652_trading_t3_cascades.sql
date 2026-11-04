-- ============================================================================
-- Trading T3 — cascades (docs/design/shift-trading/01-trading-fsm.md §6).
-- A trade ends when either of its shifts leaves the published flow, or when
-- leave is approved for a shift someone holds in it:
--   unpublish / cancel  -> trg_shift_end_trades (AFTER UPDATE)
--   delete              -> trg_shift_end_trades_on_delete (BEFORE DELETE: the
--                          trade rows cascade away with the shift, which left
--                          the partner shift stuck in S6/S7)
--   leave approved      -> trg_leave_end_trades
-- All three call end_trades_for_shift. Ending the request lets
-- trg_swap_close_offers end its offers. Assignee changes (approval itself)
-- and auto-start (the expiry sweep owns that) are deliberately not triggers.
-- Also drops the dead legacy swap_requests branch from sm_unpublish_shift and
-- the trg_cancel_swaps_on_offer trigger (it fires on an outcome the CHECK
-- forbids and writes the empty legacy table).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.end_trades_for_shift(p_shift_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_sw public.shift_swaps%ROWTYPE;
BEGIN
  -- the shift is posted (S6), or is either side of a trade in review (S7)
  FOR v_sw IN
    SELECT * FROM public.shift_swaps
     WHERE (requester_shift_id = p_shift_id AND status IN ('OPEN', 'MANAGER_PENDING'))
        OR (target_shift_id = p_shift_id AND status = 'MANAGER_PENDING')
     FOR UPDATE
  LOOP
    UPDATE public.shift_swaps SET status = 'CANCELLED', status_changed_at = now(), updated_at = now()
     WHERE id = v_sw.id;
    -- the partner only: the caller owns the shift itself (a BEFORE DELETE
    -- trigger may not touch the row being deleted)
    UPDATE public.shifts SET trading_status = 'NoTrade', trade_requested_at = NULL, updated_at = now()
     WHERE id IN (v_sw.requester_shift_id, v_sw.target_shift_id)
       AND id <> p_shift_id
       AND trading_status <> 'NoTrade';
  END LOOP;

  -- the shift is offered into someone else's open trade (held S4)
  UPDATE public.swap_offers SET status = 'CANCELLED', updated_at = now()
   WHERE offered_shift_id = p_shift_id AND status = 'SUBMITTED';
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_shift_end_trades()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.end_trades_for_shift(OLD.id);
    RETURN OLD;
  END IF;
  PERFORM public.end_trades_for_shift(NEW.id);
  UPDATE public.shifts SET trading_status = 'NoTrade', trade_requested_at = NULL
   WHERE id = NEW.id AND trading_status <> 'NoTrade';
  RETURN NULL;
END;
$function$;

CREATE TRIGGER trg_shift_end_trades
  AFTER UPDATE OF lifecycle_status, is_cancelled ON public.shifts
  FOR EACH ROW
  WHEN ((NEW.lifecycle_status IN ('Draft', 'Cancelled') OR NEW.is_cancelled)
        AND (OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status
             OR OLD.is_cancelled IS DISTINCT FROM NEW.is_cancelled))
  EXECUTE FUNCTION public.fn_shift_end_trades();

CREATE TRIGGER trg_shift_end_trades_on_delete
  BEFORE DELETE ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_shift_end_trades();

-- Leave approved: end every trade in which the employee gives a shift dated
-- inside the leave. (Receiving a shift on a leave day is already refused at
-- approval by trg_shift_not_on_approved_leave.)
CREATE OR REPLACE FUNCTION public.fn_leave_end_trades()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift_id uuid;
BEGIN
  FOR v_shift_id IN
    SELECT s.id FROM public.shifts s
     WHERE s.assigned_employee_id = NEW.employee_id
       AND s.shift_date BETWEEN NEW.start_date::date AND NEW.end_date::date
       AND (s.trading_status <> 'NoTrade' OR public.shift_is_held(s.id))
  LOOP
    PERFORM public.end_trades_for_shift(v_shift_id);
    UPDATE public.shifts SET trading_status = 'NoTrade', trade_requested_at = NULL
     WHERE id = v_shift_id AND trading_status <> 'NoTrade';
  END LOOP;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER trg_leave_end_trades
  AFTER INSERT OR UPDATE OF status ON public.leave_requests
  FOR EACH ROW
  WHEN (NEW.status = 'approved')
  EXECUTE FUNCTION public.fn_leave_end_trades();

CREATE OR REPLACE FUNCTION public.sm_unpublish_shift(p_shift_id uuid, p_user_id uuid DEFAULT auth.uid(), p_reason text DEFAULT 'Unpublished'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift RECORD;
  v_state text;
  v_to_state text;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_shift_action(p_shift_id, 'shift.publish');
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); END IF;

  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);
  IF v_state NOT IN ('S3', 'S4', 'S5', 'S6', 'S7') THEN
    RETURN jsonb_build_object('success', false, 'error', format('sm_unpublish_shift requires a Published state (S3/S4/S5/S6/S7), current state is %s', v_state));
  END IF;

  -- Cancel active trade/swap requests if unpublishing a trade-pending shift (S6/S7)
  IF v_shift.trading_status IN ('TradeRequested', 'TradeAccepted') THEN
    UPDATE public.shift_swaps SET
      status = 'CANCELLED',
      updated_at = NOW()
    WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
      AND status IN ('OPEN', 'MANAGER_PENDING', 'OFFER_SELECTED');

    UPDATE public.shifts SET
      trading_status = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL,
      last_modified_by = p_user_id,
      updated_at = NOW()
    WHERE id IN (
      SELECT CASE WHEN requester_shift_id = p_shift_id THEN target_shift_id ELSE requester_shift_id END
      FROM public.shift_swaps
      WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
    ) AND id <> p_shift_id;

    UPDATE public.shifts SET
      trading_status = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL
    WHERE id = p_shift_id;
  END IF;

  IF v_state IN ('S3', 'S4', 'S6', 'S7') THEN
    v_to_state := 'S2';
    UPDATE public.shifts SET
      lifecycle_status   = 'Draft'::public.shift_lifecycle,
      assignment_outcome = NULL,
      bidding_status     = 'not_on_bidding'::public.shift_bidding_status,
      fulfillment_status = 'none'::public.shift_fulfillment_status,
      last_modified_by   = p_user_id,
      last_modified_reason = p_reason,
      updated_at         = NOW()
    WHERE id = p_shift_id;
  ELSE
    v_to_state := 'S1';
    UPDATE public.shifts SET
      lifecycle_status   = 'Draft'::public.shift_lifecycle,
      bidding_status     = 'not_on_bidding'::public.shift_bidding_status,
      fulfillment_status = 'none'::public.shift_fulfillment_status,
      last_modified_by   = p_user_id,
      last_modified_reason = p_reason,
      updated_at         = NOW()
    WHERE id = p_shift_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', v_to_state);
END;
$function$;

DROP TRIGGER trg_cancel_swaps_on_offer ON public.shifts;
DROP FUNCTION public.trg_cancel_swaps_on_offer_fn();

REVOKE ALL ON FUNCTION public.end_trades_for_shift(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_shift_end_trades() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_leave_end_trades() FROM PUBLIC, anon, authenticated;
