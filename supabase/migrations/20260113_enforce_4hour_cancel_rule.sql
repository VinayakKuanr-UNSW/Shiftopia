-- Migration: Fix cancel_shift_v2 to enforce 4-hour cancellation rule
-- Date: 2026-01-13
-- Description: Prevents shift cancellations within 4 hours of scheduled start

BEGIN;

-- Replace the cancel_shift_v2 function to enforce 4-hour rule
CREATE OR REPLACE FUNCTION cancel_shift_v2(
    p_shift_id UUID,
    p_reason TEXT
) RETURNS JSONB AS $$
DECLARE
    v_shift RECORD;
    v_diff_hours NUMERIC;
    v_cancelled_at TIMESTAMPTZ;
    v_cancel_type TEXT;
    v_prev_status TEXT;
    v_new_status TEXT;
    v_closes_at TIMESTAMPTZ;
    v_window_id UUID;
    v_shift_start TIMESTAMPTZ;
    v_rows INTEGER;
BEGIN
    -- 1. Fetch Shift & Validate
    SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift not found';
    END IF;
    
    -- Construct start timestamp with proper timezone handling
    -- Use the shift's timezone (default 'Australia/Sydney') to ensure correct local time interpretation
    v_shift_start := (v_shift.shift_date || ' ' || v_shift.start_time)::TIMESTAMP AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney');

    IF v_shift_start < NOW() THEN
        RAISE EXCEPTION 'Cannot cancel a shift that has already started';
    END IF;

    
    -- 2. Calculate Time Difference and Validate Early
    v_cancelled_at := NOW();
    v_diff_hours := EXTRACT(EPOCH FROM (v_shift_start - v_cancelled_at)) / 3600;
    
    -- EARLY VALIDATION: Reject if within 4 hours
    IF v_diff_hours <= 4 THEN
        RAISE EXCEPTION 'Cannot cancel shift within 4 hours of scheduled start time. Current time difference: % hours', ROUND(v_diff_hours, 2);
    END IF;
    
    v_prev_status := v_shift.status;
    
    -- 3. Update Shift to Release Employee
    UPDATE public.shifts 
    SET 
        is_cancelled = FALSE, 
        assigned_employee_id = NULL,
        employee_id = NULL,
        updated_at = NOW(),
        assignment_status_text = 'unassigned', 
        assignment_method_text = NULL,
        assigned_at = NULL,
        cancellation_reason = p_reason
    WHERE id = p_shift_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RAISE EXCEPTION 'Shift update failed - Shift not found or access denied';
    END IF;

    -- 4. Logic Branching
    
    -- CASE A: Standard (> 24h)
    IF v_diff_hours > 24 THEN
        v_cancel_type := 'STANDARD';
        v_new_status := 'open';
        v_closes_at := v_shift_start - INTERVAL '4 hours';
        
        -- Clean up any existing window
        DELETE FROM public.shift_bid_windows WHERE shift_id = p_shift_id;
        
        -- Create Bidding Window
        INSERT INTO public.shift_bid_windows (shift_id, opens_at, closes_at, status)
        VALUES (p_shift_id, NOW(), v_closes_at, 'open')
        RETURNING id INTO v_window_id;
        
        -- Tag shift as bidding enabled and populate direct columns
        UPDATE public.shifts SET 
            bidding_enabled = TRUE,
            is_on_bidding = TRUE,
            bidding_start_at = NOW(),
            bidding_end_at = v_closes_at,
            status = 'open',
            cancellation_type_text = 'standard'
        WHERE id = p_shift_id;
        
        -- Log events (check if log_shift_event exists, assuming yes from previous migrations)
        PERFORM log_shift_event(p_shift_id, 'SHIFT_CANCELLED_STANDARD', v_prev_status, 'open', 
            jsonb_build_object('reason', p_reason, 'diff_hours', v_diff_hours, 'window_id', v_window_id));
            
        PERFORM log_shift_event(p_shift_id, 'SHIFT_PUSHED_TO_BIDDING', v_prev_status, 'open', NULL);

    -- CASE B: Late (4h < diff <= 24h)
    ELSE
        -- Since we already validated diff_hours > 4 upfront, this ELSE handles 4 < diff_hours <= 24
        v_cancel_type := 'LATE';
        v_new_status := 'open';
        v_closes_at := v_shift_start - INTERVAL '4 hours';
        
        DELETE FROM public.shift_bid_windows WHERE shift_id = p_shift_id;
        
        INSERT INTO public.shift_bid_windows (shift_id, opens_at, closes_at, status)
        VALUES (p_shift_id, NOW(), v_closes_at, 'open')
        RETURNING id INTO v_window_id;
        
        -- Tag shift as bidding enabled, populate direct columns, and mark as urgent
        UPDATE public.shifts SET 
            bidding_enabled = TRUE,
            is_on_bidding = TRUE,
            bidding_start_at = NOW(),
            bidding_end_at = v_closes_at,
            status = 'open',
            cancellation_type_text = 'late',
            bidding_priority_text = 'urgent'
        WHERE id = p_shift_id;
        
        PERFORM log_shift_event(p_shift_id, 'SHIFT_CANCELLED_LATE', v_prev_status, 'open', 
            jsonb_build_object('reason', p_reason, 'diff_hours', v_diff_hours, 'urgency', 'URGENT'));
            
        PERFORM log_shift_event(p_shift_id, 'SHIFT_PUSHED_TO_BIDDING_URGENT', v_prev_status, 'open', NULL);
    END IF;
    
    RETURN jsonb_build_object(
        'success', true,
        'cancellation_type', v_cancel_type,
        'new_status', v_new_status,
        'window_id', v_window_id,
        'final_shift_state', (SELECT to_jsonb(s) FROM public.shifts s WHERE id = p_shift_id)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
