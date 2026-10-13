-- ============================================================================
-- F2 — one Full-Time role silences availability for the CASUAL roles beside it.
--
-- THE PROBLEM. `trg_prevent_ft_availability_rule` blocks an availability
-- declaration whenever `sm_holds_active_ft_contract_in(profile, sub_department)`
-- is true — that is, whenever the person holds ANY Full-Time contract in that
-- sub-department. The four availability tables key on
-- (profile_id, sub_department_id) with no role dimension, so "any" is the
-- strongest question the data can currently answer.
--
-- That was right while a sub-department meant one appointment. It stops being
-- right the moment someone is Full-Time in one role there and Casual in
-- another. Verified against production for the acceptance scenario
-- (Full-Time Event Setups Manager + Casual Usher, same sub-department):
--
--     sm_holds_active_ft_contract_in(sub-dept A) = true
--
-- so the trigger refuses every declaration in that sub-department. Their Usher
-- role is Casual, and Casual is OPT_IN: silence means UNAVAILABLE, not
-- available. The person is left with an empty slot list under OPT_IN, which the
-- solver hard-filters out of every Casual shift in that sub-department —
-- silently, with no reason emitted. That is the HC-5d failure shape.
--
-- WHY THIS IS THE EBA READING, NOT A LOOSENING. The guard exists because
-- permanents are regulated by LEAVE, not availability: a Full-Time Team Member
-- is rostered from their contract (cl 12.2(b), cl 35.1) and records
-- unavailability through Part E. That reasoning attaches to the ENGAGEMENT, not
-- to the human. Clause 13 (Multi-Hiring) expressly contemplates a permanent
-- Team Member ALSO being engaged casually, and a casual engagement has no
-- contracted hours to be rostered from — cl 13.1(d) makes it something the
-- Team Member instigates and can withdraw at any time. Availability is how they
-- express that. Blocking it makes the cl 13 engagement unworkable.
--
-- THE RULE, THEREFORE: block only when EVERY active contract in scope is
-- Full-Time. A sub-department that is wholly Full-Time behaves exactly as it
-- does today — which is every Full-Time employee in the system. A MIXED
-- sub-department becomes declarable, because part of it genuinely needs to be.
--
-- SCOPE BRANCHES ARE COPIED, NOT REWRITTEN. The three branches below are the
-- three branches of `sm_holds_active_ft_contract_in` (migration
-- 20260821090100) in the same order, and the TypeScript half
-- (`contractsInScope` in availability/domain/contract-basis.ts) must admit the
-- same rows. A NULL `p_sub_department_id` still means UNSCOPED — every contract
-- the person holds — because a rule with no sub-department covers every job and
-- must clear the strictest test.
--
-- NOT SUFFICIENT ON ITS OWN. The frontend still hides the availability editor
-- on `isFullTime` from `resolveScopedBasis`, which applies non-casual-first
-- precedence within a sub-department and so still resolves the mixed case to
-- Full-Time. Until that is given a role grain, this migration removes a failed
-- WRITE but the page will not yet offer the editor. That is the safe direction
-- to be out of step in — the database now permits strictly more than the UI
-- attempts, never less — but the pair is not finished until both move.
--
-- `sm_holds_active_ft_contract_in` and `sm_holds_active_ft_contract` are LEFT
-- IN PLACE and unchanged: `sm_materialize_contract_envelope` still uses the
-- person-wide one, and the "does this person hold a Full-Time contract here"
-- question is a legitimate one that other callers may want. This migration adds
-- a differently-shaped question and points only the availability trigger at it.
-- ============================================================================

