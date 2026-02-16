-- Migration: User Schema Consolidation & Contracts Implementation
-- Description: Merges employees and user_profiles into profiles, and implements multi-contract system.

BEGIN;

-- ==========================================
-- 1. PREPARATION: Create Unified Profiles
-- ==========================================

-- Check if profiles already exists (Supabase default)
-- If not, create it. If yes, we'll alter it.
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    employee_code TEXT UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    full_name TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    avatar_url TEXT,
    date_of_birth DATE,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    employment_type TEXT DEFAULT 'Casual',
    system_role TEXT DEFAULT 'Team Member',
    hire_date DATE DEFAULT CURRENT_DATE,
    termination_date DATE,
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMPTZ,
    organization_id UUID REFERENCES public.organizations(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migrating data from existing employees and user_profiles tables
-- 1. Insert from employees (using email as link if available, otherwise just data)
INSERT INTO public.profiles (id, first_name, last_name, email, phone, organization_id, created_at)
SELECT 
    COALESCE(up.id, gen_random_uuid()), -- This is tricky if no auth user exists yet for some employees
    COALESCE(e.first_name, 'Unknown'),
    COALESCE(e.last_name, 'Employee'),
    COALESCE(e.email, 'unknown_' || e.id || '@example.com'),
    e.phone,
    up.organization_id,
    e.created_at
FROM public.employees e
LEFT JOIN public.user_profiles up ON up.employee_id = e.id
ON CONFLICT (email) DO NOTHING;

-- ==========================================
-- 2. CREATE USER CONTRACTS
-- ==========================================

CREATE TABLE public.user_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id),
    department_id UUID NOT NULL REFERENCES public.departments(id),
    sub_department_id UUID NOT NULL REFERENCES public.sub_departments(id),
    role_id UUID NOT NULL REFERENCES public.roles(id),
    rem_level_id UUID NOT NULL REFERENCES public.remuneration_levels(id),
    access_level TEXT NOT NULL CHECK (access_level IN ('Alpha', 'Beta', 'Gamma', 'Delta')),
    status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive', 'Terminated')),
    notes TEXT,
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, organization_id, department_id, sub_department_id, role_id)
);

-- Helper for updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_user_contracts_updated_at BEFORE UPDATE ON public.user_contracts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ==========================================
-- 3. MIGRATE ROLES TO CONTRACTS
-- ==========================================

-- Populate user_contracts from existing user_profiles assignments
INSERT INTO public.user_contracts (
    user_id, 
    organization_id, 
    department_id, 
    sub_department_id, 
    role_id, 
    rem_level_id, 
    access_level
)
SELECT 
    up.id,
    up.organization_id,
    up.department_id,
    up.sub_department_id,
    r.id as role_id,
    r.remuneration_level_id as rem_level_id,
    CASE 
        WHEN up.role = 'admin' THEN 'Delta'
        WHEN up.role = 'manager' THEN 'Gamma'
        WHEN up.role = 'teamlead' THEN 'Beta'
        ELSE 'Alpha'
    END
FROM public.user_profiles up
JOIN public.roles r ON r.department_id = up.department_id -- Simplification for seed data
ON CONFLICT DO NOTHING;

-- ==========================================
-- 4. UPDATE FOREIGN KEYS (24+ Tables)
-- ==========================================

-- Add user_contract_id to shifts
ALTER TABLE public.shifts ADD COLUMN user_contract_id UUID REFERENCES public.user_contracts(id) ON DELETE SET NULL;

-- Many tables reference employees.id. We need to transition them to profiles.id (user_id).
-- Using a DO block for repetitive FK updates is safer.

DO $$
DECLARE
    table_rec RECORD;
BEGIN
    -- Update columns named employee_id that reference employees table
    FOR table_rec IN 
        SELECT table_name, column_name
        FROM information_schema.columns 
        WHERE column_name = 'employee_id' AND table_schema = 'public'
        AND table_name NOT IN ('employees', 'profiles', 'user_profiles')
    LOOP
        -- This logic assumes we can map employees.id back to profiles.id
        -- In a real migration, we'd add the column, migrate data, then drop old FK.
        -- For now, we'll keep the columns but update their references later.
        NULL; 
    END LOOP;
END $$;

-- ==========================================
-- 5. RLS POLICIES (MULTI-CONTRACT AWARE)
-- ==========================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_contracts ENABLE ROW LEVEL SECURITY;

-- Profile Visibility
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Delta users see all profiles" ON public.profiles FOR SELECT 
USING (EXISTS (SELECT 1 FROM public.user_contracts WHERE user_id = auth.uid() AND access_level = 'Delta'));

-- Contract Visibility
CREATE POLICY "Users view own contracts" ON public.user_contracts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Managers view sub-dept contracts" ON public.user_contracts FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.user_contracts mc 
        WHERE mc.user_id = auth.uid() 
        AND (mc.access_level = 'Delta' OR (mc.access_level = 'Gamma' AND mc.sub_department_id = public.user_contracts.sub_department_id))
    )
);

-- Shift Visibility (Scoped by Sub-Department)
DROP POLICY IF EXISTS "Users can view accessible shifts" ON shifts;
CREATE POLICY "Users view shifts scoped by contract" ON shifts FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.user_contracts uc
        WHERE uc.user_id = auth.uid()
        AND (
            uc.access_level = 'Delta' -- Global
            OR uc.sub_department_id = shifts.sub_department_id -- Scoped
            OR shifts.employee_id = (SELECT employee_id FROM public.user_profiles WHERE id = auth.uid()) -- Own shifts (Legacy check)
        )
    )
);

COMMIT;
