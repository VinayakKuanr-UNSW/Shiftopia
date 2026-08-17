-- Migration: 20260805150000_add_roster_subgroup_range_use_resolver.sql
-- Description: `add_roster_subgroup_range` (7-arg) delegates roster find-or-create to
--              `sm_resolve_roster`, and its past-date skip moves off UTC.
--
-- WHY THIS ONE IS STILL HERE
-- --------------------------
-- It is the FOURTH implementation of find-or-create-this-roster, and the last one
-- with a live caller (useRosterMutations.ts:86, via CentralAddSubGroupDialog). It
-- matters more now than it did: with activation implicit, "Add Sub-Group" is a
-- normal way to touch a cold day, so this path creates rosters routinely rather
-- than occasionally.
--
-- THREE DEFECTS IT CARRIED
-- ------------------------
-- 1. UTC past-date skip. `IF v_current_date < CURRENT_DATE` -- the database runs in
--    UTC while the business timezone is Australia/Sydney, so between midnight and
--    10/11am Sydney time CURRENT_DATE is still YESTERDAY. In that window the guard
--    let the function create a roster for a day already past locally, against the
--    rule that nothing is created in the past. Now cut over to
--    (now() AT TIME ZONE 'Australia/Sydney')::date, the same clock
--    sm_resolve_roster uses.
--
-- 2. No authorization. SECURITY DEFINER with no check at all, so it bypassed
--    rosters_insert_rbac exactly as the other roster-creating functions did.
--    sm_resolve_roster applies `roster.edit` on the creation path.
--
-- 3. Partial group seeding. It created only the ONE group it was asked for, so a
--    roster born here had a single group until something else filled the rest in.
--    sm_resolve_roster guarantees all four.
--
-- The skip stays a skip, not a raise: this function is called over a RANGE, and a
-- range that merely starts in the past should add the subgroup to its future days
-- rather than failing wholesale. sm_resolve_roster is therefore only ever reached
-- with a present-or-future date, and p_allow_past stays false as a backstop.
--
-- The 5-arg overload is deliberately untouched. It has no callers in the client, no
-- callers in SQL, and it still raises 'Roster not activated for date: %' -- a
-- message from the model this work replaces. Left in place rather than dropped so
-- this migration stays reversible; it should be removed once confirmed dead.

CREATE OR REPLACE FUNCTION public.add_roster_subgroup_range(
    p_org_id uuid,
    p_dept_id uuid,
    p_sub_dept_id uuid,
    p_group_external_id text,
    p_name text,
    p_start_date date,
    p_end_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_current_date DATE;
    v_roster_id UUID;
    v_roster_group_id UUID;
    v_group_name TEXT;
    v_sort_order INT;
    v_today_sydney DATE := (now() AT TIME ZONE 'Australia/Sydney')::date;
BEGIN
    -- Determine group name and sort order based on external_id
    CASE p_group_external_id
        WHEN 'convention_centre' THEN
            v_group_name := 'Convention Centre';
            v_sort_order := 0;
        WHEN 'exhibition_centre' THEN
            v_group_name := 'Exhibition Centre';
            v_sort_order := 1;
        WHEN 'theatre' THEN
            v_group_name := 'Theatre';
            v_sort_order := 2;
        WHEN 'the_cutaway' THEN
            v_group_name := 'The Cutaway';
            v_sort_order := 3;
        ELSE
            RAISE EXCEPTION 'Invalid group external_id: %', p_group_external_id;
    END CASE;

    -- Iterate through dates
    v_current_date := p_start_date;
    WHILE v_current_date <= p_end_date LOOP

        -- STRICT LOCK: skip days already past in Australia/Sydney. Skipping rather
        -- than raising keeps a range that merely starts in the past usable.
        IF v_current_date < v_today_sydney THEN
            v_current_date := v_current_date + 1;
            CONTINUE;
        END IF;

        -- 1. Roster for this day (find-or-create). Owns the RBAC check and
        --    guarantees the four venue groups exist.
        v_roster_id := public.sm_resolve_roster(
            p_org_id, p_dept_id, p_sub_dept_id, v_current_date, false
        );

        -- 2. Locate the group. sm_resolve_roster has already created it; the
        --    INSERT branch remains only for a roster carrying a non-standard label.
        SELECT id INTO v_roster_group_id
        FROM public.roster_groups
        WHERE roster_id = v_roster_id AND (external_id = p_group_external_id OR name = v_group_name);

        IF v_roster_group_id IS NULL THEN
            INSERT INTO public.roster_groups (
                roster_id,
                name,
                external_id,
                sort_order
            ) VALUES (
                v_roster_id,
                v_group_name,
                p_group_external_id,
                v_sort_order
            )
            RETURNING id INTO v_roster_group_id;
        END IF;

        -- 3. Ensure Subgroup Exists (Idempotent)
        IF NOT EXISTS (
            SELECT 1 FROM public.roster_subgroups
            WHERE roster_group_id = v_roster_group_id AND name = p_name
        ) THEN
            INSERT INTO public.roster_subgroups (
                roster_group_id,
                name,
                sort_order
            ) VALUES (
                v_roster_group_id,
                p_name,
                999 -- Default sort order for ad-hoc subgroups
            );
        END IF;

        v_current_date := v_current_date + 1;
    END LOOP;
END;
$function$;

ALTER FUNCTION public.add_roster_subgroup_range(uuid, uuid, uuid, text, text, date, date) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.add_roster_subgroup_range(uuid, uuid, uuid, text, text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_roster_subgroup_range(uuid, uuid, uuid, text, text, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_roster_subgroup_range(uuid, uuid, uuid, text, text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_roster_subgroup_range(uuid, uuid, uuid, text, text, date, date) TO service_role;
