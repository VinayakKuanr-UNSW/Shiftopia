-- ==============================================================================
-- UNIFIED USER SCHEMA MIGRATION
-- Consolidates: profiles, user_profiles, employees → profiles + user_contracts
-- ==============================================================================
-- Run this in Supabase SQL Editor
-- 
-- ARCHITECTURE:
--   auth.users (Supabase managed - DO NOT TOUCH)
--        ↓ 1:1
--   profiles (unified user data)
--        ↓ 1:many
--   user_contracts (roles, departments, access levels)
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- STEP 1: Ensure profiles table has all needed columns
-- ==============================================================================

-- Add missing columns from employees table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS middle_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Active';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS availability JSONB;

-- Note: full_name is a GENERATED column - it auto-populates from first_name + last_name

-- ==============================================================================
-- STEP 2: Migrate data from employees table to profiles (if not already linked)
-- ==============================================================================

-- For employees that exist but don't have a profile, we need to handle this
-- This is tricky because employees.id is NOT linked to auth.users.id
-- We'll create a mapping column temporarily

-- Add legacy_employee_id to profiles for mapping
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS legacy_employee_id UUID;

-- Update profiles with employee data based on email match
UPDATE profiles p
SET 
    middle_name = COALESCE(p.middle_name, e.middle_name),
    status = COALESCE(e.status, p.status, 'Active'),
    availability = COALESCE(e.availability, p.availability),
    legacy_employee_id = e.id
FROM employees e
WHERE LOWER(p.email) = LOWER(e.email);

-- ==============================================================================
-- STEP 3: Create user_contracts table
-- ==============================================================================

CREATE TABLE IF NOT EXISTS user_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Link to unified profiles (which links to auth.users)
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Organizational hierarchy
    organization_id UUID NOT NULL REFERENCES organizations(id),
    department_id UUID NOT NULL REFERENCES departments(id),
    sub_department_id UUID NOT NULL REFERENCES sub_departments(id),
    
    -- Position
    role_id UUID NOT NULL REFERENCES roles(id),
    rem_level_id UUID NOT NULL REFERENCES remuneration_levels(id),
    
    -- Access level (Alpha, Beta, Gamma, Delta)
    access_level TEXT NOT NULL DEFAULT 'Alpha' 
        CHECK (access_level IN ('Alpha', 'Beta', 'Gamma', 'Delta')),
    
    -- Contract status
    status TEXT NOT NULL DEFAULT 'Active' 
        CHECK (status IN ('Active', 'Inactive', 'Terminated')),
    
    -- Dates
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    
    -- Overrides
    custom_hourly_rate DECIMAL(10,2),
    notes TEXT,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    
    -- Prevent duplicate contracts
    UNIQUE(user_id, organization_id, department_id, sub_department_id, role_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_contracts_user_id ON user_contracts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_contracts_org ON user_contracts(organization_id);
CREATE INDEX IF NOT EXISTS idx_user_contracts_dept ON user_contracts(department_id);
CREATE INDEX IF NOT EXISTS idx_user_contracts_sub_dept ON user_contracts(sub_department_id);
CREATE INDEX IF NOT EXISTS idx_user_contracts_role ON user_contracts(role_id);
CREATE INDEX IF NOT EXISTS idx_user_contracts_active ON user_contracts(status) WHERE status = 'Active';

-- ==============================================================================
-- STEP 4: Add user_contract_id to shifts for payroll tracking
-- ==============================================================================

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS user_contract_id UUID REFERENCES user_contracts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_shifts_user_contract ON shifts(user_contract_id);

-- ==============================================================================
-- STEP 5: Updated_at trigger
-- ==============================================================================

CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_user_contracts ON user_contracts;
CREATE TRIGGER set_timestamp_user_contracts
    BEFORE UPDATE ON user_contracts
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

-- ==============================================================================
-- STEP 6: RLS Policies for user_contracts
-- ==============================================================================

ALTER TABLE user_contracts ENABLE ROW LEVEL SECURITY;

-- Users can view their own contracts
DROP POLICY IF EXISTS "Users can view own contracts" ON user_contracts;
CREATE POLICY "Users can view own contracts"
    ON user_contracts FOR SELECT
    USING (auth.uid() = user_id);

-- Delta (Admin) users can see ALL contracts
DROP POLICY IF EXISTS "Delta users can view all contracts" ON user_contracts;
CREATE POLICY "Delta users can view all contracts"
    ON user_contracts FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_contracts uc
            WHERE uc.user_id = auth.uid()
            AND uc.access_level = 'Delta'
            AND uc.status = 'Active'
        )
    );

-- Gamma (Manager) users can see contracts in their sub-department
DROP POLICY IF EXISTS "Gamma users can view sub_dept contracts" ON user_contracts;
CREATE POLICY "Gamma users can view sub_dept contracts"
    ON user_contracts FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_contracts manager_uc
            WHERE manager_uc.user_id = auth.uid()
            AND manager_uc.access_level = 'Gamma'
            AND manager_uc.status = 'Active'
            AND manager_uc.sub_department_id = user_contracts.sub_department_id
        )
    );

-- Delta users can manage all contracts
DROP POLICY IF EXISTS "Delta users can manage contracts" ON user_contracts;
CREATE POLICY "Delta users can manage contracts"
    ON user_contracts FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM user_contracts uc
            WHERE uc.user_id = auth.uid()
            AND uc.access_level = 'Delta'
            AND uc.status = 'Active'
        )
    );

-- ==============================================================================
-- STEP 7: Update shifts RLS to use contracts (scoped by sub-department)
-- ==============================================================================

