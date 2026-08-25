-- ============================================================================
-- F1 — the employment-target trigger picks one of several contracts ARBITRARILY.
--
-- THE PROBLEM. `fn_enforce_shift_employment_target` loads a single contract and
-- compares its employment_status to the shift's target:
--
--     SELECT uc.employment_status::text INTO v_status
--       FROM hr.user_contracts uc
--      WHERE uc.user_id = NEW.assigned_employee_id AND uc.status = 'Active'
--        AND (NEW.sub_department_id IS NULL
--             OR uc.sub_department_id = NEW.sub_department_id
--             OR uc.sub_department_id IS NULL)
--      ORDER BY (uc.sub_department_id = NEW.sub_department_id) DESC NULLS LAST
--      LIMIT 1;
--
-- The ORDER BY has ONE key, and it is a boolean that is TRUE for every row when
-- the person holds two contracts in the shift's own sub-department. Verified:
--
--      role_name             | employment_status | order_key
--     -----------------------+-------------------+-----------
--      Event Setups Manager  | Full-Time         | true
--      Usher                 | Casual            | true      <- tie
--
-- With the key constant, `LIMIT 1` returns whichever row the plan happens to
-- emit first. Assigning that employee to a Casual-targeted Usher shift in that
-- sub-department therefore succeeds or fails with "Employment target mismatch"
-- depending on the query plan, and can flip after a VACUUM or ANALYZE. This is
-- the same defect `availability/domain/contract-basis.ts` was written to fix on
-- the frontend — "took contracts[0] straight off unordered PostgREST output" —
-- surviving in SQL.
--
-- THE FIX: ASK THE ROLE. `shifts.role_id` already exists and is exactly the
-- column that disambiguates. The unique constraint
-- `user_contracts_user_id_organization_id_department_id_sub_de_key` on
-- (user_id, organization_id, department_id, sub_department_id, role_id)
-- guarantees at most one contract per person per role per sub-department, so
-- narrowing by role_id turns an ambiguous set into exactly one row.
--
-- TWO PATHS, AND WHY THEY DIFFER IN STRICTNESS:
--
--   ROLE MATCHED — the shift names a role and the person holds a contract for
--     it. That contract governs, full stop, and is checked strictly. This is
--     the deterministic case and the one the multi-role feature depends on:
--     a Full-Time Event Setups Manager who is also a Casual Usher is judged
--     Casual for Usher shifts and Full-Time for Event Setups Manager shifts.
--
--   NO ROLE MATCH — the shift names no role, or names one the person does not
--     hold a contract for. There is then no fact identifying which of their
--     contracts they would be working under, so the trigger accepts the
--     assignment if ANY in-scope contract satisfies the target. That is
--     deliberately permissive and matches what the app layer already does
--     (`compliance/v8/rules/employment-target.ts` uses `statuses.some(...)`),
--     so the two cannot disagree and produce a UI that offers an assignment the
--     write then refuses.
--
--     Note this path is never STRICTER than the code it replaces: today a
--     matching contract can exist and still be rejected because LIMIT 1
--     happened to pick a different one. It can only turn spurious failures
--     into successes.
--
-- ALSO FIXED, QUIETLY: the UPDATE short-circuit did not list `role_id` or
-- `sub_department_id`, so moving a shift to a different role or sub-department
-- skipped re-validation entirely and could leave an assignment standing that
-- the new scope forbids. Both are now in the guard.
--
-- BACKWARD COMPATIBILITY. A person with one contract in the sub-department has
-- exactly one row in scope, so both paths select the row the old LIMIT 1
-- selected and the outcome is identical. Every message string and SQLSTATE
-- ('23514') is preserved; only the mismatch message gains the list of statuses
-- actually held, which the old single-row form could not report.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_enforce_shift_employment_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_status      text;
    v_normalized  text;
    v_is_flexible boolean;
    v_in_scope    int;
    v_bad_status  text;
    v_held        text;
