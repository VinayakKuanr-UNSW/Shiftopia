
-- Migration 014: Implement Time Transition RPC (No Transaction Block)

CREATE OR REPLACE FUNCTION process_shift_time_transitions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Start Shifts (Published -> InProgress)
  -- Condition: Start Time Reached, End Time Not Reached, Assigned, Published
  -- Note: We only transition Assigned shifts because S11/S12 require assignment.
  -- Unassigned shifts past start time technically become invalid/missed (handled separately or manual cancel).
  UPDATE shifts
  SET 
    lifecycle_status = 'InProgress',
    updated_at = NOW()
  WHERE lifecycle_status = 'Published'
    AND assignment_status = 'assigned'
    AND (shift_date || ' ' || start_time)::timestamp at time zone COALESCE(timezone, 'Australia/Sydney') <= NOW()
    AND (shift_date || ' ' || end_time)::timestamp at time zone COALESCE(timezone, 'Australia/Sydney') > NOW();

  -- 2. Complete Shifts (InProgress -> Completed)
  -- Condition: End Time Reached, InProgress
  UPDATE shifts
  SET 
    lifecycle_status = 'Completed',
    updated_at = NOW()
  WHERE lifecycle_status = 'InProgress'
    AND (shift_date || ' ' || end_time)::timestamp at time zone COALESCE(timezone, 'Australia/Sydney') <= NOW();

  -- 3. Complete Shifts that skipped InProgress (Published -> Completed)
  -- Condition: End Time Reached, Assigned, Published
  UPDATE shifts
  SET 
    lifecycle_status = 'Completed',
    updated_at = NOW()
  WHERE lifecycle_status = 'Published'
    AND assignment_status = 'assigned'
    AND (shift_date || ' ' || end_time)::timestamp at time zone COALESCE(timezone, 'Australia/Sydney') <= NOW();

END;
$$;
