-- Migration: Fix Publish RPC Logic for Bidding and Offers
-- Description: Updates publish_shift to set correct bidding defaults and ensure Offers are not marked as 'assigned'.
-- Timestamp: 20260122180000

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
    v_bidding_end_at TIMESTAMPTZ;
BEGIN
    -- 1. Lock and Get Shift
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
    
    IF v_shift IS NULL THEN
        RAISE EXCEPTION 'Shift not found: %', p_shift_id;
    END IF;

    -- 2. Validate Current State (Allow re-publishing if needed, but primarily for Draft)
    -- Relaxed check: If already published, maybe we are updating? But for now stick to Draft -> Published transition logic specific to this button.
    -- User might hit publish on an already published shift (e.g. to move to bidding).
    -- For now, we enforce draft or implicit update.
    
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

        -- CRITICAL: Mark as 'unassigned' so it doesn't show as confirmed in My Roster
        UPDATE shifts
        SET 
            lifecycle_status = 'published',
            fulfillment_status = 'offered',
            assignment_status = 'unassigned', -- It is offered, not yet assigned/confirmed
            is_published = TRUE
        WHERE id = p_shift_id;

    ELSE
        -- Draft + Unassigned -> Bidding
        v_new_fulfillment_status := 'bidding';
        
        -- Calculate default bidding end time (e.g. 3 days from now, or 24h before shift, or default +7 days)
        -- Using +7 days as a safe default if not configured
        v_bidding_end_at := NOW() + interval '7 days';

        UPDATE shifts 
        SET 
            lifecycle_status = 'published',
            fulfillment_status = 'bidding',
            assignment_status = 'unassigned',
            is_published = TRUE,
            is_on_bidding = TRUE,
            bidding_enabled = TRUE,
            bidding_open_at = NOW(),
            bidding_close_at = COALESCE(bidding_close_at, v_bidding_end_at),
            bidding_end_at = COALESCE(bidding_end_at, v_bidding_end_at), -- Ensure both columns synced
            bidding_deadline = COALESCE(bidding_deadline, v_bidding_end_at)
        WHERE id = p_shift_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'new_status', 'published',
        'fulfillment', v_new_fulfillment_status
    );

END;
$$;

COMMIT;
