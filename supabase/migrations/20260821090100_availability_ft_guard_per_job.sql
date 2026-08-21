-- =============================================================================
-- Migration: 20260821090100_availability_ft_guard_per_job.sql
-- Description: Ask "is THIS JOB Full-Time?" instead of "is this PERSON
--              Full-Time anywhere?" when refusing an availability declaration.
--
-- Depends on 20260821090000, which added `sub_department_id`. Meaningless
-- without it.
--
-- WHY. `trg_prevent_ft_availability_rule` (20260817120000) tests
-- `sm_holds_active_ft_contract()` — "holds ANY Active contract whose
-- employment_status matches '%full%'". That predicate was chosen deliberately
-- and, at the time, correctly: it is the CONSERVATIVE reading, it cannot drift
-- from `resolveComplianceBasis`'s precedence because it does not reproduce it,
-- and it errs towards treating someone as contract-available rather than
-- silently hard-filtering a permanent out of every shift.
--
-- What it could not express is a person who is Full-Time in one job and Casual
-- in another. Production holds exactly one today — a Full-Time contract in
-- Building Services · Security plus four Casual contracts across Event
-- Delivery · Set-up and Live Events · Front of House — and for them the
-- person-wide reading is not conservative at all. It refuses every casual
-- declaration they might make, which leaves them with no slots, which under
-- `availability_mode = 'OPT_IN'` (what the solver derives for their casual
-- contracts) hard-filters them out of every casual shift with no reason
-- emitted. The guard meant to protect permanents is what makes their casual
-- work unassignable.
--
-- THE FALLBACK IS THE LOAD-BEARING PART. An UNSCOPED declaration
-- (`sub_department_id IS NULL`) covers every job the person holds, including
-- the Full-Time one, so it must still clear the PERSON-WIDE test. Without that
-- branch this migration would be a hole in the guard rather than a refinement
-- of it: every full-timer could re-acquire availability simply by leaving the
-- scope unset, which is exactly what every pre-existing client does today.
--
-- That fallback is also what keeps this file inert. Nothing writes a scoped
-- declaration until Phase 5 ships, so on the day this applies every write is
-- still unscoped and still judged exactly as it is now.
-- =============================================================================

-- ── 1. The per-job predicate ─────────────────────────────────────────────────
--
-- Deliberately NOT a re-implementation of `resolveComplianceBasis`'s
-- precedence, for the same reason the person-wide predicate was not: a
-- precedence-based test would have to reproduce that ordering in SQL and stay
-- in step with it forever. "Is there an Active Full-Time contract attached to
-- THIS sub-department" cannot drift.

