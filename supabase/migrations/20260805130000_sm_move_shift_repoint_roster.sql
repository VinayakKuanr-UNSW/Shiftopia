-- Migration: 20260805130000_sm_move_shift_repoint_roster.sql
-- Description: `sm_move_shift` re-points `roster_id` when a drag moves a shift to a
--              different date.
--
-- THE BUG
-- -------
-- The live function updates shift_date and roster_date but leaves roster_id alone:
--
--     shift_date  = COALESCE(p_shift_date, shift_date),
--     roster_date = COALESCE(p_shift_date, roster_date),
--     -- roster_id untouched
--
-- `rosters` is a per-DAY container (one row per start_date/dept/sub_dept), so after
-- any cross-date drag the shift claims to be on day B while its roster_id still
-- points at day A's container. Everything that joins shifts to rosters -- roster
-- structure reads, publish-by-range, template clear, the planner stats RPC -- then
-- disagrees with the grid, which reads shift_date.
--
-- Zero rows are affected in prod right now only because `shifts` is empty
-- (deliberately, verified 2026-08-05). This is a live bug, not a theoretical one,
-- and implicit activation makes cross-date drags materially more common: the
-- target day no longer has to be activated first, so there is a lot more empty
-- calendar to drag onto.
--
-- SECOND BUG FIXED: NULL params were destructive, not "no change"
-- ---------------------------------------------------------------
-- The old body assigned two columns unconditionally:
--
--     shift_group_id     = p_shift_group_id,      -- not COALESCE
--     roster_subgroup_id = p_roster_subgroup_id,  -- not COALESCE
--
-- while every other column used COALESCE. So omitting them did not mean "leave
-- them alone", it meant "set them to NULL" -- and `roster_subgroup_id` is NOT
-- NULL, so any caller that omitted it got a 23502. That is exactly what the Group
-- Mode drop-into-Unassigned path does (GroupModeView.tsx passes `undefined` for
-- both when targetGroupType === 'unassigned'), right below a comment saying it
-- must NOT null them out because of the NOT NULL constraint. The intent was
-- already documented; the SQL just did not implement it. Now NULL means unchanged,
-- consistently across every parameter.
--
-- GROUP/SUBGROUP FOLLOW THE ROSTER
-- --------------------------------
-- roster_groups and roster_subgroups are per-ROSTER rows. Re-pointing roster_id
-- without re-pointing them would leave the shift attached to the previous day's
-- subgroup, which is the same class of inconsistency in a different column: the
-- structure RPCs (rename/delete/clone_roster_subgroup_v2) match on roster + name,
-- so the moved shift would still answer to the OLD day's subgroup operations. On a
-- cross-date move the group and subgroup are therefore re-resolved by NAME on the
-- destination roster, creating the subgroup if that day does not have it yet --
-- the same find-or-create sm_create_shift performs.
--
-- BEHAVIOUR
-- ---------
-- p_allow_past = false on the resolver call, so a drag onto a day that is already
-- past in Australia/Sydney and has no roster is refused rather than silently
-- creating a past container -- consistent with the "no shifts in the past" rule.
-- Dragging onto a past day that already HAS a roster still resolves, exactly as
-- before; the UI's own past-date guards are the front line there.
--
-- The org/dept/sub-dept for the resolver are read from the shift itself, so the
-- new container always lands in the same scope as the shift being moved -- a move
-- can never relocate a shift into a different department's roster.

