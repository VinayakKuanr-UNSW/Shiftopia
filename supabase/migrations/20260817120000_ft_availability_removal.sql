-- =============================================================================
-- Migration: 20260817120000_ft_availability_removal.sql
-- Description: Remove availability management for Full-Time (FT) employees.
--              FT employees are available by virtue of their employment
--              contract; unavailability is managed strictly through Leave
--              Management (`employee_leave_days` -> solver `unavailable_dates`).
--
-- WHAT "FT" MEANS HERE, AND WHY EVERY TEST IN THIS FILE IS THE SAME ONE.
-- Three places below have to answer "is this person Full-Time?" — the write
-- guard, the envelope materializer, and the purge. They MUST agree: if the
-- materializer thinks someone is Part-Time while the trigger thinks they are
-- Full-Time, the materializer writes envelope slots that nothing will ever
-- reclaim and that no one can delete through the UI. So all three use the
-- identical predicate, factored into `public.sm_holds_active_ft_contract()`:
-- "holds ANY Active contract whose employment_status matches '%full%'".
--
-- That is deliberately the CONSERVATIVE reading rather than a re-implementation
-- of `resolveComplianceBasis`'s precedence. 30 of 103 people in production hold
-- more than one Active contract and at least one holds two whose employment
-- statuses disagree outright ({Full-Time, Casual}). A precedence-based test
-- would have to reproduce that ordering in SQL and stay in step with it
-- forever; "holds any FT contract" cannot drift, and it errs towards treating
-- someone as contract-available, which is the direction that does not silently
-- hard-filter a permanent out of every shift (see the HC-5d 0/144 incident).
-- =============================================================================

-- ── 0. The shared FT predicate ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sm_holds_active_ft_contract(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, hr, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM hr.user_contracts uc
     WHERE uc.user_id = p_profile_id
       AND uc.status = 'Active'
       AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
  );
$$;

COMMENT ON FUNCTION public.sm_holds_active_ft_contract(uuid) IS
  'True when the profile holds ANY Active Full-Time contract. The single '
  'definition of "is Full-Time" shared by trg_prevent_ft_availability_rule and '
  'sm_materialize_contract_envelope, so the write guard and the slot generator '
  'can never disagree about one person.';

-- SECURITY DEFINER over hr.user_contracts: readable by anyone who can call it,
-- so it is not for the app. `authenticated` is revoked explicitly because
-- Supabase grants EXECUTE on new functions to PUBLIC (hence anon) AND to
-- authenticated — revoking PUBLIC alone leaves it exposed over /rest/v1/rpc.
REVOKE ALL ON FUNCTION public.sm_holds_active_ft_contract(uuid)
    FROM PUBLIC, anon, authenticated;

-- ── 1. Write guard: FT employees cannot declare availability ─────────────────

CREATE OR REPLACE FUNCTION public.trg_prevent_ft_availability_rule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, hr, pg_catalog
AS $$
BEGIN
  IF public.sm_holds_active_ft_contract(NEW.profile_id) THEN
    RAISE EXCEPTION 'Availability is contract based for Full Time employees. Use Leave Management for unavailability.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_prevent_ft_availability_rule() IS
  'BEFORE INSERT OR UPDATE on availability_rules: rejects rows for profiles '
  'holding an Active Full-Time contract. The backstop behind the client guard '
  'in src/modules/availability/api/availability.service.ts, which fails OPEN on '
  'a contract read error by design — this is what closes it. DELETE is '
  'deliberately not covered, so cleanup of pre-existing rows stays possible.';

-- Same reasoning as above, and the same gap `get_advisors` flagged for
-- trg_availability_rule_closes_request() in 20260809000300: a trigger function
-- is callable over /rest/v1/rpc unless authenticated is revoked too.
REVOKE ALL ON FUNCTION public.trg_prevent_ft_availability_rule()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prevent_ft_availability_rule ON public.availability_rules;
CREATE TRIGGER trg_prevent_ft_availability_rule
  BEFORE INSERT OR UPDATE ON public.availability_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_prevent_ft_availability_rule();

