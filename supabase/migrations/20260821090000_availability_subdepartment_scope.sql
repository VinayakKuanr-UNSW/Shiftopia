-- =============================================================================
-- Migration: 20260821090000_availability_subdepartment_scope.sql
-- Description: Give availability a sub-department dimension.
--
-- WHY. Every availability table is keyed on `profile_id` alone, while
-- employment is a property of a CONTRACT: `user_contracts` carries
-- (department_id, sub_department_id, role_id, employment_status) per row and
-- 10 of 103 people in production hold more than one, up to five. One person
-- holds a Full-Time contract in Building Services · Security AND four Casual
-- contracts across Event Delivery · Set-up and Live Events · Front of House.
--
-- With no scope column, every reader that needs a department has to guess one,
-- and `resolveComplianceBasis` — written to pick ONE basis for the rolling
-- ordinary-hours caps, where person-wide is correct — is the thing doing the
-- guessing. Its documented "non-casual beats casual" ordering resolves that
-- person onto their Full-Time contract, so the availability page hides the
-- editor and `trg_prevent_ft_availability_rule` refuses the write. Their four
-- casual jobs cannot declare availability at all, and the solver then
-- hard-filters them out of every casual shift under OPT_IN with no reason
-- emitted (the HC-5d 0/144 failure shape).
--
-- This migration adds the dimension and nothing else. It does NOT change who
-- may declare what — that is 20260821090100 (the per-job Full-Time guard).
-- Every column added here is NULLABLE and every reader treats NULL as "all of
-- my sub-departments", so applying this file leaves production behaving
-- exactly as it does today.
--
-- SCOPE OF THE CHANGE. Six tables gain the column, two functions are rewritten
-- to carry it, one unique index is replaced, and 85 of 90 existing rules are
-- backfilled. The two function rewrites are NOT optional cleanups — see the
-- unique-index note in section 4.
-- =============================================================================

-- ── 1. The column ────────────────────────────────────────────────────────────
--
-- NULL means UNSCOPED: "this declaration covers every sub-department I hold a
-- contract in". That is the only value that can preserve today's behaviour for
-- rows written before this migration, and it is what the five rules the
-- backfill cannot resolve keep (section 6).
--
-- `sub_departments` rather than a (department_id, sub_department_id) pair:
-- `sub_departments.department_id` is NOT NULL, so the department is always
-- derivable and storing it too would create a second copy that can disagree.

ALTER TABLE public.availability_rules
  ADD COLUMN IF NOT EXISTS sub_department_id uuid
    REFERENCES public.sub_departments (id) ON DELETE RESTRICT;

ALTER TABLE public.availability_slots
  ADD COLUMN IF NOT EXISTS sub_department_id uuid
    REFERENCES public.sub_departments (id) ON DELETE RESTRICT;

ALTER TABLE public.availability_exceptions
  ADD COLUMN IF NOT EXISTS sub_department_id uuid
    REFERENCES public.sub_departments (id) ON DELETE RESTRICT;

ALTER TABLE public.availability_requests
  ADD COLUMN IF NOT EXISTS sub_department_id uuid
    REFERENCES public.sub_departments (id) ON DELETE RESTRICT;

-- ON DELETE RESTRICT, not CASCADE or SET NULL. Deleting a sub-department that
-- still has availability declared against it is a data-migration decision, not
-- something a stray DELETE should silently resolve: CASCADE would destroy the
-- declarations and SET NULL would silently WIDEN them to every sub-department
-- the person holds, which is the failure this whole migration exists to stop.

COMMENT ON COLUMN public.availability_rules.sub_department_id IS
  'Which job this declaration is for. NULL = unscoped: covers every '
  'sub-department the profile holds an Active contract in. Employment status '
  'is a property of the contract, not the person — see '
  'src/modules/rosters/services/eligibility.service.ts, which already resolves '
  'it this way on the manager side.';
COMMENT ON COLUMN public.availability_slots.sub_department_id IS
  'Copied from the source rule by generate_availability_slots(). NULL for '
  'envelope-sourced slots, which are contract-wide by construction.';
COMMENT ON COLUMN public.availability_exceptions.sub_department_id IS
  'Which job this exception subtracts from. NULL = every one of them.';
COMMENT ON COLUMN public.availability_requests.sub_department_id IS
  'Which job the manager is asking the employee to declare for. NULL = any.';

