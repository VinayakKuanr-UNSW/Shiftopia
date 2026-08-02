-- ─────────────────────────────────────────────────────────────────────────────
-- Backfilled into version control 2026-08-02 from the PRODUCTION migration
-- ledger (supabase_migrations.schema_migrations @ version 20260727225942).
--
-- This migration was applied DIRECTLY to prod via the Supabase MCP during the
-- 2026-07-27/28 security & payroll audit and had no committed source file until
-- now. It is ALREADY APPLIED in prod — do not re-run against production.
-- Context: docs/investigations/2026-08-02_migration-reconciliation.md
-- ─────────────────────────────────────────────────────────────────────────────

-- P1 fix (payroll & compliance audit, finding H-6, first-aid piece).
-- cl 28.2: a first-aid-qualified Team Member APPOINTED by the Employer to
-- perform First Aid duties on a shift is paid $0.56/ordinary hour. The
-- formula for this was already correct in the cost engine, but no data
-- source existed anywhere to say a given shift actually carries that
-- appointment, so the allowance never fired on live data.
--
-- Mirrors the existing `is_training` boolean-flag-on-shift pattern.
-- Deliberately NOT bundling a protein-spill (cl 28.3) data source in this
-- migration: that allowance is an ad-hoc per-incident event (an unplanned
-- cleanup during a shift), not a plannable per-shift duty like this one or
-- training, and forcing it onto this same boolean-flag model would be the
-- wrong shape — it needs its own incident-style capture, which is a
-- separate piece of product/UX work.

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS is_first_aid_duty boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN shifts.is_first_aid_duty IS
  'cl 28.2 -- true when the Employer has appointed the assigned employee to perform First Aid duties on this shift (requires the employee to independently hold a current first-aid qualification). Drives the $0.56/ordinary-hour allowance in the payroll cost engine.';
