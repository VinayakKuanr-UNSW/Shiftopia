
-- Migration 005a: Fix Invalid State Combinations & Trigger (No Transaction Block)

-- 1. Fix the Trigger Function to use correct Enum CASE (prevents "invalid input value" error)
CREATE OR REPLACE FUNCTION validate_shift_state_invariants()
RETURNS TRIGGER AS $$
BEGIN
    -- Only check on updates/inserts
    IF TG_OP = 'UPDATE' OR TG_OP = 'INSERT' THEN
        
        -- LOCK: Confirmed Assignments cannot change Employee ID directly
        -- Note: casting Enums to text if needed, but direct comparison usually works if Case matches.
        -- 'confirmed' is lower case in assignment_outcome enum.
        IF OLD.assignment_outcome = 'confirmed' AND NEW.assignment_outcome = 'confirmed' THEN
            IF OLD.assigned_employee_id IS DISTINCT FROM NEW.assigned_employee_id THEN
                 RAISE EXCEPTION 'Locking Violation: Cannot change employee on a Confirmed shift. Cancel assignment first.';
            END IF;
        END IF;

        -- LOCK: Historical States (Using correct TitleCase Enum values)
        -- 'InProgress', 'Completed', 'Cancelled'
        IF OLD.lifecycle_status IN ('InProgress', 'Completed', 'Cancelled') THEN
             IF OLD.start_time IS DISTINCT FROM NEW.start_time OR OLD.end_time IS DISTINCT FROM NEW.end_time THEN
                  RAISE EXCEPTION 'Locking Violation: Cannot change time of % shift.', OLD.lifecycle_status;
             END IF;
             IF OLD.role_id IS DISTINCT FROM NEW.role_id THEN
                  RAISE EXCEPTION 'Locking Violation: Cannot change role of % shift.', OLD.lifecycle_status;
             END IF;
        END IF;

    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Validate Trigger Exists (Re-enable if disabled)
-- Ensuring it is enabled so it protects future invariants, but we just fixed it so it won't crash updates.
ALTER TABLE shifts ENABLE TRIGGER trg_validate_shift_state_invariants;


-- 3. Data Remediation

-- Fix: Draft shifts with non-Pending outcome
UPDATE shifts
SET assignment_outcome = 'pending'
WHERE lifecycle_status = 'Draft'
  AND assignment_status = 'assigned'
  AND assignment_outcome NOT IN ('pending') 
  AND assignment_outcome IS NOT NULL;

-- Fix: Unassigned shifts with non-null outcome
UPDATE shifts
SET assignment_outcome = NULL
WHERE assignment_status = 'unassigned'
  AND assignment_outcome IS NOT NULL;

-- Fix: OnBidding shifts that are Assigned (should be Unassigned)
UPDATE shifts
SET 
  assignment_status = 'unassigned',
  assignment_outcome = NULL,
  assigned_employee_id = NULL
WHERE bidding_status IN ('on_bidding_normal', 'on_bidding_urgent')
  AND assignment_status = 'assigned';

-- Fix: InProgress/Completed shifts that are Unassigned (should be Cancelled)
UPDATE shifts
SET lifecycle_status = 'Cancelled'
WHERE lifecycle_status IN ('InProgress', 'Completed')
  AND assignment_status = 'unassigned';

-- Fix: Trading status on non-Confirmed shifts
UPDATE shifts
SET trading_status = 'NoTrade'
WHERE trading_status != 'NoTrade'
  AND (assignment_outcome != 'confirmed' OR assignment_outcome IS NULL);

-- Fix: Bidding status on Assigned shifts (except BiddingClosedNoWinner on Unassigned)
UPDATE shifts
SET bidding_status = 'not_on_bidding'
WHERE bidding_status IN ('on_bidding_normal', 'on_bidding_urgent')
  AND assignment_status = 'assigned';

-- Fix: Cancelled shifts - ensure clean state (Added required fields)
UPDATE shifts
SET 
  bidding_status = 'not_on_bidding',
  trading_status = 'NoTrade',
  assignment_outcome = NULL,
  assignment_status = 'unassigned',
  assigned_employee_id = NULL
WHERE lifecycle_status = 'Cancelled';