CREATE OR REPLACE FUNCTION public.sm_move_shift(
    p_shift_id uuid,
    p_group_type text DEFAULT NULL::text,
    p_sub_group_name text DEFAULT NULL::text,
    p_shift_group_id uuid DEFAULT NULL::uuid,
    p_roster_subgroup_id uuid DEFAULT NULL::uuid,
    p_shift_date date DEFAULT NULL::date,
    p_user_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_found BOOLEAN;
    v_shift RECORD;
    v_roster_id uuid;
    v_group_id uuid;
    v_subgroup_id uuid;
    v_group_type text;
    v_sub_group_name text;
    v_is_cross_date boolean := false;
BEGIN
    SELECT id, organization_id, department_id, sub_department_id, shift_date,
           roster_id, shift_group_id, roster_subgroup_id,
           group_type::text AS group_type, sub_group_name
      INTO v_shift
      FROM shifts
     WHERE id = p_shift_id
       AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found or already deleted');
    END IF;

    -- NULL means "leave unchanged" for every parameter, uniformly.
    v_roster_id      := v_shift.roster_id;
    v_group_id       := COALESCE(p_shift_group_id, v_shift.shift_group_id);
    v_subgroup_id    := COALESCE(p_roster_subgroup_id, v_shift.roster_subgroup_id);
    v_group_type     := COALESCE(p_group_type, v_shift.group_type);
    v_sub_group_name := COALESCE(p_sub_group_name, v_shift.sub_group_name);

    v_is_cross_date := p_shift_date IS NOT NULL AND p_shift_date <> v_shift.shift_date;

    IF v_is_cross_date THEN
        -- The day container changes with the day.
        v_roster_id := public.sm_resolve_roster(
            v_shift.organization_id,
            v_shift.department_id,
            v_shift.sub_department_id,
            p_shift_date,
            false
        );
    END IF;

    -- Group/subgroup rows are per-ROSTER, but the ids arriving here frequently are
    -- not. GroupModeView builds one visual row per group/sub-group NAME across the
    -- whole visible date range (ensureGroup keeps the first id it sees), so the
    -- id it hands back on a drop belongs to whichever roster in the range happened
    -- to be encountered first -- routinely a different day than the drop target.
    -- Trusting it would write a shift onto another day's subgroup.
    --
    -- So do not trust the caller: keep the supplied ids only if they actually
    -- belong to this shift's roster, and otherwise re-resolve by NAME on that
    -- roster. This runs on same-date moves too, which is what makes the primitive
    -- self-correcting no matter which id the grid sends.
    IF v_group_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.roster_groups WHERE id = v_group_id AND roster_id = v_roster_id
    ) THEN
        v_group_id := NULL;
    END IF;

    IF v_group_id IS NULL AND v_group_type IS NOT NULL THEN
        -- sm_resolve_roster has already guaranteed the four venue groups exist on
        -- any roster it touched; this also covers legacy rosters it has not.
        SELECT id INTO v_group_id
          FROM public.roster_groups
         WHERE roster_id = v_roster_id
           AND (external_id = v_group_type
                OR LOWER(REPLACE(name, ' ', '_')) = LOWER(v_group_type))
         LIMIT 1;
    END IF;

    IF v_subgroup_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.roster_subgroups rsg
          JOIN public.roster_groups rg ON rg.id = rsg.roster_group_id
         WHERE rsg.id = v_subgroup_id AND rg.roster_id = v_roster_id
    ) THEN
        v_subgroup_id := NULL;
    END IF;

    IF v_subgroup_id IS NULL AND v_group_id IS NOT NULL AND v_sub_group_name IS NOT NULL THEN
        SELECT id INTO v_subgroup_id
          FROM public.roster_subgroups
         WHERE roster_group_id = v_group_id
           AND (LOWER(name) = LOWER(v_sub_group_name)
                OR LOWER(name) = LOWER(REPLACE(v_sub_group_name, '_', ' ')))
         LIMIT 1;

        IF v_subgroup_id IS NULL THEN
            INSERT INTO public.roster_subgroups (roster_group_id, name, sort_order)
            VALUES (v_group_id, v_sub_group_name, 999)
            RETURNING id INTO v_subgroup_id;
        END IF;
    END IF;

    -- roster_subgroup_id is NOT NULL; refuse with a readable message rather than
    -- bottoming out in a 23502 naming a column the UI never asked about.
    IF v_subgroup_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format(
                'Cannot place this shift on %s: no sub-group resolved (group_type %s, sub_group_name %s)',
                COALESCE(p_shift_date, v_shift.shift_date),
                COALESCE(v_group_type, '<null>'),
                COALESCE(v_sub_group_name, '<null>'))
        );
    END IF;

    UPDATE shifts SET
        -- Cast TEXT parameter to the ENUM type required by the table
        group_type         = CASE
                                WHEN v_group_type IS NULL THEN group_type
                                ELSE v_group_type::template_group_type
                             END,
        sub_group_name     = COALESCE(v_sub_group_name, sub_group_name),
        shift_group_id     = v_group_id,
        roster_subgroup_id = v_subgroup_id,
        shift_date         = COALESCE(p_shift_date, shift_date),
        roster_date        = COALESCE(p_shift_date, roster_date),
        roster_id          = v_roster_id,
        updated_at         = NOW(),
        last_modified_by   = p_user_id
    WHERE id = p_shift_id
      AND deleted_at IS NULL;

    v_found := FOUND;

    IF NOT v_found THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found or already deleted');
    END IF;

    RETURN jsonb_build_object('success', true, 'roster_id', v_roster_id);
END;
$function$;

ALTER FUNCTION public.sm_move_shift(uuid, text, text, uuid, uuid, date, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.sm_move_shift(uuid, text, text, uuid, uuid, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sm_move_shift(uuid, text, text, uuid, uuid, date, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.sm_move_shift(uuid, text, text, uuid, uuid, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_move_shift(uuid, text, text, uuid, uuid, date, uuid) TO service_role;
