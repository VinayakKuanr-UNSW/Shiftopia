-- ─────────────────────────────────────────────────────────────────────────────
-- APPLIED TO PROD 2026-10-05 via the Supabase MCP (ledger version
-- 20261005125053). Do not re-run against production. Rollback-only dry-run:
-- before, an employee read all 537 licence rows in the organisation; after, only
-- their own 6. The org admin still reads 537; a sub-department lead (beta)
-- reads every licence in their sub-department.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- Licences carry work rights: `license_type = 'WorkRights'` rows hold visa
-- status and `has_restricted_work_limit`. 20261005070333 scoped reads to "shares
-- an organisation", which still let every employee read every colleague's visa
-- conditions. Reads are now limited to the employee and anyone with
-- `shift.view` over one of their active contracts (can_view_employee_schedule,
-- 20261005071543) — the people who assign, approve and review their shifts.
--
-- Callers checked: the manager-side readers (bid review's visa flag,
-- eligibility, roster loaders, Team Availability, the Users page) all run
-- under shift.view scope. The one employee-side cross-read is swap acceptance's
-- counterparty context (fetchV8EmployeeContext): it now sees no counterparty
-- licences, so is_student_visa falls back to false there — the same treatment
-- the counterparty's contract got in 20261005122256 — and the manager re-runs
-- compliance with full visibility at approval. Skills keep org-wide reads.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY employee_licenses_select ON public.employee_licenses;
CREATE POLICY employee_licenses_select ON public.employee_licenses
  FOR SELECT TO authenticated
  USING (public.can_view_employee_schedule(employee_id));
