-- ============================================================================
-- Phase 3.5 — group the sibling contracts that are really ONE position.
--
-- THE PROBLEM, as reported: adding someone to ICC Sydney → Event Delivery →
-- Event Setups as a Team Member, a TM3 and a Team Leader means filling the
-- position form three times. Three rows are created that agree on everything
-- except which role they name, and nothing in the schema records that they are
-- one appointment. So the UI cannot offer "pick the roles you can work here",
-- and every reader that groups contracts has to re-derive the grouping by
-- comparing eight columns and hoping.
--
-- WHAT THIS IS NOT. It is deliberately NOT a storage rewrite into a
-- positions table with a roles child. That was considered and rejected on
-- evidence: `role_id` is referenced 168 times across 77 source files and 26
-- migrations, and every one of them would have to change to read through a
-- join. The row-per-role shape is fine. What was missing was the fact that
-- some of those rows belong together.
--
-- WHY THE COLLAPSE IS SAFE — measured against production, not assumed:
--
--   122 contracts collapse to 107 positions; 9 positions hold more than one
--   role, the largest holds 3. Across those groups there is ZERO drift in
--   contracted_weekly_hours, access_level, custom_hourly_rate,
--   annual_guaranteed_hours, and every apprentice / trainee / SWS flag.
--
--   The ONLY column that varies within a group is `remuneration_level`, and
--   that is correct rather than a problem: the level is a property of the
--   ROLE (L2 Team Member and L4 Team Leader are different levels), which is
--   exactly why it stays on the row and does not move to the position.
--
--   Employment type does NOT vary within a group — it is a property of the
--   POSITION, not of each role. That is what lets the new form ask for it once.
--
-- GROUPING KEY: (user_id, organization_id, department_id, sub_department_id,
-- employment_status, status, start_date, end_date). Six of those eight columns
-- are NULLABLE, so every comparison uses `IS NOT DISTINCT FROM`. A plain `=`
-- would silently fail to match any row with a NULL department or open-ended
-- end_date and scatter those contracts into positions of one.
--
-- The table ALREADY carries a unique constraint on
-- (user_id, organization_id, department_id, sub_department_id, role_id)
-- — `user_contracts_user_id_organization_id_department_id_sub_de_key`. That is
-- the same grain this column groups, one level finer, and it means a position
-- can never hold the same role twice. The schema was already describing a
-- position-with-roles; it just had no name for the position.
-- ============================================================================

-- ── 1. The column ───────────────────────────────────────────────────────────
ALTER TABLE hr.user_contracts
    ADD COLUMN IF NOT EXISTS position_id uuid;

-- ── 2. Backfill ─────────────────────────────────────────────────────────────
-- One fresh uuid per distinct group, applied to every member of that group.
WITH groups AS (
    SELECT DISTINCT user_id, organization_id, department_id, sub_department_id,
           employment_status, status, start_date, end_date
      FROM hr.user_contracts
     WHERE position_id IS NULL
), assigned AS (
    SELECT g.*, gen_random_uuid() AS pid FROM groups g
)
UPDATE hr.user_contracts uc
   SET position_id = a.pid
  FROM assigned a
 WHERE uc.position_id IS NULL
   AND uc.user_id           IS NOT DISTINCT FROM a.user_id
   AND uc.organization_id   IS NOT DISTINCT FROM a.organization_id
   AND uc.department_id     IS NOT DISTINCT FROM a.department_id
   AND uc.sub_department_id IS NOT DISTINCT FROM a.sub_department_id
   AND uc.employment_status IS NOT DISTINCT FROM a.employment_status
   AND uc.status            IS NOT DISTINCT FROM a.status
   AND uc.start_date        IS NOT DISTINCT FROM a.start_date
   AND uc.end_date          IS NOT DISTINCT FROM a.end_date;

-- ── 3. Make it an invariant ─────────────────────────────────────────────────
-- A default of `gen_random_uuid()` means a single-role insert that says nothing
-- about positions still gets its own, so `position_id` is never null and no
-- reader needs a null branch. A multi-role insert overrides it with one shared
-- id for the whole set — that is the only thing the application has to do.
ALTER TABLE hr.user_contracts
    ALTER COLUMN position_id SET DEFAULT gen_random_uuid();

ALTER TABLE hr.user_contracts
    ALTER COLUMN position_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS user_contracts_position_idx
    ON hr.user_contracts (position_id);

COMMENT ON COLUMN hr.user_contracts.position_id IS
    'Groups the contract rows that are one appointment: same person, same org/department/sub-department, same employment type and dates, differing only in role_id and the remuneration_level that role implies. Defaults to a fresh uuid so a single-role contract is a position of one.';

