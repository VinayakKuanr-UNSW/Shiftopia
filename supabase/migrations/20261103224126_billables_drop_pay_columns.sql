-- ============================================================================
-- Migration: billables_drop_pay_columns
-- Purpose:
--   The 2026-11-02 split moved the retired payroll tables' pay fields onto
--   billables, whose read policy is timesheet.view OR payroll.view. Team Leads
--   (beta) hold timesheet.view but not payroll.view, so they could read pay —
--   which shift_payroll_records had refused them (CI: access-matrix
--   04_suites_by_level, B pay=. became pay=y).
--
--   Nothing reads or writes these nine columns: every row is NULL / '[]' and
--   pay is computed in the app (Gross Pay). Dropping them leaves billables
--   holding hours and review state only, which timesheet.view rightly covers.
-- ============================================================================

ALTER TABLE public.billables
  DROP COLUMN rate_level,
  DROP COLUMN employment_basis,
  DROP COLUMN base_rate,
  DROP COLUMN ordinary_hours,
  DROP COLUMN overtime_hours,
  DROP COLUMN penalty_amount,
  DROP COLUMN allowance_amount,
  DROP COLUMN gross_pay,
  DROP COLUMN lines;
