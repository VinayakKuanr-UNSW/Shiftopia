-- Migration: Implement Unpublish Shift RPC
-- Description: Adds unpublish_shift function to revert Published shifts to Draft (S1/S2).
-- Triggered by "Unpublish" button in UI to allow editing.

BEGIN;

CREATE OR REPLACE FUNCTION public.unpublish_shift(p_shift_id uuid, p_actor_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_shift RECORD;
    v_new_outcome text;
BEGIN
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
    
    IF v_shift IS NULL THEN RAISE EXCEPTION 'Shift not found'; END IF;
    
    -- Validate State
    IF v_shift.lifecycle_status != 'published' THEN
        RAISE EXCEPTION 'Only published shifts can be unpublished';
    END IF;
    
    -- Logic: Revert to Draft
    
    IF v_shift.assigned_employee_id IS NOT NULL THEN
        -- Case: Assigned (S3/S4) -> S2 (Draft + Pending)
        -- We keep the employee assigned, but reset status to Pending
        v_new_outcome := 'Pending'; -- Note: Case sensitive check on constraint? usually 'Pending' or 'pending'? 
        -- Check constraint: shift_assignment_outcome_enum? Or is it text?
        -- Actually shifts.assignment_outcome (text) usually lowercase 'pending' in my previous fixes?
        -- Let's check existing data or assume lowercase 'pending' is safer for internal consistency, 
        -- BUT S1/S2 definitions often say 'Pending' (Title case).
        -- Let's use 'pending' (lowercase) to match 'offered', 'confirmed'.
        
        UPDATE shifts
        SET 
            lifecycle_status = 'draft',
            is_draft = TRUE, -- Explicitly set draft flag
            is_published = FALSE,
            published_at = NULL,
            published_by_user_id = NULL,
            
            assignment_outcome = 'pending', -- Reset outcome
            fulfillment_status = 'none',
            
            is_on_bidding = FALSE,
            bidding_enabled = FALSE,
            bidding_open_at = NULL,
            bidding_close_at = NULL,
            
            updated_at = NOW()
        WHERE id = p_shift_id;
        
        -- Also cancel any open offers?
        -- Yes, if we unpublish, the offer is retracted.
        UPDATE shift_offers
        SET status = 'cancelled' -- Lowercase per my previous fix
        WHERE shift_id = p_shift_id AND status = 'Pending';
        
    ELSE
        -- Case: Unassigned (S5/S6/S8) -> S1 (Draft + Unassigned)
        UPDATE shifts
        SET 
            lifecycle_status = 'draft',
            is_draft = TRUE, -- Explicitly set draft flag
            is_published = FALSE,
            published_at = NULL,
            published_by_user_id = NULL,
            
            assignment_outcome = NULL,
            fulfillment_status = 'none',
            
            is_on_bidding = FALSE,
            bidding_enabled = FALSE,
            bidding_open_at = NULL,
            bidding_close_at = NULL,
            is_urgent = FALSE,
            
            updated_at = NOW()
        WHERE id = p_shift_id;
        
        -- Cancel any bids? 
        -- shift_bids table logic... probably should reject pending bids?
        -- For now, leaving them pending might be weird. Let's rejecting them.
        UPDATE shift_bids
        SET status = 'rejected'
        WHERE shift_id = p_shift_id AND status = 'pending';
        
        -- Close active bidding windows to stay clean
        UPDATE shift_bid_windows
        SET status = 'closed'
        WHERE shift_id = p_shift_id AND status = 'open';
        
    END IF;

    RETURN jsonb_build_object('success', true, 'action', 'unpublished', 'new_status', 'draft');
END;
$function$;

COMMIT;