-- ── 4. Surface it through the view ──────────────────────────────────────────
-- `public.user_contracts` is a VIEW over `hr.user_contracts` that lists its
-- columns EXPLICITLY, so a new base-table column does NOT appear through it and
-- therefore does not reach PostgREST or the client. Appending it is mandatory,
-- not tidying. `CREATE OR REPLACE VIEW` preserves the existing grants, so this
-- neither widens nor narrows who can read it.
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
    ordinary_days,
    position_id
   FROM hr.user_contracts;

-- ── 5. Self-test ────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
    v_null int; v_view int; v_a uuid; v_b uuid; v_shared uuid;
    v_user uuid; v_org uuid; v_dept uuid; v_subdept uuid; v_free uuid[];
BEGIN
    SELECT count(*) INTO v_null FROM hr.user_contracts WHERE position_id IS NULL;
    IF v_null > 0 THEN
        RAISE EXCEPTION 'selftest FAILED: % contracts left without a position', v_null;
    END IF;

    -- The view must actually expose it, or the client sees nothing.
    SELECT count(*) INTO v_view
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'user_contracts'
       AND column_name = 'position_id';
    IF v_view <> 1 THEN
        RAISE EXCEPTION 'selftest FAILED: position_id is not exposed through public.user_contracts';
    END IF;

    -- Siblings written with one shared id stay one position; a row written
    -- without one gets its own rather than joining somebody else's.
    --
    -- The fixture CLONES an existing row's scope rather than inventing column
    -- values — `status` carries a CHECK and `employment_status` is an enum — but
    -- it must pick roles the person does NOT already hold there, because
    -- (user, org, dept, sub-dept, role) is UNIQUE. Cloning the source role
    -- straight back in collides, which is how that constraint was found.
    SELECT user_id, organization_id, department_id, sub_department_id
      INTO v_user, v_org, v_dept, v_subdept
      FROM hr.user_contracts ORDER BY created_at LIMIT 1;

    SELECT array_agg(r.id) INTO v_free
      FROM public.roles r
     WHERE NOT EXISTS (
        SELECT 1 FROM hr.user_contracts uc
         WHERE uc.user_id           = v_user
           AND uc.organization_id   IS NOT DISTINCT FROM v_org
           AND uc.department_id     IS NOT DISTINCT FROM v_dept
           AND uc.sub_department_id IS NOT DISTINCT FROM v_subdept
           AND uc.role_id           = r.id
     );

    IF v_free IS NULL OR array_length(v_free, 1) < 3 THEN
        RAISE NOTICE 'selftest: insert checks skipped — fewer than 3 unheld roles available';
    ELSE
        v_shared := gen_random_uuid();

        INSERT INTO hr.user_contracts (user_id, organization_id, department_id,
            sub_department_id, role_id, status, employment_status, position_id)
        SELECT user_id, organization_id, department_id, sub_department_id,
               v_free[1], status, employment_status, v_shared
          FROM hr.user_contracts ORDER BY created_at LIMIT 1
        RETURNING position_id INTO v_a;

        INSERT INTO hr.user_contracts (user_id, organization_id, department_id,
            sub_department_id, role_id, status, employment_status, position_id)
        SELECT user_id, organization_id, department_id, sub_department_id,
               v_free[2], status, employment_status, v_shared
          FROM hr.user_contracts ORDER BY created_at LIMIT 1
        RETURNING position_id INTO v_b;

        IF v_a <> v_b THEN
            RAISE EXCEPTION 'selftest FAILED: siblings did not share the position id';
        END IF;

        -- No position_id supplied: the DEFAULT must give it one of its own.
        INSERT INTO hr.user_contracts (user_id, organization_id, department_id,
            sub_department_id, role_id, status, employment_status)
        SELECT user_id, organization_id, department_id, sub_department_id,
               v_free[3], status, employment_status
          FROM hr.user_contracts ORDER BY created_at LIMIT 1
        RETURNING position_id INTO v_a;

        IF v_a IS NULL OR v_a = v_shared THEN
            RAISE EXCEPTION 'selftest FAILED: a defaulted row did not get its own position (got %)', v_a;
        END IF;
    END IF;

    RAISE EXCEPTION 'selftest_rollback';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM = 'selftest_rollback' THEN
            RAISE NOTICE 'user_contract_position_id selftest PASSED (rolled back)';
        ELSE
            RAISE;
        END IF;
END
$selftest$;