-- The archive tables take the column too, so a future purge cannot silently
-- drop the scope of the rows it cold-stores.
--
-- HAZARD, stated rather than hidden: the purge block in
-- 20260817120000_ft_availability_removal.sql archives POSITIONALLY
-- (`SELECT r.*, now(), v_reason`). Appending here puts `sub_department_id`
-- after `archived_reason` in the archive but LAST in the live table, so that
-- statement no longer lines up. It is a one-shot DO block that has already run
-- and must never run again (`supabase db push` is forbidden on this project),
-- and if it somehow did it now fails loudly on a uuid→timestamptz mismatch
-- rather than writing misaligned rows. Any NEW archive write must name its
-- columns explicitly.

ALTER TABLE public.availability_rules_archive
  ADD COLUMN IF NOT EXISTS sub_department_id uuid;
ALTER TABLE public.availability_slots_archive
  ADD COLUMN IF NOT EXISTS sub_department_id uuid;

-- ── 2. "Does this person hold a job here?" ───────────────────────────────────
--
-- One definition, so the write guard below and the Full-Time guard in
-- 20260821090100 can never disagree about one person — the same reasoning that
-- produced `sm_holds_active_ft_contract` in 20260817120000.
--
-- Reads `hr.user_contracts` directly rather than the `public.user_contracts`
-- VIEW: this is SECURITY DEFINER and must see every contract, not the subset
-- the calling user's RLS admits.

