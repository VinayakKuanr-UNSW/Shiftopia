-- ============================================================================
-- F3 — the contract guardrails count ROWS where they mean POSITIONS.
--
-- THE PROBLEM. Migration 20260821110000 made a position a set of contract rows
-- that share a `position_id` and differ only in `role_id`. The guardrail
-- trigger predates that and still reasons per row, so two of its three rules
-- misfire the moment a position covers more than one role:
--
--   * "An employee cannot hold more than one active Full-Time contract."
--     A Full-Time position covering two roles writes two Full-Time rows. Row 2
--     sees row 1 and the whole batch rolls back. Measured against production:
--
--         T1 multi-role FT position = BLOCKED: An employee cannot hold more
--         than one active Full-Time contract.
--
--   * The 38h Part-Time sum adds `contracted_weekly_hours` once PER ROW, but
--     those hours are a property of the POSITION — the person works 20h in that
--     appointment, not 20h per role they may be rostered as. A three-role
--     20h Part-Time position therefore reads as 60h and is refused:
--
--         T3 multi-role PART-TIME position (3 roles @20h) = BLOCKED: Total
--         contracted hours across all Part-Time contracts cannot exceed 38
--         hours per week (attempted total: 40.0h/week).
--
--     (40.0, not 60.0, because it fails on row 2 before row 3 is reached.)
--
-- The net effect is that the position abstraction only ever worked for Casual,
-- which is why the nine multi-role positions in the historical data survived —
-- they were all Casual. That was not a deliberate restriction; nothing in the
-- EBA says a Full-Time appointment covers exactly one role. Clause 14
-- (Multiskilling) says the opposite: a Team Member "shall be available to work
-- as required on any work within their skill, competence and training".
--
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT.
--
--   CHANGED  The Full-Time uniqueness test counts DISTINCT position_id and
--            ignores rows belonging to the position being written. One
--            Full-Time POSITION stays the limit; that position may name as
--            many roles as it likes.
--
--   CHANGED  The Part-Time hours sum collapses to one figure per position
--            before adding, so a position is counted once however many roles
--            it covers. 38h across all Part-Time POSITIONS stays the cap
--            (cl 35.2(b) — ordinary hours must not exceed an average of 38 per
--            week; cl 12.3(b) puts a part-timer below that average).
--
--   UNCHANGED  The Full-Time ↔ Part-Time mutual exclusion. It is an existence
--            test, so rows and positions give the same answer, and the rule
--            itself is right: 38 Full-Time hours leave no room beneath the
--            cap for a second permanent engagement.
--
--   UNCHANGED  Casual is exempt from the ceiling entirely. Casuals carry no
--            contracted-hours floor, and cl 13 (Multi-Hiring) expressly
--            contemplates a permanent Team Member ALSO being engaged casually
--            — which is exactly the arrangement this whole change exists to
--            support, and which the ceiling must not obstruct.
--
--   UNCHANGED  Every message string and SQLSTATE, except the one word "contract"
--            -> "position" in the Full-Time message, because the noun it names
--            has changed. Callers that match on ERRCODE are unaffected.
--
-- BACKWARD COMPATIBILITY. `position_id` is NOT NULL with a
-- `gen_random_uuid()` default, so a legacy single-role row is a position of
-- one: `count(DISTINCT position_id)` returns exactly what `count(*)` returned,
-- and the per-position sum returns that row's own hours. Every single-role
-- employee behaves byte-identically.
--
-- ── THE INDEX HAS TO GO, AND WHY THAT IS NOT A LOOSENING ────────────────────
-- Rewriting the trigger is NOT sufficient. The same rule is enforced a second
-- time, harder, by a partial unique index:
--
--     CREATE UNIQUE INDEX idx_user_contracts_single_active_ft
--         ON hr.user_contracts (user_id)
--      WHERE status = 'Active' AND employment_status = 'Full-Time';
--
-- Found by testing rather than by reading: with the trigger already fixed, a
-- multi-role Full-Time position still failed, now with
-- "duplicate key value violates unique constraint idx_user_contracts_single_active_ft".
--
-- The new rule is "at most one Full-Time POSITION", i.e. at most one DISTINCT
-- position_id among a user's Active Full-Time rows. That is a counting
-- predicate, not a uniqueness one, and no B-tree unique index can express it:
-- (user_id, position_id) would permit unlimited positions, and (user_id) is the
-- row-grain rule being replaced. So the index is dropped and the trigger
-- becomes the single owner of the rule.
--
-- What the index was genuinely buying beyond the trigger was CONCURRENCY: two
-- transactions inserting a Full-Time contract for one person at the same time
-- both pass a trigger's SELECT under READ COMMITTED, because neither sees the
-- other's uncommitted row, and both commit. That race is closed here by taking
-- a transaction-scoped advisory lock keyed on the user before checking, which
-- serialises contract writes per employee and costs nothing when there is no
-- contention. The guarantee therefore survives the index; only its mechanism
-- changes.
-- ============================================================================

