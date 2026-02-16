-- Trigger to clean up shift_offers when a shift is unassigned
-- Migration: 20260123_trigger_cleanup_on_unassign.sql

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
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cleanup_offers_on_unassign ON shifts;

CREATE TRIGGER trg_cleanup_offers_on_unassign
    BEFORE UPDATE ON shifts
    FOR EACH ROW
    EXECUTE FUNCTION cleanup_offers_on_unassign();
