-- ============================================================================
-- Availability sub-department scope — behaviour harness
-- ============================================================================
--
-- Pins migration 20260821090000_availability_subdepartment_scope.sql, which
-- gives availability the sub-department dimension it never had.
--
-- The properties worth pinning, because every one of them fails SILENTLY:
--
--   * two sub-departments, same person, same date, same window, both survive —
--     this is the whole feature, and under the old unique index the second
--     declaration vanished with no error;
--   * the COALESCE sentinel still dedupes UNSCOPED rows, which a bare nullable
--     column in a unique index would not (every NULL is distinct from every
--     other NULL, so the uniqueness guarantee would simply evaporate);
--   * slots inherit their rule's scope, always;
--   * you cannot declare availability for a sub-department you hold no Active
--     contract in, and a DEPARTMENT-WIDE contract (NULL sub-department) is in
--     scope for every sub-department beneath it;
--   * the backfill scopes only the unambiguous, and leaves the rest NULL
--     rather than inventing an answer;
--   * `sm_materialize_contract_envelope` still runs. It names its conflict
--     target explicitly and the migration replaces the only index that clause
--     could infer — left alone it raises 42P10 on a pg_cron job, where the
--     failure surfaces as a stale envelope rather than as an error anyone sees.
--     Test 10 asserts the rewritten body runs; test 11 asserts the OLD body
--     genuinely breaks, so the rewrite is proven necessary rather than assumed.
--
-- HOW TO RUN (throwaway container — never point this at a real database):
--
--   docker run -d --name availscope-pg -e POSTGRES_PASSWORD=pw -p 55434:5432 postgres:17
--   docker exec -i availscope-pg psql -U postgres -v ON_ERROR_STOP=1 -q \
--     < supabase/tests/availability_subdepartment_scope.sql
--   docker rm -f availscope-pg
--
-- Self-contained: builds the schema subset it needs, applies the migration's
-- DDL inline, then asserts.
--
-- Expected tail: "ALL AVAILABILITY SCOPE TESTS PASSED", no ERROR.
-- ============================================================================

\set ON_ERROR_STOP on
-- `warning` only while the schema subset is built, so the DROP ... IF EXISTS
-- "skipping" chatter stays out of the way. Raised back to `notice` before the
-- assertions — they report through RAISE NOTICE, and leaving this at `warning`
-- makes a fully passing run and a fully SKIPPED run look identical.
SET client_min_messages = warning;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS hr;

-- ── schema subset ───────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.availability_slots CASCADE;
DROP TABLE IF EXISTS public.availability_rules CASCADE;
DROP TABLE IF EXISTS public.availability_exceptions CASCADE;
DROP TABLE IF EXISTS public.availability_requests CASCADE;
DROP TABLE IF EXISTS public.availability_rules_archive CASCADE;
DROP TABLE IF EXISTS public.availability_slots_archive CASCADE;
DROP TABLE IF EXISTS public.sub_departments CASCADE;
DROP TABLE IF EXISTS public.departments CASCADE;
DROP TABLE IF EXISTS hr.user_contracts CASCADE;
DROP TABLE IF EXISTS public.employee_leave_days CASCADE;

CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE public.sub_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id),
  name text NOT NULL
);

CREATE TABLE hr.user_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL,
  employment_status text,
  department_id uuid,
  sub_department_id uuid,
  contracted_weekly_hours numeric,
  ordinary_span_start time,
  ordinary_span_end time,
  ordinary_days smallint[],
  start_date date,
  end_date date
);

CREATE TABLE public.availability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  start_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  repeat_type text NOT NULL DEFAULT 'none',
  repeat_days integer[],
  repeat_end_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.availability_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid REFERENCES public.availability_rules(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL,
  slot_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  created_at timestamptz DEFAULT now(),
  source text NOT NULL DEFAULT 'rule'
);

