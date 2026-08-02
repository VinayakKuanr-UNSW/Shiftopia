-- ─────────────────────────────────────────────────────────────────────────────
-- Backfilled into version control 2026-08-02 from the PRODUCTION migration
-- ledger (supabase_migrations.schema_migrations @ version 20260727024158).
--
-- This migration was applied DIRECTLY to prod via the Supabase MCP during the
-- 2026-07-27/28 security & payroll audit and had no committed source file until
-- now. It is ALREADY APPLIED in prod — do not re-run against production.
-- Context: docs/investigations/2026-08-02_migration-reconciliation.md
-- ─────────────────────────────────────────────────────────────────────────────

-- P0 fix (payroll & compliance audit, 2026-07-27), finding C-5.
--
-- The most recent uncommitted lifecycle migration on this branch
-- (20260725011041_timesheet_lifecycle_triggers.sql) states explicitly:
-- "AutoPilot has been REMOVED from the module ... installs the
-- human-only lifecycle plumbing (no bot branches, no
-- app.timesheet.autopilot GUC)". The working tree matches that intent
-- (timesheetAutoPilot.api.ts deleted, TimesheetPage.tsx no longer
-- wires any AutoPilot control). But the live database did not match:
-- the auto-verify-timesheets edge function, its RPC, and a cron job
-- calling it every minute were all still active, held back only by
-- shadow_mode=true on the ICC Sydney policy row -- with no
-- application-level way left to see or toggle it after the UI removal.
--
-- This migration makes the live system match the branch's own stated
-- intent: disable the policy row (belt-and-suspenders alongside
-- shadow_mode) and stop the cron job that is the only thing that ever
-- invokes the auto-verify path. Nothing here changes current runtime
-- behaviour (shadow_mode already suppressed every decision), it only
-- removes the "one flag flip away from silent live auto-approval"
-- exposure.
--
-- Scope note: this intentionally does NOT touch the swap-approval
-- AutoPilot (auto-approve-swaps-tick / sm_swap_auto_decide). There is
-- no equivalent "removed" signal for that feature elsewhere in this
-- branch (the generic src/modules/core/autopilot/ module is still
-- being actively modified, matching the branch name
-- feat/autopilot-uniform-onoff), so retiring it would be an
-- unrelated, unrequested scope change.

UPDATE public.timesheet_approval_rules
SET enabled = false,
    updated_at = now()
WHERE enabled = true;

SELECT cron.unschedule('auto-verify-timesheets-tick');
