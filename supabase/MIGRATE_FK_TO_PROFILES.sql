-- ================================================================
-- Migration: Deprecate Employees Table -> Use Profiles
-- ================================================================
-- This script updates key tables to reference 'profiles' instead of 'employees'.
-- This aligns with the new architecture where 'employees' is deprecated.

-- 1. Helper function to safely drop FK if it exists
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN (
        SELECT tc.table_name, kcu.column_name, tc.constraint_name
        FROM information_schema.table_constraints tc 
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name 
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu 
          ON ccu.constraint_name = tc.constraint_name 
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' 
          AND ccu.table_name = 'employees'
          AND tc.table_name IN (
            'employee_licenses', 
            'employee_skills', 
            'employee_certifications', 
            'employee_performance_metrics', 
            'roster_shift_assignments',
            'shift_bids',
            'timesheets'
          )
    ) LOOP
        EXECUTE 'ALTER TABLE ' || quote_ident(r.table_name) || ' DROP CONSTRAINT ' || quote_ident(r.constraint_name);
        RAISE NOTICE 'Dropped constraint % from table %', r.constraint_name, r.table_name;
    END LOOP;
END $$;

-- 2. Clean up orphaned data before adding new constraints
-- (Ensure all referenced IDs exist in profiles)
DELETE FROM public.employee_licenses WHERE employee_id NOT IN (SELECT id FROM public.profiles);
DELETE FROM public.employee_skills WHERE employee_id NOT IN (SELECT id FROM public.profiles);
DELETE FROM public.employee_performance_metrics WHERE employee_id NOT IN (SELECT id FROM public.profiles);
DELETE FROM public.roster_shift_assignments WHERE employee_id NOT IN (SELECT id FROM public.profiles);

-- 3. Add new Foreign Keys referencing profiles
-- Note: We keep the column name 'employee_id' to minimize code breakage, but it points to profiles.

-- employee_licenses
ALTER TABLE public.employee_licenses
  ADD CONSTRAINT employee_licenses_profile_fkey 
  FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- employee_skills
ALTER TABLE public.employee_skills
  ADD CONSTRAINT employee_skills_profile_fkey 
  FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- employee_performance_metrics
ALTER TABLE public.employee_performance_metrics
  ADD CONSTRAINT employee_performance_metrics_profile_fkey 
  FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- roster_shift_assignments
ALTER TABLE public.roster_shift_assignments
  ADD CONSTRAINT roster_shift_assignments_profile_fkey 
  FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- employee_certifications (if exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employee_certifications') THEN
    DELETE FROM public.employee_certifications WHERE employee_id NOT IN (SELECT id FROM public.profiles);
    ALTER TABLE public.employee_certifications
      ADD CONSTRAINT employee_certifications_profile_fkey 
      FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- shift_bids (if exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shift_bids') THEN
    DELETE FROM public.shift_bids WHERE employee_id NOT IN (SELECT id FROM public.profiles);
    
    ALTER TABLE public.shift_bids
      ADD CONSTRAINT shift_bids_profile_fkey 
      FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Output
DO $$
BEGIN
  RAISE NOTICE 'Migration to profiles complete. Foreign keys updated.';
END $$;
