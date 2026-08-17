-- ============================================================================
-- Contract ordinary-hours envelope — behaviour harness
-- ============================================================================
--
-- Pins `sm_materialize_contract_envelope` (migration
-- 20260817000000_contract_ordinary_hours_envelope.sql), which owns every
-- `availability_slots` row with `source = 'envelope'`.
--
-- The properties worth pinning, because getting any of them wrong silently
-- removes people from the roster rather than raising anything:
--
--   * a contract with NO span configured writes NOTHING — this is the state
--     every production contract is in, so applying the migration is a no-op;
--   * casuals are ignored even when a span is set on them;
--   * `source = 'rule'` slots (what the employee declared) are NEVER touched;
--   * regeneration is idempotent, and revoking an envelope — by clearing the
--     span or ending the contract — removes the slots it wrote;
--   * approved leave carves days out; pending leave does not;
--   * multi-contract staff resolve to ONE envelope, by the same precedence as
--     `resolveComplianceBasis` in
--     src/modules/availability/domain/contract-basis.ts.
--
-- HOW TO RUN (throwaway container — never point this at a real database; it
-- truncates hr.user_contracts, public.availability_slots and
-- public.leave_requests):
--
--   docker run -d --name envelope-pg -e POSTGRES_PASSWORD=pw \
--     -p 55433:5432 postgres:17
--   docker exec -i envelope-pg psql -U postgres -v ON_ERROR_STOP=1 -q \
--     < supabase/tests/contract_ordinary_hours_envelope.sql
--   docker rm -f envelope-pg
--
-- The file is self-contained: it builds the schema subset it needs, applies
-- the migration's DDL and function inline, then asserts. The `cron.schedule`
-- block at the end of the migration is the only part not exercised here —
-- pg_cron is not present in a stock postgres image.
--
-- Expected tail: "ALL ENVELOPE TESTS PASSED", 36 `ok` notices, no ERROR.
-- ============================================================================

-- Faithful subset of the production schema the envelope migration touches.
create schema if not exists hr;

create type employment_status as enum ('Full-Time','Part-Time','Casual','Flexible Part-Time');
create type access_level as enum ('member','lead','manager','admin');

create table hr.user_contracts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  organization_id uuid,
  department_id uuid,
  sub_department_id uuid,
  role_id uuid not null default gen_random_uuid(),
  status text not null default 'Active',
  start_date date default current_date,
  end_date date,
  custom_hourly_rate numeric,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid,
  access_level access_level,
  employment_status employment_status default 'Full-Time',
  contracted_weekly_hours numeric default 38,
  is_apprentice boolean default false,
  apprentice_type text,
  apprentice_year integer,
  has_completed_year_12 boolean default false,
  is_trainee boolean default false,
  trainee_category text,
  trainee_level text,
  trainee_exit_year integer,
  trainee_years_out integer,
  trainee_aqf_level integer,
  trainee_year integer,
  is_training_on_job boolean default false,
  prefers_sba_loading boolean default false,
  is_sws boolean default false,
  sws_capacity_percentage integer,
  is_sws_trial boolean default false,
  sws_trial_start_date date,
  annual_guaranteed_hours integer,
  remuneration_level smallint
);

create view public.user_contracts as
  select id, user_id, organization_id, department_id, sub_department_id, role_id,
         status, start_date, end_date, custom_hourly_rate, notes, created_at,
         updated_at, created_by, access_level, employment_status,
         contracted_weekly_hours, is_apprentice, apprentice_type, apprentice_year,
         has_completed_year_12, is_trainee, trainee_category, trainee_level,
         trainee_exit_year, trainee_years_out, trainee_aqf_level, trainee_year,
         is_training_on_job, prefers_sba_loading, is_sws, sws_capacity_percentage,
         is_sws_trial, sws_trial_start_date, annual_guaranteed_hours, remuneration_level
    from hr.user_contracts;

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  start_date date not null,
  start_time time not null,
  end_time time not null,
  repeat_type text not null default 'none',
  repeat_days integer[],
  repeat_end_date date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.availability_slots (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references public.availability_rules(id) on delete cascade,
  profile_id uuid not null,
  slot_date date not null,
  start_time time not null,
  end_time time not null,
  created_at timestamptz default now()
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null,
  start_date timestamptz not null,
  end_date timestamptz not null,
  status text not null default 'pending'
);

