-- First, let's check if data actually exists (this bypasses RLS)
-- Run this as postgres/service_role user
SELECT COUNT(*) FROM shift_audit_log;

-- Check what RLS policies exist
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'shift_audit_log';

-- Try to select data as authenticated user
SELECT * FROM shift_audit_log LIMIT 5;

-- Check if RLS is actually enabled
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname = 'shift_audit_log';
