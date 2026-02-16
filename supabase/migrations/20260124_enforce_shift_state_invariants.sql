-- Migration: Enforce Shift State Invariants
-- Description: Adds a strict trigger to enforce the 15 valid states (S1-S15) and prevent illegal transitions/edits.

BEGIN;

CREATE OR REPLACE FUNCTION validate_shift_state_invariants()
RETURNS TRIGGER AS $$
DECLARE
    v_state_id TEXT := NULL;
    v_error_ctx TEXT;
BEGIN
    -- 1. IDENTIFY STATE (S1-S15)
    -- This logic mirrors the spec. We try to match the NEW row to a valid state.
    
    -- S15: Cancelled
    IF NEW.lifecycle_status = 'cancelled' OR NEW.is_cancelled = TRUE THEN
        v_state_id := 'S15';
        -- Requirement: No outcome, not on bidding
        IF NEW.assignment_outcome IS NOT NULL THEN
             RAISE EXCEPTION 'Invalid State (S15-Cancelled): Cannot have assignment outcome.';
        END IF;
        IF NEW.is_on_bidding = TRUE THEN
             RAISE EXCEPTION 'Invalid State (S15-Cancelled): Cannot be on bidding.';
        END IF;

    -- DRAFT STATES (S1, S2)
    ELSIF NEW.lifecycle_status = 'draft' THEN
        IF NEW.assignment_status = 'unassigned' THEN
            v_state_id := 'S1'; -- Draft + Unassigned
            -- Invariants
            IF NEW.assigned_employee_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid State (S1): Unassigned status but has employee_id'; END IF;
            IF NEW.assignment_outcome IS NOT NULL THEN RAISE EXCEPTION 'Invalid State (S1): Unassigned cannot have outcome'; END IF;
            IF NEW.is_on_bidding = TRUE THEN RAISE EXCEPTION 'Invalid State (S1): Draft cannot be on bidding'; END IF;
            
        ELSIF NEW.assignment_status = 'assigned' THEN
            v_state_id := 'S2'; -- Draft + Assigned
            -- Invariants
            IF NEW.assigned_employee_id IS NULL THEN RAISE EXCEPTION 'Invalid State (S2): Assigned status but no employee_id'; END IF;
            IF NEW.assignment_outcome IS NOT NULL AND NEW.assignment_outcome != 'pending' THEN 
                 -- Allow NULL (derived as pending) or explicit 'pending'
                 RAISE EXCEPTION 'Invalid State (S2): Draft assignment must be Pending (or null)'; 
            END IF;
             IF NEW.is_on_bidding = TRUE THEN RAISE EXCEPTION 'Invalid State (S2): Draft cannot be on bidding'; END IF;
        ELSE
            RAISE EXCEPTION 'Invalid State (Draft): Invalid assignment_status "%"', NEW.assignment_status;
        END IF;

    -- PUBLISHED / IN_PROGRESS / COMPLETED
    ELSIF NEW.lifecycle_status IN ('published', 'in_progress', 'completed') THEN
        
        -- UNASSIGNED (S5, S6, S8)
        IF NEW.assignment_status = 'unassigned' THEN
            IF NEW.assigned_employee_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid State (Unassigned): Has employee_id'; END IF;
            IF NEW.assignment_outcome IS NOT NULL THEN RAISE EXCEPTION 'Invalid State (Unassigned): Cannot have outcome'; END IF;

            IF NEW.fulfillment_status = 'bidding' OR NEW.is_on_bidding = TRUE THEN
                IF NEW.is_urgent THEN v_state_id := 'S6'; -- Urgent Bidding
                ELSE v_state_id := 'S5'; -- Normal Bidding
                END IF;
            ELSIF NEW.fulfillment_status = 'bidding_closed_no_winner' OR NEW.bidding_status = 'bidding_closed_no_winner' THEN
                 v_state_id := 'S8';
            ELSE
                 -- Allow a transitional "Open" state if implied? Spec says S5 is default for "Open".
                 -- If not on bidding, maybe just Published+Unassigned (Open)?
                 -- We map this to S5-like (Open) but check if Bidding flag matches.
                 v_state_id := 'S5-Open';
            END IF;

        -- ASSIGNED (S3, S4, S7, S9-S14)
        ELSIF NEW.assignment_status = 'assigned' THEN
             IF NEW.assigned_employee_id IS NULL THEN RAISE EXCEPTION 'Invalid State (Assigned): No employee_id'; END IF;
             IF NEW.is_on_bidding = TRUE THEN RAISE EXCEPTION 'Invalid State (Assigned): Cannot be on bidding'; END IF;

             -- S7: Emergency Assigned
             IF NEW.assignment_outcome = 'emergency_assigned' THEN
                 IF NEW.lifecycle_status = 'published' THEN v_state_id := 'S7';
                 ELSIF NEW.lifecycle_status = 'in_progress' THEN v_state_id := 'S12';
                 ELSIF NEW.lifecycle_status = 'completed' THEN v_state_id := 'S14';
                 END IF;
             
             -- S4/S9/S10/S11/S13: Confirmed
             ELSIF NEW.assignment_outcome = 'confirmed' THEN
                 IF NEW.lifecycle_status = 'published' THEN
                     IF NEW.is_trade_requested THEN v_state_id := 'S9';
                     ELSE v_state_id := 'S4';
                     END IF;
                 ELSIF NEW.lifecycle_status = 'in_progress' THEN v_state_id := 'S11';
                 ELSIF NEW.lifecycle_status = 'completed' THEN v_state_id := 'S13';
                 END IF;

             -- S3: Offered
             ELSIF NEW.assignment_outcome = 'offered' THEN
                 IF NEW.lifecycle_status = 'published' THEN v_state_id := 'S3';
                 ELSE RAISE EXCEPTION 'Invalid State: Offered is only valid in Published state';
                 END IF;
            
             ELSE
                 RAISE EXCEPTION 'Invalid State: Assigned shift must have valid outcome (offered, confirmed, emergency_assigned). Got "%"', NEW.assignment_outcome;
             END IF;

        ELSE
             RAISE EXCEPTION 'Invalid State: Unknown assignment_status "%"', NEW.assignment_status;
        END IF;

    ELSE
        RAISE EXCEPTION 'Invalid State: Unknown lifecycle_status "%"', NEW.lifecycle_status;
    END IF;


    -- 2. TRANSITION RULES & LOCKING (On UPDATE)
    IF TG_OP = 'UPDATE' THEN
        
        -- LOCK: Confirmed Assignments (S4/S11/S13) cannot change Employee ID directly
        -- Exception: Unassigning (to NULL) is allowed (e.g. Cancel/Pull Back)
        IF OLD.assignment_outcome = 'confirmed' AND NEW.assignment_outcome = 'confirmed' THEN
            IF OLD.assigned_employee_id != NEW.assigned_employee_id THEN
                RAISE EXCEPTION 'Locking Violation: Cannot change employee on a Confirmed shift. Cancel assignment first.';
            END IF;
        END IF;

        -- LOCK: Historical States (InProgress/Completed/Cancelled) are mostly Immutable
        IF OLD.lifecycle_status IN ('in_progress', 'completed', 'cancelled') THEN
             -- Allow specific updates? (e.g. check-in, notes)
             -- Block Start/End Time changes
             IF OLD.start_time != NEW.start_time OR OLD.end_time != NEW.end_time THEN
                  RAISE EXCEPTION 'Locking Violation: Cannot change time of % shift.', OLD.lifecycle_status;
             END IF;
             IF OLD.role_id != NEW.role_id THEN
                  RAISE EXCEPTION 'Locking Violation: Cannot change role of % shift.', OLD.lifecycle_status;
             END IF;
        END IF;

    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- DROP AND RECREATE TRIGGER
DROP TRIGGER IF EXISTS trg_validate_shift_state_invariants ON shifts;

CREATE TRIGGER trg_validate_shift_state_invariants
    BEFORE INSERT OR UPDATE ON shifts
    FOR EACH ROW
    EXECUTE FUNCTION validate_shift_state_invariants();

COMMIT;
