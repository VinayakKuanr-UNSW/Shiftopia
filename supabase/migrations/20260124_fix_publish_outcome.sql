-- Migration: Fix Publish Outcome
-- Description: Updates publish_shift to explicitly set assignment_outcome = 'offered' when publishing an assigned shift.
-- This ensures the Shift State Machine (S.M.v2) correctly identifies State S3 (Published + Assigned + Offered).

BEGIN;

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
    v_shift_start TIMESTAMPTZ;
    v_bidding_close_at TIMESTAMPTZ;
    v_is_urgent BOOLEAN;
BEGIN
    -- 1. Lock and Get Shift
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
    
    IF v_shift IS NULL THEN
        RAISE EXCEPTION 'Shift not found: %', p_shift_id;
    END IF;

    -- 2. Validate Current State
    IF v_shift.lifecycle_status != 'draft' AND v_shift.lifecycle_status != 'published' THEN
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
        -- Draft + Assigned -> Offered (S3)
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
            assignment_outcome = 'offered', -- FIX: Explicitly set outcome to 'offered'
            is_published = TRUE,
            is_draft = FALSE,
            published_at = NOW(),
            published_by_user_id = p_actor_id
        WHERE id = p_shift_id;

    ELSE
        -- Draft + Unassigned -> Bidding
        v_new_fulfillment_status := 'bidding';
        
        -- TIMEZONE FIX: Interpret shift time as Australia/Sydney (AEDT/AEST)
        v_shift_start := (v_shift.shift_date::TEXT || ' ' || v_shift.start_time::TEXT)::TIMESTAMP AT TIME ZONE 'Australia/Sydney';
        
        -- STRICT RULE: Bidding must close 4 hours BEFORE shift start.
        v_bidding_close_at := v_shift_start - INTERVAL '4 hours';
        
        -- Invariant Check: If window is already closed/expired
        IF v_bidding_close_at <= NOW() THEN
            RAISE EXCEPTION 'WINDOW_EXPIRED';
        END IF;
        
        -- Calculate Urgency
        v_is_urgent := (v_bidding_close_at - NOW()) < INTERVAL '24 hours';
        
        -- Update shift
        UPDATE shifts SET 
            lifecycle_status = 'published',
            fulfillment_status = v_new_fulfillment_status,
            is_published = TRUE,
            is_draft = FALSE,
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
        'assignment_outcome', CASE WHEN v_shift.assigned_employee_id IS NOT NULL THEN 'offered' ELSE NULL END
    );

END;
$$;

COMMIT;
