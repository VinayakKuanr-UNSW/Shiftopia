-- ================================================================
-- Fix RLS Policies for employee_licenses
-- ================================================================
-- Enabling proper delete permissions

ALTER TABLE public.employee_licenses ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to be safe
DROP POLICY IF EXISTS "Authenticated users can view employee licenses" ON public.employee_licenses;
DROP POLICY IF EXISTS "Authenticated users can manage employee licenses" ON public.employee_licenses;
DROP POLICY IF EXISTS "Authenticated users can update employee licenses" ON public.employee_licenses;
DROP POLICY IF EXISTS "Authenticated users can delete employee licenses" ON public.employee_licenses;

-- Create comprehensive policies
-- 1. View: All authenticated users can view licenses (or restrict to self/manager if needed)
CREATE POLICY "Authenticated users can view employee licenses"
  ON public.employee_licenses FOR SELECT TO authenticated USING (true);

-- 2. Insert: Authenticated users (managers/admins) can add licenses
CREATE POLICY "Authenticated users can manage employee licenses"
  ON public.employee_licenses FOR INSERT TO authenticated WITH CHECK (true);

-- 3. Update: Authenticated users can update licenses (e.g. expiry, status)
CREATE POLICY "Authenticated users can update employee licenses"
  ON public.employee_licenses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 4. Delete: Authenticated users can delete licenses (Fixing the reported issue)
CREATE POLICY "Authenticated users can delete employee licenses"
  ON public.employee_licenses FOR DELETE TO authenticated USING (true);

-- Output result
DO $$
BEGIN
  RAISE NOTICE 'RLS policies for employee_licenses updated.';
END $$;