BEGIN
    IF NEW.assigned_employee_id IS NULL THEN RETURN NEW; END IF;

    -- Nothing that bears on the answer changed.  `role_id` and
    -- `sub_department_id` are new to this list: both move the shift into a
    -- different contract scope and must force a re-check.
    IF TG_OP = 'UPDATE'
       AND NEW.assigned_employee_id     IS NOT DISTINCT FROM OLD.assigned_employee_id
       AND NEW.target_employment_type   IS NOT DISTINCT FROM OLD.target_employment_type
       AND NEW.target_requires_flexible IS NOT DISTINCT FROM OLD.target_requires_flexible
       AND NEW.role_id                  IS NOT DISTINCT FROM OLD.role_id
       AND NEW.sub_department_id        IS NOT DISTINCT FROM OLD.sub_department_id
    THEN RETURN NEW; END IF;

    -- ── Path 1: the contract for THIS ROLE, when the person holds one ───────
    -- Exact sub-department first, then a department-wide contract, then `id` so
    -- the ordering is TOTAL rather than merely usually-stable. The unique
    -- constraint means the first key already decides it in practice; the rest
    -- exist so no future data shape can reintroduce a coin flip.
    IF NEW.role_id IS NOT NULL THEN
        SELECT uc.employment_status::text INTO v_status
          FROM hr.user_contracts uc
         WHERE uc.user_id = NEW.assigned_employee_id
           AND uc.status = 'Active'
           AND uc.role_id = NEW.role_id
           AND ( NEW.sub_department_id IS NULL
              OR uc.sub_department_id = NEW.sub_department_id
              OR uc.sub_department_id IS NULL )
         ORDER BY (uc.sub_department_id IS NOT DISTINCT FROM NEW.sub_department_id) DESC,
                  (uc.sub_department_id IS NOT NULL) DESC,
                  uc.id
         LIMIT 1;
    END IF;

    IF v_status IS NOT NULL THEN
        IF lower(btrim(v_status)) NOT IN ('full-time','part-time','casual','flexible part-time') THEN
            RAISE EXCEPTION 'Cannot assign this employee: unrecognised employment status "%" on their contract for this role, so it cannot be matched against the shift target (%). Add this status to fn_normalize_employment_type (and its two sibling alias tables) before it can be used.',
                v_status, NEW.target_employment_type USING ERRCODE = '23514';
        END IF;

        v_normalized  := public.fn_normalize_employment_type(v_status);
        v_is_flexible := lower(btrim(v_status)) LIKE 'flexible%';

        IF v_normalized <> NEW.target_employment_type THEN
            RAISE EXCEPTION 'Employment target mismatch: this shift is for % staff, but the selected employee is % on their contract for this role.',
                NEW.target_employment_type, v_status USING ERRCODE = '23514';
        END IF;

        IF NEW.target_requires_flexible AND NOT v_is_flexible THEN
            RAISE EXCEPTION 'Employment target mismatch: this shift requires Flexible Part-Time staff, but the selected employee is % on their contract for this role.',
                v_status USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
    END IF;

    -- ── Path 2: no contract names this role — fall back to the sub-department ──
    SELECT COUNT(*) INTO v_in_scope
      FROM hr.user_contracts uc
     WHERE uc.user_id = NEW.assigned_employee_id
       AND uc.status = 'Active'
       AND ( NEW.sub_department_id IS NULL
          OR uc.sub_department_id = NEW.sub_department_id
          OR uc.sub_department_id IS NULL );

    IF v_in_scope = 0 THEN
        RAISE EXCEPTION 'Cannot assign this employee: no active contract found for this sub-department, so their employment type cannot be confirmed against the shift target (%).',
            NEW.target_employment_type USING ERRCODE = '23514';
    END IF;

    -- Preserve the original's refusal to guess at a status it does not know.
    SELECT uc.employment_status::text INTO v_bad_status
      FROM hr.user_contracts uc
     WHERE uc.user_id = NEW.assigned_employee_id
       AND uc.status = 'Active'
       AND ( NEW.sub_department_id IS NULL
          OR uc.sub_department_id = NEW.sub_department_id
          OR uc.sub_department_id IS NULL )
       AND lower(btrim(COALESCE(uc.employment_status::text, ''))) NOT IN
           ('full-time','part-time','casual','flexible part-time')
     ORDER BY uc.id
     LIMIT 1;

    IF v_bad_status IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot assign this employee: unrecognised employment status "%" on their contract for this sub-department, so it cannot be matched against the shift target (%). Add this status to fn_normalize_employment_type (and its two sibling alias tables) before it can be used.',
            v_bad_status, NEW.target_employment_type USING ERRCODE = '23514';
    END IF;

    -- Does ANY in-scope contract satisfy the target?
    PERFORM 1
       FROM hr.user_contracts uc
      WHERE uc.user_id = NEW.assigned_employee_id
        AND uc.status = 'Active'
        AND ( NEW.sub_department_id IS NULL
           OR uc.sub_department_id = NEW.sub_department_id
           OR uc.sub_department_id IS NULL )
        AND public.fn_normalize_employment_type(uc.employment_status::text) = NEW.target_employment_type
        AND ( NOT NEW.target_requires_flexible
              OR lower(btrim(uc.employment_status::text)) LIKE 'flexible%' );

    IF FOUND THEN RETURN NEW; END IF;

    -- Nothing matched. Report every status held, deterministically ordered, so
    -- the message is the same on every run and names the real problem.
    SELECT string_agg(DISTINCT uc.employment_status::text, ', ' ORDER BY uc.employment_status::text)
      INTO v_held
      FROM hr.user_contracts uc
     WHERE uc.user_id = NEW.assigned_employee_id
       AND uc.status = 'Active'
       AND ( NEW.sub_department_id IS NULL
          OR uc.sub_department_id = NEW.sub_department_id
          OR uc.sub_department_id IS NULL );

    IF NEW.target_requires_flexible THEN
        RAISE EXCEPTION 'Employment target mismatch: this shift requires Flexible Part-Time staff, but the selected employee holds % for this sub-department.',
            v_held USING ERRCODE = '23514';
    END IF;

    RAISE EXCEPTION 'Employment target mismatch: this shift is for % staff, but the selected employee holds % for this sub-department.',
        NEW.target_employment_type, v_held USING ERRCODE = '23514';
