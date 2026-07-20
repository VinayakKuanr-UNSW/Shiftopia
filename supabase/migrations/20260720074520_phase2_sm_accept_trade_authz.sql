-- =============================================================================
-- Phase 2 — Backend authorization & integrity for peer swap acceptance (H2).
--
-- sm_accept_trade (the requester "accept an offer" RPC, SECURITY DEFINER so it
-- bypasses RLS) previously performed NO caller authorization and trusted the
-- client-supplied compliance snapshot verbatim. Any authenticated user could
-- accept an offer on anyone else's OPEN swap, select an arbitrary offer, and
-- push it to MANAGER_PENDING.
--
-- This migration hardens it WITHOUT changing the success-path contract the
-- lifecycle e2e pins (same table writes, same return shape) by adding, up front:
--   1. Caller authz  — only the swap's requester (owner), a manager/admin, or a
--      NULL-uid caller (service_role worker) may accept.
--   2. Offer integrity — the offer must belong to THIS swap, name the given
--      offerer, and still be SUBMITTED (locked FOR UPDATE to serialize with a
--      concurrent withdraw/expire).
--   3. Compliance guard — refuse to commit when the snapshot is absent or not
--      feasible (defense-in-depth; authoritative server-side recomputation via
--      the evaluate-compliance edge function is tracked as a follow-up).
--
-- Prod body confirmed identical to baseline before edit (no drift).
-- NOT YET APPLIED — pending review + checkpoint sign-off.
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."sm_accept_trade"(
  "p_swap_id" "uuid",
  "p_offer_id" "uuid",
  "p_offerer_id" "uuid",
  "p_offer_shift_id" "uuid" DEFAULT NULL::"uuid",
  "p_compliance_snapshot" "jsonb" DEFAULT NULL::"jsonb"
) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $function$
DECLARE
  v_caller    uuid := auth.uid();
  v_swap      shift_swaps%ROWTYPE;
  v_offer     swap_offers%ROWTYPE;
  v_shift_ids uuid[];
BEGIN
  -- 1. Lock the swap row and verify it is still OPEN
  SELECT * INTO v_swap FROM shift_swaps WHERE id = p_swap_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Swap request not found', 'code', 'SWAP_NOT_FOUND');
  END IF;

  -- 1a. AUTHORIZATION (H2): only the swap's requester may accept an offer on it.
  -- Managers/admins may act on behalf; a NULL caller is the service_role worker.
  IF v_caller IS NOT NULL
     AND v_caller <> v_swap.requester_id
     AND NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized to accept this swap', 'code', 'FORBIDDEN');
  END IF;

  IF v_swap.status <> 'OPEN' THEN
    RETURN json_build_object(
      'success', false,
      'error', format('Swap is no longer OPEN (current status: %s)', v_swap.status),
      'code', 'SWAP_NOT_OPEN'
    );
  END IF;

  -- 1b. OFFER INTEGRITY: the chosen offer must belong to this swap, name the
  -- passed offerer, and still be live. Lock it to serialize with withdraw/expire.
  SELECT * INTO v_offer FROM swap_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND OR v_offer.swap_request_id <> p_swap_id THEN
    RETURN json_build_object('success', false, 'error', 'Offer does not belong to this swap', 'code', 'OFFER_MISMATCH');
  END IF;
  IF v_offer.offerer_id <> p_offerer_id THEN
    RETURN json_build_object('success', false, 'error', 'Offerer does not match the offer', 'code', 'OFFERER_MISMATCH');
  END IF;
  IF v_offer.status <> 'SUBMITTED' THEN
    RETURN json_build_object(
      'success', false,
      'error', format('Offer is not selectable (status: %s)', v_offer.status),
      'code', 'OFFER_NOT_SUBMITTED'
    );
  END IF;

  -- 1c. COMPLIANCE GUARD (H2, defense-in-depth): never commit an accept whose
  -- snapshot is missing or not feasible.
  IF p_compliance_snapshot IS NULL
     OR COALESCE((p_compliance_snapshot->>'feasible')::boolean, false) = false THEN
    RETURN json_build_object('success', false, 'error', 'Compliance snapshot missing or not feasible', 'code', 'COMPLIANCE_REQUIRED');
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
$function$;
