-- Fix Swap Visibility Issue
-- The issue is that the 'viewer' (Vinayak) cannot see the 'requester_shift' (Kurry's shift)
-- because the existing RLS policies on `shifts` only allow viewing your own shifts or if you have manager permissions.
-- We need to allow users to see shifts that are part of an OPEN swap request so they can evaluate the swap.

-- Policy: Allow authenticated users to view shifts that are part of an OPEN swap
-- Note: This is safe because the user must also be able to see the `shift_swaps` record itself 
-- (governed by its own RLS) for the EXISTS clause to return true.

CREATE POLICY "shifts_select_open_swaps" ON "public"."shifts"
AS PERMISSIVE FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM shift_swaps
    WHERE shift_swaps.requester_shift_id = shifts.id
    AND shift_swaps.status = 'OPEN'
  )
);

-- Additionally, we might need to see the target shift if it exists (for offered swaps), 
-- though the primary issue right now is the requester shift.
CREATE POLICY "shifts_select_offered_swaps" ON "public"."shifts"
AS PERMISSIVE FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM shift_swaps
    WHERE shift_swaps.target_shift_id = shifts.id
    AND shift_swaps.status IN ('OPEN', 'MANAGER_PENDING')
  )
);
