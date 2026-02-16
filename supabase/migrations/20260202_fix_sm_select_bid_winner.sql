-- Migration: Fix sm_select_bid_winner to use valid fulfillment_status enum value
-- The enum shift_fulfillment_status only allows: "scheduled", "bidding", "offered", "none"
-- The function was incorrectly using "fulfilled" which doesn't exist

CREATE OR REPLACE FUNCTION public.sm_select_bid_winner(
    p_shift_id UUID,
    p_winner_id UUID,
    p_user_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_shift RECORD;
    v_bid RECORD;
    v_result JSONB;
BEGIN
    -- Get the shift
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Shift not found');
    END IF;
    
    -- Check if shift is on bidding
    IF v_shift.bidding_status NOT IN ('on_bidding_normal', 'on_bidding_urgent') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Shift is not on bidding');
    END IF;
    
    -- Get the winning bid
    SELECT * INTO v_bid 
    FROM shift_bids 
    WHERE shift_id = p_shift_id AND employee_id = p_winner_id AND status = 'pending';
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'No pending bid found for this employee');
    END IF;
    
    -- Update the shift: assign the winner, close bidding, set lifecycle to Published, assignment to assigned
    UPDATE shifts SET
        assigned_employee_id = p_winner_id,
        assignment_status = 'assigned',
        assignment_outcome = 'confirmed',
        bidding_status = 'not_on_bidding',
        is_on_bidding = false,
        fulfillment_status = 'scheduled',  -- FIXED: was "fulfilled" which is not a valid enum value
        lifecycle_status = 'Published',
        updated_at = NOW()
    WHERE id = p_shift_id;
    
    -- Update the winning bid status
    UPDATE shift_bids SET
        status = 'accepted',  -- FIXED: was 'approved' which is not a valid enum value
        updated_at = NOW()
    WHERE id = v_bid.id;
    
    -- Reject all other pending bids for this shift
    UPDATE shift_bids SET
        status = 'rejected',
        updated_at = NOW()
    WHERE shift_id = p_shift_id 
      AND id != v_bid.id 
      AND status = 'pending';
    
    -- Log audit event (optional - if audit table exists)
    BEGIN
        INSERT INTO shift_audit_events (
            shift_id,
            event_category,
            event_type,
            performed_by_id,
            old_data,
            new_data,
            created_at
        ) VALUES (
            p_shift_id,
            'bidding',
            'bid_winner_selected',
            COALESCE(p_user_id, auth.uid()),
            jsonb_build_object(
                'bidding_status', v_shift.bidding_status,
                'assignment_status', v_shift.assignment_status
            ),
            jsonb_build_object(
                'winner_id', p_winner_id,
                'assignment_status', 'assigned',
                'fulfillment_status', 'scheduled'
            ),
            NOW()
        );
    EXCEPTION WHEN undefined_table THEN
        -- Ignore if audit table doesn't exist
        NULL;
    END;
    
    RETURN jsonb_build_object(
        'success', true, 
        'message', 'Bid winner selected successfully',
        'shift_id', p_shift_id,
        'winner_id', p_winner_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.sm_select_bid_winner(UUID, UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.sm_select_bid_winner IS 
'Selects a bid winner for a shift on bidding. Changes shift state from S5/S6 to S4 (Confirmed).
Fixed: Uses correct enum value "scheduled" instead of invalid "fulfilled".';