-- ── The row-grain unique index, replaced by the position-grain trigger rule ──
DROP INDEX IF EXISTS hr.idx_user_contracts_single_active_ft;

CREATE OR REPLACE FUNCTION hr.fn_check_user_contract_guardrails()
RETURNS trigger
LANGUAGE plpgsql
-- Pinned: a role-mutable search_path would let the caller decide which
-- `user_contracts` the guardrails read. Flagged by the Supabase advisor before
-- this change and fixed here because this migration owns the function now.
-- Every reference below is schema-qualified or in pg_catalog, so pinning cannot
-- alter behaviour.
SET search_path TO 'pg_catalog', 'hr', 'public'
AS $function$
DECLARE
    v_ft_positions  INT;
    v_pt_count      INT;
    v_pt_weekly_sum NUMERIC;
    v_new_weekly    NUMERIC;
    -- The sentinel the original used so `id <> NEW.id` is never NULL-swallowed.
    k_no_id CONSTANT uuid := '00000000-0000-0000-0000-000000000000'::uuid;
BEGIN
    IF NEW.status <> 'Active' THEN
        RETURN NEW;
    END IF;

    -- Serialise contract writes for this ONE employee, so the counting rules
    -- below cannot be defeated by two concurrent transactions that each see a
    -- pre-insert world. Transaction-scoped, released at commit, and keyed on
    -- the user so unrelated employees never contend. This replaces the
    -- concurrency guarantee that the dropped partial unique index provided.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));

    -- Weekly hours implied by THIS row. Unchanged from the original.
    IF NEW.employment_status = 'Full-Time' THEN
        v_new_weekly := 38;
    ELSIF NEW.employment_status = 'Part-Time' THEN
        v_new_weekly := COALESCE(NEW.contracted_weekly_hours, 0);
    ELSIF NEW.employment_status = 'Flexible Part-Time' THEN
        IF COALESCE(NEW.contracted_weekly_hours, 0) > 0 THEN
            v_new_weekly := NEW.contracted_weekly_hours;
        ELSE
            v_new_weekly := COALESCE(NEW.annual_guaranteed_hours, 0) / 52.0;
        END IF;
    ELSE
        v_new_weekly := 0;
    END IF;

    -- ── 1. At most one active Full-Time POSITION ────────────────────────────
    -- `position_id IS DISTINCT FROM NEW.position_id` is the whole fix: the
    -- siblings of the position being written are not a second appointment.
    IF NEW.employment_status = 'Full-Time' THEN
        SELECT COUNT(DISTINCT position_id) INTO v_ft_positions
        FROM hr.user_contracts
        WHERE user_id = NEW.user_id
          AND status = 'Active'
          AND employment_status = 'Full-Time'
          AND position_id IS DISTINCT FROM NEW.position_id
          AND id <> COALESCE(NEW.id, k_no_id);

        IF v_ft_positions > 0 THEN
            RAISE EXCEPTION 'An employee cannot hold more than one active Full-Time position.'
                USING ERRCODE = '23505';
        END IF;
    END IF;

    -- ── 2. Full-Time and Part-Time cannot coexist ───────────────────────────
    -- Existence tests: unchanged, and unaffected by the row/position question.
    IF NEW.employment_status = 'Full-Time' THEN
        SELECT COUNT(*) INTO v_pt_count
        FROM hr.user_contracts
        WHERE user_id = NEW.user_id
          AND status = 'Active'
          AND employment_status IN ('Part-Time', 'Flexible Part-Time')
          AND id <> COALESCE(NEW.id, k_no_id);

        IF v_pt_count > 0 THEN
            RAISE EXCEPTION 'An employee holding a Part-Time contract cannot also hold a Full-Time contract.'
                USING ERRCODE = '23514';
        END IF;

    ELSIF NEW.employment_status IN ('Part-Time', 'Flexible Part-Time') THEN
        SELECT COUNT(*) INTO v_ft_positions
        FROM hr.user_contracts
        WHERE user_id = NEW.user_id
          AND status = 'Active'
          AND employment_status = 'Full-Time'
          AND id <> COALESCE(NEW.id, k_no_id);

        IF v_ft_positions > 0 THEN
            RAISE EXCEPTION 'An employee holding a Full-Time contract cannot also hold a Part-Time contract.'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- ── 3. 38h across all Part-Time POSITIONS ───────────────────────────────
    -- One figure per position, then summed. `max()` rather than `min()` or
    -- `avg()` is arbitrary only because the value cannot differ within a
    -- position: hours are written from one form field onto every row of the
    -- appointment. If a position ever did disagree with itself, taking the
    -- largest is the reading that cannot understate the ceiling.
    IF NEW.employment_status IN ('Part-Time', 'Flexible Part-Time') THEN
        WITH per_position AS (
            SELECT position_id,
                   MAX(CASE
                        WHEN employment_status = 'Part-Time'
                            THEN COALESCE(contracted_weekly_hours, 0)
                        WHEN employment_status = 'Flexible Part-Time'
                            THEN CASE WHEN COALESCE(contracted_weekly_hours, 0) > 0
                                      THEN contracted_weekly_hours
                                      ELSE COALESCE(annual_guaranteed_hours, 0) / 52.0 END
                        ELSE 0
                       END) AS weekly
              FROM hr.user_contracts
             WHERE user_id = NEW.user_id
               AND status = 'Active'
               AND employment_status IN ('Part-Time', 'Flexible Part-Time')
               AND position_id IS DISTINCT FROM NEW.position_id
               AND id <> COALESCE(NEW.id, k_no_id)
             GROUP BY position_id
        )
        SELECT COALESCE(SUM(weekly), 0) INTO v_pt_weekly_sum FROM per_position;

        IF (v_pt_weekly_sum + v_new_weekly) > 38.001 THEN
            RAISE EXCEPTION 'Total contracted hours across all Part-Time contracts cannot exceed 38 hours per week (attempted total: %h/week).',
                ROUND(v_pt_weekly_sum + v_new_weekly, 1)
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION hr.fn_check_user_contract_guardrails() IS
    'Contract guardrails at POSITION grain: one active Full-Time position (not row), '
    'Full-Time and Part-Time mutually exclusive, and 38h/week summed across Part-Time '
    'positions counting each position once however many roles it covers. Casual exempt '
    '(EBA cl 13 Multi-Hiring). See migration 20260824130000.';

