-- ============================================================================
-- Timesheets — billable variance reasons (arrival + departure)
--
-- When a manager sets a billable start/end that varies from the roster (beyond
-- the ±5-min grace), they must record WHY. Stored per-side so payroll/audit can
-- report on paid-early / late-start / short / overtime decisions. Captured by
-- the timesheet editor; surfaced in the row + History.
-- ============================================================================

ALTER TABLE public.timesheets
  ADD COLUMN IF NOT EXISTS arrival_variance_reason   text,
  ADD COLUMN IF NOT EXISTS departure_variance_reason text;

COMMENT ON COLUMN public.timesheets.arrival_variance_reason IS
  'Manager-selected reason the billable START varies from the rostered start (payroll variance). Null when on-roster.';
COMMENT ON COLUMN public.timesheets.departure_variance_reason IS
  'Manager-selected reason the billable END varies from the rostered end (short / overtime). Null when on-roster.';
