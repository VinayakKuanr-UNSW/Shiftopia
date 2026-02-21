-- Reproduction Script for Swap Visibility Issue
-- Run this in Supabase SQL Editor

-- 1. Variables
-- Vinayak (Viewer)
DO $$
DECLARE
    v_viewer_id uuid := 'c2bc29d0-9c5c-4384-886a-10350a3fd4c9';
    v_requester_id uuid := 'be8b6a39-6552-409d-8a5b-f00862273a9d'; -- Kurry Admin
    v_swap_id uuid := 'aa0a9d24-660e-410c-9564-224c382bbd0b';
    v_shift_id uuid;
    v_shift_org_id uuid;
    v_count int;
BEGIN
    -- Get the shift ID from the swap
    SELECT requester_shift_id INTO v_shift_id FROM shift_swaps WHERE id = v_swap_id;
    
    RAISE NOTICE 'Testing visibility for Viewer: %, Target Shift: %', v_viewer_id, v_shift_id;

    -- 2. Test Direct Select as System (Bypass RLS)
    SELECT organization_id INTO v_shift_org_id FROM shifts WHERE id = v_shift_id;
    RAISE NOTICE 'System View - Shift Exists: %, Org: %', (v_shift_id IS NOT NULL), v_shift_org_id;

    -- 3. Test Select as Viewer (Simulate RLS)
    -- Note: We can't easily SET ROLE in this block without being superuser, 
    -- but we can check if a policy exists or use a view if available.
    -- Instead, we'll check the policies definition directly.
    
    RAISE NOTICE '--- Checking Policies on Shifts ---';
END $$;

SELECT * FROM pg_policies WHERE tablename = 'shifts';
