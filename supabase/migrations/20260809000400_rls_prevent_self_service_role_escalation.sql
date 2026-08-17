-- ============================================================================
-- Prevent self-service privilege escalation on public.profiles.
--
-- BEFORE (verified in production 2026-08-09):
--   profiles | profiles_update_own | UPDATE | {authenticated}
--            | USING  ((SELECT auth.uid()) = id)
--            | CHECK  ((SELECT auth.uid()) = id)
--
-- The policy is row-scoped but not COLUMN-scoped, so an authenticated user may
-- UPDATE any column of their own row — including `legacy_system_role`.
--
-- That column is the system's authority check. Both live predicates read it:
--   is_admin()            -> legacy_system_role IN ('admin','manager')  [+ zeta/epsilon cert]
--   is_manager_or_above() -> legacy_system_role IN ('admin','manager')  [+ gamma..zeta cert]
--
-- So a single self-UPDATE promotes any logged-in user to administrator, and
-- every policy and RPC gated on those two functions then admits them. This is
-- reachable from the browser with the publishable key and an ordinary login.
--
-- ── Fix ─────────────────────────────────────────────────────────────────────
-- An RLS policy cannot compare NEW to OLD, so the invariant is enforced with a
-- BEFORE UPDATE trigger: `legacy_system_role` may only change when the caller
-- is a *true* administrator — the `admin` system role or an active `zeta`
-- certificate — or a trusted server-side `service_role`.
--
-- Managers and gamma/delta/epsilon holders are deliberately excluded. They pass
-- is_manager_or_above() for scheduling work, but assigning system roles is an
-- administrator action; letting a manager grant `admin` would reintroduce the
-- same escalation one step removed.
--
-- ── Why a trigger and not a narrowed policy ─────────────────────────────────
-- Postgres has no column-level RLS. Revoking column UPDATE from `authenticated`
-- was rejected as the primary fix because the app updates `preferences` and
-- profile fields through the same role, and a column grant list silently drifts
-- as columns are added. The trigger states the invariant once, in terms of the
-- thing being protected.
--
-- SECURITY DEFINER with a pinned search_path, matching the is_admin()
-- convention already in this schema. Idempotent; safe to re-run.
--
-- ── Rollback ────────────────────────────────────────────────────────────────
--   drop trigger if exists trg_enforce_role_change_authority on public.profiles;
--   drop function if exists public.enforce_role_change_authority();
-- ============================================================================

create or replace function public.enforce_role_change_authority()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if new.legacy_system_role is distinct from old.legacy_system_role then
    -- Enforce only against a request that carries a JWT.
    --
    -- Direct database access (SQL editor, migrations, psql) is already
    -- privileged and has no JWT, so auth.uid() is NULL there and every check
    -- below would fail — the reference version has exactly that flaw and locks
    -- the DBA out of role administration permanently.
    --
    -- Do NOT try to detect this with current_user: inside a SECURITY DEFINER
    -- function current_user is always the function OWNER (postgres), so any
    -- `current_user <> 'postgres'` guard is dead code that disables the whole
    -- trigger. (Verified the hard way — it let a team_member self-promote.)
    --
    -- Skipping the no-JWT path is safe because it is not reachable from the
    -- API: PostgREST without a JWT is `anon`, and the profiles_update_own
    -- policy requires auth.uid() = id, which no anon request can satisfy. RLS
    -- covers that path; this trigger covers the authenticated one.
    if auth.uid() is not null
       and coalesce(auth.role(), '') <> 'service_role'
       and not exists (
         select 1 from public.profiles p
         where p.id = auth.uid()
           and p.legacy_system_role = 'admin'
       )
       and not exists (
         select 1 from public.app_access_certificates c
         where c.user_id = auth.uid()
           and c.access_level = 'zeta'
           and c.is_active = true
       )
    then
      raise exception 'Not authorised to change the system role'
        using errcode = '42501',
              hint = 'Role changes are administrator-controlled (admin / zeta).';
    end if;
  end if;
  return new;
end;
$$;

-- The function reads profiles under SECURITY DEFINER; it must not be callable
-- directly by clients. (Supabase grants EXECUTE to PUBLIC *and* implicitly to
-- authenticated on new functions — revoke both, per the pattern established in
-- 20260809000300.)
revoke all on function public.enforce_role_change_authority() from public;
revoke all on function public.enforce_role_change_authority() from anon;
revoke all on function public.enforce_role_change_authority() from authenticated;

drop trigger if exists trg_enforce_role_change_authority on public.profiles;
create trigger trg_enforce_role_change_authority
  before update on public.profiles
  for each row
  execute function public.enforce_role_change_authority();

-- ── Verification (run as an ordinary authenticated user, NOT the MCP/superuser
--    connection, which is BYPASSRLS and also skips nothing here — the trigger
--    fires for every role, so test the *authority* branch with a real JWT) ───
--
--   -- expect: ERROR 42501 "Not authorised to change the system role"
--   update public.profiles set legacy_system_role = 'admin' where id = auth.uid();
--
--   -- expect: success (no role column touched)
--   update public.profiles set preferences = preferences where id = auth.uid();
