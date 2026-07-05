-- =====================================================================
-- Security: tighten assignment_snapshots RLS (restrict employee work history).
-- =====================================================================
-- Previously USING (true), which exposed historical employee work data globally
-- to any authenticated user. This tightens it so snapshots are visible only if:
-- 1. You are the employee on the snapshot (employee_id = auth.uid()).
-- 2. You have visibility into the underlying shift (via `shifts` RLS, which 
--    enforces ORG/DEPT/SUBDEPT manager RBAC and bidding/swap scopes).
-- =====================================================================

DROP POLICY IF EXISTS "Authenticated users can view assignment snapshots"
    ON public.assignment_snapshots;

CREATE POLICY "Authenticated users can view assignment snapshots"
    ON public.assignment_snapshots
    FOR SELECT TO authenticated
    USING (
        employee_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.shifts s
            WHERE s.id = assignment_snapshots.shift_id
        )
    );