CREATE TABLE public.availability_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  exception_date date,
  start_time time NOT NULL,
  end_time time NOT NULL,
  severity text NOT NULL DEFAULT 'SOFT',
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TABLE public.availability_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.availability_rules_archive (LIKE public.availability_rules);
ALTER TABLE public.availability_rules_archive ADD COLUMN archived_at timestamptz, ADD COLUMN archived_reason text;
CREATE TABLE public.availability_slots_archive (LIKE public.availability_slots);
ALTER TABLE public.availability_slots_archive ADD COLUMN archived_at timestamptz, ADD COLUMN archived_reason text;

CREATE TABLE public.employee_leave_days (employee_id uuid, leave_date date);

-- The pre-migration index this migration replaces. Present so test 3 can prove
-- what the old shape did.
CREATE UNIQUE INDEX availability_slots_uniq
  ON public.availability_slots (profile_id, slot_date, start_time, end_time, source);

CREATE OR REPLACE FUNCTION public.sm_holds_active_ft_contract(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM hr.user_contracts uc
                  WHERE uc.user_id = p_profile_id AND uc.status = 'Active'
                    AND LOWER(COALESCE(uc.employment_status,'')) LIKE '%full%');
$$;

-- The pre-migration slot generator, so the migration's rewrite is a real diff.
CREATE OR REPLACE FUNCTION public.generate_availability_slots()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
declare current_date_cursor date; end_date_limit date; weekday int; days_diff int;
begin
  current_date_cursor := coalesce(new.start_date, current_date);
  if new.repeat_type = 'none' then end_date_limit := current_date_cursor;
  else end_date_limit := least(coalesce(new.repeat_end_date,'2099-01-01'), current_date_cursor + interval '180 days'); end if;
  while current_date_cursor <= end_date_limit loop
    weekday := extract(isodow from current_date_cursor);
    days_diff := (current_date_cursor - new.start_date);
    if new.repeat_type='none' or new.repeat_type='daily'
       or (new.repeat_type='weekly' and weekday = any(new.repeat_days))
       or (new.repeat_type='fortnightly' and weekday = any(new.repeat_days) and ((days_diff/7)::int % 2 = 0)) then
      insert into availability_slots (rule_id, profile_id, slot_date, start_time, end_time)
      values (new.id, new.profile_id, current_date_cursor, new.start_time, new.end_time)
      on conflict do nothing;
    end if;
    if new.repeat_type='none' then exit; end if;
    current_date_cursor := current_date_cursor + interval '1 day';
  end loop;
  return new;
end; $fn$;

CREATE TRIGGER trg_generate_availability_slots
  AFTER INSERT ON public.availability_rules
  FOR EACH ROW EXECUTE FUNCTION public.generate_availability_slots();

-- The PERSON-WIDE Full-Time guard as deployed by 20260817120000. Present so
-- test 0 can demonstrate the defect 20260821090100 exists to fix, rather than
-- asserting the fixed behaviour against a world where the bug never existed.
CREATE OR REPLACE FUNCTION public.trg_prevent_ft_availability_rule()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, hr, pg_catalog AS $fn$
BEGIN
  IF public.sm_holds_active_ft_contract(NEW.profile_id) THEN
    RAISE EXCEPTION 'Availability is contract based for Full Time employees. Use Leave Management for unavailability.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $fn$;

CREATE TRIGGER trg_prevent_ft_availability_rule
  BEFORE INSERT OR UPDATE ON public.availability_rules
  FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_ft_availability_rule();

-- ── fixtures ────────────────────────────────────────────────────────────────
--
-- Mirrors the production shapes the migration has to survive.

INSERT INTO public.departments (id, name) VALUES
  ('d0000000-0000-0000-0000-000000000001','Building Services'),
  ('d0000000-0000-0000-0000-000000000002','Event Delivery'),
  ('d0000000-0000-0000-0000-000000000003','Live Events');

INSERT INTO public.sub_departments (id, department_id, name) VALUES
  ('50000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Security'),
  ('50000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002','Set-up'),
  ('50000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000003','Front of House');

