-- Implement Bidding RPCs (Phase 4)

-- 1. Select Bidding Winner
-- Consolidate: Fixed signature/ambiguity and added Upsert logic for offers (2026-01-25)
CREATE OR REPLACE FUNCTION public.select_bidding_winner(
    p_shift_id uuid,
    p_employee_id uuid,
    p_admin_id uuid DEFAULT auth.uid()
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_shift RECORD;
    v_bid RECORD;
BEGIN
    -- 1. Lock Shift and Validate
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
    
    IF v_shift IS NULL THEN
        RAISE EXCEPTION 'Shift not found';
    END IF;
    
    -- Check if bidding is actually open or compatible?
    -- Ideally we allow selecting winner even if closed, but status must be unassigned.
    IF v_shift.assignment_status != 'unassigned' THEN
        RAISE EXCEPTION 'Shift is already assigned';
    END IF;

    -- 2. Validate Bid exists
    SELECT * INTO v_bid FROM shift_bids 
    WHERE shift_id = p_shift_id AND employee_id = p_employee_id 
    FOR UPDATE;
    
    IF v_bid IS NULL THEN
        RAISE EXCEPTION 'Employee has not bid on this shift';
    END IF;

    -- 3. Update Shift to Offered State (S4)
    UPDATE shifts
    SET 
        bidding_status = 'not_on_bidding',
        is_on_bidding = FALSE,
        bidding_enabled = FALSE,
        assignment_status = 'assigned',
        assignment_outcome = 'offered', -- S4
        assigned_employee_id = p_employee_id,
        updated_at = NOW()
    WHERE id = p_shift_id;

    -- 4. Create or Update Offer
    INSERT INTO shift_offers (shift_id, employee_id, status, offered_at)
    VALUES (p_shift_id, p_employee_id, 'Pending', NOW())
    ON CONFLICT (shift_id, employee_id) 
    DO UPDATE SET 
        status = 'Pending', 
        offered_at = NOW(),
        responded_at = NULL; -- Reset any previous response

    -- 5. Accept Winner's Bid
    UPDATE shift_bids 
    SET status = 'accepted', reviewed_at = NOW(), reviewed_by = p_admin_id
    WHERE id = v_bid.id;

    -- 6. Reject Other Bids
    UPDATE shift_bids 
    SET status = 'rejected', reviewed_at = NOW(), reviewed_by = p_admin_id
    WHERE shift_id = p_shift_id AND id != v_bid.id AND status = 'pending';

    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'winner_id', p_employee_id,
        'action', 'winner_selected'
    );
END;
$function$;

-- 2. Close Bidding No Winner
CREATE OR REPLACE FUNCTION public.close_bidding_no_winner(p_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_shift RECORD;
BEGIN
    -- 1. Lock Shift
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
    
    IF v_shift IS NULL THEN RAISE EXCEPTION 'Shift not found'; END IF;

    -- 2. Update to S8 (Published, Unassigned, BiddingClosedNoWinner)
    UPDATE shifts
    SET 
        bidding_status = 'bidding_closed_no_winner',
        is_on_bidding = FALSE,
        bidding_enabled = FALSE,
        updated_at = NOW()
    WHERE id = p_shift_id;

    -- 3. Reject All Pending Bids
    UPDATE shift_bids 
    SET status = 'rejected', reviewed_at = NOW(), reviewed_by = auth.uid()
    WHERE shift_id = p_shift_id AND status = 'pending';

    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'status', 'bidding_closed_no_winner'
    );
END;
$function$;
