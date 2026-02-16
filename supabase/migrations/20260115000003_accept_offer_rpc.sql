-- Migration: Accept Swap Offer RPC
-- Consolidates the accept offer logic into a transactional RPC
-- to ensure atomicity when accepting an offer.

CREATE OR REPLACE FUNCTION accept_swap_offer(p_offer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_offer record;
    v_request record;
    v_actor_id uuid;
BEGIN
    -- Get current user
    v_actor_id := auth.uid();
    
    -- 1. Lock and retrieve the offer
    SELECT * INTO v_offer 
    FROM swap_offers 
    WHERE id = p_offer_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Swap offer not found';
    END IF;

    IF v_offer.status != 'pending' THEN
        RAISE EXCEPTION 'Offer is not pending (current status: %)', v_offer.status;
    END IF;

    -- 2. Lock and retrieve the swap request
    SELECT * INTO v_request 
    FROM swap_requests 
    WHERE id = v_offer.swap_request_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Swap request not found';
    END IF;

    IF v_request.status != 'pending_employee' THEN
        RAISE EXCEPTION 'Swap request is not open for offers (current status: %)', v_request.status;
    END IF;

    -- 3. Update the swap request with offer details
    UPDATE swap_requests
    SET swap_with_employee_id = v_offer.offering_employee_id,
        offered_shift_id = v_offer.offered_shift_id,
        status = 'pending_manager',
        responded_at = now(),
        updated_at = now()
    WHERE id = v_offer.swap_request_id;

    -- 4. Accept this offer
    UPDATE swap_offers
    SET status = 'accepted',
        updated_at = now()
    WHERE id = p_offer_id;

    -- 5. Reject all other pending offers for this swap request
    UPDATE swap_offers
    SET status = 'rejected',
        updated_at = now()
    WHERE swap_request_id = v_offer.swap_request_id
      AND id != p_offer_id
      AND status = 'pending';

    -- 6. Log to audit
    INSERT INTO swap_audit_logs (swap_request_id, actor_id, previous_status, new_status, reason)
    VALUES (v_offer.swap_request_id, v_actor_id, 'pending_employee', 'pending_manager', 'Offer accepted by employee');

END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION accept_swap_offer(uuid) TO authenticated;

COMMENT ON FUNCTION accept_swap_offer IS 'Atomically accepts a swap offer, updates the swap request, and rejects other pending offers.';
