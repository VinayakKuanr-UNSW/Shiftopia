-- Test the trigger by manually updating a shift
-- First, get a shift ID
SELECT id, assigned_employee_id, is_on_bidding, is_published 
FROM shifts 
LIMIT 1;

-- Now update it to trigger the audit log
-- Replace 'YOUR_SHIFT_ID' with the actual ID from above
-- UPDATE shifts 
-- SET is_published = true 
-- WHERE id = 'YOUR_SHIFT_ID';

-- Then check if audit log was created
-- SELECT * FROM shift_audit_log WHERE shift_id = 'YOUR_SHIFT_ID';
