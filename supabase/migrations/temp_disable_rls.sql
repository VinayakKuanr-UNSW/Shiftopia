-- TEMPORARY: Disable RLS to test if data exists
-- WARNING: This makes the table publicly readable! Only for testing!
ALTER TABLE shift_audit_log DISABLE ROW LEVEL SECURITY;

-- Now check the data
SELECT * FROM shift_audit_log LIMIT 10;
