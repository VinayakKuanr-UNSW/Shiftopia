-- Migration: Setup User Contracts System
-- Description: Creates the user_contracts table and updates the shift assignment system.

BEGIN;

-- 1. Create user_contracts table
CREATE TABLE IF NOT EXISTS public.user_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id),
    department_id UUID NOT NULL REFERENCES public.departments(id),
    sub_department_id UUID NOT NULL REFERENCES public.sub_departments(id),
    role_id UUID NOT NULL REFERENCES public.roles(id),
    remuneration_level_id UUID NOT NULL REFERENCES public.remuneration_levels(id),
    access_level TEXT NOT NULL CHECK (access_level IN ('Alpha', 'Beta', 'Gamma', 'Delta')),
    status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive', 'Terminated')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, organization_id, department_id, sub_department_id, role_id)
);

-- 2. Add user_contract_id to shifts table
-- This allows tracking exactly which contract/rate was used for a shift
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shifts' AND column_name = 'user_contract_id'
    ) THEN
        ALTER TABLE public.shifts ADD COLUMN user_contract_id UUID REFERENCES public.user_contracts(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 3. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_contracts_user_id ON public.user_contracts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_contracts_sub_dept ON public.user_contracts(sub_department_id);
CREATE INDEX IF NOT EXISTS idx_shifts_user_contract_id ON public.shifts(user_contract_id);

-- 4. Set up RLS for user_contracts
ALTER TABLE public.user_contracts ENABLE ROW LEVEL SECURITY;

-- Users can view their own contracts
CREATE POLICY "Users can view own contracts"
    ON public.user_contracts FOR SELECT
    USING (auth.uid() = user_id);

-- Delta level users can see everything
CREATE POLICY "Delta users can see all contracts"
    ON public.user_contracts FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.user_contracts
            WHERE user_id = auth.uid() 
            AND access_level = 'Delta'
            AND status = 'Active'
        )
    );

-- Gamma level users (Managers) can see contracts in their sub-department
CREATE POLICY "Gamma users can see sub-department contracts"
    ON public.user_contracts FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.user_contracts manager_c
            WHERE manager_c.user_id = auth.uid()
            AND manager_c.access_level = 'Gamma'
            AND manager_c.status = 'Active'
            AND manager_c.sub_department_id = public.user_contracts.sub_department_id
        )
    );

-- 5. Updated at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_contracts_updated_at
    BEFORE UPDATE ON public.user_contracts
    FOR EACH ROW
    EXECUTE PROCEDURE public.update_updated_at_column();

-- 6. Update Shift Assignment Policies for Multi-Contract Support
-- Gamma managers can only assign shifts within their sub-department
DROP POLICY IF EXISTS "Users can update shifts in their department" ON shifts;
CREATE POLICY "Managers can update shifts in their sub-department"
    ON public.shifts FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.user_contracts uc
            WHERE uc.user_id = auth.uid()
            AND uc.access_level IN ('Gamma', 'Delta')
            AND (uc.access_level = 'Delta' OR uc.sub_department_id = public.shifts.sub_department_id)
            AND uc.status = 'Active'
        )
    );

-- 7. Automated Contract Picker Trigger (Placeholder/Logic)
-- When a shift is assigned, we should try to link it to a valid contract automatically
CREATE OR REPLACE FUNCTION public.auto_link_shift_contract()
RETURNS TRIGGER AS $$
BEGIN
    -- Only try to link if employee_id is set but user_contract_id is not
    IF NEW.employee_id IS NOT NULL AND NEW.user_contract_id IS NULL THEN
        -- Find a contract that matches the employee, sub_department, and role
        -- Note: We assume NEW.employee_id matches profiles.id (auth.uid)
        SELECT id INTO NEW.user_contract_id
        FROM public.user_contracts
        WHERE user_id = (SELECT id FROM profiles WHERE id = NEW.employee_id OR employee_id = NEW.employee_id LIMIT 1) -- Support both ID types during transition
        AND sub_department_id = NEW.sub_department_id
        AND role_id = NEW.role_id
        AND status = 'Active'
        LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_auto_link_shift_contract
    BEFORE INSERT OR UPDATE OF employee_id ON public.shifts
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_link_shift_contract();

COMMIT;
