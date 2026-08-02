-- Fix broken RLS SELECT policies on shift_payroll_records and shift_compliance_snapshots.
--
-- Both policies used: s.organization_id IN (SELECT s.organization_id FROM profiles WHERE profiles.id = auth.uid())
-- `profiles` has no organization_id column, so the inner "s.organization_id" silently resolved as a
-- correlated reference back to the OUTER `shifts s` alias (not a profiles column), collapsing the
-- entire check to "EXISTS(profiles row for auth.uid())" -- i.e. any authenticated user with a profile
-- could read ANY shift's payroll actuals / compliance snapshot, regardless of ownership or organization.
--
-- Replaced with the established self-or-manager idiom already used for equivalent sensitive per-employee
-- data elsewhere in this schema (see employee_performance_metrics.perf_metrics_self_or_manager_read).

BEGIN;

DROP POLICY IF EXISTS payroll_records_select ON public.shift_payroll_records;

CREATE POLICY payroll_records_self_or_manager_select ON public.shift_payroll_records
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.shifts s
    WHERE s.id = shift_payroll_records.shift_id
      AND s.assigned_employee_id = auth.uid()
  )
  OR is_manager_or_above()
);

DROP POLICY IF EXISTS compliance_snapshots_select ON public.shift_compliance_snapshots;

CREATE POLICY compliance_snapshots_self_or_manager_select ON public.shift_compliance_snapshots
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.shifts s
    WHERE s.id = shift_compliance_snapshots.shift_id
      AND s.assigned_employee_id = auth.uid()
  )
  OR is_manager_or_above()
);

COMMIT;