CREATE OR REPLACE FUNCTION public.sm_holds_active_contract_in(
  p_profile_id        uuid,
  p_sub_department_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, hr, pg_catalog
AS $$
  SELECT p_sub_department_id IS NULL
      OR EXISTS (
           SELECT 1
             FROM hr.user_contracts uc
            WHERE uc.user_id = p_profile_id
              AND uc.status  = 'Active'
              AND (
                    uc.sub_department_id = p_sub_department_id
                    -- A contract with no sub-department is DEPARTMENT-WIDE and
                    -- therefore in scope for every sub-department beneath it.
                    -- No Active contract is in that shape today (0 of 140), but
                    -- the manager-side reader already handles it and the two
                    -- must not diverge.
                 OR (uc.sub_department_id IS NULL
                     AND uc.department_id IS NOT NULL
                     AND uc.department_id = (
                           SELECT sd.department_id
                             FROM public.sub_departments sd
                            WHERE sd.id = p_sub_department_id))
                  )
         );
$$;

COMMENT ON FUNCTION public.sm_holds_active_contract_in(uuid, uuid) IS
  'True when the profile holds an Active contract in that sub-department, or a '
  'department-wide one above it. NULL sub-department returns true (unscoped). '
  'Shared by trg_availability_scope_is_contracted and, from 20260821090100, by '
  'the per-job Full-Time write guard.';

-- Supabase grants EXECUTE on new functions to PUBLIC (hence anon) AND to
-- authenticated; revoking PUBLIC alone leaves it callable over /rest/v1/rpc.
REVOKE ALL ON FUNCTION public.sm_holds_active_contract_in(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ── 3. You cannot declare availability for a job you do not hold ─────────────

CREATE OR REPLACE FUNCTION public.trg_availability_scope_is_contracted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, hr, pg_catalog
AS $$
BEGIN
  IF NEW.sub_department_id IS NOT NULL
     AND NOT public.sm_holds_active_contract_in(NEW.profile_id, NEW.sub_department_id) THEN
    RAISE EXCEPTION
      'No Active contract in that sub-department — availability can only be declared for a job you hold.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_availability_scope_is_contracted() IS
  'BEFORE INSERT OR UPDATE on availability_rules and availability_exceptions: '
  'rejects a scope the profile holds no Active contract in. A CHECK constraint '
  'could not carry this — it may only call IMMUTABLE functions and this reads '
  'another table.';

REVOKE ALL ON FUNCTION public.trg_availability_scope_is_contracted()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_availability_scope_is_contracted ON public.availability_rules;
CREATE TRIGGER trg_availability_scope_is_contracted
  BEFORE INSERT OR UPDATE ON public.availability_rules
  FOR EACH ROW EXECUTE FUNCTION public.trg_availability_scope_is_contracted();

DROP TRIGGER IF EXISTS trg_availability_scope_is_contracted ON public.availability_exceptions;
CREATE TRIGGER trg_availability_scope_is_contracted
  BEFORE INSERT OR UPDATE ON public.availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.trg_availability_scope_is_contracted();

-- `availability_requests` is deliberately NOT guarded. A request is a message
-- from a manager ("please declare your availability for Set-up"), not a
-- declaration, and onboarding legitimately sends one before the contract row
-- exists. Guarding it would block that with a check_violation the manager
-- cannot act on.

-- ── 4. Slots carry the scope, and the unique index respects it ───────────────
--
-- THIS IS THE LOAD-BEARING PART OF THE FILE.
--
-- `availability_slots_uniq` is (profile_id, slot_date, start_time, end_time,
-- source) and generate_availability_slots() inserts ON CONFLICT DO NOTHING.
-- Add the column without extending the index and "09:00-17:00 for Set-up" plus
-- "09:00-17:00 for Front of House" on the same date collapse to ONE row — no
-- error, no log, the second declaration simply never exists. That is the
-- feature this migration exists to enable, failing silently on day one.
--
-- COALESCE to a sentinel rather than the bare column, because a NULL in a
-- unique index makes every NULL row distinct from every other one. On the bare
-- column the 5,502 unscoped rows we are about to create would lose their
-- uniqueness guarantee entirely and true duplicates would flow back in.

CREATE OR REPLACE FUNCTION public.generate_availability_slots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  current_date_cursor date;
  end_date_limit date;
  weekday int;
  days_diff int;
begin
  current_date_cursor := coalesce(new.start_date, current_date);

  if new.repeat_type = 'none' then
    end_date_limit := current_date_cursor;
  else
    end_date_limit := least(
      coalesce(new.repeat_end_date, '2099-01-01'),
      current_date_cursor + interval '180 days'
    );
  end if;

  while current_date_cursor <= end_date_limit loop
    weekday := extract(isodow from current_date_cursor);
    days_diff := (current_date_cursor - new.start_date);

    if
      new.repeat_type = 'none'
      or new.repeat_type = 'daily'
      or (
        new.repeat_type = 'weekly'
        and weekday = any(new.repeat_days)
      )
      or (
        new.repeat_type = 'fortnightly'
        and weekday = any(new.repeat_days)
        and (
          (days_diff / 7)::int % 2 = 0
        )
      )
    then
      insert into availability_slots (
        rule_id,
        profile_id,
        slot_date,
        start_time,
        end_time,
        -- THE ONE ADDED LINE. Everything else in this body is the deployed
        -- definition verbatim, transcribed from pg_get_functiondef() in
        -- production so the rewrite cannot silently drift.
        sub_department_id
      )
      values (
        new.id,
        new.profile_id,
        current_date_cursor,
        new.start_time,
        new.end_time,
        new.sub_department_id
      )
      on conflict do nothing;
    end if;

    if new.repeat_type = 'none' then
      exit;
    end if;

    current_date_cursor := current_date_cursor + interval '1 day';
  end loop;

  return new;
end;
$function$;

-- Swap the index. Plain CREATE (not CONCURRENTLY) so it runs inside this
-- migration's transaction and there is never a window in which the table has
-- no uniqueness guarantee. 5,502 rows — the lock is momentary.
DROP INDEX IF EXISTS public.availability_slots_uniq;
CREATE UNIQUE INDEX availability_slots_uniq
  ON public.availability_slots (
    profile_id, slot_date, start_time, end_time, source,
    COALESCE(sub_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

COMMENT ON INDEX public.availability_slots_uniq IS
  'One slot per (profile, date, window, source, SCOPE). The COALESCE sentinel '
  'is required: a bare nullable column would make every unscoped row distinct '
  'from every other and drop the uniqueness guarantee for them.';

-- The scoped window read that Phase 6 (roster-fetcher, reserve list, People
-- Mode) will issue on every solve.
CREATE INDEX IF NOT EXISTS availability_slots_profile_scope_date_idx
  ON public.availability_slots (profile_id, sub_department_id, slot_date);

CREATE INDEX IF NOT EXISTS availability_rules_profile_scope_idx
  ON public.availability_rules (profile_id, sub_department_id);

-- ── 5. sm_materialize_contract_envelope: keep its ON CONFLICT valid ──────────
--
-- NOT a cleanup. That function names its conflict target explicitly —
-- `ON CONFLICT (profile_id, slot_date, start_time, end_time, source)` — and
-- section 4 just replaced the only index that clause could infer. Left alone it
-- raises 42P10 "no unique or exclusion constraint matching the ON CONFLICT
-- specification" on its next run, which is a pg_cron job, not a user action:
-- the failure would surface as a silently stale envelope rather than an error
-- anyone sees.
--
-- The body below is the PRODUCTION definition read back from
-- pg_get_functiondef(), with the inference clause as the only change. The
-- DELETE is deliberately untouched: this function writes envelope slots with a
-- NULL scope and its reclaim predicate is therefore still exactly right.
-- Whether the envelope itself should become per-job is a Phase 6 question.

CREATE OR REPLACE FUNCTION public.sm_materialize_contract_envelope(
  p_from        date   DEFAULT CURRENT_DATE,
  p_to          date   DEFAULT (CURRENT_DATE + 180),
  p_profile_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(profiles_touched integer, slots_written integer, slots_removed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'hr'
AS $function$
DECLARE
  v_written int := 0;
  v_removed int := 0;
  v_touched int := 0;
BEGIN
  IF p_to < p_from THEN
    RAISE EXCEPTION 'sm_materialize_contract_envelope: p_to (%) is before p_from (%)', p_to, p_from
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_to - p_from) > 400 THEN
    RAISE EXCEPTION 'sm_materialize_contract_envelope: horizon of % days exceeds the 400-day maximum', (p_to - p_from)
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  DROP TABLE IF EXISTS _env_target;
  DROP TABLE IF EXISTS _env_scope;

  CREATE TEMP TABLE _env_target ON COMMIT DROP AS
  WITH basis AS (
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
       AND NOT public.sm_holds_active_ft_contract(uc.user_id)
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
     AND NOT EXISTS (
       SELECT 1 FROM public.employee_leave_days eld
        WHERE eld.employee_id = b.user_id
          AND eld.leave_date  = d::date
     );

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
    -- CHANGED BY 20260821090000: must match the new expression index exactly.
    ON CONFLICT (profile_id, slot_date, start_time, end_time, source,
                 COALESCE(sub_department_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO NOTHING
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
$function$;

-- ── 6. Backfill ──────────────────────────────────────────────────────────────
--
-- Resolve each existing rule onto its owner's sub-department where — and only
-- where — that is unambiguous: the profile holds Active contracts resolving to
-- exactly ONE sub-department. 85 of 90 rules qualify.
--
-- The other five stay NULL, which is the honest answer and the safe one
-- (unscoped = covers everything = today's behaviour):
--   * ONE profile holds Active contracts in TWO sub-departments (Casual in
--     both Building Services · Security and Event Delivery · Set-up). Splitting
--     their single declaration between the two is a decision only they can
--     make, and Phase 5 is what gives them the control to make it.
--   * FOUR profiles hold availability rules while holding ZERO contracts of any
--     status. Those declarations are already orphaned — that is a data-hygiene
--     problem this migration must not paper over by inventing a scope.

DO $$
DECLARE
  v_rules_scoped        int;
  v_slots_from_rule     int;
  v_slots_orphan        int;
  v_rules_unscoped      int;
  v_ambiguous           int;
BEGIN
  WITH resolvable AS (
    -- `(array_agg(DISTINCT ...))[1]`, not `min(...)`: PostgreSQL has no min/max
    -- aggregate for uuid (verified absent on the 17.6 instance this targets), so
    -- `min(sub_department_id)` fails outright with "function min(uuid) does not
    -- exist". The HAVING below has already established there is exactly one
    -- distinct value, so which element is taken is not a choice.
    SELECT uc.user_id,
           (array_agg(DISTINCT uc.sub_department_id))[1] AS sub_department_id
      FROM hr.user_contracts uc
     WHERE uc.status = 'Active'
       AND uc.sub_department_id IS NOT NULL
     GROUP BY uc.user_id
    HAVING count(DISTINCT uc.sub_department_id) = 1
       -- A department-wide contract alongside a scoped one would make the
       -- single sub-department an understatement of where they may work.
       AND NOT EXISTS (
         SELECT 1 FROM hr.user_contracts w
          WHERE w.user_id = uc.user_id
            AND w.status = 'Active'
            AND w.sub_department_id IS NULL
       )
  ), upd AS (
    UPDATE public.availability_rules r
       SET sub_department_id = x.sub_department_id
      FROM resolvable x
     WHERE r.profile_id = x.user_id
       AND r.sub_department_id IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_rules_scoped FROM upd;

  -- Slots follow their rule. This is the authoritative path: every slot with a
  -- rule_id inherits exactly what the rule now says.
  WITH upd AS (
    UPDATE public.availability_slots s
       SET sub_department_id = r.sub_department_id
      FROM public.availability_rules r
     WHERE s.rule_id = r.id
       AND r.sub_department_id IS NOT NULL
       AND s.sub_department_id IS DISTINCT FROM r.sub_department_id
    RETURNING 1
  )
  SELECT count(*) INTO v_slots_from_rule FROM upd;

  -- Rule-sourced slots whose rule_id is NULL cannot inherit, so they resolve
  -- against the profile directly, under the same unambiguity test. Production
  -- held 134 of these for full-timers before 20260817120000 deleted them; this
  -- covers any that remain rather than leaving them as the one shape of row the
  -- backfill silently skips.
  WITH resolvable AS (
    SELECT uc.user_id, (array_agg(DISTINCT uc.sub_department_id))[1] AS sub_department_id
      FROM hr.user_contracts uc
     WHERE uc.status = 'Active' AND uc.sub_department_id IS NOT NULL
     GROUP BY uc.user_id
    HAVING count(DISTINCT uc.sub_department_id) = 1
       AND NOT EXISTS (
         SELECT 1 FROM hr.user_contracts w
          WHERE w.user_id = uc.user_id AND w.status = 'Active'
            AND w.sub_department_id IS NULL)
  ), upd AS (
    UPDATE public.availability_slots s
       SET sub_department_id = x.sub_department_id
      FROM resolvable x
     WHERE s.profile_id = x.user_id
       AND s.rule_id IS NULL
       AND s.source = 'rule'
       AND s.sub_department_id IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_slots_orphan FROM upd;

  SELECT count(*) INTO v_rules_unscoped
    FROM public.availability_rules WHERE sub_department_id IS NULL;

  SELECT count(DISTINCT r.profile_id) INTO v_ambiguous
    FROM public.availability_rules r
   WHERE r.sub_department_id IS NULL
     AND EXISTS (SELECT 1 FROM hr.user_contracts uc
                  WHERE uc.user_id = r.profile_id AND uc.status = 'Active');

  RAISE LOG '[availability-scope] % rule(s) scoped, % slot(s) via rule, % orphan slot(s), % rule(s) left unscoped (% of them held by someone with an Active contract)',
    v_rules_scoped, v_slots_from_rule, v_slots_orphan, v_rules_unscoped, v_ambiguous;
END $$;

-- ── 7. Verification ──────────────────────────────────────────────────────────
--
-- Assert the invariants rather than trusting the statements above. A migration
-- that reports success on a half-applied state is worse than one that fails.

DO $$
DECLARE
  v_bad_scope   int;
  v_rule_mismatch int;
  v_uniq        int;
BEGIN
  -- Every scoped row names a sub-department its owner actually holds.
  SELECT count(*) INTO v_bad_scope FROM (
    SELECT r.id FROM public.availability_rules r
     WHERE r.sub_department_id IS NOT NULL
       AND NOT public.sm_holds_active_contract_in(r.profile_id, r.sub_department_id)
    UNION ALL
    SELECT e.id FROM public.availability_exceptions e
     WHERE e.sub_department_id IS NOT NULL
       AND NOT public.sm_holds_active_contract_in(e.profile_id, e.sub_department_id)
  ) q;

  IF v_bad_scope > 0 THEN
    RAISE EXCEPTION
      'availability-scope: % row(s) are scoped to a sub-department the profile holds no Active contract in — the backfill disagrees with the trigger it just installed',
      v_bad_scope USING ERRCODE = 'data_exception';
  END IF;

  -- No slot may disagree with the rule that produced it.
  SELECT count(*) INTO v_rule_mismatch
    FROM public.availability_slots s
    JOIN public.availability_rules r ON r.id = s.rule_id
   WHERE s.sub_department_id IS DISTINCT FROM r.sub_department_id;

  IF v_rule_mismatch > 0 THEN
    RAISE EXCEPTION
      'availability-scope: % slot(s) carry a scope their source rule does not',
      v_rule_mismatch USING ERRCODE = 'data_exception';
  END IF;

  -- The index that makes two sub-departments possible must actually exist, and
  -- must be the expression form — the plain-column form would compile, apply,
  -- and then eat declarations.
  SELECT count(*) INTO v_uniq
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname  = 'availability_slots_uniq'
     AND indexdef LIKE '%COALESCE%sub_department_id%';

  IF v_uniq <> 1 THEN
    RAISE EXCEPTION
      'availability-scope: availability_slots_uniq is missing or is not the COALESCE expression form'
      USING ERRCODE = 'data_exception';
  END IF;

  RAISE LOG '[availability-scope] verification passed';
END $$;