-- MULTI: casual in two sub-departments (production: Charles Brown).
-- FTMIX: 1 Full-Time + 2 Casual across three sub-departments (production: the
--        employee this whole change exists for).
-- SOLO : one contract, one sub-department — the 85-rule majority.
-- ORPHAN: holds availability but NO contract of any status. Four of these exist
--        in production and the backfill must leave them alone.
-- DEPTW: a DEPARTMENT-WIDE contract (NULL sub-department).
INSERT INTO hr.user_contracts (user_id, status, employment_status, department_id, sub_department_id, contracted_weekly_hours) VALUES
  ('a0000000-0000-0000-0000-00000000000a','Active','Casual','d0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',0),
  ('a0000000-0000-0000-0000-00000000000a','Active','Casual','d0000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002',0);

INSERT INTO hr.user_contracts (user_id, status, employment_status, department_id, sub_department_id, contracted_weekly_hours) VALUES
  ('b0000000-0000-0000-0000-000000000001','Active','Full-Time','d0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',38),
  ('b0000000-0000-0000-0000-000000000001','Active','Casual','d0000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002',0),
  ('b0000000-0000-0000-0000-000000000001','Active','Casual','d0000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000003',0),
  ('c0000000-0000-0000-0000-000000000001','Active','Casual','d0000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002',0),
  ('e0000000-0000-0000-0000-000000000001','Active','Casual','d0000000-0000-0000-0000-000000000003',NULL,0);

-- Pre-migration declarations, unscoped because the column does not exist yet.
INSERT INTO public.availability_rules (profile_id, start_date, start_time, end_time, repeat_type) VALUES
  ('a0000000-0000-0000-0000-00000000000a','2027-01-04','09:00','17:00','none'),  -- MULTI (ambiguous)
  ('c0000000-0000-0000-0000-000000000001','2027-01-04','09:00','17:00','none'),  -- SOLO  (resolvable)
  ('f0000000-0000-0000-0000-000000000001','2027-01-04','09:00','17:00','none');  -- ORPHAN (no contract)

-- ============================================================================
-- APPLY THE MIGRATION (sections 1-6, inline)
-- ============================================================================

ALTER TABLE public.availability_rules      ADD COLUMN sub_department_id uuid REFERENCES public.sub_departments(id) ON DELETE RESTRICT;
ALTER TABLE public.availability_slots      ADD COLUMN sub_department_id uuid REFERENCES public.sub_departments(id) ON DELETE RESTRICT;
ALTER TABLE public.availability_exceptions ADD COLUMN sub_department_id uuid REFERENCES public.sub_departments(id) ON DELETE RESTRICT;
ALTER TABLE public.availability_requests   ADD COLUMN sub_department_id uuid REFERENCES public.sub_departments(id) ON DELETE RESTRICT;
ALTER TABLE public.availability_rules_archive ADD COLUMN sub_department_id uuid;
ALTER TABLE public.availability_slots_archive ADD COLUMN sub_department_id uuid;

