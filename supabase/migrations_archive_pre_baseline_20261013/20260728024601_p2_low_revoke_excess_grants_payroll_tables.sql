-- ─────────────────────────────────────────────────────────────────────────────
-- Backfilled into version control 2026-08-02 from the PRODUCTION migration
-- ledger (supabase_migrations.schema_migrations @ version 20260728024601).
--
-- This migration was applied DIRECTLY to prod via the Supabase MCP during the
-- 2026-07-27/28 security & payroll audit and had no committed source file until
-- now. It is ALREADY APPLIED in prod — do not re-run against production.
-- Context: docs/investigations/2026-08-02_migration-reconciliation.md
-- ─────────────────────────────────────────────────────────────────────────────

-- Audit L-13: eba_rate, eba_allowance, eba_trainee_schedule and
-- gross_pay_records all had GRANT ALL (INSERT/UPDATE/DELETE/TRUNCATE/
-- REFERENCES/TRIGGER/SELECT) to both anon and authenticated, correctly
-- backstopped by RLS today (eba_* have no write policy at all = default deny;
-- gross_pay_records' write policies require auth.role() = 'service_role') —
-- but "backstopped only by RLS" is one dropped/misedited policy away from a
-- real hole, matching the pattern already closed for other tables in the
-- 2026-07-19 remediation. Revoke down to what's actually needed:
--   * eba_rate / eba_allowance / eba_trainee_schedule: SELECT for
--     `authenticated` only (their own "Everyone can view EBA rates" policy is
--     genuinely meant to be world-readable-to-logged-in-users) — anon gets
--     nothing (no anon SELECT policy exists for these either).
--   * gross_pay_records: SELECT for `authenticated` only (their own policy
--     already scopes to `employee_id = auth.uid()`) — all writes are
--     service_role-only regardless of grant, so writes are revoked entirely
--     from anon/authenticated.
REVOKE ALL ON public.eba_rate FROM anon, authenticated;
GRANT SELECT ON public.eba_rate TO authenticated;

REVOKE ALL ON public.eba_allowance FROM anon, authenticated;
GRANT SELECT ON public.eba_allowance TO authenticated;

REVOKE ALL ON public.eba_trainee_schedule FROM anon, authenticated;
GRANT SELECT ON public.eba_trainee_schedule TO authenticated;

REVOKE ALL ON public.gross_pay_records FROM anon, authenticated;
GRANT SELECT ON public.gross_pay_records TO authenticated;
