-- ================================================================
-- Sync Profiles to Employees
-- ================================================================
-- This script safely inserts missing employee records for existing profiles
-- to prevent foreign key errors when adding licenses/contracts.

INSERT INTO public.employees (id, first_name, last_name, email, created_at, updated_at)
SELECT 
  id, 
  first_name, 
  last_name, 
  email,
  created_at,
  updated_at
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.employees e WHERE e.id = p.id
);

-- Output result
DO $$
DECLARE
  v_count integer;
BEGIN
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE ' synced % profiles to employees table', v_count;
END $$;
