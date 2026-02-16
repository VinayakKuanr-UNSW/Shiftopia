-- Migration: Fix Accept Offer RPC State Transition
-- Description: Updates accept_shift_offer to set assignment_outcome = 'confirmed' (S4)
-- This ensures the shift appears in the roster (which filters out 'offered') and is visually confirmed.

BEGIN;

CREATE OR REPLACE FUNCTION public.accept_shift_offer(p_shift_id uuid, p_employee_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_shift RECORD;
    v_offer RECORD;
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

    -- 3. Validate Employee Match
    IF v_shift.assigned_employee_id != p_employee_id THEN
        RAISE EXCEPTION 'You are not the assigned employee for this offer.';
    END IF;

    -- 4. Update Offer Status
    UPDATE shift_offers
    SET status = 'Accepted', responded_at = NOW()
    WHERE id = v_offer.id;

    -- 5. Update Shift Status to S4 (Confirmed)
    UPDATE shifts
    SET 
        fulfillment_status = 'scheduled', -- Visual "Scheduled" or "Confirmed" depending on mapping
        assignment_outcome = 'confirmed', -- KEY FIX: Set outcome to Confirmed (S4)
        confirmed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_shift_id;

    -- 6. Return Success
    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'action', 'accepted',
        'message', 'Shift offer accepted. It is now on your roster.'
    );
END;
$function$;

COMMIT;
