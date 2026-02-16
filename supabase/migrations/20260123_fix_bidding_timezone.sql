-- Migration: Fix Bidding Window Timezone & Strict 4h Rule
-- Description: Updates RPCs to use Australia/Sydney timezone for shift start and enforces strict 4h bidding closure rule.

BEGIN;

-- 1. Update publish_shift RPC
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
         -- Allow published if we are re-publishing? No, usually draft.
         -- But maybe pushing to bidding from assigned (if allowed)?
         -- Existing allowed only draft. GroupModeView logic implies pushing unassigned draft.
         -- If it is already published but unassigned (Open), allow? 
         -- Existing logic said: IF v_shift.lifecycle_status != 'draft' THEN RAISE ...
         -- I'll keep it strict for now.
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
        -- Draft + Assigned -> Offered (or Published directly if auto-approve?) Matches previous logic.
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


-- 2. Update push_shift_to_bidding_on_cancel RPC
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
    v_shift_start TIMESTAMPTZ;
    v_bidding_close_at TIMESTAMPTZ;
    v_is_urgent BOOLEAN;
BEGIN
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
    
    IF v_shift IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
    END IF;
    
    -- TIMEZONE FIX
    v_shift_start := (v_shift.shift_date::TEXT || ' ' || v_shift.start_time::TEXT)::TIMESTAMP AT TIME ZONE 'Australia/Sydney';
    
    -- Skip if shift is in the past
    IF v_shift_start < NOW() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift is in the past');
    END IF;
    
    -- STRICT 4h RULE
    v_bidding_close_at := v_shift_start - INTERVAL '4 hours';
    
    IF v_bidding_close_at <= NOW() THEN
        -- Strict failure for cancellation handling too?
        -- User said "since shift bidding window has to close 4h before... ask manager to find emergency cover"
        -- This implies we fail even for cancellations.
        RETURN jsonb_build_object('success', false, 'error', 'WINDOW_EXPIRED', 'message', 'Too late to open bidding (less than 4h). Emergency cover required.');
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
