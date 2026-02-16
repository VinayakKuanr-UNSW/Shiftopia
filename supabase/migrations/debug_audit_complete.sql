-- ========================================
-- AUDIT TRAIL DEBUG QUERIES
-- Run these in order to diagnose the issue
-- ========================================

-- 1. Check if table exists and has correct structure
SELECT table_name, table_type 
FROM information_schema.tables 
WHERE table_name IN ('shift_audit_events', 'shift_audit_log');

-- 2. Check if trigger exists and is enabled
SELECT 
    tgname AS trigger_name,
    tgenabled AS enabled,
    pg_get_triggerdef(oid) AS trigger_definition
FROM pg_trigger
WHERE tgrelid = 'shifts'::regclass;

-- 3. Count rows in audit table (bypasses RLS)
SELECT COUNT(*) as total_events FROM shift_audit_events;

-- 4. If count > 0, show sample data (bypasses RLS)
SELECT 
    id,
    shift_id,
    event_type,
    event_category,
    performed_by_name,
    created_at
FROM shift_audit_events
ORDER BY created_at DESC
LIMIT 5;

-- 5. Check RLS policies
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies
WHERE tablename = 'shift_audit_events';

-- 6. Test RLS - see if authenticated user can read
-- (This simulates what your app would see)
SET LOCAL ROLE authenticated;
SELECT COUNT(*) as visible_to_authenticated FROM shift_audit_events;
RESET ROLE;

-- 7. Get a shift ID to test with
SELECT id, shift_date, is_published, assigned_employee_id, created_at
FROM shifts
ORDER BY created_at DESC
LIMIT 3;

-- 8. Manually test trigger (pick a shift ID from above)
-- Replace 'SHIFT_ID_HERE' with actual ID
-- UPDATE shifts 
-- SET is_published = NOT is_published 
-- WHERE id = 'SHIFT_ID_HERE';

-- 9. After updating, check if new audit event was created
-- SELECT * FROM shift_audit_events 
-- WHERE shift_id = 'SHIFT_ID_HERE'
-- ORDER BY created_at DESC;
