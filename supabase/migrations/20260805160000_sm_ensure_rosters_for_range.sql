-- Migration: 20260805160000_sm_ensure_rosters_for_range.sql
-- Description: Create the day containers for a date range without seeding any
--              shifts. Backs the "No template — create empty days" case of the
--              merged Schedule-from-Template flow.
--
-- WHY THIS EXISTS
-- ---------------
-- `apply_template_to_date_range_v2` already creates the rosters it needs, so the
-- with-a-template path is covered. The no-template path was previously served by
-- `create_planning_period`, which is being retired from the UI: it created a
-- `planning_periods` row that no screen in the application ever read (verified
-- 2026-08-05 — the only consumer was the dialog that wrote it, checking for its
-- own duplicates). See the Apply Template / Bulk Seeding section of
-- docs/investigations/2026-08-05_roster-page-ux-accessibility-audit.md.
--
-- Doing this client-side would mean one round trip per day — 31 for a month — so
-- it loops server-side instead. All the actual rules live in sm_resolve_roster:
-- `roster.edit` RBAC, the Australia/Sydney past-date refusal, race-safe upsert,
-- and the four venue groups.
--
-- PAST DATES ARE SKIPPED, NOT REFUSED
-- -----------------------------------
-- A user picking "This Month" on the 20th means "the rest of this month", not
-- "fail because the 1st has passed". So past days are skipped and counted rather
-- than aborting the range — the same shape `add_roster_subgroup_range` uses. The
-- returned `days_skipped` lets the UI say so out loud instead of silently doing
-- less than the user asked for.
--
-- MULTI SUB-DEPARTMENT
-- --------------------
-- Takes an ARRAY of sub-department ids. When the planner has no sub-department
-- selected, the merged dialog passes every sub-department in scope, which is what
-- `create_planning_period` did. A NULL entry is meaningful and supported (a
-- department-level roster), so the array may contain NULLs.

CREATE OR REPLACE FUNCTION public.sm_ensure_rosters_for_range(
    p_org_id       uuid,
    p_dept_id      uuid,
    p_sub_dept_ids uuid[],
    p_start_date   date,
    p_end_date     date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_curr_date    date;
    v_sub_id       uuid;
    v_roster_id    uuid;
    v_created      integer := 0;
    v_existing     integer := 0;
    v_skipped_past integer := 0;
    v_today_sydney date := (now() AT TIME ZONE 'Australia/Sydney')::date;
    v_pre_existed  boolean;
BEGIN
    IF p_end_date < p_start_date THEN
        RAISE EXCEPTION 'sm_ensure_rosters_for_range: end_date must be >= start_date'
            USING ERRCODE = '22007';
    END IF;

    IF p_sub_dept_ids IS NULL OR array_length(p_sub_dept_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'sm_ensure_rosters_for_range: at least one sub-department (or NULL) is required'
            USING ERRCODE = '22004';
    END IF;

    FOREACH v_sub_id IN ARRAY p_sub_dept_ids LOOP
        v_curr_date := p_start_date;
        WHILE v_curr_date <= p_end_date LOOP

            IF v_curr_date < v_today_sydney THEN
                v_skipped_past := v_skipped_past + 1;
                v_curr_date := v_curr_date + 1;
                CONTINUE;
            END IF;

            -- Counted before the call so the summary can distinguish "created 12"
            -- from "12 were already there" — the difference the calendar preview
            -- shows the user, so the toast must agree with it.
            SELECT EXISTS (
                SELECT 1 FROM public.rosters
                 WHERE start_date = v_curr_date
                   AND department_id = p_dept_id
                   AND sub_department_id IS NOT DISTINCT FROM v_sub_id
            ) INTO v_pre_existed;

            v_roster_id := public.sm_resolve_roster(
                p_org_id, p_dept_id, v_sub_id, v_curr_date, false
            );

            IF v_pre_existed THEN
                v_existing := v_existing + 1;
            ELSE
                v_created := v_created + 1;
            END IF;

            v_curr_date := v_curr_date + 1;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'success',       true,
        'days_created',  v_created,
        'days_existing', v_existing,
        'days_skipped',  v_skipped_past
    );
END;
$$;

ALTER FUNCTION public.sm_ensure_rosters_for_range(uuid, uuid, uuid[], date, date) OWNER TO postgres;

-- Supabase grants EXECUTE to BOTH `anon` and `authenticated` by default on a new
-- function, and revoking PUBLIC alone does not close the direct `authenticated`
-- grant. State the intended grants explicitly.
REVOKE ALL ON FUNCTION public.sm_ensure_rosters_for_range(uuid, uuid, uuid[], date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sm_ensure_rosters_for_range(uuid, uuid, uuid[], date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.sm_ensure_rosters_for_range(uuid, uuid, uuid[], date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_ensure_rosters_for_range(uuid, uuid, uuid[], date, date) TO service_role;

COMMENT ON FUNCTION public.sm_ensure_rosters_for_range(uuid, uuid, uuid[], date, date) IS
    'Creates empty roster day containers across a range for one or more '
    'sub-departments, delegating every rule to sm_resolve_roster. Backs the '
    '"no template" case of the merged Schedule-from-Template dialog, replacing '
    'create_planning_period, whose planning_periods row no screen ever read.';