-- ── 2. sm_materialize_contract_envelope: skip FT profiles ────────────────────
--
-- This is the deployed 20260817000000 body with ONE predicate added to the
-- `basis` CTE. Everything else — the `_env_scope` UNION, the NOT EXISTS diff
-- guard on the DELETE, the RAISE LOG — is load-bearing and reproduced verbatim.
--
-- The UNION is load-bearing FOR THIS CHANGE specifically. Excluding FT from
-- `_env_target` is what makes someone disappear from the generator, and the
-- UNION's second half is the only thing that then reclaims the envelope slots
-- they already hold. Scope the rewrite to `_env_target` alone and a Part-Timer
-- promoted to Full-Time keeps their envelope rows forever — rows that still
-- NARROW their roster under per-date OPT_OUT semantics, that the FT page no
-- longer renders, and that the write guard above does not cover because it
-- guards `availability_rules`, not `availability_slots`.

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
       -- Full-Time availability is implicit: no synthetic slots are generated
       -- for them, because a generated slot would CONSTRAIN the dates it covers
       -- rather than enable them, and a generator that covers part of a horizon
       -- and stops would hard-block the rest.
       --
       -- Tested on the PERSON, not on this row. Someone holding an FT contract
       -- with no span plus a Part-Time contract with one would otherwise have
       -- the FT row dropped by the `ordinary_span_start IS NOT NULL` predicate
       -- above, let the PT row win the DISTINCT ON, and get envelope slots the
       -- write guard's own definition of FT says they must not have.
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
     -- Approved leave carves the day out of the envelope. The solver already
     -- excludes it via `unavailable_dates`, so this is not what makes leave
     -- binding; it is what keeps the slot table — and therefore the Team
     -- Availability page reading it — from claiming someone is available on a
     -- day they are on leave.
     --
     -- `employee_leave_days` is the view over exactly this predicate
     -- (leave_requests WHERE status = 'approved', expanded one row per day),
     -- and is the name the rest of the FT work refers to, so the two cannot
     -- drift apart the way two hand-written range overlaps would.
     AND NOT EXISTS (
       SELECT 1 FROM public.employee_leave_days eld
        WHERE eld.employee_id = b.user_id
          AND eld.leave_date  = d::date
     );

  -- Scope of the rewrite: everyone we just generated for, PLUS anyone still
  -- holding envelope rows in this range. The second half is what cleans up
  -- after a contract is ended, its span cleared, or (now) the person becoming
  -- Full-Time — without it, revoking an envelope would leave the old slots
  -- behind and keep constraining the person forever.
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
  'Regenerates source=''envelope'' availability_slots for Active contracts that '
  'are neither Casual nor Full-Time and have an ordinary-hours span configured, '
  'over [p_from, p_to]. Full-Time is excluded because their availability is '
  'implicit (see sm_holds_active_ft_contract); Casual because a generated slot '
  'is not an offer they made. Idempotent: deletes envelope rows in range that no '
  'longer belong — including every row of a person who has just become '
  'Full-Time — and inserts the ones that do, never touching source=''rule'' '
  'rows. Skips dates covered by approved leave. Writes nothing for contracts '
  'with a NULL span, which is every contract until one is explicitly opted in.';

-- ── 3. Archive tables ────────────────────────────────────────────────────────
--
-- The purge below destroys 17 rules and 1,533 slots of real employee-entered
-- data. `LIKE` copies the column shape and nothing else — no defaults, no keys,
-- no FKs — which is what an archive wants: it must accept rows the live table
-- would now reject, and it must never cascade when the live row goes.
--
-- Recoverability is not optional here. The purge is otherwise a one-way door,
-- and it is keyed on `sm_holds_active_ft_contract`, so ANY error in that
-- predicate — a contract miskeyed as Full-Time, a status typo'd to 'full time
-- (casual)' — silently widens the blast radius to people it was never meant to
-- touch. The archive is what turns that from data loss into a reversible
-- mistake. See docs/runbooks/ft-availability-removal.md for the restore.

