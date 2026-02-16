-- FIX: Sync assignment_status (ENUM) with assignment_status_text (TEXT)
-- This prevents data corruption during unpublish/transitions where triggers rely on the Enum value.

-- 1. Create or replace the sync function
CREATE OR REPLACE FUNCTION public.sync_assignment_status_columns()
RETURNS TRIGGER AS $$
BEGIN
    -- If text changed, update enum
    IF NEW.assignment_status_text IS DISTINCT FROM OLD.assignment_status_text THEN
        -- Map text to enum values. Handle potential mismatches gracefully.
        BEGIN
            NEW.assignment_status := NEW.assignment_status_text::assignment_status_enum;
        EXCEPTION WHEN OTHERS THEN
            -- If mapping fails (e.g. 'unassigned' text vs 'unassigned' enum case mismatch), standardise it
            IF NEW.assignment_status_text = 'unassigned' THEN NEW.assignment_status := 'unassigned';
            ELSIF NEW.assignment_status_text = 'assigned' THEN NEW.assignment_status := 'assigned';
            ELSIF NEW.assignment_status_text = 'pending' THEN NEW.assignment_status := 'pending';
            ELSIF NEW.assignment_status_text = 'declined' THEN NEW.assignment_status := 'declined';
            END IF;
        END;
    END IF;
    
    -- If enum changed (less likely to be driver), update text
    IF NEW.assignment_status IS DISTINCT FROM OLD.assignment_status THEN
        NEW.assignment_status_text := NEW.assignment_status::text;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Attach trigger (if not exists)
DROP TRIGGER IF EXISTS tr_sync_assignment_status_columns ON shifts;
CREATE TRIGGER tr_sync_assignment_status_columns
    BEFORE INSERT OR UPDATE ON shifts
    FOR EACH ROW
    EXECUTE FUNCTION sync_assignment_status_columns();

-- 3. One-time fix for existing corrupt rows (Ghost Shifts)
-- Find shifts that have an employee but say 'unassigned' and fix them.
UPDATE shifts
SET 
    assignment_status = 'assigned',
    assignment_status_text = 'assigned'
WHERE 
    assigned_employee_id IS NOT NULL 
    AND (assignment_status = 'unassigned' OR assignment_status_text = 'unassigned');

-- 4. Fix shifts that are Draft+Assigned (S2) but missing outcome
UPDATE shifts
SET assignment_outcome = 'pending'
WHERE 
    lifecycle_status = 'draft' 
    AND assigned_employee_id IS NOT NULL 
    AND (assignment_outcome IS NULL OR assignment_outcome::text = '');

-- 5. Harden unpublish_shift to ensure it doesn't leave bad state
CREATE OR REPLACE FUNCTION public.unpublish_shift(p_shift_id uuid, p_actor_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_shift RECORD;
BEGIN
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
    
    IF v_shift IS NULL THEN RAISE EXCEPTION 'Shift not found'; END IF;
    
    IF v_shift.lifecycle_status != 'published' THEN
        RAISE EXCEPTION 'Only published shifts can be unpublished';
    END IF;
    
    -- Case: Assigned -> S2 (Draft + Pending)
    IF v_shift.assigned_employee_id IS NOT NULL THEN
        UPDATE shifts
        SET 
            lifecycle_status = 'draft',
            is_draft = TRUE,
            is_published = FALSE,
            published_at = NULL,
            published_by_user_id = NULL,
            
            assignment_outcome = 'pending', -- Ensure Pending
            fulfillment_status = 'none',
            assignment_status = 'assigned', -- Explicitly set Enum
            assignment_status_text = 'assigned', -- Explicitly set Text
            
            is_on_bidding = FALSE,
            bidding_enabled = FALSE,
            updated_at = NOW()
        WHERE id = p_shift_id;
        
        -- Cancel open offers
        UPDATE shift_offers
        SET status = 'cancelled'
        WHERE shift_id = p_shift_id AND status = 'Pending';
        
    ELSE
        -- Case: Unassigned -> S1 (Draft + Unassigned)
        UPDATE shifts
        SET 
            lifecycle_status = 'draft',
            is_draft = TRUE,
            is_published = FALSE,
            published_at = NULL,
            published_by_user_id = NULL,
            
            assignment_outcome = NULL,
            fulfillment_status = 'none',
            assignment_status = 'unassigned',
            assignment_status_text = 'unassigned',
            
            is_on_bidding = FALSE,
            bidding_enabled = FALSE,
            updated_at = NOW()
        WHERE id = p_shift_id;
        
        -- Cancel bids/windows
        UPDATE shift_bids SET status = 'rejected' WHERE shift_id = p_shift_id AND status = 'pending';
        UPDATE shift_bid_windows SET status = 'closed' WHERE shift_id = p_shift_id AND status = 'open';
    END IF;

    RETURN jsonb_build_object('success', true, 'action', 'unpublished', 'new_status', 'draft');
END;
$function$;
