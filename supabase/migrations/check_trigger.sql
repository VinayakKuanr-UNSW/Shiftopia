-- Check if trigger exists
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'shifts';

-- Check if the trigger function exists
SELECT proname, prosrc 
FROM pg_proc 
WHERE proname = 'log_shift_change';

-- Test: Manually call the trigger function
-- First, let's see if we have any shifts at all
SELECT id, shift_date, assigned_employee_id, is_on_bidding, is_published, is_cancelled 
FROM shifts 
LIMIT 5;
