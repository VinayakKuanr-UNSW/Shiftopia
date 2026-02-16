-- Migration: Bidding Window Auto-Calculation & URGENT Flag
-- Description: Updates publish_shift RPC to auto-calculate bidding_close_at (4h before shift start) 
--              and sets is_urgent flag for shifts with < 24h bidding window
-- Timestamp: 20260123_bidding_window_autocalc

BEGIN;

-------------------------------------------------------------------------
-- 1. Add missing columns if they don't exist
-------------------------------------------------------------------------
DO $$ 
BEGIN
    -- is_urgent
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shifts' AND column_name = 'is_urgent'
    ) THEN
        ALTER TABLE shifts ADD COLUMN is_urgent BOOLEAN DEFAULT FALSE;
    END IF;

    -- bidding_close_at
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shifts' AND column_name = 'bidding_close_at'
    ) THEN
        ALTER TABLE shifts ADD COLUMN bidding_close_at TIMESTAMPTZ;
    END IF;

    -- bidding_open_at
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shifts' AND column_name = 'bidding_open_at'
    ) THEN
        ALTER TABLE shifts ADD COLUMN bidding_open_at TIMESTAMPTZ;
    END IF;

    -- bidding_enabled
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shifts' AND column_name = 'bidding_enabled'
    ) THEN
        ALTER TABLE shifts ADD COLUMN bidding_enabled BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-------------------------------------------------------------------------
-- 2. Updated publish_shift RPC with auto-calculated bidding window
-------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION publish_shift(
    p_shift_id UUID,
    p_actor_id UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_shift RECORD;
    v_new_fulfillment_status shift_fulfillment_status;
    v_overlap_exists BOOLEAN;
    v_rest_period_ok BOOLEAN;
    v_result JSONB;
    v_shift_start TIMESTAMP;
    v_bidding_close_at TIMESTAMP;
    v_is_urgent BOOLEAN;
BEGIN
    -- 1. Lock and Get Shift
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
    
    IF v_shift IS NULL THEN
        RAISE EXCEPTION 'Shift not found: %', p_shift_id;
    END IF;

    -- 2. Validate Current State
    IF v_shift.lifecycle_status != 'draft' THEN
        RAISE EXCEPTION 'Shift must be in Draft state to publish (current: %)', v_shift.lifecycle_status;
    END IF;

    -- 3. Compliance Check (Only for Assigned shifts)
    IF v_shift.assigned_employee_id IS NOT NULL THEN
        -- Check Overlap
        SELECT check_shift_overlap(
            v_shift.assigned_employee_id,
            v_shift.shift_date,
            v_shift.start_time,
            v_shift.end_time,
            v_shift.id
        ) INTO v_overlap_exists;

        IF v_overlap_exists THEN
            RAISE EXCEPTION 'Compliance Violation: Shift Overlap detected for employee %', v_shift.assigned_employee_id;
        END IF;

        -- Check Rest Period
        SELECT validate_rest_period(
            v_shift.assigned_employee_id,
            v_shift.shift_date,
            v_shift.start_time,
            v_shift.end_time,
            8
        ) INTO v_rest_period_ok;

        IF NOT v_rest_period_ok THEN
            RAISE EXCEPTION 'Compliance Violation: insufficient Rest Period (min 8h) for employee %', v_shift.assigned_employee_id;
        END IF;
    END IF;

    -- 4. Determine New State & Actions
    IF v_shift.assigned_employee_id IS NOT NULL THEN
        -- Draft + Assigned -> Offered
        v_new_fulfillment_status := 'offered';
        
        -- Create Offer
        INSERT INTO shift_offers (shift_id, employee_id, status, offered_at)
        VALUES (p_shift_id, v_shift.assigned_employee_id, 'Pending', NOW())
        ON CONFLICT (shift_id, employee_id) DO UPDATE SET status = 'Pending', offered_at = NOW(); 

        -- Update shift
        UPDATE shifts
        SET 
            lifecycle_status = 'published',
            fulfillment_status = v_new_fulfillment_status,
            is_published = TRUE,
            published_at = NOW(),
            published_by_user_id = p_actor_id
        WHERE id = p_shift_id;

    ELSE
        -- Draft + Unassigned -> Bidding
        v_new_fulfillment_status := 'bidding';
        
        -- Calculate bidding window: closes 4 hours before shift start
        v_shift_start := (v_shift.shift_date::TEXT || ' ' || v_shift.start_time::TEXT)::TIMESTAMP;
        v_bidding_close_at := v_shift_start - INTERVAL '4 hours';
        
        -- Determine if URGENT (less than 24 hours until bidding closes)
        v_is_urgent := (v_bidding_close_at - NOW()) < INTERVAL '24 hours';
        
        -- Update shift with bidding window
        UPDATE shifts SET 
            lifecycle_status = 'published',
            fulfillment_status = v_new_fulfillment_status,
            is_published = TRUE,
            published_at = NOW(),
            published_by_user_id = p_actor_id,
            is_on_bidding = TRUE,
            bidding_enabled = TRUE,
            bidding_open_at = NOW(),
            bidding_close_at = v_bidding_close_at,
            is_urgent = v_is_urgent
        WHERE id = p_shift_id;
    END IF;

    -- 5. Log / Return
    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'new_status', 'published',
        'fulfillment', v_new_fulfillment_status,
        'bidding_close_at', v_bidding_close_at,
        'is_urgent', v_is_urgent
    );