-- Roles the migration's GRANT/REVOKE statements name.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;

-- ── The migration under test (DDL + function, cron block omitted) ─────────

-- Contract Ordinary-Hours Envelope + Materializer
-- ===============================================
-- Gives permanent (FT / PT / Flexible PT) staff the thing the availability
-- model has never had: a statement of WHEN THEY MAY BE ROSTERED that comes
-- from their contract instead of from a self-service declaration.
--
-- WHY. Availability means opposite things for the two populations:
--
--   * A CASUAL declares availability as an OFFER. No declaration means "not
--     offered", i.e. unavailable. That is correct and unchanged.
--   * A PERMANENT is regulated by their LEAVE, not by an offer — they are
--     contracted to hours the employer must find. Treating a missing
--     declaration as "cannot work" simultaneously tells the solver "this
--     person may not work" and "you owe this person 38h/week", which is a
--     contradiction it can only resolve by eating an unavoidable penalty or by
--     dropping them from the roster silently.
--
-- Production is in exactly that state: every availability rule on file was
-- written in ONE seed transaction (2026-08-11 02:05:42), and five of the 17
-- full-timers carry a 12:00-14:00 once-weekly rule, leaving them eligible for
-- almost nothing while still owed their contracted hours.
--
-- THE ENVELOPE IS NOT THE DAYS OFF. It answers "when could this person
-- lawfully be rostered", a span-of-hours question. Which days they actually
-- work is the roster cycle's job, and the EBA limits on that
-- (cl 35.1(e) 20-in-28 and paired days off, the 152h/28d average, rest gaps)
-- are already enforced by the solver and the V8 engine. An envelope reading
-- "06:00-22:00, seven days" is therefore correct for someone who will only be
-- rostered five of them.
--
-- ── APPLYING THIS IS A NO-OP FOR THE ROSTER ─────────────────────────────────
-- The envelope columns are NULLABLE and NULL means UNRESTRICTED. No contract
-- has a span configured, so `sm_materialize_contract_envelope` writes nothing
-- until someone opts a contract in, and the solver's per-date OPT_OUT
-- fail-open continues to carry permanents exactly as it does today.
--
-- That is deliberate. Emitting a default envelope would be the riskiest
-- possible change: HC-5d requires FULL CONTAINMENT, so a span guessed even
-- slightly too narrow silently un-rosters people. Production shifts already
-- start at 05:30, so the obvious "06:00-22:00" guess would have excluded the
-- earliest shift on the board — the same failure already recorded once, where
-- a 06:30 shift could not be filled against an 07:00 availability start.
-- The span is a policy decision that needs a human; this migration builds the
-- mechanism and leaves the decision open.
--
-- Columns are added NULLABLE for a second reason: making one NOT NULL is a
-- time bomb for hand-written RPCs that INSERT with explicit column lists.

-- ── 1. Envelope columns on the contract ─────────────────────────────────────

ALTER TABLE hr.user_contracts
  ADD COLUMN IF NOT EXISTS ordinary_span_start time,
  ADD COLUMN IF NOT EXISTS ordinary_span_end   time,
  ADD COLUMN IF NOT EXISTS ordinary_days       smallint[];

COMMENT ON COLUMN hr.user_contracts.ordinary_span_start IS
  'Earliest clock time this contract may be rostered from (ordinary-hours span). '
  'NULL = unrestricted; the pair with ordinary_span_end must both be set for an '
  'envelope to be materialized.';
COMMENT ON COLUMN hr.user_contracts.ordinary_span_end IS
  'Latest clock time this contract may be rostered to. NULL = unrestricted. '
  'Must be strictly greater than ordinary_span_start — a cross-midnight span is '
  'not expressible here, see sm_materialize_contract_envelope.';
