-- ============================================================================
-- Close anonymous access on three tables left fully open to `public`.
--
-- BEFORE (verified in production 2026-08-09):
--   shift_bid_windows        | "Public Access"                       | ALL    | {public} | true
--   shift_offers             | "Enable read access for all users"    | SELECT | {public} | true
--   shift_offers             | "Enable insert for all users"         | INSERT | {public} | check true
--   shift_offers             | "Enable update for all users"         | UPDATE | {public} | true
--   roster_shift_assignments | "roster_assignments_select"           | SELECT | {public} | true
--
-- Role `public` includes `anon`, and all three tables additionally carry full
-- table grants to `anon` (SELECT/INSERT/UPDATE/DELETE). RLS is enabled on each,
-- but a `USING (true)` policy for `public` makes that irrelevant.
--
-- ── Actual severity: anonymous WRITE, not a data leak ───────────────────────
-- All three tables are empty (0 rows) and no frontend code references any of
-- them — `grep -r` across src/ returns nothing outside the generated
-- types.ts. So nothing is currently being disclosed.
--
-- The live risk is the other direction: anyone holding the publishable key can
-- INSERT into shift_bid_windows and shift_offers, and UPDATE shift_offers.
-- That is unbounded anonymous write access to the database. It is also a trap
-- for later — these tables are part of the bidding/offer model, and the day
-- something starts reading them, attacker-inserted rows become live data.
--
-- ── AFTER ───────────────────────────────────────────────────────────────────
--   shift_bid_windows        read: authenticated · write: manager (gamma+)
--   shift_offers             read/update: the offer recipient, or a manager
--                            insert/delete: manager only
--   roster_shift_assignments read: the assigned employee, or a manager
--                            (writes already gated — see the note below)
--
-- ── Why is_manager_or_above() ───────────────────────────────────────────────
-- It is the predicate this schema settled on (gamma+ certificate OR legacy
-- admin|manager), it reads `legacy_system_role` which exists, and it is STABLE
-- SECURITY DEFINER with a pinned search_path and an EXCEPTION guard. Same
-- choice as 20260809000200 for availability. is_admin() is NOT used: despite
-- the name it also returns true for managers, so it is a confusing spelling of
-- the same idea.
--
-- Server-side work is unaffected: service_role bypasses RLS by design.
--
-- ── Rollback ────────────────────────────────────────────────────────────────
-- Each block below is a drop-and-recreate; to revert, drop the new policies and
-- recreate the originals as listed in the BEFORE block.
-- ============================================================================

-- ── public.shift_bid_windows ────────────────────────────────────────────────
-- Per-shift bidding window. Readable by any signed-in user (the bidding UI will
-- need it when it is wired up); only managers may open, close or amend one.
drop policy if exists "Public Access" on public.shift_bid_windows;
revoke all on public.shift_bid_windows from anon;

create policy "bid_windows_select_authenticated" on public.shift_bid_windows
  for select to authenticated
  using (true);

create policy "bid_windows_write_manager" on public.shift_bid_windows
  for all to authenticated
  using (public.is_manager_or_above())
  with check (public.is_manager_or_above());

-- ── public.shift_offers ─────────────────────────────────────────────────────
-- `employee_id` is the offer recipient. A recipient may see and respond to
-- their own offer (UPDATE covers accept/decline via status/responded_at);
-- creating and withdrawing offers is a manager action.
drop policy if exists "Enable read access for all users" on public.shift_offers;
drop policy if exists "Enable insert for all users" on public.shift_offers;
drop policy if exists "Enable update for all users" on public.shift_offers;
revoke all on public.shift_offers from anon;

create policy "shift_offers_select_own_or_manager" on public.shift_offers
  for select to authenticated
  using (employee_id = (select auth.uid()) or public.is_manager_or_above());

create policy "shift_offers_update_own_or_manager" on public.shift_offers
  for update to authenticated
  using (employee_id = (select auth.uid()) or public.is_manager_or_above())
  with check (employee_id = (select auth.uid()) or public.is_manager_or_above());

create policy "shift_offers_insert_manager" on public.shift_offers
  for insert to authenticated
  with check (public.is_manager_or_above());

create policy "shift_offers_delete_manager" on public.shift_offers
  for delete to authenticated
  using (public.is_manager_or_above());

-- ── public.roster_shift_assignments ─────────────────────────────────────────
-- Only the blanket SELECT is replaced. The INSERT/UPDATE/DELETE policies are
-- left exactly as they are: they call auth_can_manage_rosters(), which is
-- broken for an unrelated reason (it reads profiles.system_role, a column that
-- does not exist) and is repaired separately in 20260809000600. Fixing both in
-- one migration would make it impossible to tell which change caused a
-- regression.
drop policy if exists "roster_assignments_select" on public.roster_shift_assignments;
revoke all on public.roster_shift_assignments from anon;

create policy "roster_assignments_select_own_or_manager" on public.roster_shift_assignments
  for select to authenticated
  using (employee_id = (select auth.uid()) or public.is_manager_or_above());

-- ── Verification (Supabase SQL Editor, after applying) ───────────────────────
--  (1) No policy should remain that targets {public} with a `true` qualifier:
--    select tablename, policyname, roles::text, cmd, qual
--    from pg_policies
--    where schemaname='public'
--      and tablename in ('shift_bid_windows','shift_offers','roster_shift_assignments');
--
--  (2) anon holds no grants on any of the three:
--    select table_name, grantee, privilege_type
--    from information_schema.role_table_grants
--    where table_schema='public' and grantee='anon'
--      and table_name in ('shift_bid_windows','shift_offers','roster_shift_assignments');
--
--  (3) A REST call with only the publishable key must now fail on all three
--      (was HTTP 200 for GET, and INSERT succeeded).
