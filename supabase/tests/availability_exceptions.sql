-- ============================================================================
-- Availability exceptions — constraints + RLS harness
-- ============================================================================
--
-- Pins migration 20260817000100_availability_exceptions.sql: the subtractive
-- half of the availability model, and the first producer the solver's
-- `availability_overrides` channel has ever had.
--
-- The properties worth pinning:
--   * an employee may set SOFT / PREFERENCE on THEMSELVES and nothing else —
--     HARD is a pre-filter block at the same tier as approved leave, consumes
--     no balance, and leaves no record of having been granted, so it is
--     manager-only;
--   * that check applies on UPDATE as well as INSERT, or a PREFERENCE row
--     could simply be escalated to HARD after the fact;
--   * deletion stays open to the owner: withdrawing a restriction on yourself
--     only ever widens when you can be rostered;
--   * the unique index covers the UNDATED case via COALESCE — a plain index
--     over a nullable column would let two "every day" rows through, since
--     NULL <> NULL, and two SOFT rows on one window cost 10000c rather than
--     the 5000c the employee asked for.
--
-- TESTING RLS: the role must actually be switched, and `SET LOCAL` outside an
-- explicit transaction is a NO-OP in psql (each statement gets its own
-- implicit transaction), so a harness written with SET LOCAL silently runs as
-- the table owner and every policy assertion is a false pass. This file uses
-- session-level SET / RESET ROLE.
--
-- HOW TO RUN (throwaway container — never point this at a real database):
--
--   docker run -d --name exceptions-pg -e POSTGRES_PASSWORD=pw postgres:17
--   docker exec -i exceptions-pg psql -U postgres -v ON_ERROR_STOP=1 -q \
--     < supabase/tests/availability_exceptions.sql
--   docker rm -f exceptions-pg
--
-- Expected tail: "ALL EXCEPTION TESTS PASSED", 16 `ok` notices, no ERROR.
-- ============================================================================

-- ── Schema stub ─────────────────────────────────────────────────────────────
create table public.profiles (id uuid primary key default gen_random_uuid());
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create or replace function public.is_manager_or_above() returns boolean language sql stable as $$ select coalesce(current_setting('test.is_manager', true) = 'on', false) $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated login; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
grant usage on schema public to authenticated, anon;

-- ── The migration under test ──────────────────────────────────────────────

-- Availability Exceptions
-- =======================
-- The employee-facing half of `availability_overrides` — the solver channel
-- that has existed, fully implemented, since the optimizer was written and has
-- never had a single producer.
--
-- WHAT IT IS FOR. Permanents are regulated by their leave, not by an offer of
-- availability, so the one thing they genuinely need to express on the
-- availability page is the EXCEPTION: "I have a medical appointment on the
-- 4th", "please don't roster me nights in September", "Tuesday afternoons I'm
-- at study". None of those are leave — no balance is consumed, no approval is
-- owed — and none of them can be said today.
--
-- WHY IT IS NOT AVAILABILITY. Saying it through `availability_rules` would
-- require declaring every hour you CAN work in order to carve out the hours you
-- cannot, and under HC-5d full containment a too-narrow declaration silently
-- un-rosters you. Five full-timers in production are in exactly that state from
-- a 2-hour seeded window. An exception is subtractive by construction, so it
-- cannot cause that failure.
--
-- ── SEVERITY, AND WHY EMPLOYEES CANNOT SET 'HARD' ───────────────────────────
--   PREFERENCE  1000c — a nudge. Self-service.
--   SOFT        5000c — routed around unless coverage is worth more. Self-service.
--   HARD        pre-filter block, the same tier as approved leave. NOT
--               self-service: it removes the person from consideration
--               outright, which is a decision the employer has to make, and
--               unlike leave it consumes no balance and leaves no audit trail
--               of having been granted. Manager-only, enforced in RLS below.
--
-- Everything here is additive. Nothing reads these rows until
-- `RosterFetcher.fetchAvailabilityExceptions` does, and an empty table produces
-- an empty override list, which is what the solver already receives today.

CREATE TABLE IF NOT EXISTS public.availability_exceptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- NULL = every day in the horizon. A recurrence beyond that is deliberately
  -- not modelled: `availability_rules` already owns recurrence, and a second
  -- expansion engine is how the two would drift.
  exception_date  date,
  start_time      time NOT NULL,
  end_time        time NOT NULL,

  severity        text NOT NULL DEFAULT 'SOFT',
  reason          text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  CONSTRAINT availability_exceptions_severity_check
    CHECK (severity IN ('HARD', 'SOFT', 'PREFERENCE')),
  -- A zero-length or backwards window is meaningless, and the solver's
  -- `end <= start` branch would read it as crossing midnight — silently
  -- penalising a span the employee never named.
  CONSTRAINT availability_exceptions_window_check
    CHECK (end_time > start_time)
);