COMMENT ON COLUMN hr.user_contracts.ordinary_days IS
  'ISO weekdays (1=Mon .. 7=Sun) on which the ordinary-hours span applies. '
  'NULL = all seven. This is NOT the days-off pattern — cl 35.1(e) paired days '
  'off and the 20-in-28 cap are enforced by the solver and the V8 engine, not here.';

-- Both ends together, and a forward span. A backwards or half-configured
-- envelope would otherwise materialize as an empty window, which under HC-5d's
-- full-containment rule means "unavailable for everything".
ALTER TABLE hr.user_contracts
  DROP CONSTRAINT IF EXISTS user_contracts_ordinary_span_valid;
ALTER TABLE hr.user_contracts
  ADD CONSTRAINT user_contracts_ordinary_span_valid CHECK (
    (ordinary_span_start IS NULL AND ordinary_span_end IS NULL)
    OR (ordinary_span_start IS NOT NULL AND ordinary_span_end IS NOT NULL
        AND ordinary_span_end > ordinary_span_start)
  );

-- ISO weekdays only, and never an empty array (which would mean "no days" and
-- so, again, unavailable for everything — NULL is how you say "all days").
ALTER TABLE hr.user_contracts
  DROP CONSTRAINT IF EXISTS user_contracts_ordinary_days_valid;
ALTER TABLE hr.user_contracts
  ADD CONSTRAINT user_contracts_ordinary_days_valid CHECK (
    ordinary_days IS NULL
    OR (cardinality(ordinary_days) BETWEEN 1 AND 7
        AND ordinary_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[])
  );

-- ── 2. Re-expose through the public view ────────────────────────────────────
-- `public.user_contracts` is a plain view over hr.user_contracts with an
-- explicit column list, so new base-table columns are invisible until it is
-- recreated. Column list reproduced verbatim from the live definition plus the
-- three additions.

CREATE OR REPLACE VIEW public.user_contracts AS
SELECT id,
       user_id,
       organization_id,
       department_id,
       sub_department_id,
       role_id,
       status,
       start_date,
       end_date,
       custom_hourly_rate,
       notes,
       created_at,
       updated_at,
       created_by,
       access_level,
       employment_status,
       contracted_weekly_hours,
       is_apprentice,
       apprentice_type,
       apprentice_year,
       has_completed_year_12,
       is_trainee,
       trainee_category,
       trainee_level,
       trainee_exit_year,
       trainee_years_out,
       trainee_aqf_level,
       trainee_year,
       is_training_on_job,
       prefers_sba_loading,
       is_sws,
       sws_capacity_percentage,
       is_sws_trial,
       sws_trial_start_date,
       annual_guaranteed_hours,
       remuneration_level,
       ordinary_span_start,
       ordinary_span_end,
       ordinary_days
  FROM hr.user_contracts;

-- ── 3. Slot provenance ──────────────────────────────────────────────────────
-- The materializer has to be able to delete what it wrote WITHOUT touching a
-- slot the employee declared. `rule_id IS NULL` is not a safe discriminator —
-- it is nullable for other reasons — so provenance is recorded explicitly.

ALTER TABLE public.availability_slots
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'rule';

ALTER TABLE public.availability_slots
  DROP CONSTRAINT IF EXISTS availability_slots_source_check;
ALTER TABLE public.availability_slots
  ADD CONSTRAINT availability_slots_source_check
    CHECK (source IN ('rule', 'envelope'));

