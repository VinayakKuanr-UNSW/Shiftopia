-- ============================================================================
-- Repair public.auth_can_manage_rosters() — it references a column that does
-- not exist, so it raises instead of returning a boolean.
--
-- BEFORE (verified in production 2026-08-09):
--   CREATE FUNCTION public.auth_can_manage_rosters() RETURNS boolean
--     ... RETURN EXISTS (
--           SELECT 1 FROM public.profiles
--           WHERE id = auth.uid() AND system_role IN ('admin','manager'));
--
--   select public.auth_can_manage_rosters();
--   -- ERROR: 42703: column "system_role" does not exist
--
-- public.profiles has `legacy_system_role`; there is no `system_role` column.
-- The reference is unqualified, so it is not shadowed by anything — it is
-- simply wrong, and plpgsql only surfaces it when the statement is first
-- executed, which is why it survived in the schema.
--
-- ── Blast radius ────────────────────────────────────────────────────────────
-- Three policies call it, all on roster_shift_assignments:
--   roster_assignments_insert  (INSERT, with check)
--   roster_assignments_update  (UPDATE, using)
--   roster_assignments_delete  (DELETE, using)
--
-- Note this fails LOUD, not closed. A policy predicate that raises aborts the
-- statement, so these are not "deny by default" — every authenticated write to
-- roster_shift_assignments errors out with 42703. Only service_role, which
-- bypasses RLS entirely, can write the table today. That the breakage has gone
-- unnoticed is consistent with the table being empty and unreferenced by the
-- frontend.
--
-- ── Fix ─────────────────────────────────────────────────────────────────────
-- Delegate to is_manager_or_above() rather than re-implementing the check.
-- That function is the schema's settled definition of "manager or above"
-- (gamma+ certificate OR legacy admin|manager), reads the column that actually
-- exists, and carries the EXCEPTION guard that turns an unexpected failure into
-- `false` instead of an aborted statement.
--
-- Behaviour change, stated plainly: this is strictly more permissive than the
-- original *intent* (it also admits gamma/delta/epsilon certificate holders,
-- not just legacy admin|manager). It is a large change from the original
-- *effect*, which was to raise for everyone. Aligning on one predicate is the
-- point — three spellings of "manager" is how the missing column went unseen.
--
-- The signature is unchanged, so the three policies pick this up with no
-- further DDL.
--
-- ── Rollback ────────────────────────────────────────────────────────────────
-- Restore the previous body from the BEFORE block above (it will raise again).
-- ============================================================================

create or replace function public.auth_can_manage_rosters()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select public.is_manager_or_above();
$$;

revoke all on function public.auth_can_manage_rosters() from public;
revoke all on function public.auth_can_manage_rosters() from anon;
grant execute on function public.auth_can_manage_rosters() to authenticated;

-- ── Verification (Supabase SQL Editor, after applying) ───────────────────────
--   -- expect: a boolean, not ERROR 42703
--   select public.auth_can_manage_rosters();
--
--   -- expect: false for an ordinary employee, true for a manager, run under a
--   -- real JWT (SET ROLE authenticated + request.jwt.claims), because the MCP
--   -- connection is superuser/BYPASSRLS and auth.uid() is null there.