END;
$function$;

COMMENT ON FUNCTION public.fn_enforce_shift_employment_target() IS
    'Enforces shifts.target_employment_type against the assignee''s contract at ROLE grain: '
    'the contract naming shifts.role_id governs when one exists (deterministic), otherwise any '
    'in-scope contract matching the target is accepted (mirrors V8_EMPLOYMENT_TARGET). Replaces '
    'an ORDER BY whose only key tied whenever a person held two contracts in one sub-department. '
    'See migration 20260824130100.';

-- ── Self-test ───────────────────────────────────────────────────────────────
-- Two halves.
--
--   PART A asserts the thing this migration actually changes — that the
--   role-scoped lookup resolves to ONE row and the SAME row every time. It runs
--   unconditionally, because it depends on nothing but user_contracts.
--
--   PART B drives the real trigger through an INSERT on `shifts`. That table
--   carries 24 triggers (shape gate, FSM, audit, …) and any of them can refuse
--   a synthetic row for reasons that have nothing to do with employment
--   targets. So Part B treats ONLY our own messages as verdicts and reports
--   anything else as SKIPPED — a self-test that fails on an unrelated guard
--   teaches the next reader to ignore it.
DO $selftest$
DECLARE
    v_user uuid; v_org uuid; v_dept uuid; v_sd uuid; v_r uuid[];
    v_shift uuid; v_msg text; v_failures text := '';
    v_roster uuid; v_subgroup uuid;
    v_got text; v_first text; v_n int;
    k_ours CONSTANT text := '(Employment target mismatch|no active contract found|unrecognised employment status)';
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
        RAISE NOTICE 'shift_employment_target_role_grain selftest SKIPPED — no fixture';
        RETURN;
    END IF;

    -- The exact ambiguity: Full-Time in role 1, Casual in role 2, same sub-dept.
    INSERT INTO hr.user_contracts (user_id, organization_id, department_id, sub_department_id,
                                   role_id, status, employment_status, contracted_weekly_hours)
    VALUES (v_user, v_org, v_dept, v_sd, v_r[1], 'Active', 'Full-Time', 38),
           (v_user, v_org, v_dept, v_sd, v_r[2], 'Active', 'Casual', 0);

    -- ── PART A — the lookup resolves to one row, and the same row every time ──
    -- This is the defect verbatim: before this migration the equivalent query
    -- ordered on a key that was TRUE for both rows.
    FOR i IN 1..20 LOOP
        SELECT uc.employment_status::text INTO v_got
          FROM hr.user_contracts uc
         WHERE uc.user_id = v_user AND uc.status = 'Active'
           AND uc.role_id = v_r[2]
           AND ( uc.sub_department_id = v_sd OR uc.sub_department_id IS NULL )
         ORDER BY (uc.sub_department_id IS NOT DISTINCT FROM v_sd) DESC,
                  (uc.sub_department_id IS NOT NULL) DESC,
                  uc.id
         LIMIT 1;

        IF i = 1 THEN v_first := v_got; END IF;
        IF v_got IS DISTINCT FROM v_first THEN
            v_failures := v_failures || '(A) role lookup was not stable across passes ; ';
            EXIT;
        END IF;
    END LOOP;

    IF v_first IS DISTINCT FROM 'Casual' THEN
        v_failures := v_failures || '(A) the Casual role resolved to "'
                   || COALESCE(v_first, 'NULL') || '", not Casual ; ';
    END IF;

    SELECT uc.employment_status::text INTO v_got
      FROM hr.user_contracts uc
     WHERE uc.user_id = v_user AND uc.status = 'Active' AND uc.role_id = v_r[1]
       AND ( uc.sub_department_id = v_sd OR uc.sub_department_id IS NULL )
     ORDER BY (uc.sub_department_id IS NOT DISTINCT FROM v_sd) DESC,
              (uc.sub_department_id IS NOT NULL) DESC, uc.id
     LIMIT 1;
    IF v_got IS DISTINCT FROM 'Full-Time' THEN
        v_failures := v_failures || '(A) the Full-Time role resolved to "'
                   || COALESCE(v_got, 'NULL') || '", not Full-Time ; ';
    END IF;

    -- And the unnarrowed set really is ambiguous — i.e. Part A is testing
    -- something. Two rows, two different statuses, one sub-department.
    SELECT COUNT(DISTINCT uc.employment_status::text) INTO v_n
      FROM hr.user_contracts uc
     WHERE uc.user_id = v_user AND uc.status = 'Active' AND uc.sub_department_id = v_sd;
    IF v_n < 2 THEN
        v_failures := v_failures || '(A) fixture is not ambiguous — only '
                   || v_n || ' distinct status in the sub-department ; ';
    END IF;

    -- ── PART B — drive the real trigger, best effort ─────────────────────────
    SELECT rs.id, rs.roster_id INTO v_subgroup, v_roster
      FROM public.roster_subgroups rs ORDER BY rs.id LIMIT 1;

    IF v_subgroup IS NULL THEN
        RAISE NOTICE 'shift_employment_target_role_grain selftest — Part B SKIPPED (no roster subgroup)';
    ELSE
        -- (b1) Casual-targeted shift naming the CASUAL role: must be accepted.
        BEGIN
            INSERT INTO public.shifts (organization_id, department_id, sub_department_id, role_id,
                                       roster_id, roster_subgroup_id, shift_date, start_time, end_time,
                                       target_employment_type, assigned_employee_id)
            VALUES (v_org, v_dept, v_sd, v_r[2], v_roster, v_subgroup,
                    CURRENT_DATE + 30, '09:00', '17:00', 'Casual', v_user)
            RETURNING id INTO v_shift;
            DELETE FROM public.shifts WHERE id = v_shift;
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
            IF v_msg ~ k_ours THEN
                v_failures := v_failures || '(B1) Casual shift on the Casual role was refused by '
                           || 'the employment-target rule: ' || v_msg || ' ; ';
            ELSE
                RAISE NOTICE 'shift_employment_target_role_grain — Part B SKIPPED (unrelated guard: %)', v_msg;
            END IF;
        END;

        -- (b2) FT-targeted shift naming the CASUAL role: must be REFUSED, and
        --      refused by OUR rule rather than by something else.
        BEGIN
            INSERT INTO public.shifts (organization_id, department_id, sub_department_id, role_id,
                                       roster_id, roster_subgroup_id, shift_date, start_time, end_time,
                                       target_employment_type, assigned_employee_id)
            VALUES (v_org, v_dept, v_sd, v_r[2], v_roster, v_subgroup,
                    CURRENT_DATE + 30, '09:00', '17:00', 'FT', v_user)
            RETURNING id INTO v_shift;
            DELETE FROM public.shifts WHERE id = v_shift;
            v_failures := v_failures || '(B2) an FT shift on the Casual role was ACCEPTED ; ';
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
            IF v_msg LIKE '%(B2) an FT shift%' THEN RAISE; END IF;
            -- refused; by our rule or another guard, either way not accepted
            NULL;
        END;
    END IF;

    IF v_failures <> '' THEN
        RAISE EXCEPTION 'shift_employment_target_role_grain selftest FAILED: %', v_failures;
    END IF;

    RAISE EXCEPTION 'selftest_rollback';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM = 'selftest_rollback' THEN
            RAISE NOTICE 'shift_employment_target_role_grain selftest PASSED (rolled back)';
        ELSE
            RAISE;
        END IF;
END
$selftest$;
