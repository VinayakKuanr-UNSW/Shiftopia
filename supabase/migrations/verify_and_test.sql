-- 1. Verify table exists with correct columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'shift_audit_events'
ORDER BY ordinal_position;

-- 2. Verify trigger exists
SELECT tgname, tgtype, tgenabled
FROM pg_trigger
WHERE tgrelid = 'shifts'::regclass
AND tgname = 'shifts_audit_trigger';

-- 3. Check if any shifts exist
SELECT id, shift_date, assigned_employee_id, is_on_bidding, is_published
FROM shifts
LIMIT 3;

-- 4. Test: Update a shift to fire the trigger
-- Pick a shift ID from the result above and run:
-- UPDATE shifts SET is_published = true WHERE id = 'YOUR_SHIFT_ID_HERE';

-- 5. Check if audit event was created
-- SELECT * FROM shift_audit_events ORDER BY created_at DESC LIMIT 5;