-- ── 1. The narrowed predicate ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sm_all_active_contracts_ft_in(
    p_profile_id uuid,
    p_sub_department_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'hr', 'pg_catalog'
AS $function$
  WITH in_scope AS (
    SELECT lower(COALESCE(uc.employment_status::text, '')) AS st
      FROM hr.user_contracts uc
     WHERE uc.user_id = p_profile_id
       AND uc.status = 'Active'
       AND ( p_sub_department_id IS NULL
          OR uc.sub_department_id = p_sub_department_id
          OR (uc.sub_department_id IS NULL AND uc.department_id IS NOT NULL
              AND uc.department_id = (SELECT sd.department_id
                                        FROM public.sub_departments sd
                                       WHERE sd.id = p_sub_department_id)) )
  )
  -- Vacuously true is the wrong answer: someone with NO contract in scope is
  -- not "wholly Full-Time", they are unclassified, and must stay able to
  -- declare. Hence the EXISTS as well as the NOT EXISTS.
  --
  -- An empty or unrecognised status counts as NOT Full-Time, so it makes the
  -- sub-department mixed and the declaration allowed. That is the safe
  -- direction: the cost of a wrongly-permitted declaration is a row a
  -- permanent did not need, and the cost of a wrongly-refused one is a casual
  -- hard-filtered out of every shift.
  --
  -- 'flexible part-time' does not contain 'full', so LIKE '%full%' does not
  -- catch it — matching `sm_holds_active_ft_contract_in`, which relies on the
  -- same property.
  SELECT EXISTS (SELECT 1 FROM in_scope)
     AND NOT EXISTS (SELECT 1 FROM in_scope WHERE st NOT LIKE '%full%');
$function$;

COMMENT ON FUNCTION public.sm_all_active_contracts_ft_in(uuid, uuid) IS
    'True when the profile holds at least one Active contract in scope and EVERY one of them is '
    'Full-Time. Narrower than sm_holds_active_ft_contract_in, which answers "any". Used by the '
    'availability guard so a sub-department holding both a Full-Time and a Casual role stays '
    'declarable for the Casual side (EBA cl 13 Multi-Hiring). See migration 20260824130200.';

-- Match the grant posture of its siblings exactly: postgres + service_role and
-- nothing else. Supabase grants EXECUTE broadly on new functions, so revoking
-- PUBLIC alone would leave anon and authenticated holding it.
REVOKE ALL ON FUNCTION public.sm_all_active_contracts_ft_in(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sm_all_active_contracts_ft_in(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.sm_all_active_contracts_ft_in(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sm_all_active_contracts_ft_in(uuid, uuid) TO service_role;

-- ── 2. Point the trigger at it ──────────────────────────────────────────────
-- Fires on availability_rules and availability_exceptions. Message and SQLSTATE
-- unchanged; only the question it asks is narrower.
CREATE OR REPLACE FUNCTION public.trg_prevent_ft_availability_rule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'hr', 'pg_catalog'
AS $function$
BEGIN
  IF public.sm_all_active_contracts_ft_in(NEW.profile_id, NEW.sub_department_id) THEN
    RAISE EXCEPTION 'Availability is contract based for Full Time employees. Use Leave Management for unavailability.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 3. Self-test ────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
    v_user uuid; v_org uuid; v_dept uuid; v_sd uuid; v_r uuid[];
    v_failures text := '';
    v_all_ft boolean; v_any_ft boolean;
BEGIN
    SELECT id INTO v_user FROM public.profiles ORDER BY id LIMIT 1;
    SELECT id INTO v_org  FROM public.organizations ORDER BY id LIMIT 1;

    SELECT sd.department_id, sd.id INTO v_dept, v_sd
      FROM public.sub_departments sd
      JOIN hr.roles r ON r.subdepartment_id = sd.id
     GROUP BY sd.department_id, sd.id
    HAVING COUNT(r.id) >= 2
     ORDER BY sd.id LIMIT 1;

    SELECT array_agg(id ORDER BY id) INTO v_r
      FROM (SELECT r.id FROM hr.roles r
             WHERE r.subdepartment_id = v_sd
               AND NOT EXISTS (SELECT 1 FROM hr.user_contracts uc
                                WHERE uc.user_id = v_user AND uc.role_id = r.id
                                  AND uc.sub_department_id IS NOT DISTINCT FROM v_sd)
             ORDER BY r.id LIMIT 2) s;

    IF v_user IS NULL OR v_sd IS NULL OR v_r IS NULL OR array_length(v_r, 1) < 2 THEN
        RAISE NOTICE 'availability_ft_guard_mixed_subdepartment selftest SKIPPED — no fixture';
        RETURN;
    END IF;

    -- (a) No contract in scope at all: unclassified, so NOT blocked.
    IF public.sm_all_active_contracts_ft_in(v_user, v_sd) THEN
        v_failures := v_failures || '(a) blocked with no contract in scope ; ';
    END IF;

    -- (b) Wholly Full-Time sub-department: still blocked, exactly as today.
    INSERT INTO hr.user_contracts (user_id, organization_id, department_id, sub_department_id,
                                   role_id, status, employment_status, contracted_weekly_hours)
    VALUES (v_user, v_org, v_dept, v_sd, v_r[1], 'Active', 'Full-Time', 38);

    v_all_ft := public.sm_all_active_contracts_ft_in(v_user, v_sd);
    v_any_ft := public.sm_holds_active_ft_contract_in(v_user, v_sd);
    IF NOT v_all_ft THEN
        v_failures := v_failures || '(b) wholly-FT sub-department was NOT blocked ; ';
    END IF;
    IF NOT v_any_ft THEN
        v_failures := v_failures || '(b) sanity: the old predicate disagrees ; ';
    END IF;

    -- (c) Add a Casual role in the SAME sub-department. The old predicate still
    --     says "blocked"; the new one must say "declarable". This single pair of
    --     assertions is the entire point of the migration.
    INSERT INTO hr.user_contracts (user_id, organization_id, department_id, sub_department_id,
                                   role_id, status, employment_status, contracted_weekly_hours)
    VALUES (v_user, v_org, v_dept, v_sd, v_r[2], 'Active', 'Casual', 0);

    v_all_ft := public.sm_all_active_contracts_ft_in(v_user, v_sd);
    v_any_ft := public.sm_holds_active_ft_contract_in(v_user, v_sd);
    IF v_all_ft THEN
        v_failures := v_failures || '(c) mixed sub-department is STILL blocked ; ';
    END IF;
    IF NOT v_any_ft THEN
        v_failures := v_failures || '(c) sanity: the old predicate should still say "any FT" ; ';
    END IF;

    -- (d) Unscoped (NULL sub-department) covers every job, so a person holding
    --     any Casual anywhere is not wholly Full-Time.
    IF public.sm_all_active_contracts_ft_in(v_user, NULL) THEN
        v_failures := v_failures || '(d) unscoped said wholly-FT while a Casual contract exists ; ';
    END IF;

    IF v_failures <> '' THEN
        RAISE EXCEPTION 'availability_ft_guard_mixed_subdepartment selftest FAILED: %', v_failures;
    END IF;

    RAISE EXCEPTION 'selftest_rollback';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM = 'selftest_rollback' THEN
            RAISE NOTICE 'availability_ft_guard_mixed_subdepartment selftest PASSED (rolled back)';
        ELSE
            RAISE;
        END IF;
END
$selftest$;