CREATE TABLE IF NOT EXISTS public.availability_rules_archive
  (LIKE public.availability_rules);
CREATE TABLE IF NOT EXISTS public.availability_slots_archive
  (LIKE public.availability_slots);

ALTER TABLE public.availability_rules_archive
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archived_reason text NOT NULL DEFAULT 'unspecified';
ALTER TABLE public.availability_slots_archive
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archived_reason text NOT NULL DEFAULT 'unspecified';

-- These hold one employee's stated working availability, which is the same
-- sensitivity as the live tables — and the live ones were world-readable by
-- `anon` until 20260809000200. Supabase's default privileges grant new public
-- tables to anon AND authenticated, so revoking PUBLIC alone is not enough.
-- RLS with NO policies denies every non-superuser role outright; the REVOKEs
-- mean a future policy cannot accidentally re-expose them either.
ALTER TABLE public.availability_rules_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_slots_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.availability_rules_archive FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.availability_slots_archive FROM PUBLIC, anon, authenticated;

-- `LIKE` copies no indexes, and the purge below looks rows up by id to decide
-- what still needs archiving. Not a performance concern at this size — it is what
-- keeps the re-run path O(n) instead of a seq scan per live row.
CREATE INDEX IF NOT EXISTS availability_rules_archive_id_idx
  ON public.availability_rules_archive (id);
CREATE INDEX IF NOT EXISTS availability_slots_archive_id_idx
  ON public.availability_slots_archive (id);

COMMENT ON TABLE public.availability_rules_archive IS
  'Cold storage for availability_rules removed by a migration or data-hygiene '
  'job. Deliberately carries no keys or FKs so it can hold rows the live table '
  'would now reject. Not readable by anon or authenticated; restore is a '
  'service_role operation — see docs/runbooks/ft-availability-removal.md.';
COMMENT ON TABLE public.availability_slots_archive IS
  'Cold storage for availability_slots. See availability_rules_archive.';

-- ── 4. Purge existing FT availability ────────────────────────────────────────

DO $$
DECLARE
  v_reason      text := 'ft_availability_removal_20260817120000';
  v_rules_arch  int;
  v_slots_arch  int;
  v_rules_del   int;
  v_slots_del   int;
  v_missing     int;