COMMENT ON TABLE public.availability_exceptions IS
  'Subtractive availability: windows an employee should not be rostered into, '
  'fed to the solver as `availability_overrides`. Distinct from leave (no '
  'balance, no approval) and from availability_rules (which is additive). '
  'HARD severity is manager-only — see the RLS policies.';
COMMENT ON COLUMN public.availability_exceptions.exception_date IS
  'NULL applies the window to EVERY day in the optimization horizon.';

CREATE INDEX IF NOT EXISTS availability_exceptions_profile_date_idx
  ON public.availability_exceptions (profile_id, exception_date);

-- One window per person per date per severity. Without it a double-submit
-- stacks penalties: two SOFT rows on the same day cost 10000c, which crosses
-- into territory the employee never asked for.
CREATE UNIQUE INDEX IF NOT EXISTS availability_exceptions_uniq
  ON public.availability_exceptions
     (profile_id, COALESCE(exception_date, '0001-01-01'::date), start_time, end_time, severity);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.availability_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS availability_exceptions_select ON public.availability_exceptions;
CREATE POLICY availability_exceptions_select
  ON public.availability_exceptions FOR SELECT TO authenticated
  USING (profile_id = (SELECT auth.uid()) OR is_manager_or_above());

-- INSERT/UPDATE: your own rows, and only at a severity you are allowed to set.
-- The severity test is in WITH CHECK rather than a trigger so it applies to the
-- row as written, and cannot be sidestepped by updating a PREFERENCE row up to
-- HARD after the fact.
DROP POLICY IF EXISTS availability_exceptions_insert ON public.availability_exceptions;
CREATE POLICY availability_exceptions_insert
  ON public.availability_exceptions FOR INSERT TO authenticated
  WITH CHECK (
    (profile_id = (SELECT auth.uid()) AND severity IN ('SOFT', 'PREFERENCE'))
    OR is_manager_or_above()
  );

DROP POLICY IF EXISTS availability_exceptions_update ON public.availability_exceptions;
CREATE POLICY availability_exceptions_update
  ON public.availability_exceptions FOR UPDATE TO authenticated
  USING (profile_id = (SELECT auth.uid()) OR is_manager_or_above())
  WITH CHECK (
    (profile_id = (SELECT auth.uid()) AND severity IN ('SOFT', 'PREFERENCE'))
    OR is_manager_or_above()
  );

-- DELETE stays open to the owner at any severity: withdrawing a restriction on
-- yourself only ever widens when you can be rostered, so it needs no guard.
DROP POLICY IF EXISTS availability_exceptions_delete ON public.availability_exceptions;
CREATE POLICY availability_exceptions_delete
  ON public.availability_exceptions FOR DELETE TO authenticated
  USING (profile_id = (SELECT auth.uid()) OR is_manager_or_above());

-- Supabase grants table privileges to anon by default on new tables; RLS would
-- still block reads, but there is no reason for the grant to exist.
REVOKE ALL ON public.availability_exceptions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_exceptions TO authenticated;

-- ── Verification (Supabase SQL Editor, after applying) ──────────────────────
--   -- expect 0 rows; nothing reads this until the fetcher ships
--   SELECT count(*) FROM public.availability_exceptions;
--
--   -- expect a check_violation: employees may not self-serve a HARD block
--   SET LOCAL ROLE authenticated;
--   INSERT INTO public.availability_exceptions (profile_id, start_time, end_time, severity)
--   VALUES (auth.uid(), '09:00', '17:00', 'HARD');

-- ── Assertions ────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on
\pset pager off

create or replace function assert_eq(got anyelement, want anyelement, label text)
returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL % — got %, want %', label, got, want; end if;
  raise notice 'ok   %', label;
end $$;

