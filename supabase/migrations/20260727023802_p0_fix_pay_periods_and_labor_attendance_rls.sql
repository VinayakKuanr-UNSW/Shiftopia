-- ─────────────────────────────────────────────────────────────────────────────
-- Backfilled into version control 2026-08-02 from the PRODUCTION migration
-- ledger (supabase_migrations.schema_migrations @ version 20260727023802).
--
-- This migration was applied DIRECTLY to prod via the Supabase MCP during the
-- 2026-07-27/28 security & payroll audit and had no committed source file until
-- now. It is ALREADY APPLIED in prod — do not re-run against production.
-- Context: docs/investigations/2026-08-02_migration-reconciliation.md
-- ─────────────────────────────────────────────────────────────────────────────

-- P0 security fix (payroll & compliance audit, 2026-07-27), findings
-- H-15 and M-15. Both policies were named/intended for admins or a
-- controlled clock flow but had an unconditional `true` predicate
-- for any authenticated user -- exactly the bug class the
-- 2026-07-19 remediation (rls_fix_always_true_sensitive_tables)
-- fixed elsewhere, missed on these two tables.

-- ---------------------------------------------------------------
-- H-15: pay_periods -- any authenticated user could create/modify
-- pay period boundaries and status, not just admins.
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage pay periods" ON public.pay_periods;
DROP POLICY IF EXISTS "Admins can update pay periods" ON public.pay_periods;

CREATE POLICY "Admins can manage pay periods" ON public.pay_periods
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update pay periods" ON public.pay_periods
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------
-- M-15: actual_labor_attendance -- an assigned-vs-present headcount
-- rollup table (event_id/role/time_slot/assigned/present -- no
-- per-employee identity column, so this is operational payroll-
-- adjacent staffing data, not personal attendance records) allowed
-- any authenticated user to insert rows, not just a manager or a
-- trusted system process. Scope writes the same way pay_periods now
-- is; leave the existing broad read policy in place (unflagged by
-- the audit, needed for reporting).
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "authenticated_insert_actual_labor_attendance" ON public.actual_labor_attendance;

CREATE POLICY "managers_insert_actual_labor_attendance" ON public.actual_labor_attendance
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager_or_above());