BEGIN
  -- Archive BOTH tables before deleting EITHER. Rules must be captured before
  -- their delete cascades the slots out from under the slot archive.
  --
  -- `NOT EXISTS ... a.id = r.id` makes this RE-RUNNABLE. A second run (a retry
  -- after a partial failure, or a `db push` that offers the file again) finds the
  -- live rows already gone and archives nothing, instead of appending a duplicate
  -- copy — which would then make a COUNT-based verification fail and report
  -- "archive verification failed" when nothing whatsoever is wrong. A migration
  -- whose retry path lies to the operator is worse than one that cannot retry.
  INSERT INTO public.availability_rules_archive
  SELECT r.*, now(), v_reason
    FROM public.availability_rules r
   WHERE public.sm_holds_active_ft_contract(r.profile_id)
     AND NOT EXISTS (SELECT 1 FROM public.availability_rules_archive a WHERE a.id = r.id);
  GET DIAGNOSTICS v_rules_arch = ROW_COUNT;

  INSERT INTO public.availability_slots_archive
  SELECT s.*, now(), v_reason
    FROM public.availability_slots s
   WHERE public.sm_holds_active_ft_contract(s.profile_id)
     AND NOT EXISTS (SELECT 1 FROM public.availability_slots_archive a WHERE a.id = s.id);
  GET DIAGNOSTICS v_slots_arch = ROW_COUNT;

  -- VERIFY BEFORE DELETING, and verify by IDENTITY rather than by count.
  --
  -- Every live row about to be deleted must already have its id in the archive.
  -- That is a strictly stronger claim than "the counts match" — a count check
  -- passes if the archive holds the right NUMBER of wrong rows — and unlike a
  -- count it stays true on a re-run, where there are no live rows left and the
  -- test is vacuously satisfied.
  SELECT count(*) INTO v_missing FROM (
    SELECT r.id FROM public.availability_rules r
     WHERE public.sm_holds_active_ft_contract(r.profile_id)
       AND NOT EXISTS (SELECT 1 FROM public.availability_rules_archive a WHERE a.id = r.id)
    UNION ALL
    SELECT s.id FROM public.availability_slots s
     WHERE public.sm_holds_active_ft_contract(s.profile_id)
       AND NOT EXISTS (SELECT 1 FROM public.availability_slots_archive a WHERE a.id = s.id)
  ) missing;

  IF v_missing > 0 THEN
    RAISE EXCEPTION
      'ft_availability_removal: % row(s) would be deleted without being archived — refusing to proceed',
      v_missing
      USING ERRCODE = 'data_exception';
  END IF;

  -- Rules first: availability_slots.rule_id is ON DELETE CASCADE, so this
  -- clears most of the slots as a side effect.
  DELETE FROM public.availability_rules r
   WHERE public.sm_holds_active_ft_contract(r.profile_id);
  GET DIAGNOSTICS v_rules_del = ROW_COUNT;

  -- Then EVERY remaining slot for an FT profile, keyed on profile_id alone.
  --
  -- Not `source = 'envelope'`, and not "orphans only". Production holds 134 FT
  -- slots across 10 of the 17 full-timers with rule_id IS NULL *and*
  -- source = 'rule' — 70 of them dated in the future. They match neither the
  -- cascade above nor a source-scoped delete, and would survive as invisible
  -- declarations: the FT page no longer renders a calendar to remove them, the
  -- guard in step 1 covers availability_rules rather than availability_slots,
  -- and every reader that queries availability_slots directly (reserve list,
  -- DnD assign, Team Availability) would go on honouring them.
  DELETE FROM public.availability_slots s
   WHERE public.sm_holds_active_ft_contract(s.profile_id);
  GET DIAGNOSTICS v_slots_del = ROW_COUNT;

  -- The deletes must not have reached the archive. Nothing declares a FK from
  -- the archive to the live tables — that is the point of building it with a bare
  -- `LIKE` — but this asserts it rather than assuming it, because a stray cascade
  -- here empties the only copy of the data at the exact moment the live rows go.
  IF (SELECT count(*) FROM public.availability_rules_archive
       WHERE archived_reason = v_reason) < v_rules_arch
     OR (SELECT count(*) FROM public.availability_slots_archive
          WHERE archived_reason = v_reason) < v_slots_arch THEN
    RAISE EXCEPTION
      'ft_availability_removal: archived rows disappeared during delete — expected at least %/% rules/slots'
      , v_rules_arch, v_slots_arch
      USING ERRCODE = 'data_exception';
  END IF;

  -- Nothing FT-held may remain live. The guard blocks future INSERTs; this
  -- catches a delete predicate that silently matched less than the archive did.
  IF EXISTS (SELECT 1 FROM public.availability_slots s
              WHERE public.sm_holds_active_ft_contract(s.profile_id))
     OR EXISTS (SELECT 1 FROM public.availability_rules r
                 WHERE public.sm_holds_active_ft_contract(r.profile_id)) THEN
    RAISE EXCEPTION 'ft_availability_removal: FT availability rows still present after purge'
      USING ERRCODE = 'data_exception';
  END IF;

  RAISE LOG '[ft_availability_removal] archived %/% rules/slots, deleted %/% — restore: docs/runbooks/ft-availability-removal.md',
    v_rules_arch, v_slots_arch, v_rules_del, v_slots_del;
END;
$$;