CREATE OR REPLACE FUNCTION public.sm_holds_active_contract_in(p_profile_id uuid, p_sub_department_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, hr, pg_catalog AS $f$
  SELECT p_sub_department_id IS NULL OR EXISTS (
    SELECT 1 FROM hr.user_contracts uc
     WHERE uc.user_id = p_profile_id AND uc.status = 'Active'
       AND ( uc.sub_department_id = p_sub_department_id
          OR (uc.sub_department_id IS NULL AND uc.department_id IS NOT NULL
              AND uc.department_id = (SELECT sd.department_id FROM public.sub_departments sd
                                       WHERE sd.id = p_sub_department_id))));
$f$;

CREATE OR REPLACE FUNCTION public.trg_availability_scope_is_contracted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, hr, pg_catalog AS $f$
BEGIN
  IF NEW.sub_department_id IS NOT NULL
     AND NOT public.sm_holds_active_contract_in(NEW.profile_id, NEW.sub_department_id) THEN
    RAISE EXCEPTION 'No Active contract in that sub-department — availability can only be declared for a job you hold.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $f$;

CREATE TRIGGER trg_availability_scope_is_contracted BEFORE INSERT OR UPDATE ON public.availability_rules
  FOR EACH ROW EXECUTE FUNCTION public.trg_availability_scope_is_contracted();
CREATE TRIGGER trg_availability_scope_is_contracted BEFORE INSERT OR UPDATE ON public.availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.trg_availability_scope_is_contracted();

CREATE OR REPLACE FUNCTION public.generate_availability_slots()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
declare current_date_cursor date; end_date_limit date; weekday int; days_diff int;
begin
  current_date_cursor := coalesce(new.start_date, current_date);
  if new.repeat_type = 'none' then end_date_limit := current_date_cursor;
  else end_date_limit := least(coalesce(new.repeat_end_date,'2099-01-01'), current_date_cursor + interval '180 days'); end if;
  while current_date_cursor <= end_date_limit loop
    weekday := extract(isodow from current_date_cursor);
    days_diff := (current_date_cursor - new.start_date);
    if new.repeat_type='none' or new.repeat_type='daily'
       or (new.repeat_type='weekly' and weekday = any(new.repeat_days))
       or (new.repeat_type='fortnightly' and weekday = any(new.repeat_days) and ((days_diff/7)::int % 2 = 0)) then
      insert into availability_slots (rule_id, profile_id, slot_date, start_time, end_time, sub_department_id)
      values (new.id, new.profile_id, current_date_cursor, new.start_time, new.end_time, new.sub_department_id)
      on conflict do nothing;
    end if;
    if new.repeat_type='none' then exit; end if;
    current_date_cursor := current_date_cursor + interval '1 day';
  end loop;
  return new;
end; $fn$;

DROP INDEX IF EXISTS public.availability_slots_uniq;
CREATE UNIQUE INDEX availability_slots_uniq ON public.availability_slots
  (profile_id, slot_date, start_time, end_time, source,
   COALESCE(sub_department_id,'00000000-0000-0000-0000-000000000000'::uuid));

-- Backfill (migration section 6).
WITH resolvable AS (
  SELECT uc.user_id, (array_agg(DISTINCT uc.sub_department_id))[1] AS sub_department_id
    FROM hr.user_contracts uc
   WHERE uc.status='Active' AND uc.sub_department_id IS NOT NULL
   GROUP BY uc.user_id
  HAVING count(DISTINCT uc.sub_department_id)=1
     AND NOT EXISTS (SELECT 1 FROM hr.user_contracts w
                      WHERE w.user_id=uc.user_id AND w.status='Active' AND w.sub_department_id IS NULL)
)
UPDATE public.availability_rules r SET sub_department_id = x.sub_department_id
  FROM resolvable x WHERE r.profile_id = x.user_id AND r.sub_department_id IS NULL;

UPDATE public.availability_slots s SET sub_department_id = r.sub_department_id
  FROM public.availability_rules r
 WHERE s.rule_id = r.id AND r.sub_department_id IS NOT NULL
   AND s.sub_department_id IS DISTINCT FROM r.sub_department_id;

-- ============================================================================
-- TEST 0 — the defect, demonstrated before it is fixed.
--
-- Phase 1 is applied; Phase 2 is not. The person-wide guard is still in force,
-- so the 1-FT-plus-Casual employee cannot declare for their CASUAL job even
-- though the column to say so now exists. If this ever stops failing, the
-- premise of 20260821090100 has gone away and it should be re-justified rather
-- than kept out of habit.
-- ============================================================================

SET client_min_messages = notice;

DO $t0$
DECLARE t text := 'accepted';
BEGIN
  BEGIN
    INSERT INTO public.availability_rules (profile_id,start_date,start_time,end_time,repeat_type,sub_department_id)
      VALUES ('b0000000-0000-0000-0000-000000000001','2026-12-01','09:00','17:00','none',
              '50000000-0000-0000-0000-000000000002');   -- Set-up, a CASUAL job
    RAISE EXCEPTION 'rollback t0' USING ERRCODE = 'raise_exception';
  EXCEPTION
    WHEN check_violation THEN t := 'rejected';
    WHEN raise_exception THEN NULL;
  END;
  IF t <> 'rejected' THEN
    RAISE EXCEPTION 'T0 FAILED: the person-wide guard accepted a casual-scoped declaration — the defect 20260821090100 fixes is not present, so tests 12-16 prove nothing';
  END IF;
  RAISE NOTICE 'ok 0 — person-wide guard blocks the casual job (the defect, reproduced)';
END $t0$;

-- ============================================================================
-- APPLY MIGRATION 20260821090100 (per-job Full-Time guard)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sm_holds_active_ft_contract_in(p_profile_id uuid, p_sub_department_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, hr, pg_catalog AS $f$
  SELECT CASE
    WHEN p_sub_department_id IS NULL THEN public.sm_holds_active_ft_contract(p_profile_id)
    ELSE EXISTS (
      SELECT 1 FROM hr.user_contracts uc
       WHERE uc.user_id = p_profile_id AND uc.status = 'Active'
         AND LOWER(COALESCE(uc.employment_status::text,'')) LIKE '%full%'
         AND ( uc.sub_department_id = p_sub_department_id
            OR (uc.sub_department_id IS NULL AND uc.department_id IS NOT NULL
                AND uc.department_id = (SELECT sd.department_id FROM public.sub_departments sd
                                         WHERE sd.id = p_sub_department_id))))
  END;
$f$;

CREATE OR REPLACE FUNCTION public.trg_prevent_ft_availability_rule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, hr, pg_catalog AS $fn$
BEGIN
  IF public.sm_holds_active_ft_contract_in(NEW.profile_id, NEW.sub_department_id) THEN
    RAISE EXCEPTION 'Availability is contract based for Full Time employees. Use Leave Management for unavailability.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $fn$;

DROP TRIGGER IF EXISTS trg_prevent_ft_availability_rule ON public.availability_rules;
CREATE TRIGGER trg_prevent_ft_availability_rule BEFORE INSERT OR UPDATE ON public.availability_rules
  FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_ft_availability_rule();
DROP TRIGGER IF EXISTS trg_prevent_ft_availability_rule ON public.availability_exceptions;
CREATE TRIGGER trg_prevent_ft_availability_rule BEFORE INSERT OR UPDATE ON public.availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_ft_availability_rule();

-- ============================================================================
-- ASSERTIONS
-- ============================================================================

DO $tests$
DECLARE
  n int; t text; v_r1 uuid;
  MULTI uuid := 'a0000000-0000-0000-0000-00000000000a';
  FTMIX uuid := 'b0000000-0000-0000-0000-000000000001';
  SOLO  uuid := 'c0000000-0000-0000-0000-000000000001';
  DEPTW uuid := 'e0000000-0000-0000-0000-000000000001';
  ORPHAN uuid := 'f0000000-0000-0000-0000-000000000001';
  SEC uuid := '50000000-0000-0000-0000-000000000001';
  SETUP uuid := '50000000-0000-0000-0000-000000000002';
  FOH uuid := '50000000-0000-0000-0000-000000000003';
BEGIN

  -- 1. the column landed everywhere
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND column_name='sub_department_id'
     AND table_name IN ('availability_rules','availability_slots','availability_exceptions',
                        'availability_requests','availability_rules_archive','availability_slots_archive');
  IF n <> 6 THEN RAISE EXCEPTION 'T1 FAILED: sub_department_id on % of 6 tables', n; END IF;
  RAISE NOTICE 'ok 1 — column present on all six tables';

  -- 2. the index is the EXPRESSION form, not the plain-column form
  SELECT count(*) INTO n FROM pg_indexes
   WHERE schemaname='public' AND indexname='availability_slots_uniq'
     AND indexdef LIKE '%COALESCE%sub_department_id%';
  IF n <> 1 THEN RAISE EXCEPTION 'T2 FAILED: availability_slots_uniq is not the COALESCE expression form'; END IF;
  RAISE NOTICE 'ok 2 — unique index is the COALESCE expression form';

  -- 3. THE FEATURE: two sub-departments, same person, same date, same window
  INSERT INTO public.availability_rules (profile_id,start_date,start_time,end_time,repeat_type,sub_department_id)
    VALUES (FTMIX,'2027-02-01','09:00','17:00','none',SETUP);
  INSERT INTO public.availability_rules (profile_id,start_date,start_time,end_time,repeat_type,sub_department_id)
    VALUES (FTMIX,'2027-02-01','09:00','17:00','none',FOH);
  SELECT count(*) INTO n FROM public.availability_slots
   WHERE profile_id=FTMIX AND slot_date='2027-02-01' AND start_time='09:00';
  IF n <> 2 THEN RAISE EXCEPTION 'T3 FAILED: expected 2 slots for two sub-departments, got % — the unique index is eating declarations', n; END IF;
  RAISE NOTICE 'ok 3 — two sub-departments coexist on one date/window';

  -- 4. the SAME sub-department twice is still deduped
  INSERT INTO public.availability_rules (profile_id,start_date,start_time,end_time,repeat_type,sub_department_id)
    VALUES (FTMIX,'2027-02-01','09:00','17:00','none',SETUP);
  SELECT count(*) INTO n FROM public.availability_slots
   WHERE profile_id=FTMIX AND slot_date='2027-02-01' AND start_time='09:00';
  IF n <> 2 THEN RAISE EXCEPTION 'T4 FAILED: duplicate sub-department produced % slots, expected 2', n; END IF;
  RAISE NOTICE 'ok 4 — same sub-department twice still dedupes';

  -- 5. the COALESCE sentinel dedupes UNSCOPED rows (a bare nullable column would not)
  INSERT INTO public.availability_slots (profile_id,slot_date,start_time,end_time,source,sub_department_id)
    VALUES (SOLO,'2027-04-01','10:00','14:00','rule',NULL) ON CONFLICT DO NOTHING;
  INSERT INTO public.availability_slots (profile_id,slot_date,start_time,end_time,source,sub_department_id)
    VALUES (SOLO,'2027-04-01','10:00','14:00','rule',NULL) ON CONFLICT DO NOTHING;
  SELECT count(*) INTO n FROM public.availability_slots
   WHERE profile_id=SOLO AND slot_date='2027-04-01';
  IF n <> 1 THEN RAISE EXCEPTION 'T5 FAILED: unscoped duplicate produced % rows, expected 1 — NULLs are not being folded onto the sentinel', n; END IF;
  RAISE NOTICE 'ok 5 — unscoped rows still dedupe via the sentinel';

  -- 6. slots inherit their rule's scope
  SELECT count(*) INTO n FROM public.availability_slots s
    JOIN public.availability_rules r ON r.id = s.rule_id
   WHERE s.sub_department_id IS DISTINCT FROM r.sub_department_id;
  IF n <> 0 THEN RAISE EXCEPTION 'T6 FAILED: % slot(s) disagree with their source rule', n; END IF;
  RAISE NOTICE 'ok 6 — every slot agrees with its rule';

  -- 7. the guard refuses a sub-department the profile holds no contract in
  t := 'NOT RAISED';
  BEGIN
    INSERT INTO public.availability_rules (profile_id,start_date,start_time,end_time,repeat_type,sub_department_id)
      VALUES (SOLO,'2027-05-01','09:00','17:00','none',SEC);
  EXCEPTION WHEN check_violation THEN t := 'rejected';
  END;
  IF t <> 'rejected' THEN RAISE EXCEPTION 'T7 FAILED: an uncontracted sub-department was accepted'; END IF;
  RAISE NOTICE 'ok 7 — uncontracted scope rejected';

  -- 8. a DEPARTMENT-WIDE contract is in scope for every sub-department beneath it
  INSERT INTO public.availability_rules (profile_id,start_date,start_time,end_time,repeat_type,sub_department_id)
    VALUES (DEPTW,'2027-06-01','09:00','17:00','none',FOH);
  SELECT count(*) INTO n FROM public.availability_rules WHERE profile_id=DEPTW AND sub_department_id=FOH;
  IF n <> 1 THEN RAISE EXCEPTION 'T8 FAILED: department-wide contract did not admit its sub-department'; END IF;
  RAISE NOTICE 'ok 8 — department-wide contract covers its sub-departments';

  -- 9. the backfill scoped only the unambiguous
  SELECT sub_department_id::text INTO t FROM public.availability_rules
   WHERE profile_id=SOLO AND start_date='2027-01-04';
  IF t IS DISTINCT FROM SETUP::text THEN RAISE EXCEPTION 'T9a FAILED: single-contract profile backfilled to %, expected Set-up', t; END IF;

  SELECT sub_department_id::text INTO t FROM public.availability_rules
   WHERE profile_id=MULTI AND start_date='2027-01-04';
  IF t IS NOT NULL THEN RAISE EXCEPTION 'T9b FAILED: two-sub-department profile was backfilled to % — the backfill invented an answer', t; END IF;

  SELECT sub_department_id::text INTO t FROM public.availability_rules
   WHERE profile_id=ORPHAN AND start_date='2027-01-04';
  IF t IS NOT NULL THEN RAISE EXCEPTION 'T9c FAILED: contractless profile was backfilled to %', t; END IF;
  RAISE NOTICE 'ok 9 — backfill scoped the unambiguous and only the unambiguous';

  -- 10. an unscoped (NULL) rule is still accepted — this is what keeps the
  --     migration a no-op for every pre-existing reader
  INSERT INTO public.availability_rules (profile_id,start_date,start_time,end_time,repeat_type,sub_department_id)
    VALUES (MULTI,'2027-07-01','09:00','17:00','none',NULL) RETURNING id INTO v_r1;
  SELECT count(*) INTO n FROM public.availability_slots WHERE rule_id=v_r1 AND sub_department_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'T10 FAILED: unscoped rule produced % unscoped slot(s), expected 1', n; END IF;
  RAISE NOTICE 'ok 10 — unscoped declarations still work';

  -- ── 20260821090100: the per-job Full-Time guard ──────────────────────────

  -- 12. THE FIX: the 1-FT-plus-Casual employee can now declare for a CASUAL job.
  --     Test 0 proved this exact insert was refused a moment ago.
  SELECT count(*) INTO n FROM public.availability_rules
   WHERE profile_id=FTMIX AND sub_department_id IN (SETUP, FOH);
  IF n < 2 THEN RAISE EXCEPTION 'T12 FAILED: FT+Casual employee holds % casual-scoped rule(s), expected at least 2', n; END IF;
  RAISE NOTICE 'ok 12 — FT+Casual employee can declare for their casual jobs';

  -- 13. …and is STILL refused for the Full-Time one.
  t := 'NOT RAISED';
  BEGIN
    INSERT INTO public.availability_rules (profile_id,start_date,start_time,end_time,repeat_type,sub_department_id)
      VALUES (FTMIX,'2027-09-01','09:00','17:00','none',SEC);
  EXCEPTION WHEN check_violation THEN t := 'rejected';
  END;
  IF t <> 'rejected' THEN RAISE EXCEPTION 'T13 FAILED: a Full-Time-scoped declaration was accepted'; END IF;
  RAISE NOTICE 'ok 13 — Full-Time job still refuses declarations';

  -- 14. THE HOLE THAT WOULD OTHERWISE OPEN: an UNSCOPED declaration covers every
  --     job including the Full-Time one, so it must still hit the person-wide
  --     test. Without the fallback branch every full-timer could re-acquire
  --     availability just by leaving the scope unset — which is what every
  --     pre-Phase-5 client does by default.
  t := 'NOT RAISED';
  BEGIN
    INSERT INTO public.availability_rules (profile_id,start_date,start_time,end_time,repeat_type,sub_department_id)
      VALUES (FTMIX,'2027-09-02','09:00','17:00','none',NULL);
  EXCEPTION WHEN check_violation THEN t := 'rejected';
  END;
  IF t <> 'rejected' THEN RAISE EXCEPTION 'T14 FAILED: an UNSCOPED declaration by an FT-holder was accepted — the guard has a hole'; END IF;
  RAISE NOTICE 'ok 14 — unscoped declarations still hit the person-wide test';

  -- 15. A casual is untouched. The failure that would matter most: this is the
  --     101-person majority, and a guard that over-fires here stops the entire
  --     workforce declaring anything.
  INSERT INTO public.availability_rules (profile_id,start_date,start_time,end_time,repeat_type,sub_department_id)
    VALUES (SOLO,'2027-09-03','09:00','17:00','none',SETUP);
  SELECT count(*) INTO n FROM public.availability_rules WHERE profile_id=SOLO AND start_date='2027-09-03';
  IF n <> 1 THEN RAISE EXCEPTION 'T15 FAILED: a casual was blocked by the FT guard'; END IF;
  RAISE NOTICE 'ok 15 — casuals unaffected';

  -- 16. availability_exceptions is now guarded at the DATABASE, which it never
  --     was (createAvailabilityException: "this table has no DB-level FT
  --     trigger, so this check is the only enforcement there is").
  t := 'NOT RAISED';
  BEGIN
    INSERT INTO public.availability_exceptions (profile_id,exception_date,start_time,end_time,severity,sub_department_id)
      VALUES (FTMIX,'2027-09-04','09:00','17:00','SOFT',SEC);
  EXCEPTION WHEN check_violation THEN t := 'rejected';
  END;
  IF t <> 'rejected' THEN RAISE EXCEPTION 'T16a FAILED: an FT-scoped exception was accepted'; END IF;

  --     …but the casual job accepts one, which is the point of the rescoping.
  INSERT INTO public.availability_exceptions (profile_id,exception_date,start_time,end_time,severity,sub_department_id)
    VALUES (FTMIX,'2027-09-04','09:00','17:00','SOFT',SETUP);
  SELECT count(*) INTO n FROM public.availability_exceptions WHERE profile_id=FTMIX;
  IF n <> 1 THEN RAISE EXCEPTION 'T16b FAILED: a casual-scoped exception was refused'; END IF;
  RAISE NOTICE 'ok 16 — exceptions guarded per-job at the database';

  RAISE NOTICE '';
  RAISE NOTICE 'ALL AVAILABILITY SCOPE TESTS PASSED';
END $tests$;

-- ============================================================================
-- 11. The rewrite of sm_materialize_contract_envelope is NECESSARY, not tidy.
--
-- Asserted separately because it needs the deployed body to FAIL. A conflict
-- target naming the replaced index raises 42P10 — on a pg_cron job, where it
-- surfaces as a silently stale envelope rather than as an error anyone sees.
-- ============================================================================

DO $envelope$
DECLARE t text := 'NOT RAISED';
BEGIN
  BEGIN
    INSERT INTO public.availability_slots (profile_id, slot_date, start_time, end_time, source)
    VALUES ('c0000000-0000-0000-0000-000000000001','2027-08-01','09:00','17:00','envelope')
    ON CONFLICT (profile_id, slot_date, start_time, end_time, source) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN t := SQLSTATE;
  END;
  IF t <> '42P10' THEN
    RAISE EXCEPTION 'T11 FAILED: the OLD conflict target still resolves (%) — the index swap did not take, so the envelope rewrite is untested', t;
  END IF;

  -- and the new one does resolve
  INSERT INTO public.availability_slots (profile_id, slot_date, start_time, end_time, source)
  VALUES ('c0000000-0000-0000-0000-000000000001','2027-08-01','09:00','17:00','envelope')
  ON CONFLICT (profile_id, slot_date, start_time, end_time, source,
               COALESCE(sub_department_id,'00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;

  RAISE NOTICE 'ok 11 — old conflict target raises 42P10; rewritten target resolves';
  RAISE NOTICE 'ALL ENVELOPE CONFLICT-TARGET TESTS PASSED';
END $envelope$;
