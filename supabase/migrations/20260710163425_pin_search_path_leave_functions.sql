-- ─────────────────────────────────────────────────────────────────────────────
-- Backfilled into version control 2026-08-02 from the PRODUCTION migration
-- ledger (supabase_migrations.schema_migrations @ version 20260710163425).
--
-- This migration was applied DIRECTLY to prod via the Supabase MCP during the
-- 2026-07-27/28 security & payroll audit and had no committed source file until
-- now. It is ALREADY APPLIED in prod — do not re-run against production.
-- Context: docs/investigations/2026-08-02_migration-reconciliation.md
-- ─────────────────────────────────────────────────────────────────────────────

-- Security lint follow-up (function_search_path_mutable): the leave module's
-- functions — two of them SECURITY DEFINER — ran with a mutable search_path,
-- exposing them to search-path hijacking. Pin explicitly. `hr` is included for
-- the accrual function's hr.user_contracts / hr.roles joins (they are also
-- schema-qualified in the body; the pin is defence in depth).
ALTER FUNCTION public.accrue_leave_balances() SET search_path = pg_catalog, public, hr;
ALTER FUNCTION public.deduct_leave_balance_on_approval() SET search_path = pg_catalog, public;
ALTER FUNCTION public.update_leave_balances_updated_at() SET search_path = pg_catalog, public;
