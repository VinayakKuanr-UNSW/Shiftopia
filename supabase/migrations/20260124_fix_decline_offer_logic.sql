-- Migration: Fix Decline Offer Logic with Time Rules
-- Description: Updates decline_shift_offer to implement time-based logic (Normal/Urgent/Emergency).
-- Ensures S5 (Normal) vs S6 (Urgent) states are correctly set.

BEGIN;

CREATE OR REPLACE FUNCTION public.decline_shift_offer(p_shift_id uuid, p_employee_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_shift RECORD;
    v_offer RECORD;
    v_shift_start TIMESTAMPTZ;
    v_hours_remaining NUMERIC;
    v_bidding_close_at TIMESTAMPTZ;
    v_bidding_status shift_bidding_status;
    v_is_urgent BOOLEAN;
BEGIN
    -- 1. Lock and Get Shift
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
    
    IF v_shift IS NULL THEN
        RAISE EXCEPTION 'Shift not found: %', p_shift_id;
    END IF;

    -- 2. Validate Offer Exists and is Pending
    SELECT * INTO v_offer FROM shift_offers 
    WHERE shift_id = p_shift_id AND employee_id = p_employee_id AND status = 'Pending'
    FOR UPDATE;

    IF v_offer IS NULL THEN
        RAISE EXCEPTION 'No pending offer found for this shift and employee.';
    END IF;

    -- 3. Update Offer Status
    UPDATE shift_offers
    SET status = 'Declined', responded_at = NOW()
    WHERE id = v_offer.id;

    -- 4. Calculate Time Remaining
    v_shift_start := (v_shift.shift_date || ' ' || v_shift.start_time)::TIMESTAMP AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney');
    v_hours_remaining := EXTRACT(EPOCH FROM (v_shift_start - NOW())) / 3600;

    -- 5. Determine Bidding State based on Time
    IF v_hours_remaining > 24 THEN
        -- > 24h: Normal Bidding (S5)
        v_bidding_status := 'on_bidding_normal';
        v_is_urgent := FALSE;
        -- Close 4 hours before start
        v_bidding_close_at := v_shift_start - INTERVAL '4 hours';
        
    ELSIF v_hours_remaining > 4 THEN
        -- 4h - 24h: Urgent Bidding (S6)
        v_bidding_status := 'on_bidding_urgent';
        v_is_urgent := TRUE;
        -- Close 2 hours before start
        v_bidding_close_at := v_shift_start - INTERVAL '2 hours';
        
    ELSE
        -- < 4h: Emergency / Urgent (S6)
        -- We still open bidding but it's extremely urgent.
        v_bidding_status := 'on_bidding_urgent';
        v_is_urgent := TRUE;
        -- Close 30 mins before start (or immediately if passed?)
        v_bidding_close_at := v_shift_start - INTERVAL '30 minutes';
        
        -- In rigorous S7 implementation, we might skip bidding and alert manager.
        -- For now, Urgent Bidding is the best fallback.
    END IF;

    -- 6. Update Shift Logic
    UPDATE shifts
    SET 
        assigned_employee_id = NULL,
        assignment_status = 'unassigned',
        assignment_outcome = NULL, -- Clear outcome
        
        fulfillment_status = 'bidding',
        bidding_status = v_bidding_status,
        
        is_on_bidding = TRUE,
        bidding_enabled = TRUE,
        bidding_open_at = NOW(),
        bidding_close_at = v_bidding_close_at,
        is_urgent = v_is_urgent,
        
        updated_at = NOW()
    WHERE id = p_shift_id;

    -- 7. Return Success
    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'action', 'declined',
        'message', 'Shift offer declined. It is now open for bidding.',
        'bidding_status', v_bidding_status
    );
END;
$function$;

COMMIT;
