-- ==============================================================================
-- FIX: Bootstrap policy for initial contract creation
-- ==============================================================================
-- Problem: No one can create the first Delta contract because the INSERT policy
-- requires Delta access, but no one has Delta access yet.
-- 
-- Solution: Allow users with system_role = 'admin' in profiles to create contracts
-- ==============================================================================

-- Drop the existing INSERT policy
DROP POLICY IF EXISTS "Delta users can insert contracts" ON user_contracts;

-- Create a new INSERT policy that allows:
-- 1. Users with Delta access (via helper function)
-- 2. OR users with system_role = 'admin' in profiles (bootstrap)
CREATE POLICY "Authorized users can insert contracts"
    ON user_contracts FOR INSERT
    WITH CHECK (
        public.user_has_delta_access(auth.uid())
        OR
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.system_role = 'admin'
        )
    );

-- Also update the UPDATE and DELETE policies to allow admin bootstrap
DROP POLICY IF EXISTS "Delta users can update contracts" ON user_contracts;
DROP POLICY IF EXISTS "Delta users can delete contracts" ON user_contracts;

CREATE POLICY "Authorized users can update contracts"
    ON user_contracts FOR UPDATE
    USING (
        public.user_has_delta_access(auth.uid())
        OR
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.system_role = 'admin'
        )
    );

CREATE POLICY "Authorized users can delete contracts"
    ON user_contracts FOR DELETE
    USING (
        public.user_has_delta_access(auth.uid())
        OR
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.system_role = 'admin'
        )
    );

-- ==============================================================================
-- VERIFY your current user has admin role
-- ==============================================================================
-- Run: SELECT id, email, system_role FROM profiles WHERE id = auth.uid();
