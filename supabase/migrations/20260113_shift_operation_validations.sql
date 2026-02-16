-- Phase 1: Database Functions with Validations
-- This migration creates RPC functions for shift operations with:
-- 1. Proper timezone handling (AEST/AEDT)
-- 2. Post-start operation prevention
-- 3. Centralized validation logic

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Get shift start time with proper timezone handling
CREATE OR REPLACE FUNCTION get_shift_start_time(p_shift_id UUID)
RETURNS TIMESTAMPTZ AS $$
DECLARE
    v_shift RECORD;
    v_shift_start TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift not found';
    END IF;
    
    -- Construct timestamp with shift's timezone (default Australia/Sydney)
    v_shift_start := (v_shift.shift_date || ' ' || v_shift.start_time)::TIMESTAMP 
        AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney');
    
    RETURN v_shift_start;
END;
$$ LANGUAGE plpgsql STABLE;

-- Check if shift has already started
CREATE OR REPLACE FUNCTION has_shift_started(p_shift_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN get_shift_start_time(p_shift_id) <= NOW();
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- SHIFT ASSIGNMENT RPC
-- ============================================================

CREATE OR REPLACE FUNCTION assign_shift_rpc(
    p_shift_id UUID,
    p_employee_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_shift RECORD;
BEGIN
    -- Validate shift exists
    SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift not found';
    END IF;
    
    -- Prevent assignment after shift has started
    IF has_shift_started(p_shift_id) THEN
        RAISE EXCEPTION 'Cannot assign shift after it has started';
    END IF;
    
    -- Perform assignment with explicit enum casting
    UPDATE public.shifts SET
        assigned_employee_id = p_employee_id,
        employee_id = p_employee_id,
        status = CASE 
            WHEN p_employee_id IS NOT NULL THEN 'assigned'::shift_status
            ELSE 'open'::shift_status
        END,
        assignment_status_text = CASE 
            WHEN p_employee_id IS NOT NULL THEN 'assigned' 
            ELSE 'unassigned' 
        END,
        assigned_at = CASE 
            WHEN p_employee_id IS NOT NULL THEN NOW() 
            ELSE NULL 
        END,
        updated_at = NOW()
    WHERE id = p_shift_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'employee_id', p_employee_id,
        'message', CASE 
            WHEN p_employee_id IS NOT NULL THEN 'Shift assigned successfully'
            ELSE 'Shift unassigned successfully'
        END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- BIDDING RPC
-- ============================================================

CREATE OR REPLACE FUNCTION bid_on_shift_rpc(
    p_shift_id UUID,
    p_employee_id UUID,
    p_priority INTEGER DEFAULT 1
) RETURNS JSONB AS $$
DECLARE
    v_bid_id UUID;
    v_shift RECORD;
BEGIN
    -- Validate shift exists and is open for bidding
    SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift not found';
    END IF;
    
    IF NOT v_shift.bidding_enabled THEN
        RAISE EXCEPTION 'This shift is not open for bidding';
    END IF;
    
    -- Prevent bidding after shift has started
    IF has_shift_started(p_shift_id) THEN
        RAISE EXCEPTION 'Cannot bid on shift after it has started';
    END IF;
    
    -- Check if bidding window has closed
    IF v_shift.bidding_end_at IS NOT NULL AND v_shift.bidding_end_at < NOW() THEN
        RAISE EXCEPTION 'Bidding window has closed for this shift';
    END IF;
    
    -- Check if employee already has a bid on this shift
    IF EXISTS (
        SELECT 1 FROM public.shift_bids 
        WHERE shift_id = p_shift_id 
        AND employee_id = p_employee_id
        AND status != 'withdrawn'
    ) THEN
        RAISE EXCEPTION 'You already have an active bid on this shift';
    END IF;
    
    -- Create the bid
    INSERT INTO public.shift_bids (
        shift_id,
        employee_id,
        priority,
        status,
        created_at,
        updated_at
    ) VALUES (
        p_shift_id,
        p_employee_id,
        p_priority,
        'pending',
        NOW(),
        NOW()
    ) RETURNING id INTO v_bid_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'bid_id', v_bid_id,
        'message', 'Bid placed successfully'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Withdraw bid RPC
CREATE OR REPLACE FUNCTION withdraw_bid_rpc(
    p_bid_id UUID,
    p_employee_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_bid RECORD;
BEGIN
    -- Validate bid exists and belongs to employee
    SELECT * INTO v_bid FROM public.shift_bids WHERE id = p_bid_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bid not found';
    END IF;
    
    IF v_bid.employee_id != p_employee_id THEN
        RAISE EXCEPTION 'You can only withdraw your own bids';
    END IF;
    
    IF v_bid.status != 'pending' THEN
        RAISE EXCEPTION 'Can only withdraw pending bids';
    END IF;
    
    -- Prevent withdrawal after shift has started
    IF has_shift_started(v_bid.shift_id) THEN
        RAISE EXCEPTION 'Cannot withdraw bid after shift has started';
    END IF;
    
    -- Withdraw the bid
    UPDATE public.shift_bids 
    SET 
        status = 'withdrawn',
        updated_at = NOW()
    WHERE id = p_bid_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Bid withdrawn successfully'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- SHIFT SWAP/TRADE RPC
-- ============================================================

CREATE OR REPLACE FUNCTION create_swap_rpc(
    p_requester_shift_id UUID,
    p_requester_id UUID,
    p_swap_type TEXT DEFAULT 'swap',
    p_reason TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_swap_id UUID;
    v_shift RECORD;
BEGIN
    -- Validate shift exists and belongs to requester
    SELECT * INTO v_shift FROM public.shifts WHERE id = p_requester_shift_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift not found';
    END IF;
    
    IF v_shift.assigned_employee_id != p_requester_id THEN
        RAISE EXCEPTION 'You can only swap shifts assigned to you';
    END IF;
    
    -- Prevent swap creation after shift has started
    IF has_shift_started(p_requester_shift_id) THEN
        RAISE EXCEPTION 'Cannot create swap request after shift has started';
    END IF;
    
    -- Check if shift already has pending swap
    IF EXISTS (
        SELECT 1 FROM public.shift_swaps 
        WHERE requester_shift_id = p_requester_shift_id 
        AND status = 'pending'
    ) THEN
        RAISE EXCEPTION 'This shift already has a pending swap request';
    END IF;
    
    -- Create swap request
    INSERT INTO public.shift_swaps (
        requester_id,
        requester_shift_id,
        swap_type,
        status,
        reason,
        created_at,
        updated_at
    ) VALUES (
        p_requester_id,
        p_requester_shift_id,
        p_swap_type,
        'pending',
        p_reason,
        NOW(),
        NOW()
    ) RETURNING id INTO v_swap_id;
    
    -- Mark shift as trade requested
    UPDATE public.shifts 
    SET 
        is_trade_requested = TRUE,
        updated_at = NOW()
    WHERE id = p_requester_shift_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'swap_id', v_swap_id,
        'message', 'Swap request created successfully'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Cancel swap RPC
CREATE OR REPLACE FUNCTION cancel_swap_rpc(
    p_swap_id UUID,
    p_requester_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_swap RECORD;
BEGIN
    -- Validate swap exists and belongs to requester
    SELECT * INTO v_swap FROM public.shift_swaps WHERE id = p_swap_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Swap request not found';
    END IF;
    
    IF v_swap.requester_id != p_requester_id THEN
        RAISE EXCEPTION 'You can only cancel your own swap requests';
    END IF;
    
    IF v_swap.status != 'pending' THEN
        RAISE EXCEPTION 'Can only cancel pending swap requests';
    END IF;
    
    -- Prevent cancellation after shift has started
    IF has_shift_started(v_swap.requester_shift_id) THEN
        RAISE EXCEPTION 'Cannot cancel swap after shift has started';
    END IF;
    
    -- Cancel the swap
    UPDATE public.shift_swaps 
    SET 
        status = 'cancelled',
        updated_at = NOW()
    WHERE id = p_swap_id;
    
    -- Reset shift flag
    UPDATE public.shifts 
    SET 
        is_trade_requested = FALSE,
        updated_at = NOW()
    WHERE id = v_swap.requester_shift_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Swap request cancelled successfully'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- ADMIN OPERATIONS
-- ============================================================

-- Admin can delete shifts even after they've started
CREATE OR REPLACE FUNCTION admin_delete_shift_rpc(
    p_shift_id UUID,
    p_admin_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_system_role TEXT;
BEGIN
    -- Verify admin permissions using system_role
    SELECT system_role INTO v_system_role 
    FROM public.profiles 
    WHERE id = p_admin_id;
    
    IF v_system_role != 'admin' THEN
        RAISE EXCEPTION 'Only admins can delete shifts';
    END IF;
    
    -- Soft delete the shift
    UPDATE public.shifts 
    SET 
        deleted_at = NOW(),
        updated_at = NOW()
    WHERE id = p_shift_id;
    
    -- Also soft delete any related bids
    UPDATE public.shift_bids 
    SET 
        status = 'withdrawn',
        updated_at = NOW()
    WHERE shift_id = p_shift_id 
    AND status = 'pending';
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Shift deleted successfully'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON FUNCTION get_shift_start_time IS 'Returns shift start time with proper timezone handling (AEST/AEDT)';
COMMENT ON FUNCTION has_shift_started IS 'Checks if a shift has already started based on current Sydney time';
COMMENT ON FUNCTION assign_shift_rpc IS 'Assigns or unassigns employee to shift with validation';
COMMENT ON FUNCTION bid_on_shift_rpc IS 'Places a bid on an open shift with validation';
COMMENT ON FUNCTION withdraw_bid_rpc IS 'Withdraws a pending bid with validation';
COMMENT ON FUNCTION create_swap_rpc IS 'Creates a shift swap request with validation';
COMMENT ON FUNCTION cancel_swap_rpc IS 'Cancels a pending swap request with validation';
COMMENT ON FUNCTION admin_delete_shift_rpc IS 'Admin-only function to delete shifts (even started ones)';
