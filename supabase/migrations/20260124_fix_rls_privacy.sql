-- Migration: Fix RLS Privacy Leak
-- Description: Drops the permissive 'Authenticated users can view all shifts' policy.
-- Ensures employees cannot see Draft shifts.

BEGIN;

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Authenticated users can view all shifts" ON shifts;

-- Ensure "Users view shifts scoped by contract" filters out drafts?
-- The existing policies might need tightening. 
-- "Users view shifts scoped by contract" allows viewing if assigned_employee_id = auth.uid().
-- We must ensure that even if assigned, if it's DRAFT, they shouldn't see it (unless they are a manager?).
-- Actually, if a shift is Draft + Assigned, it's usually planning. The employee shouldn't know yet.
-- SO we should add `AND is_published = true` to the employee visibility logic.

DROP POLICY IF EXISTS "Users view shifts scoped by contract" ON shifts;

CREATE POLICY "Users view shifts scoped by contract"
ON shifts
FOR SELECT
TO authenticated
USING (
  -- Managers/Admins can see everything (handled by separate policy? Or here?)
  -- Let's rely on specific Role checks or Policy "shifts_manage" for managers.
  -- But "Users view shifts scoped by contract" seems to target employees.
  
  -- Logic:
  -- 1. Manager Access: (via function or role check) -> See ALL
  -- 2. Employee Access:
  --    a. Assigned to me AND Published
  --    b. In my sub-department AND Published (for team view?)
  --    c. Open for bidding AND Published (often cross-department)
  
  -- Existing logic was:
  -- (user_has_delta_access(auth.uid()) OR (assigned_employee_id = auth.uid()) OR (sub_department_id IN ...))
  
  -- We simply append "AND (is_published = true OR user_has_delta_access(auth.uid()))"
  -- Assuming user_has_delta_access checks for Manager/Admin role.
  
  (
    -- Managers see everything (or scoped by access)
    user_has_delta_access(auth.uid()) 
  )
  OR
  (
    -- Employees see only PUBLISHED shifts
    is_published = true
    AND (
      -- Assigned to them
      assigned_employee_id = auth.uid()
      OR
      -- In their sub-department (for roster view)
      sub_department_id IN (
        SELECT uc.sub_department_id
        FROM user_contracts uc
        WHERE uc.user_id = auth.uid() AND uc.status = 'Active'
      )
    )
  )
);

COMMIT;
