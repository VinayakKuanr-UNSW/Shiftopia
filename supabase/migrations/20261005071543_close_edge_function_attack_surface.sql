-- ─────────────────────────────────────────────────────────────────────────────
-- APPLIED TO PROD 2026-10-05 via the Supabase MCP (ledger version
-- 20261005071543). Do not re-run against production. Helper dry-run
-- beforehand: employee self=true, employee->colleague=false, org manager->
-- employee=true, no user=false.
-- ─────────────────────────────────────────────────────────────────────────────

-- 2026-10-05 edge-function audit.
--
-- 1. can_view_employee_schedule(): the authorisation question the
--    evaluate-compliance edge function now asks before reporting anything
--    about an employee — yourself, or `shift.view` over one of that employee's
--    active contracts (exactly who can already see their shifts under RLS).
--    The function previously ran with the service role and NO authentication
--    (verify_jwt off): anyone on the internet could read any employee's weekly
--    hours, schedule overlaps, rest status and licence expiries.
--
-- 2. autoschedule_sessions / autoschedule_assignments had `ALL ... USING true
--    WITH CHECK true` for every signed-in user. With the unauthenticated
--    autoschedule-commit edge function (service role, writes shifts directly,
--    bypassing sm_apply_shift_op), any employee could write their own
--    simulation_result and have it committed — assigning anyone to any open
--    shift with no compliance or FSM check. The edge-function autoscheduler has
--    zero UI entry points in this app or the almond fork, both tables hold 0
--    rows, and the only SQL reader (delete_user_entirely) is SECURITY DEFINER.
--    Close them to everything but the service role; the edge functions are
--    retired separately.

CREATE FUNCTION public.can_view_employee_schedule(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
       p_employee_id = auth.uid()
    OR EXISTS (
         SELECT 1 FROM public.user_contracts uc
          WHERE uc.user_id = p_employee_id
            AND uc.status = 'Active'
            AND public.user_has_action_in_scope('shift.view', uc.organization_id, uc.department_id, uc.sub_department_id))
  );
$$;

DROP POLICY autoschedule_sessions_authenticated    ON public.autoschedule_sessions;
DROP POLICY autoschedule_assignments_authenticated ON public.autoschedule_assignments;
REVOKE ALL ON public.autoschedule_sessions, public.autoschedule_assignments FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.can_view_employee_schedule(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_employee_schedule(uuid) TO authenticated, service_role;
