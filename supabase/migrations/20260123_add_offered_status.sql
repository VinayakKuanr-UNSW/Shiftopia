-- Add 'offered' to shift_fulfillment_status enum
-- Migration: 20260123_add_offered_status.sql

-- 1. Add 'offered' to the enum if not exists
ALTER TYPE shift_fulfillment_status ADD VALUE IF NOT EXISTS 'offered';

-- 2. Update publish_shift RPC to create offers
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
    v_start_datetime TIMESTAMP WITH TIME ZONE;
    v_bidding_close_at TIMESTAMP WITH TIME ZONE;
    v_now TIMESTAMP WITH TIME ZONE := NOW();
BEGIN
    -- Lock and get shift
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
    
    IF v_shift IS NULL THEN
        RAISE EXCEPTION 'Shift not found: %', p_shift_id;
    END IF;

    -- Build full start datetime
    v_start_datetime := (v_shift.shift_date || ' ' || v_shift.start_time)::TIMESTAMP 
                        AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney');
    
    -- Bidding closes 4 hours before shift start
    v_bidding_close_at := v_start_datetime - INTERVAL '4 hours';
    
    -- 4-HOUR RULE Check
    IF v_bidding_close_at <= v_now THEN
        RAISE EXCEPTION 'WINDOW_EXPIRED: Cannot publish shift - bidding window would already be closed. Shift starts in less than 4 hours.';
    END IF;

    -- Check if shift has a candidate assigned (Draft Assignment)
    IF v_shift.assigned_employee_id IS NOT NULL THEN
        -- LOGIC CHANGE: Instead of confirming assignment, create an OFFER
        
        -- 1. Create offer record
        INSERT INTO shift_offers (
            shift_id,
            employee_id,
            status,
            offered_at
        ) VALUES (
            p_shift_id,
            v_shift.assigned_employee_id,
            'Pending',
            v_now
        )
        ON CONFLICT (shift_id, employee_id) 
        DO UPDATE SET 
            status = 'Pending', 
            offered_at = v_now,
            responded_at = NULL,
            response_notes = NULL;
            
        -- 2. Update shift to 'Offered' state
        UPDATE shifts 
        SET 
            lifecycle_status = 'published',
            fulfillment_status = 'offered', -- NEW STATUS
            assignment_status = 'unassigned', -- Reset assignment so they can accept it
            assigned_employee_id = NULL, -- Clear hard assignment (optional, or keep it as tentative?)
                                         -- Better to clear it so constraint chk_bidding_requires_unassigned doesn't trigger if we used bidding?
                                         -- Actually, for 'offered', we might NOT want to clear it if we treat assigned_id as "candidate".
                                         -- BUT earlier user said "Draft - Assigned" -> "Published".
                                         -- If we move to "Offered", effectively no one is "Assigned" yet.
                                         -- Let's keep assigned_employee_id as NULL to be safe and use shift_offers to track candidates.
            is_published = TRUE,
            is_draft = FALSE,
            is_on_bidding = FALSE,
            bidding_enabled = FALSE, -- Offers are not bidding
            published_at = v_now,
            published_by_user_id = p_actor_id
        WHERE id = p_shift_id;
        
        RETURN jsonb_build_object(
            'success', true,
            'shift_id', p_shift_id,
            'new_status', 'published',
            'fulfillment_status', 'offered',
            'offered_to', v_shift.assigned_employee_id
        );
    ELSE
        -- Unassigned shifts: Publish WITH bidding (unchanged)
        UPDATE shifts 
        SET 
            lifecycle_status = 'published',
            fulfillment_status = 'bidding',
            assignment_status = 'unassigned',
            is_published = TRUE,
            is_draft = FALSE,
            is_on_bidding = TRUE,
            bidding_enabled = TRUE,
            bidding_open_at = v_now,
            bidding_close_at = v_bidding_close_at,
            published_at = v_now,
            published_by_user_id = p_actor_id
        WHERE id = p_shift_id;
        
        RETURN jsonb_build_object(
            'success', true,
            'shift_id', p_shift_id,
            'new_status', 'published',
            'is_on_bidding', true
        );
    END IF;
END;
$$;
