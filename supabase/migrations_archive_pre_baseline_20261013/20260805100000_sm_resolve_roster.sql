-- Migration: 20260805100000_sm_resolve_roster.sql
-- Description: One canonical "give me the roster for this day, creating it if needed"
--              resolver. Foundation for implicit roster activation.
--
-- WHY THIS EXISTS
-- ---------------
-- `rosters` is a day container, one row per
-- (start_date, department_id, sub_department_id), and `shifts.roster_id` is NOT
-- NULL -- so every write path needs a roster row to exist first. Today that row is
-- created by an explicit manager action ("Activate Roster" / "Plan Period"), and
-- FOUR separate code paths refuse to work until it does.
--
-- Making activation implicit means every write path needs find-or-create. There
-- are already THREE divergent implementations of that operation:
--
--   activate_roster_for_range        -- explicit `IS NULL` branch          (correct)
--   create_planning_period           -- ON CONFLICT on the expression index (correct)
--   apply_template_to_date_range_v2  -- `sub_department_id = v_sub_dept_id` (BROKEN)
--
-- The third is NULL-unsafe: when the target sub-department is NULL that predicate
-- is never true, so the SELECT misses, the INSERT fires anyway, and it collides
-- with uk_rosters_date_dept_subdept -> 23505 aborts the whole apply. Latent today
-- only because all 163 prod rosters have a non-null sub_department_id. Removing
-- the activation gate makes the NULL path reachable, so it is fixed here rather
-- than inherited (see 20260805120000).
--
-- SECURITY
-- --------
-- `rosters` has a correct RBAC INSERT policy:
--     rosters_insert_rbac: user_has_action_in_scope('roster.edit', org, dept, sub_dept)
-- but both roster-creating functions are SECURITY DEFINER with NO authorization
-- check of any kind -- any authenticated user can create a roster in any org. That
-- is reachable today only via two explicit manager actions; making creation
-- implicit puts it behind EVERY write path, so the guard lands here.
--
-- The guard is skipped when auth.uid() IS NULL, i.e. service_role / pg_cron /
-- solver contexts, which have no JWT and are already trusted. It is NOT skipped
-- for any authenticated caller.
--
-- PAST DATES
-- ----------
-- Stakeholder decision 2026-08-05: shifts must not be created, edited or updated
-- in the past. This function therefore refuses to CREATE a roster for a past date.
-- Resolving an ALREADY-EXISTING past roster still succeeds -- reading back a row
-- someone else made is not a write, and blocking it would break edit/publish flows
-- over ranges that merely include past days.
--
-- The cutoff is Sydney's date, not CURRENT_DATE. The database runs in UTC
-- (verified: current_setting('TimeZone') = 'UTC') while the business timezone is
-- Australia/Sydney, so CURRENT_DATE lags Sydney by up to 11 hours. Between
-- midnight and 10/11am Sydney time, CURRENT_DATE is still YESTERDAY -- which would
-- have let a caller create a roster for a day that is already in the past locally.
-- `activate_roster_for_range` has this bug today; this function does not.

