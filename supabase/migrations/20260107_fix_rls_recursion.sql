-- ==============================================================================
-- FIX: Infinite Recursion in user_contracts RLS Policies
-- ==============================================================================
-- The original policies checked user_contracts to see if the user has Delta access,
-- but that creates infinite recursion. This fix uses SECURITY DEFINER functions.
-- ==============================================================================

-- First, drop the problematic policies
DROP POLICY IF EXISTS "Users can view own contracts" ON user_contracts;
DROP POLICY IF EXISTS "Delta users can view all contracts" ON user_contracts;
DROP POLICY IF EXISTS "Gamma users can view sub_dept contracts" ON user_contracts;
DROP POLICY IF EXISTS "Delta users can manage contracts" ON user_contracts;

-- Create a SECURITY DEFINER function to check if user has Delta access
-- This bypasses RLS when checking, avoiding the recursion
CREATE OR REPLACE FUNCTION public.user_has_delta_access(check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_contracts
        WHERE user_id = check_user_id
        AND access_level = 'Delta'
        AND status = 'Active'
    );
$$;

-- Create a function to check if user has Gamma access for a specific sub-department
CREATE OR REPLACE FUNCTION public.user_has_gamma_access_for_subdept(check_user_id UUID, check_subdept_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_contracts
        WHERE user_id = check_user_id
        AND access_level = 'Gamma'
        AND status = 'Active'
        AND sub_department_id = check_subdept_id
    );
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.user_has_delta_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_gamma_access_for_subdept(UUID, UUID) TO authenticated;

-- ==============================================================================
-- Recreate RLS Policies using the helper functions
-- ==============================================================================

-- 1. Users can always view their own contracts
CREATE POLICY "Users can view own contracts"
    ON user_contracts FOR SELECT
    USING (auth.uid() = user_id);

-- 2. Delta users can view ALL contracts (using helper function to avoid recursion)
CREATE POLICY "Delta users can view all contracts"
    ON user_contracts FOR SELECT
    USING (public.user_has_delta_access(auth.uid()));

-- 3. Gamma users can view contracts in their managed sub-departments
CREATE POLICY "Gamma users can view sub_dept contracts"
    ON user_contracts FOR SELECT
    USING (public.user_has_gamma_access_for_subdept(auth.uid(), sub_department_id));

-- 4. Delta users can INSERT/UPDATE/DELETE all contracts
CREATE POLICY "Delta users can insert contracts"
    ON user_contracts FOR INSERT
    WITH CHECK (public.user_has_delta_access(auth.uid()));

CREATE POLICY "Delta users can update contracts"
    ON user_contracts FOR UPDATE
    USING (public.user_has_delta_access(auth.uid()));

CREATE POLICY "Delta users can delete contracts"
    ON user_contracts FOR DELETE
    USING (public.user_has_delta_access(auth.uid()));

-- ==============================================================================
-- Also fix the shifts policy if it has the same issue
-- ==============================================================================

DROP POLICY IF EXISTS "Users view shifts scoped by contract" ON shifts;
DROP POLICY IF EXISTS "Managers can update shifts in their sub-department" ON shifts;

-- Recreate shifts SELECT policy
CREATE POLICY "Users view shifts scoped by contract"
    ON shifts FOR SELECT
    USING (
        -- Delta = Global access (using helper function)
        public.user_has_delta_access(auth.uid())
        OR
        -- User's own shifts
        assigned_employee_id = auth.uid()
        OR
        -- Scoped access via contracts (using a subquery that won't recurse)
        sub_department_id IN (
            SELECT uc.sub_department_id 
            FROM user_contracts uc 
            WHERE uc.user_id = auth.uid() 
            AND uc.status = 'Active'
        )
    );

-- Recreate shifts UPDATE policy
CREATE POLICY "Managers can update shifts in their sub-department"
    ON shifts FOR UPDATE
    USING (
        public.user_has_delta_access(auth.uid())
        OR
        public.user_has_gamma_access_for_subdept(auth.uid(), sub_department_id)
    );

-- ==============================================================================
-- VERIFY: Check that policies are correctly created
-- ==============================================================================
-- Run: SELECT * FROM pg_policies WHERE tablename = 'user_contracts';