COMMENT ON COLUMN public.availability_slots.source IS
  '''rule'' = materialized from an availability_rules row the employee created '
  '(the pre-existing behaviour, and the default so every existing row and every '
  'existing INSERT with an explicit column list keeps working). ''envelope'' = '
  'generated from the contract ordinary-hours span by '
  'sm_materialize_contract_envelope, which owns those rows exclusively.';

-- Makes regeneration idempotent, and lets the rule trigger's existing
-- `ON CONFLICT DO NOTHING` finally do something — there was no unique
-- constraint at all, so duplicate slots were silently possible. Verified
-- zero duplicate (profile_id, slot_date, start_time, end_time) groups in
-- production before adding this.
CREATE UNIQUE INDEX IF NOT EXISTS availability_slots_uniq
  ON public.availability_slots (profile_id, slot_date, start_time, end_time, source);

CREATE INDEX IF NOT EXISTS availability_slots_envelope_idx
  ON public.availability_slots (profile_id, slot_date)
  WHERE source = 'envelope';

-- ── 4. The materializer ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sm_materialize_contract_envelope(
  p_from        date   DEFAULT CURRENT_DATE,
  p_to          date   DEFAULT (CURRENT_DATE + 180),
  p_profile_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (profiles_touched int, slots_written int, slots_removed int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, hr
AS $$
DECLARE
  v_written int := 0;
  v_removed int := 0;
  v_touched int := 0;
BEGIN
  IF p_to < p_from THEN
    RAISE EXCEPTION 'sm_materialize_contract_envelope: p_to (%) is before p_from (%)', p_to, p_from
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- The rule generator caps itself at 180 days; this bound is deliberately
  -- looser but still finite, so a bad call cannot generate an unbounded table.
  IF (p_to - p_from) > 400 THEN
    RAISE EXCEPTION 'sm_materialize_contract_envelope: horizon of % days exceeds the 400-day maximum', (p_to - p_from)
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ON COMMIT DROP frees these at the end of the TRANSACTION, not the end of
  -- the call, so a second invocation inside one transaction would otherwise
  -- fail with "relation _env_target already exists". Cron gets a transaction
  -- per run and never hits it; a manual backfill that scopes by profile in a
  -- loop hits it immediately.
  DROP TABLE IF EXISTS _env_target;
  DROP TABLE IF EXISTS _env_scope;

  CREATE TEMP TABLE _env_target ON COMMIT DROP AS
  WITH basis AS (
    -- ONE contract per person decides the envelope. 30 of 103 staff hold more
    -- than one Active contract and at least one holds two whose employment
    -- statuses disagree outright, so an arbitrary pick would make the result
    -- depend on row order. Ordering mirrors `resolveComplianceBasis` in
    -- src/modules/availability/domain/contract-basis.ts: non-casual first,
    -- then the larger weekly basis, then the later start.
    SELECT DISTINCT ON (uc.user_id)
           uc.user_id,
           uc.ordinary_span_start,
           uc.ordinary_span_end,
           COALESCE(uc.ordinary_days, ARRAY[1,2,3,4,5,6,7]::smallint[]) AS ordinary_days,
           uc.start_date,
           uc.end_date
      FROM hr.user_contracts uc
     WHERE uc.status = 'Active'
       AND uc.employment_status <> 'Casual'
       AND uc.ordinary_span_start IS NOT NULL
       AND uc.ordinary_span_end   IS NOT NULL
       AND (p_profile_ids IS NULL OR uc.user_id = ANY (p_profile_ids))
     ORDER BY uc.user_id,
              (uc.employment_status = 'Casual'),
              uc.contracted_weekly_hours DESC NULLS LAST,
              uc.start_date DESC NULLS LAST,
              uc.id
  )
  SELECT b.user_id AS profile_id,
         d::date   AS slot_date,
         b.ordinary_span_start AS start_time,
         b.ordinary_span_end   AS end_time
    FROM basis b
    CROSS JOIN LATERAL generate_series(
      GREATEST(p_from, COALESCE(b.start_date, p_from)),
      LEAST   (p_to,   COALESCE(b.end_date,   p_to)),
      interval '1 day'
    ) AS d
   WHERE EXTRACT(isodow FROM d)::smallint = ANY (b.ordinary_days)
     -- Approved leave carves the day out of the envelope. The solver already
     -- excludes it via `unavailable_dates`, so this is not what makes leave
     -- binding; it is what keeps the slot table — and therefore the Team
     -- Availability page reading it — from claiming someone is available on a
     -- day they are on leave.
     AND NOT EXISTS (
       SELECT 1 FROM public.leave_requests lr
        WHERE lr.employee_id = b.user_id
          AND lr.status = 'approved'
          AND lr.start_date::date <= d::date
          AND lr.end_date::date   >= d::date
     );

  -- Scope of the rewrite: everyone we just generated for, PLUS anyone still
  -- holding envelope rows in this range. The second half is what cleans up
  -- after a contract is ended or its span cleared — without it, revoking an
  -- envelope would leave the old slots behind and keep constraining the
  -- person forever.
  CREATE TEMP TABLE _env_scope ON COMMIT DROP AS
    SELECT DISTINCT profile_id FROM _env_target
    UNION
    SELECT DISTINCT s.profile_id
      FROM public.availability_slots s
     WHERE s.source = 'envelope'
       AND s.slot_date BETWEEN p_from AND p_to
       AND (p_profile_ids IS NULL OR s.profile_id = ANY (p_profile_ids));

  SELECT count(*) INTO v_touched FROM _env_scope;

  WITH removed AS (
    DELETE FROM public.availability_slots s
     USING _env_scope sc
     WHERE s.profile_id = sc.profile_id
       AND s.source = 'envelope'
       AND s.slot_date BETWEEN p_from AND p_to
       AND NOT EXISTS (
         SELECT 1 FROM _env_target t
          WHERE t.profile_id = s.profile_id
            AND t.slot_date  = s.slot_date
            AND t.start_time = s.start_time
            AND t.end_time   = s.end_time
       )
     RETURNING 1
  )
  SELECT count(*) INTO v_removed FROM removed;

  WITH written AS (
    INSERT INTO public.availability_slots (profile_id, slot_date, start_time, end_time, source)
    SELECT t.profile_id, t.slot_date, t.start_time, t.end_time, 'envelope'
      FROM _env_target t
    ON CONFLICT (profile_id, slot_date, start_time, end_time, source) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_written FROM written;

  RAISE LOG '[envelope] % profile(s) in scope, % slot(s) written, % removed, range % .. %',
    v_touched, v_written, v_removed, p_from, p_to;

  profiles_touched := v_touched;
  slots_written    := v_written;
  slots_removed    := v_removed;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.sm_materialize_contract_envelope(date, date, uuid[]) IS
  'Regenerates source=''envelope'' availability_slots for Active non-Casual '
  'contracts that have an ordinary-hours span configured, over [p_from, p_to]. '
  'Idempotent: deletes envelope rows in range that no longer belong and inserts '
  'the ones that do, never touching source=''rule'' rows. Skips dates covered by '
  'approved leave. Writes nothing for contracts with a NULL span, which is every '
  'contract until one is explicitly opted in.';

-- Supabase grants EXECUTE on new functions to PUBLIC (hence anon) AND to
-- authenticated. This one rewrites other people's availability, so it is
-- service_role only — the app never calls it directly; cron does.
REVOKE ALL ON FUNCTION public.sm_materialize_contract_envelope(date, date, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sm_materialize_contract_envelope(date, date, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.sm_materialize_contract_envelope(date, date, uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sm_materialize_contract_envelope(date, date, uuid[]) TO service_role;

-- ── Verification (Supabase SQL Editor, after applying) ──────────────────────
--   -- expect (0,0,0): no contract has a span configured yet, so this is a no-op
--   SELECT * FROM public.sm_materialize_contract_envelope();
--
--   -- expect the three new columns
--   SELECT ordinary_span_start, ordinary_span_end, ordinary_days
--     FROM public.user_contracts LIMIT 1;
--
--   -- expect every existing row to read 'rule'
--   SELECT source, count(*) FROM public.availability_slots GROUP BY 1;

-- ── Assertions ────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on
\pset pager off

create or replace function assert_eq(got anyelement, want anyelement, label text)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok   %', label;
end $$;

-- Fixed IDs so assertions are readable.
\set ft   '''11111111-1111-1111-1111-111111111111'''
\set pt   '''22222222-2222-2222-2222-222222222222'''
\set cas  '''33333333-3333-3333-3333-333333333333'''
\set noenv '''44444444-4444-4444-4444-444444444444'''

truncate hr.user_contracts, public.availability_slots, public.leave_requests;

-- FT with a configured Mon-Fri 06:00-18:00 envelope.
insert into hr.user_contracts (user_id, employment_status, contracted_weekly_hours, start_date,
                               ordinary_span_start, ordinary_span_end, ordinary_days)
values (:ft, 'Full-Time', 38, '2026-01-01', '06:00', '18:00', array[1,2,3,4,5]::smallint[]);

-- PT with an all-days envelope (ordinary_days NULL => all seven).
insert into hr.user_contracts (user_id, employment_status, contracted_weekly_hours, start_date,
                               ordinary_span_start, ordinary_span_end)
values (:pt, 'Part-Time', 20, '2026-01-01', '08:00', '14:00');

-- Casual WITH a span configured — must still be ignored.
insert into hr.user_contracts (user_id, employment_status, contracted_weekly_hours, start_date,
                               ordinary_span_start, ordinary_span_end)
values (:cas, 'Casual', 0, '2026-01-01', '06:00', '22:00');

-- FT with NO span — the state every production contract is in today.
insert into hr.user_contracts (user_id, employment_status, contracted_weekly_hours, start_date)
values (:noenv, 'Full-Time', 38, '2026-01-01');

-- A declared rule-sourced slot the materializer must never touch.
insert into public.availability_slots (profile_id, slot_date, start_time, end_time, source)
values (:ft, '2026-03-02', '19:00', '21:00', 'rule');

-- ── Run 1: one ISO week, Mon 2026-03-02 .. Sun 2026-03-08 ───────────────────
select * from public.sm_materialize_contract_envelope('2026-03-02', '2026-03-08') \gset r1_

select assert_eq((select count(*)::int from public.availability_slots
                   where profile_id = :ft and source='envelope'), 5,
                 'FT Mon-Fri envelope writes exactly 5 slots');

select assert_eq((select count(*)::int from public.availability_slots
                   where profile_id = :pt and source='envelope'), 7,
                 'PT with NULL ordinary_days writes all 7 days');

select assert_eq((select count(*)::int from public.availability_slots
                   where profile_id = :cas), 0,
                 'casual is ignored even with a span configured');

select assert_eq((select count(*)::int from public.availability_slots
                   where profile_id = :noenv), 0,
                 'FT with no span writes nothing (the production default = no-op)');

select assert_eq((select count(*)::int from public.availability_slots
                   where profile_id = :ft and source='rule'), 1,
                 'declared rule slot survives materialization');

select assert_eq((select start_time::text || '-' || end_time::text
                    from public.availability_slots
                   where profile_id = :ft and source='envelope' and slot_date='2026-03-02'),
                 '06:00:00-18:00:00', 'envelope slot carries the contract span');

select assert_eq((select count(*)::int from public.availability_slots
                   where profile_id = :ft and source='envelope'
                     and extract(isodow from slot_date) in (6,7)), 0,
                 'no envelope slots on days outside ordinary_days');

-- ── Run 2: idempotency ──────────────────────────────────────────────────────
select * from public.sm_materialize_contract_envelope('2026-03-02', '2026-03-08') \gset r2_
select assert_eq(:'r2_slots_written'::int, 0, 'rerun writes nothing');
select assert_eq(:'r2_slots_removed'::int, 0, 'rerun removes nothing');
select assert_eq((select count(*)::int from public.availability_slots where source='envelope'), 12,
                 'rerun leaves the slot count unchanged');

-- ── Approved leave carves days out ──────────────────────────────────────────
insert into public.leave_requests (employee_id, start_date, end_date, status)
values (:ft, '2026-03-03T00:00:00Z', '2026-03-04T23:59:59Z', 'approved');

select * from public.sm_materialize_contract_envelope('2026-03-02', '2026-03-08') \gset r3_
select assert_eq(:'r3_slots_removed'::int, 2, 'approved leave removes the two covered days');
select assert_eq((select count(*)::int from public.availability_slots
                   where profile_id = :ft and source='envelope'), 3,
                 'FT drops to 3 envelope days across the leave');
select assert_eq((select count(*)::int from public.availability_slots
                   where profile_id = :ft and source='envelope'
                     and slot_date in ('2026-03-03','2026-03-04')), 0,
                 'the leave days specifically are gone');

-- Pending leave must NOT carve anything out (only approved is binding here).
insert into public.leave_requests (employee_id, start_date, end_date, status)
values (:pt, '2026-03-03T00:00:00Z', '2026-03-04T23:59:59Z', 'pending');
select * from public.sm_materialize_contract_envelope('2026-03-02', '2026-03-08') \gset r4_
select assert_eq((select count(*)::int from public.availability_slots
                   where profile_id = :pt and source='envelope'), 7,
                 'pending leave does not carve the envelope');

-- Cancelling the leave restores the days.
update public.leave_requests set status='cancelled' where employee_id = :ft;
select * from public.sm_materialize_contract_envelope('2026-03-02', '2026-03-08') \gset r5_
select assert_eq(:'r5_slots_written'::int, 2, 'cancelled leave restores the two days');

-- ── Revoking an envelope cleans up after itself ─────────────────────────────
update hr.user_contracts set ordinary_span_start=null, ordinary_span_end=null where user_id = :pt;
select * from public.sm_materialize_contract_envelope('2026-03-02', '2026-03-08') \gset r6_
select assert_eq((select count(*)::int from public.availability_slots
                   where profile_id = :pt and source='envelope'), 0,
                 'clearing the span removes its envelope slots');
select assert_eq((select count(*)::int from public.availability_slots
                   where profile_id = :ft and source='envelope'), 5,
                 'and leaves everyone else alone');

-- Ending the contract also clears it.
update hr.user_contracts set status='Terminated' where user_id = :ft;
select * from public.sm_materialize_contract_envelope('2026-03-02', '2026-03-08') \gset r7_
select assert_eq((select count(*)::int from public.availability_slots
                   where source='envelope'), 0,
                 'terminating the contract removes its envelope slots');
select assert_eq((select count(*)::int from public.availability_slots
                   where profile_id = :ft and source='rule'), 1,
                 'the declared rule slot STILL survives');

-- ── Contract date bounds clip the horizon ───────────────────────────────────
update hr.user_contracts set status='Active', start_date='2026-03-04', end_date='2026-03-05'
 where user_id = :ft;
select * from public.sm_materialize_contract_envelope('2026-03-02', '2026-03-08') \gset r8_
select assert_eq((select count(*)::int from public.availability_slots
                   where profile_id = :ft and source='envelope'), 2,
                 'generation is clipped to the contract start/end dates');

-- ── Multi-contract basis: non-casual wins, then larger weekly hours ─────────
truncate hr.user_contracts, public.availability_slots, public.leave_requests;
insert into hr.user_contracts (user_id, employment_status, contracted_weekly_hours, start_date,
                               ordinary_span_start, ordinary_span_end)
values (:ft, 'Casual',    0,  '2026-01-01', '00:00', '23:00'),
       (:ft, 'Part-Time', 20, '2026-01-01', '09:00', '13:00'),
       (:ft, 'Full-Time', 38, '2026-01-01', '06:00', '18:00');
select * from public.sm_materialize_contract_envelope('2026-03-02', '2026-03-02') \gset r9_
select assert_eq((select start_time::text from public.availability_slots
                   where profile_id = :ft and source='envelope'), '06:00:00',
                 'multi-contract picks non-casual with the largest weekly basis');
select assert_eq((select count(*)::int from public.availability_slots where source='envelope'), 1,
                 'and writes exactly one slot for the day, not one per contract');

-- ── Scoping by profile ──────────────────────────────────────────────────────
truncate hr.user_contracts, public.availability_slots;
insert into hr.user_contracts (user_id, employment_status, contracted_weekly_hours, start_date,
                               ordinary_span_start, ordinary_span_end)
values (:ft, 'Full-Time', 38, '2026-01-01', '06:00', '18:00'),
       (:pt, 'Part-Time', 20, '2026-01-01', '08:00', '14:00');
select * from public.sm_materialize_contract_envelope('2026-03-02','2026-03-02', array[:ft]::uuid[]) \gset r10_
select assert_eq((select count(*)::int from public.availability_slots where profile_id = :ft), 1,
                 'scoped run writes the named profile');
select assert_eq((select count(*)::int from public.availability_slots where profile_id = :pt), 0,
                 'scoped run does not touch other profiles');

-- ── Guard rails ─────────────────────────────────────────────────────────────
do $$ begin
  begin
    perform public.sm_materialize_contract_envelope('2026-03-08','2026-03-02');
    raise exception 'FAIL — reversed range was accepted';
  exception when invalid_parameter_value then
    raise notice 'ok   reversed date range is rejected';
  end;
  begin
    perform public.sm_materialize_contract_envelope('2026-01-01','2027-12-31');
    raise exception 'FAIL — oversized horizon was accepted';
  exception when invalid_parameter_value then
    raise notice 'ok   horizon over 400 days is rejected';
  end;
end $$;

-- CHECK constraints on the envelope columns.
do $$ begin
  begin
    update hr.user_contracts set ordinary_span_start='18:00', ordinary_span_end='06:00';
    raise exception 'FAIL — backwards span accepted';
  exception when check_violation then raise notice 'ok   backwards span rejected'; end;
  begin
    update hr.user_contracts set ordinary_span_start='06:00', ordinary_span_end=null;
    raise exception 'FAIL — half-configured span accepted';
  exception when check_violation then raise notice 'ok   half-configured span rejected'; end;
  begin
    update hr.user_contracts set ordinary_days = array[]::smallint[];
    raise exception 'FAIL — empty ordinary_days accepted';
  exception when check_violation then raise notice 'ok   empty ordinary_days rejected'; end;
  begin
    update hr.user_contracts set ordinary_days = array[0,8]::smallint[];
    raise exception 'FAIL — out-of-range weekday accepted';
  exception when check_violation then raise notice 'ok   out-of-range weekday rejected'; end;
end $$;

-- The unique index the rule trigger's ON CONFLICT has been silently relying on.
do $$ begin
  insert into public.availability_slots (profile_id, slot_date, start_time, end_time, source)
  values ('11111111-1111-1111-1111-111111111111','2026-03-02','06:00','18:00','envelope');
  raise exception 'FAIL — duplicate slot accepted';
exception when unique_violation then raise notice 'ok   duplicate slot rejected by the unique index'; end $$;

-- A rule slot and an envelope slot may coexist at the same time — different source.
insert into public.availability_slots (profile_id, slot_date, start_time, end_time, source)
values ('11111111-1111-1111-1111-111111111111','2026-03-02','06:00','18:00','rule');
select assert_eq((select count(*)::int from public.availability_slots
                   where profile_id='11111111-1111-1111-1111-111111111111'
                     and slot_date='2026-03-02' and start_time='06:00'), 2,
                 'rule and envelope slots coexist at identical times');

-- ── Grants ──────────────────────────────────────────────────────────────────
select assert_eq(has_function_privilege('anon',
  'public.sm_materialize_contract_envelope(date,date,uuid[])','EXECUTE'), false,
  'anon cannot execute the materializer');
select assert_eq(has_function_privilege('authenticated',
  'public.sm_materialize_contract_envelope(date,date,uuid[])','EXECUTE'), false,
  'authenticated cannot execute the materializer');
select assert_eq(has_function_privilege('service_role',
  'public.sm_materialize_contract_envelope(date,date,uuid[])','EXECUTE'), true,
  'service_role can execute the materializer');

-- ── The view exposes the new columns ────────────────────────────────────────
select assert_eq((select count(*)::int from information_schema.columns
                   where table_schema='public' and table_name='user_contracts'
                     and column_name in ('ordinary_span_start','ordinary_span_end','ordinary_days')),
                 3, 'public.user_contracts view exposes the envelope columns');

\echo ''
\echo 'ALL ENVELOPE TESTS PASSED'
