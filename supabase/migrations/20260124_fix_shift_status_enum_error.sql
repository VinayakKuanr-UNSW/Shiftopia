-- Migration: Fix Shift Offer Status Constraint and Trigger
-- Description: 
-- 1. Updates shift_offers constraint to allow 'cancelled' (lowercase).
-- 2. Updates cleanup trigger to set status to 'cancelled' (lowercase) to avoid Enum/Check errors.

BEGIN;

-- 1. Update Check Constraint on shift_offers
ALTER TABLE shift_offers
DROP CONSTRAINT IF EXISTS shift_offers_status_check;

ALTER TABLE shift_offers
ADD CONSTRAINT shift_offers_status_check 
CHECK (status IN ('Pending', 'Accepted', 'Declined', 'cancelled', 'Cancelled'));
-- Allowing both cases temporarily to be safe, but preferring lowercase 'cancelled' for internal consistency.

-- 2. Update Cleanup Trigger to use lowercase 'cancelled'
CREATE OR REPLACE FUNCTION cleanup_offers_on_unassign()
RETURNS TRIGGER AS $$
BEGIN
    -- If assigned_employee_id was cleared (set to NULL) or changed
    IF OLD.assigned_employee_id IS NOT NULL AND 
       (NEW.assigned_employee_id IS NULL OR NEW.assigned_employee_id <> OLD.assigned_employee_id) THEN
        
        -- Cancel any pending offers for the OLD employee on this shift
        -- Use 'cancelled' (lowercase) to avoid potential Enum conflicts if casted
        UPDATE shift_offers
        SET status = 'cancelled'
        WHERE shift_id = NEW.id 
          AND employee_id = OLD.assigned_employee_id
          AND status = 'Pending';
          
        -- Also set fulfillment status back to unassigned if it was 'offered'
        IF NEW.fulfillment_status = 'offered' AND NEW.assigned_employee_id IS NULL THEN
            NEW.fulfillment_status := 'unassigned';
        END IF;

        -- FIX: Clear assignment_outcome as well if unassigned
        IF NEW.assigned_employee_id IS NULL THEN
            NEW.assignment_outcome := NULL;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
