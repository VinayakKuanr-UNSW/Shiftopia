-- Quick fix: Drop and recreate the RLS policy
DROP POLICY IF EXISTS "Authenticated users can view audit logs" ON shift_audit_log;

CREATE POLICY "Authenticated users can view audit logs" ON shift_audit_log
    FOR SELECT
    USING (auth.uid() IS NOT NULL);