END;
$$;

-------------------------------------------------------------------------
-- 3. Helper function to recalculate urgent flag for a shift
-------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalculate_shift_urgency(p_shift_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_shift RECORD;
    v_shift_start TIMESTAMP;
    v_bidding_close_at TIMESTAMP;
    v_is_urgent BOOLEAN;
BEGIN
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;
    
    IF v_shift IS NULL OR v_shift.bidding_close_at IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Calculate urgency based on current time
    v_is_urgent := (v_shift.bidding_close_at - NOW()) < INTERVAL '24 hours';
    
    -- Update if changed
    IF v_shift.is_urgent IS DISTINCT FROM v_is_urgent THEN
        UPDATE shifts SET is_urgent = v_is_urgent WHERE id = p_shift_id;
    END IF;
    
    RETURN v_is_urgent;
END;
$$;

-------------------------------------------------------------------------
-- 4. Function to push shift to bidding (for employee cancellations)
-------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION push_shift_to_bidding_on_cancel(
    p_shift_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_shift RECORD;
    v_shift_start TIMESTAMP;
    v_bidding_close_at TIMESTAMP;
    v_is_urgent BOOLEAN;
BEGIN
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
    
    IF v_shift IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
    END IF;
    
    -- Calculate shift start datetime
    v_shift_start := (v_shift.shift_date::TEXT || ' ' || v_shift.start_time::TEXT)::TIMESTAMP;
    
    -- Skip if shift is in the past
    IF v_shift_start < NOW() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift is in the past');
    END IF;
    
    -- Calculate bidding window: closes 4 hours before shift start
    v_bidding_close_at := v_shift_start - INTERVAL '4 hours';
    
    -- If bidding would already be closed, set it to NOW + 1 hour minimum
    IF v_bidding_close_at < NOW() THEN
        v_bidding_close_at := NOW() + INTERVAL '1 hour';
    END IF;
    
    -- URGENT if cancelled within 24 hours of shift start
    v_is_urgent := (v_shift_start - NOW()) < INTERVAL '24 hours';
    
    -- Update shift to bidding state
    UPDATE shifts SET
        assigned_employee_id = NULL,
        assignment_status = 'unassigned',
        fulfillment_status = 'bidding',
        is_on_bidding = TRUE,
        bidding_enabled = TRUE,
        bidding_open_at = NOW(),
        bidding_close_at = v_bidding_close_at,
        is_urgent = v_is_urgent,
        cancellation_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_shift_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'bidding_close_at', v_bidding_close_at,
        'is_urgent', v_is_urgent
    );
END;
$$;

COMMIT;
