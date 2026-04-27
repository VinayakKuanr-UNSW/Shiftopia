-- Atomically transitions a swap from OPEN → MANAGER_PENDING.
-- Replaces the 4-step client-side orchestration in acceptTrade() with a single
-- transaction so partial failures cannot leave the DB in an inconsistent state.
--
-- Steps (all-or-nothing):
--   1. Verify swap exists and is OPEN
--   2. Update shift_swaps → MANAGER_PENDING with target info
--   3. Mark selected swap_offer → SELECTED with compliance snapshot
--   4. Reject all other offers for this swap
--   5. Lock both shifts (requester + offerer) → trading_status = TradeAccepted
--
-- Returns: { success, error?, code? }

CREATE OR REPLACE FUNCTION public.sm_accept_trade(
  p_swap_id        uuid,
  p_offer_id       uuid,
  p_offerer_id     uuid,
  p_offer_shift_id uuid DEFAULT NULL,
  p_compliance_snapshot jsonb DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_swap           shift_swaps%ROWTYPE;
  v_shift_ids      uuid[];
BEGIN
  -- 1. Lock the swap row and verify it is still OPEN
  SELECT * INTO v_swap FROM shift_swaps WHERE id = p_swap_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Swap request not found', 'code', 'SWAP_NOT_FOUND');
  END IF;

  IF v_swap.status <> 'OPEN' THEN
    RETURN json_build_object(
      'success', false,
      'error', format('Swap is no longer OPEN (current status: %s)', v_swap.status),
      'code', 'SWAP_NOT_OPEN'
    );
  END IF;

  -- 2. Move swap to MANAGER_PENDING
  UPDATE shift_swaps
  SET
    status          = 'MANAGER_PENDING',
    target_id       = p_offerer_id,
    target_shift_id = p_offer_shift_id,
    updated_at      = NOW()
  WHERE id = p_swap_id;

  -- 3. Mark chosen offer as SELECTED
  UPDATE swap_offers
  SET status              = 'SELECTED',
      compliance_snapshot = p_compliance_snapshot
  WHERE id = p_offer_id;

  -- 4. Reject all other outstanding offers for this swap
  UPDATE swap_offers
  SET status = 'REJECTED'
  WHERE swap_request_id = p_swap_id
    AND id <> p_offer_id
    AND status NOT IN ('WITHDRAWN', 'EXPIRED', 'REJECTED');

  -- 5. Lock both shifts to TradeAccepted
  v_shift_ids := ARRAY[v_swap.requester_shift_id, p_offer_shift_id];
  UPDATE shifts
  SET trading_status = 'TradeAccepted'
  WHERE id = ANY(v_shift_ids)
    AND id IS NOT NULL;

  RETURN json_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;