-- ── Self-test ───────────────────────────────────────────────────────────────
-- Everything here is rolled back. It builds its own fixtures from live
-- reference data rather than inventing enum / CHECK values, and picks roles the
-- chosen person does not already hold, because
-- (user, org, dept, sub-dept, role) is UNIQUE.
DO $selftest$
DECLARE
    v_user uuid; v_org uuid; v_dept uuid; v_sd uuid;
    v_r uuid[]; v_pos uuid; v_pos2 uuid; v_msg text; v_failures text := '';
BEGIN
    SELECT id INTO v_user FROM public.profiles ORDER BY id LIMIT 1;
    SELECT id INTO v_org  FROM public.organizations ORDER BY id LIMIT 1;

    SELECT sd.department_id, sd.id INTO v_dept, v_sd
      FROM public.sub_departments sd
      JOIN hr.roles r ON r.subdepartment_id = sd.id
     GROUP BY sd.department_id, sd.id
    HAVING COUNT(r.id) >= 4
     ORDER BY sd.id LIMIT 1;

    SELECT array_agg(id ORDER BY id) INTO v_r
      FROM (SELECT r.id FROM hr.roles r
             WHERE r.subdepartment_id = v_sd
               AND NOT EXISTS (SELECT 1 FROM hr.user_contracts uc
                                WHERE uc.user_id = v_user AND uc.role_id = r.id
                                  AND uc.sub_department_id IS NOT DISTINCT FROM v_sd)
             ORDER BY r.id LIMIT 4) s;

    IF v_user IS NULL OR v_org IS NULL OR v_sd IS NULL
       OR v_r IS NULL OR array_length(v_r, 1) < 4 THEN
        RAISE NOTICE 'contract_guardrails_position_grain selftest SKIPPED — no fixture with 4 free roles';
        RETURN;
    END IF;

    -- (a) A Full-Time position covering three roles must now save.
    BEGIN
        v_pos := gen_random_uuid();
        INSERT INTO hr.user_contracts (user_id, organization_id, department_id, sub_department_id,
                                       role_id, status, employment_status, contracted_weekly_hours, position_id)
        VALUES (v_user, v_org, v_dept, v_sd, v_r[1], 'Active', 'Full-Time', 38, v_pos),
               (v_user, v_org, v_dept, v_sd, v_r[2], 'Active', 'Full-Time', 38, v_pos),
               (v_user, v_org, v_dept, v_sd, v_r[3], 'Active', 'Full-Time', 38, v_pos);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        v_failures := v_failures || '(a) multi-role FT position still blocked: ' || v_msg || ' ; ';
    END;

    -- (b) A SECOND Full-Time position must still be refused.
    BEGIN
        INSERT INTO hr.user_contracts (user_id, organization_id, department_id, sub_department_id,
                                       role_id, status, employment_status, contracted_weekly_hours, position_id)
        VALUES (v_user, v_org, v_dept, v_sd, v_r[4], 'Active', 'Full-Time', 38, gen_random_uuid());
        v_failures := v_failures || '(b) a second FT position was ACCEPTED ; ';
    EXCEPTION WHEN OTHERS THEN
        NULL; -- refused, as intended
    END;

    DELETE FROM hr.user_contracts WHERE user_id = v_user AND position_id = v_pos;

    -- (c) A Part-Time position covering three roles at 20h is 20h, not 60h.
    BEGIN
        v_pos := gen_random_uuid();
        INSERT INTO hr.user_contracts (user_id, organization_id, department_id, sub_department_id,
                                       role_id, status, employment_status, contracted_weekly_hours, position_id)
        VALUES (v_user, v_org, v_dept, v_sd, v_r[1], 'Active', 'Part-Time', 20, v_pos),
               (v_user, v_org, v_dept, v_sd, v_r[2], 'Active', 'Part-Time', 20, v_pos),
               (v_user, v_org, v_dept, v_sd, v_r[3], 'Active', 'Part-Time', 20, v_pos);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        v_failures := v_failures || '(c) multi-role PT position still blocked: ' || v_msg || ' ; ';
    END;

    -- (d) The 38h ceiling must still bite ACROSS positions: 20h + 20h = 40h.
    BEGIN
        v_pos2 := gen_random_uuid();
        INSERT INTO hr.user_contracts (user_id, organization_id, department_id, sub_department_id,
                                       role_id, status, employment_status, contracted_weekly_hours, position_id)
        VALUES (v_user, v_org, v_dept, v_sd, v_r[4], 'Active', 'Part-Time', 20, v_pos2);
        v_failures := v_failures || '(d) 40h across two PT positions was ACCEPTED ; ';
    EXCEPTION WHEN OTHERS THEN
        NULL; -- refused, as intended
    END;

    DELETE FROM hr.user_contracts WHERE user_id = v_user AND position_id IN (v_pos, v_pos2);

    -- (e) Casual stays exempt and unlimited — the cl 13 multi-hire case.
    BEGIN
        v_pos := gen_random_uuid();
        INSERT INTO hr.user_contracts (user_id, organization_id, department_id, sub_department_id,
                                       role_id, status, employment_status, contracted_weekly_hours, position_id)
        VALUES (v_user, v_org, v_dept, v_sd, v_r[1], 'Active', 'Full-Time', 38, v_pos);
        INSERT INTO hr.user_contracts (user_id, organization_id, department_id, sub_department_id,
                                       role_id, status, employment_status, contracted_weekly_hours, position_id)
        VALUES (v_user, v_org, v_dept, v_sd, v_r[2], 'Active', 'Casual', 0, gen_random_uuid());
        INSERT INTO hr.user_contracts (user_id, organization_id, department_id, sub_department_id,
                                       role_id, status, employment_status, contracted_weekly_hours, position_id)
        VALUES (v_user, v_org, v_dept, v_sd, v_r[3], 'Active', 'Casual', 0, gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        v_failures := v_failures || '(e) FT + two Casual roles blocked: ' || v_msg || ' ; ';
    END;

    IF v_failures <> '' THEN
        RAISE EXCEPTION 'contract_guardrails_position_grain selftest FAILED: %', v_failures;
    END IF;

    RAISE EXCEPTION 'selftest_rollback';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM = 'selftest_rollback' THEN
            RAISE NOTICE 'contract_guardrails_position_grain selftest PASSED (rolled back)';
        ELSE
            RAISE;
        END IF;
END
$selftest$;
