-- Migration: Fix Cleanup Trigger to Clear Outcome
-- Description: Updates cleanup_offers_on_unassign to explicitly set assignment_outcome = NULL when a shift is unassigned.
-- This prevents the invalid state "Unassigned + Offered".

BEGIN;

CREATE OR REPLACE FUNCTION cleanup_offers_on_unassign()
RETURNS TRIGGER AS $$
BEGIN
    -- If assigned_employee_id was cleared (set to NULL) or changed
    IF OLD.assigned_employee_id IS NOT NULL AND 
       (NEW.assigned_employee_id IS NULL OR NEW.assigned_employee_id <> OLD.assigned_employee_id) THEN
        
        -- Cancel any pending offers for the OLD employee on this shift
        UPDATE shift_offers
        SET status = 'Cancelled'
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

-- Data Patch: Fix existing corrupt data
UPDATE shifts 
SET assignment_outcome = NULL 
WHERE assigned_employee_id IS NULL 
  AND assignment_outcome IS NOT NULL;

COMMIT;