DROP POLICY IF EXISTS "Users can view accessible shifts" ON shifts;
DROP POLICY IF EXISTS "Users view shifts scoped by contract" ON shifts;

CREATE POLICY "Users view shifts scoped by contract"
    ON shifts FOR SELECT
    USING (
        -- Delta = Global access
        EXISTS (
            SELECT 1 FROM user_contracts uc
            WHERE uc.user_id = auth.uid()
            AND uc.access_level = 'Delta'
            AND uc.status = 'Active'
        )
        OR
        -- Scoped access: user has a contract for this sub-department
        EXISTS (
            SELECT 1 FROM user_contracts uc
            WHERE uc.user_id = auth.uid()
            AND uc.sub_department_id = shifts.sub_department_id
            AND uc.status = 'Active'
        )
        OR
        -- Own shifts (assigned to this user via legacy employee_id or profiles mapping)
        shifts.assigned_employee_id IN (
            SELECT legacy_employee_id FROM profiles WHERE id = auth.uid()
        )
        OR shifts.assigned_employee_id = auth.uid()
    );

-- Managers can only update shifts in their sub-department
DROP POLICY IF EXISTS "Managers can update shifts in their sub-department" ON shifts;
CREATE POLICY "Managers can update shifts in their sub-department"
    ON shifts FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_contracts uc
            WHERE uc.user_id = auth.uid()
            AND uc.status = 'Active'
            AND (
                uc.access_level = 'Delta'
                OR (uc.access_level = 'Gamma' AND uc.sub_department_id = shifts.sub_department_id)
            )
        )
    );

-- ==============================================================================
-- STEP 8: Auto-link shift to contract on assignment
-- ==============================================================================

CREATE OR REPLACE FUNCTION auto_link_shift_to_contract()
RETURNS TRIGGER AS $$
BEGIN
    -- When a shift is assigned to an employee, find matching contract
    IF NEW.assigned_employee_id IS NOT NULL AND NEW.user_contract_id IS NULL THEN
        SELECT uc.id INTO NEW.user_contract_id
        FROM user_contracts uc
        WHERE (
            uc.user_id = NEW.assigned_employee_id 
            OR uc.user_id IN (SELECT id FROM profiles WHERE legacy_employee_id = NEW.assigned_employee_id)
        )
        AND uc.sub_department_id = NEW.sub_department_id
        AND uc.role_id = NEW.role_id
        AND uc.status = 'Active'
        LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_auto_link_shift_contract ON shifts;
CREATE TRIGGER tr_auto_link_shift_contract
    BEFORE INSERT OR UPDATE OF assigned_employee_id ON shifts
    FOR EACH ROW
    EXECUTE FUNCTION auto_link_shift_to_contract();

-- ==============================================================================
-- STEP 9: Drop user_profiles if it's redundant (profiles is the source of truth)
-- ==============================================================================

-- First, check if there's an existing view we need to preserve
-- We'll rename user_profiles to user_profiles_backup instead of dropping

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_profiles' AND table_schema = 'public') THEN
        -- Check if it's different from profiles
        IF EXISTS (
            SELECT 1 FROM user_profiles up
            WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = up.id)
        ) THEN
            RAISE NOTICE 'user_profiles has data not in profiles - keeping as backup';
            ALTER TABLE user_profiles RENAME TO user_profiles_legacy;
        ELSE
            RAISE NOTICE 'user_profiles is subset of profiles - safe to archive';
            ALTER TABLE user_profiles RENAME TO user_profiles_archived;
        END IF;
    END IF;
END $$;

-- ==============================================================================
-- STEP 10: Create a helper view for common queries
-- ==============================================================================

CREATE OR REPLACE VIEW user_contract_details AS
SELECT 
    uc.*,
    p.first_name,
    p.last_name,
    p.full_name,
    p.email,
    o.name AS organization_name,
    d.name AS department_name,
    sd.name AS sub_department_name,
    r.name AS role_name,
    rl.level_number,
    rl.level_name,
    rl.hourly_rate_min,
    rl.hourly_rate_max,
    rl.description AS rem_level_description
FROM user_contracts uc
JOIN profiles p ON p.id = uc.user_id
JOIN organizations o ON o.id = uc.organization_id
JOIN departments d ON d.id = uc.department_id
JOIN sub_departments sd ON sd.id = uc.sub_department_id
JOIN roles r ON r.id = uc.role_id
JOIN remuneration_levels rl ON rl.id = uc.rem_level_id;

COMMIT;

-- ==============================================================================
-- POST-MIGRATION: Manual steps required
-- ==============================================================================
-- 
-- 1. CREATE INITIAL CONTRACTS:
--    You need to manually create user_contracts for existing users.
--    Example:
--    
--    INSERT INTO user_contracts (user_id, organization_id, department_id, sub_department_id, role_id, rem_level_id, access_level)
--    SELECT 
--        p.id,
--        'your-org-uuid',
--        'your-dept-uuid', 
--        'your-subdept-uuid',
--        'your-role-uuid',
--        'your-remlevel-uuid',
--        'Alpha'  -- or Beta/Gamma/Delta
--    FROM profiles p
--    WHERE p.is_active = true;
--
-- 2. VERIFY DATA:
--    SELECT * FROM user_contract_details;
--
-- 3. UPDATE FRONTEND:
--    The AuthProvider already fetches user_contracts on login.
--
-- 4. CLEANUP (after testing):
--    DROP TABLE IF EXISTS employees;
--    DROP TABLE IF EXISTS user_profiles_archived;
--    ALTER TABLE profiles DROP COLUMN IF EXISTS legacy_employee_id;
--
-- ==============================================================================