CREATE OR REPLACE FUNCTION public.sm_holds_active_ft_contract_in(
  p_profile_id        uuid,
  p_sub_department_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, hr, pg_catalog
AS $$
  SELECT CASE
    -- Unscoped: covers every job, so it must clear the strictest test. This is
    -- the pre-20260821 behaviour, unchanged, and it is what every client that
    -- has not yet learned about scopes will keep hitting.
    WHEN p_sub_department_id IS NULL
      THEN public.sm_holds_active_ft_contract(p_profile_id)
    ELSE EXISTS (
      SELECT 1
        FROM hr.user_contracts uc
       WHERE uc.user_id = p_profile_id
         AND uc.status  = 'Active'
         AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
         AND (
               uc.sub_department_id = p_sub_department_id
               -- A Full-Time contract with NO sub-department is
               -- DEPARTMENT-WIDE, so it makes every sub-department beneath it
               -- Full-Time for this purpose. No Active contract is in that
               -- shape today, but `sm_holds_active_contract_in` already honours
               -- the same rule and the two must not disagree about one person.
            OR (uc.sub_department_id IS NULL
                AND uc.department_id IS NOT NULL
                AND uc.department_id = (
                      SELECT sd.department_id
                        FROM public.sub_departments sd
                       WHERE sd.id = p_sub_department_id))
             )
    )
  END;
$$;

COMMENT ON FUNCTION public.sm_holds_active_ft_contract_in(uuid, uuid) IS
  'Is THIS JOB Full-Time? True when the profile holds an Active Full-Time '
  'contract in that sub-department, or a department-wide one above it. A NULL '
  'sub-department delegates to the person-wide sm_holds_active_ft_contract, '
  'because an unscoped declaration covers every job the person holds.';

-- Supabase grants EXECUTE on new functions to PUBLIC (hence anon) AND to
-- authenticated; revoking PUBLIC alone leaves it callable over /rest/v1/rpc.
-- Same gap get_advisors flagged for trg_availability_rule_closes_request().
REVOKE ALL ON FUNCTION public.sm_holds_active_ft_contract_in(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- `sm_holds_active_ft_contract()` is deliberately KEPT and unchanged.
-- `sm_materialize_contract_envelope` still calls it, and "should this person
-- get generated contract-envelope slots" is a different question from "may they
-- declare availability for this job". Whether the envelope itself should become
-- per-job is a Phase 6 decision; conflating them here would silently change
-- which permanents get envelope slots.

-- ── 2. The write guard, rescoped ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_prevent_ft_availability_rule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, hr, pg_catalog
AS $$
BEGIN
  IF public.sm_holds_active_ft_contract_in(NEW.profile_id, NEW.sub_department_id) THEN
    RAISE EXCEPTION 'Availability is contract based for Full Time employees. Use Leave Management for unavailability.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- The message is unchanged on purpose: `FT_AVAILABILITY_ERROR` in
-- src/modules/availability/api/availability.service.ts is the same string, and
-- src/modules/availability/utils/validation.utils.ts translates database errors
-- for display. Rewording here would desynchronise the two.

COMMENT ON FUNCTION public.trg_prevent_ft_availability_rule() IS
  'BEFORE INSERT OR UPDATE on availability_rules AND availability_exceptions: '
  'rejects a declaration whose SUB-DEPARTMENT is Full-Time for this profile, or '
  'any UNSCOPED declaration by a profile holding an Active Full-Time contract '
  'anywhere. Keeps its 20260817120000 name because the trigger and the client '
  'error string both reference it; it now guards both declaration tables. '
  'DELETE is deliberately still not covered, so cleanup of pre-existing rows '
  'stays possible.';

REVOKE ALL ON FUNCTION public.trg_prevent_ft_availability_rule()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prevent_ft_availability_rule ON public.availability_rules;
CREATE TRIGGER trg_prevent_ft_availability_rule
  BEFORE INSERT OR UPDATE ON public.availability_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_prevent_ft_availability_rule();

-- ── 3. Close the exceptions gap ──────────────────────────────────────────────
--
-- `availability_exceptions` has had NO database-level Full-Time guard since it
-- was created in 20260817000100 — `createAvailabilityException` says so in a
-- comment: "this table has no DB-level FT trigger, so this check is the only
-- enforcement there is". A client-side check is a courtesy, not a control.
--
-- Attaching the SAME function here rather than writing a second one, for the
-- reason 20260817120000 gave for factoring out its predicate: two guards that
-- answer "is this Full-Time?" differently is how a materializer and a trigger
-- end up disagreeing about one person.
--
-- Net effect is MORE permissive than the client is today, not less: the client
-- refuses every exception from anyone holding an FT contract anywhere, and this
-- refuses only the ones scoped to an actually-Full-Time job. Phase 4 relaxes the
-- client to match. Until then the client is simply the stricter of the two,
-- which breaks nothing. The table holds 0 rows in production.

DROP TRIGGER IF EXISTS trg_prevent_ft_availability_rule ON public.availability_exceptions;
CREATE TRIGGER trg_prevent_ft_availability_rule
  BEFORE INSERT OR UPDATE ON public.availability_exceptions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_prevent_ft_availability_rule();

-- ── 4. Self-test ─────────────────────────────────────────────────────────────
--
-- Exercised against REAL production contracts rather than asserted, because the
-- whole change is a behaviour change and a structural check would pass on a
-- guard that lets everyone through.
--
-- Every write below happens inside a BEGIN ... EXCEPTION block, which is a
-- subtransaction: raising at the end of each probe rolls its INSERT back, so
-- this section leaves nothing behind. That is also the only way to test a write
-- path here — `execute_sql` commits per statement and a client-side
-- BEGIN/ROLLBACK does not hold.

DO $$
DECLARE
  v_mixed_profile uuid;
  v_ft_subdept    uuid;
  v_casual_subdept uuid;
  v_pure_ft       uuid;
  v_casual        uuid;
  v_casual_sd     uuid;
  v_probe         text;
  v_fail          text := '';
BEGIN
  -- The one production profile holding BOTH an Active FT contract and an Active
  -- non-FT contract in a DIFFERENT sub-department. Resolved by shape, never
  -- hardcoded — a migration that names a uuid stops testing anything the moment
  -- the data moves.
  SELECT ft.user_id, ft.sub_department_id, cas.sub_department_id
    INTO v_mixed_profile, v_ft_subdept, v_casual_subdept
    FROM hr.user_contracts ft
    JOIN hr.user_contracts cas
      ON cas.user_id = ft.user_id
     AND cas.status = 'Active'
     AND LOWER(COALESCE(cas.employment_status::text,'')) NOT LIKE '%full%'
     AND cas.sub_department_id IS DISTINCT FROM ft.sub_department_id
   WHERE ft.status = 'Active'
     AND LOWER(COALESCE(ft.employment_status::text,'')) LIKE '%full%'
     AND ft.sub_department_id IS NOT NULL
     AND cas.sub_department_id IS NOT NULL
   LIMIT 1;

  IF v_mixed_profile IS NOT NULL THEN
    -- (a) the casual job MUST now be declarable — this is the whole migration
    v_probe := 'not reached';
    BEGIN
      INSERT INTO public.availability_rules
        (profile_id, start_date, start_time, end_time, repeat_type, sub_department_id)
      VALUES (v_mixed_profile, DATE '2099-01-04', '09:00', '17:00', 'none', v_casual_subdept);
      v_probe := 'accepted';
      RAISE EXCEPTION 'rollback probe a' USING ERRCODE = 'raise_exception';
    EXCEPTION
      WHEN check_violation THEN v_probe := 'REJECTED';
      WHEN raise_exception THEN NULL;   -- our own rollback, probe already set
    END;
    IF v_probe <> 'accepted' THEN
      v_fail := v_fail || format(E'\n  (a) casual-scoped declaration was %s — expected accepted', v_probe);
    END IF;

    -- (b) the Full-Time job must STILL be refused
    v_probe := 'not reached';
    BEGIN
      INSERT INTO public.availability_rules
        (profile_id, start_date, start_time, end_time, repeat_type, sub_department_id)
      VALUES (v_mixed_profile, DATE '2099-01-05', '09:00', '17:00', 'none', v_ft_subdept);
      v_probe := 'ACCEPTED';
      RAISE EXCEPTION 'rollback probe b' USING ERRCODE = 'raise_exception';
    EXCEPTION
      WHEN check_violation THEN v_probe := 'rejected';
      WHEN raise_exception THEN NULL;
    END;
    IF v_probe <> 'rejected' THEN
      v_fail := v_fail || format(E'\n  (b) FT-scoped declaration was %s — expected rejected', v_probe);
    END IF;

    -- (c) an UNSCOPED declaration must still be refused — the fallback branch
    v_probe := 'not reached';
    BEGIN
      INSERT INTO public.availability_rules
        (profile_id, start_date, start_time, end_time, repeat_type, sub_department_id)
      VALUES (v_mixed_profile, DATE '2099-01-06', '09:00', '17:00', 'none', NULL);
      v_probe := 'ACCEPTED';
      RAISE EXCEPTION 'rollback probe c' USING ERRCODE = 'raise_exception';
    EXCEPTION
      WHEN check_violation THEN v_probe := 'rejected';
      WHEN raise_exception THEN NULL;
    END;
    IF v_probe <> 'rejected' THEN
      v_fail := v_fail || format(E'\n  (c) UNSCOPED declaration was %s — expected rejected (guard has a hole)', v_probe);
    END IF;
  ELSE
    RAISE LOG '[ft-guard] no mixed FT/non-FT profile in production — probes a-c skipped';
  END IF;

  -- (d) a pure full-timer must be refused on every path, scoped or not
  SELECT uc.user_id INTO v_pure_ft
    FROM hr.user_contracts uc
   WHERE uc.status = 'Active'
     AND LOWER(COALESCE(uc.employment_status::text,'')) LIKE '%full%'
     AND NOT EXISTS (SELECT 1 FROM hr.user_contracts o
                      WHERE o.user_id = uc.user_id AND o.status = 'Active'
                        AND LOWER(COALESCE(o.employment_status::text,'')) NOT LIKE '%full%')
   LIMIT 1;

  IF v_pure_ft IS NOT NULL THEN
    v_probe := 'not reached';
    BEGIN
      INSERT INTO public.availability_rules
        (profile_id, start_date, start_time, end_time, repeat_type, sub_department_id)
      VALUES (v_pure_ft, DATE '2099-01-07', '09:00', '17:00', 'none', NULL);
      v_probe := 'ACCEPTED';
      RAISE EXCEPTION 'rollback probe d' USING ERRCODE = 'raise_exception';
    EXCEPTION
      WHEN check_violation THEN v_probe := 'rejected';
      WHEN raise_exception THEN NULL;
    END;
    IF v_probe <> 'rejected' THEN
      v_fail := v_fail || format(E'\n  (d) a pure full-timer was %s — expected rejected', v_probe);
    END IF;
  END IF;

  -- (e) a casual must be unaffected — the failure mode that matters most,
  --     because it is the 101-person majority and a guard that over-fires here
  --     stops the entire workforce declaring anything.
  SELECT uc.user_id, uc.sub_department_id INTO v_casual, v_casual_sd
    FROM hr.user_contracts uc
   WHERE uc.status = 'Active'
     AND LOWER(COALESCE(uc.employment_status::text,'')) NOT LIKE '%full%'
     AND uc.sub_department_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM hr.user_contracts o
                      WHERE o.user_id = uc.user_id AND o.status = 'Active'
                        AND LOWER(COALESCE(o.employment_status::text,'')) LIKE '%full%')
   LIMIT 1;

  IF v_casual IS NOT NULL THEN
    v_probe := 'not reached';
    BEGIN
      INSERT INTO public.availability_rules
        (profile_id, start_date, start_time, end_time, repeat_type, sub_department_id)
      VALUES (v_casual, DATE '2099-01-08', '09:00', '17:00', 'none', v_casual_sd);
      v_probe := 'accepted';
      RAISE EXCEPTION 'rollback probe e' USING ERRCODE = 'raise_exception';
    EXCEPTION
      WHEN check_violation THEN v_probe := 'REJECTED';
      WHEN raise_exception THEN NULL;
    END;
    IF v_probe <> 'accepted' THEN
      v_fail := v_fail || format(E'\n  (e) a casual was %s — expected accepted', v_probe);
    END IF;
  END IF;

  IF v_fail <> '' THEN
    RAISE EXCEPTION 'ft-guard self-test FAILED:%', v_fail USING ERRCODE = 'data_exception';
  END IF;

  RAISE LOG '[ft-guard] self-test passed — per-job guard active on availability_rules and availability_exceptions';
END $$;