truncate public.availability_exceptions, public.profiles cascade;
insert into public.profiles (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

-- ── CHECK constraints ───────────────────────────────────────────────────────
do $$ begin
  begin
    insert into public.availability_exceptions (profile_id, start_time, end_time, severity)
    values ('11111111-1111-1111-1111-111111111111','17:00','09:00','SOFT');
    raise exception 'FAIL — backwards window accepted';
  exception when check_violation then raise notice 'ok   backwards window rejected'; end;
  begin
    insert into public.availability_exceptions (profile_id, start_time, end_time, severity)
    values ('11111111-1111-1111-1111-111111111111','09:00','09:00','SOFT');
    raise exception 'FAIL — zero-length window accepted';
  exception when check_violation then raise notice 'ok   zero-length window rejected'; end;
  begin
    insert into public.availability_exceptions (profile_id, start_time, end_time, severity)
    values ('11111111-1111-1111-1111-111111111111','09:00','17:00','MAYBE');
    raise exception 'FAIL — unknown severity accepted';
  exception when check_violation then raise notice 'ok   unknown severity rejected'; end;
end $$;

-- ── Unique index: a double-submit must not stack penalties ─────────────────
insert into public.availability_exceptions (profile_id, exception_date, start_time, end_time, severity)
values ('11111111-1111-1111-1111-111111111111','2026-03-02','09:00','17:00','SOFT');
do $$ begin
  insert into public.availability_exceptions (profile_id, exception_date, start_time, end_time, severity)
  values ('11111111-1111-1111-1111-111111111111','2026-03-02','09:00','17:00','SOFT');
  raise exception 'FAIL — duplicate dated exception accepted';
exception when unique_violation then raise notice 'ok   duplicate dated exception rejected'; end $$;

-- The COALESCE arm: two undated rows must collide too. A plain unique index
-- over a nullable column would let them both through, since NULL <> NULL.
insert into public.availability_exceptions (profile_id, start_time, end_time, severity)
values ('11111111-1111-1111-1111-111111111111','14:00','16:00','PREFERENCE');
do $$ begin
  insert into public.availability_exceptions (profile_id, start_time, end_time, severity)
  values ('11111111-1111-1111-1111-111111111111','14:00','16:00','PREFERENCE');
  raise exception 'FAIL — duplicate UNDATED exception accepted';
exception when unique_violation then raise notice 'ok   duplicate undated exception rejected (COALESCE arm works)'; end $$;

-- Same window at a different severity is a different statement, and allowed.
insert into public.availability_exceptions (profile_id, exception_date, start_time, end_time, severity)
values ('11111111-1111-1111-1111-111111111111','2026-03-02','09:00','17:00','PREFERENCE');
select assert_eq((select count(*)::int from public.availability_exceptions
                   where exception_date='2026-03-02'), 2,
                 'same window at a different severity coexists');

-- ── RLS ─────────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.availability_exceptions to authenticated;

-- Employee A, not a manager.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set test.is_manager = 'off';

select assert_eq((select count(*)::int from public.availability_exceptions), 3,
                 'employee sees their own exceptions');

do $$ begin
  insert into public.availability_exceptions (profile_id, start_time, end_time, severity)
  values ('11111111-1111-1111-1111-111111111111','09:00','17:00','HARD');
  raise exception 'FAIL — employee self-served a HARD block';
exception when insufficient_privilege then
  raise notice 'ok   employee cannot self-serve HARD';
end $$;

insert into public.availability_exceptions (profile_id, exception_date, start_time, end_time, severity)
values ('11111111-1111-1111-1111-111111111111','2026-04-01','09:00','12:00','SOFT');
select assert_eq((select count(*)::int from public.availability_exceptions where exception_date='2026-04-01'), 1,
                 'employee can set SOFT on themselves');

do $$ begin
  insert into public.availability_exceptions (profile_id, start_time, end_time, severity)
  values ('22222222-2222-2222-2222-222222222222','09:00','17:00','SOFT');
  raise exception 'FAIL — employee wrote an exception onto someone else';
exception when insufficient_privilege then
  raise notice 'ok   employee cannot write onto another profile';
end $$;

-- Escalation after the fact: UPDATE must be checked too, not just INSERT.
do $$ begin
  update public.availability_exceptions set severity='HARD'
   where profile_id='11111111-1111-1111-1111-111111111111' and severity='SOFT';
  raise exception 'FAIL — employee escalated an existing row to HARD';
exception when insufficient_privilege then
  raise notice 'ok   employee cannot escalate an existing row to HARD';
end $$;

-- Withdrawing a restriction on yourself only ever widens availability.
delete from public.availability_exceptions where exception_date='2026-04-01';
select assert_eq((select count(*)::int from public.availability_exceptions where exception_date='2026-04-01'), 0,
                 'employee can delete their own exception');

reset role;

-- Employee B must not see A's rows.
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set test.is_manager = 'off';
select assert_eq((select count(*)::int from public.availability_exceptions), 0,
                 'another employee sees none of them');
reset role;

-- Manager sees everything and may set HARD.
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set test.is_manager = 'on';
select assert_eq((select count(*)::int from public.availability_exceptions), 3,
                 'manager sees all exceptions');
insert into public.availability_exceptions (profile_id, exception_date, start_time, end_time, severity)
values ('11111111-1111-1111-1111-111111111111','2026-05-01','09:00','17:00','HARD');
select assert_eq((select count(*)::int from public.availability_exceptions where severity='HARD'), 1,
                 'manager can set HARD');
reset role;

-- anon has no table grant at all.
select assert_eq(has_table_privilege('anon','public.availability_exceptions','SELECT'), false,
                 'anon has no SELECT grant');

\echo ''
\echo 'ALL EXCEPTION TESTS PASSED'