CREATE OR REPLACE FUNCTION public.sm_resolve_roster(
    p_org_id      uuid,
    p_dept_id     uuid,
    p_sub_dept_id uuid,
    p_date        date,
    p_allow_past  boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_roster_id    uuid;
    v_today_sydney date := (now() AT TIME ZONE 'Australia/Sydney')::date;
BEGIN
    IF p_dept_id IS NULL OR p_date IS NULL THEN
        RAISE EXCEPTION 'sm_resolve_roster: department_id and date are both required'
            USING ERRCODE = '22004';
    END IF;

    -- ── 1. Existing roster wins, unconditionally ─────────────────────────────
    -- Deliberately before the past-date check: resolving a roster that already
    -- exists creates nothing, so the past-date policy does not apply to it.
    -- IS NOT DISTINCT FROM, never `=`, so a NULL sub-department matches a NULL
    -- sub-department. This is the bug being fixed.
    SELECT id INTO v_roster_id
      FROM public.rosters
     WHERE start_date = p_date
       AND department_id = p_dept_id
       AND sub_department_id IS NOT DISTINCT FROM p_sub_dept_id
     LIMIT 1;

    IF v_roster_id IS NULL THEN
        -- ── 2. Authorization -- creation only ────────────────────────────────
        -- Mirrors rosters_insert_rbac, which this SECURITY DEFINER function
        -- bypasses. auth.uid() IS NULL = service_role / cron / solver: no JWT,
        -- already trusted.
        IF auth.uid() IS NOT NULL
           AND NOT public.user_has_action_in_scope('roster.edit', p_org_id, p_dept_id, p_sub_dept_id)
        THEN
            RAISE EXCEPTION
                'sm_resolve_roster: not authorized to create a roster in this scope '
                '(organization %, department %, sub-department %)',
                p_org_id, p_dept_id, p_sub_dept_id
                USING ERRCODE = '42501';
        END IF;

        -- ── 3. Past-date block ───────────────────────────────────────────────
        IF p_date < v_today_sydney AND NOT p_allow_past THEN
            RAISE EXCEPTION
                'sm_resolve_roster: refusing to create a roster for % -- that date is '
                'already in the past in Australia/Sydney (today is %). Shifts cannot be '
                'created in the past.',
                p_date, v_today_sydney
                USING ERRCODE = '22007';
        END IF;

        -- ── 4. Race-safe create ──────────────────────────────────────────────
        -- Two managers clicking the same empty cell must not duplicate or
        -- deadlock. ON CONFLICT targets uk_rosters_date_dept_subdept, whose third
        -- column is the COALESCE expression -- restated exactly to match it.
        INSERT INTO public.rosters (
            organization_id, department_id, sub_department_id,
            start_date, end_date,
            status, is_locked, created_by
        )
        VALUES (
            p_org_id, p_dept_id, p_sub_dept_id,
            p_date, p_date,
            'draft', false, auth.uid()
        )
        ON CONFLICT (start_date, department_id, COALESCE(sub_department_id, '00000000-0000-0000-0000-000000000000'::uuid))
        DO NOTHING
        RETURNING id INTO v_roster_id;

        -- Lost the race: the conflicting row is another transaction's, already
        -- committed (ON CONFLICT waits for it), so this re-read always finds it.
        IF v_roster_id IS NULL THEN
            SELECT id INTO v_roster_id
              FROM public.rosters
             WHERE start_date = p_date
               AND department_id = p_dept_id
               AND sub_department_id IS NOT DISTINCT FROM p_sub_dept_id
             LIMIT 1;
        END IF;

        IF v_roster_id IS NULL THEN
            RAISE EXCEPTION 'sm_resolve_roster: failed to resolve or create a roster for % / dept %',
                p_date, p_dept_id
                USING ERRCODE = 'XX000';
        END IF;
    END IF;

    -- ── 5. Ensure the four fixed venue groups ────────────────────────────────
    -- Runs on BOTH paths, not just creation. `shifts.roster_subgroup_id` is NOT
    -- NULL, and sm_create_shift can only resolve a subgroup once it has a GROUP to
    -- hang it off -- so a roster with no group rows makes shift creation fail
    -- outright with a NOT NULL violation, not merely produce an odd row.
    -- `activate_roster_for_range` creates rosters with no groups at all, so
    -- group-less rosters are a shape this function must be able to repair, not
    -- just avoid producing. The NOT EXISTS makes it a no-op (one indexed probe)
    -- for the overwhelmingly common already-correct case.
    --
    -- Names, external_ids and sort_orders below match both the frontend constants
    -- (src/modules/rosters/domain/projections/constants.ts) and every one of the
    -- 163 rosters already in prod.
    INSERT INTO public.roster_groups (roster_id, name, external_id, sort_order)
    SELECT v_roster_id, g.name, g.external_id, g.sort_order
      FROM (VALUES
              ('Convention Centre', 'convention_centre', 0),
              ('Exhibition Centre', 'exhibition_centre', 1),
              ('Theatre',           'theatre',           2),
              ('The Cutaway',       'the_cutaway',       3)
           ) AS g(name, external_id, sort_order)
     WHERE NOT EXISTS (
         SELECT 1 FROM public.roster_groups rg
          WHERE rg.roster_id = v_roster_id
            AND (rg.external_id = g.external_id OR rg.name = g.name)
     );

    RETURN v_roster_id;
END;
$$;

ALTER FUNCTION public.sm_resolve_roster(uuid, uuid, uuid, date, boolean) OWNER TO postgres;

-- Supabase grants EXECUTE to BOTH `anon` and `authenticated` by default on a new
-- function, and revoking PUBLIC alone does not close the direct `authenticated`
-- grant (see 20260805002942_fairness_recompute_revoke_authenticated). State the
-- intended grants explicitly.
REVOKE ALL ON FUNCTION public.sm_resolve_roster(uuid, uuid, uuid, date, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sm_resolve_roster(uuid, uuid, uuid, date, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.sm_resolve_roster(uuid, uuid, uuid, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_resolve_roster(uuid, uuid, uuid, date, boolean) TO service_role;

COMMENT ON FUNCTION public.sm_resolve_roster(uuid, uuid, uuid, date, boolean) IS
    'Canonical find-or-create for the roster day container. Race-safe, NULL-safe on '
    'sub_department_id, enforces roster.edit RBAC on creation (SECURITY DEFINER '
    'bypasses rosters_insert_rbac), refuses to create for a date already past in '
    'Australia/Sydney, and guarantees the four fixed venue groups exist. Callers: '
    'sm_create_shift, apply_template_to_date_range_v2, sm_move_shift, and the '
    'demand-injection path.';
