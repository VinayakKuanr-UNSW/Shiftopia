-- Migration: 20260805110000_sm_create_shift_lazy_roster.sql
-- Description: `sm_create_shift` resolves (and if needed creates) the roster when
--              the caller sends no roster_id, instead of raising. Also resolves a
--              missing shift_group_id from the roster's venue groups.
--
-- THE BLOCKER THIS REMOVES
-- -----------------------
-- Today the function opens with:
--     IF v_roster_id IS NULL THEN RAISE EXCEPTION 'Roster ID is required'; END IF;
-- That is the SERVER half of the "activate the roster first" workflow -- deleting
-- the frontend `hasRoster` gate alone would just move the failure somewhere worse.
--
-- BASE BODY
-- ---------
-- Rebased onto 20260805060000_sm_create_shift_target_employment_type_passthrough,
-- which is written but NOT YET APPLIED to prod (verified 2026-08-05: the live
-- definition contains no `target_employment_type`). Two CREATE OR REPLACEs of the
-- same function in flight is exactly how the approve_trade gateway bug happened,
-- so this migration is sequenced AFTER it and carries its body forward verbatim.
-- The ONLY deltas versus 20260805060000 are the two resolution blocks below.
--
-- GROUP RESOLUTION -- load-bearing, not defensive
-- ---------------------------------------------
-- The existing code auto-creates a missing subgroup, but only when shift_group_id
-- is already non-null. On a day that was never activated the grid has no group ids
-- to send: GroupModeView seeds the four standard groups with id=null, so the modal
-- posts shift_group_id = NULL.
--
-- `shifts.roster_subgroup_id` is NOT NULL (verified in prod). So without the new
-- lookup the insert does not merely produce an odd row -- it fails outright with a
-- 23502 on roster_subgroup_id. The chain that has to hold is:
--
--     group_type (always set: step-1 validity requires group + sub-group)
--       -> roster_groups row on the resolved roster   <- NEW, this migration
--         -> roster_subgroups row (found or created)  <- pre-existing
--           -> roster_subgroup_id                     <- satisfies NOT NULL
--
-- sm_resolve_roster guarantees the four venue groups exist on both its create and
-- its resolve path, which is what makes the middle link reliable.

CREATE OR REPLACE FUNCTION public.sm_create_shift(p_shift_data jsonb, p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    v_shift_id uuid;
    v_roster_id uuid;
    v_roster_subgroup_id uuid;
    v_shift_group_id uuid;
    v_sub_group_name text;
    v_creation_source text;
    v_assignment_source text;
    v_group_type text;
    v_shift_date date;
BEGIN
    v_roster_id          := (p_shift_data->>'roster_id')::uuid;
    v_roster_subgroup_id := (p_shift_data->>'roster_subgroup_id')::uuid;
    v_shift_group_id     := (p_shift_data->>'shift_group_id')::uuid;
    v_sub_group_name     := p_shift_data->>'sub_group_name';
    v_group_type         := p_shift_data->>'group_type';
    v_shift_date         := (p_shift_data->>'shift_date')::date;

    v_creation_source := COALESCE(
        p_shift_data->>'creation_source',
        CASE WHEN COALESCE((p_shift_data->>'is_from_template')::boolean, false) THEN 'template' ELSE 'manual' END
    );

    v_assignment_source := CASE
        WHEN (p_shift_data->>'assigned_employee_id') IS NOT NULL
        THEN COALESCE(p_shift_data->>'assignment_source', 'direct')
        ELSE NULL
    END;

    -- IMPLICIT ACTIVATION: no roster_id means "the day this shift is on", not an
    -- error. sm_resolve_roster owns the RBAC guard and the past-date block, so a
    -- caller cannot use this path to reach a scope or a date it could not reach
    -- through the explicit one. p_allow_past stays false: shifts are never created
    -- in the past. When roster_id IS supplied this branch never runs and behaviour
    -- is byte-identical to 20260805060000.
    IF v_roster_id IS NULL THEN
        IF v_shift_date IS NULL THEN
            RAISE EXCEPTION 'sm_create_shift: shift_date is required when roster_id is not supplied'
                USING ERRCODE = '22004';
        END IF;

        v_roster_id := public.sm_resolve_roster(
            (p_shift_data->>'organization_id')::uuid,
            (p_shift_data->>'department_id')::uuid,
            (p_shift_data->>'sub_department_id')::uuid,
            v_shift_date,
            false
        );
    END IF;

    -- Fill in the venue group from the roster when the caller only knew the
    -- group_type (the un-activated-day case described in the header).
    IF v_shift_group_id IS NULL AND v_group_type IS NOT NULL THEN
        SELECT id INTO v_shift_group_id
          FROM public.roster_groups
         WHERE roster_id = v_roster_id
           AND (external_id = v_group_type
                OR LOWER(REPLACE(name, ' ', '_')) = LOWER(v_group_type))
         LIMIT 1;
    END IF;

    IF v_roster_subgroup_id IS NULL AND v_shift_group_id IS NOT NULL AND v_sub_group_name IS NOT NULL THEN
        SELECT id INTO v_roster_subgroup_id
        FROM roster_subgroups
        WHERE roster_group_id = v_shift_group_id
          AND (LOWER(name) = LOWER(v_sub_group_name)
               OR LOWER(name) = LOWER(REPLACE(v_sub_group_name, '_', ' ')))
        LIMIT 1;

        -- Auto-create subgroup if missing from this roster group!
        IF v_roster_subgroup_id IS NULL THEN
            INSERT INTO public.roster_subgroups (
                roster_group_id,
                name,
                sort_order
            ) VALUES (
                v_shift_group_id,
                v_sub_group_name,
                999
            )
            RETURNING id INTO v_roster_subgroup_id;
        END IF;
    END IF;

    -- roster_subgroup_id is NOT NULL on `shifts`. Fail with something a caller can
    -- act on rather than letting the insert bottom out in a raw 23502 naming a
    -- column the UI never asked about.
    IF v_roster_subgroup_id IS NULL THEN
        RAISE EXCEPTION
            'sm_create_shift: could not place this shift -- no sub-group resolved '
            '(group_type %, sub_group_name %, roster %). A shift must land in a '
            'sub-group.',
            COALESCE(v_group_type, '<null>'),
            COALESCE(v_sub_group_name, '<null>'),
            v_roster_id
            USING ERRCODE = '23502';
    END IF;

    -- AUDIT DE-DUP: while the guard is set, fn_capture_shift_event short-circuits,
    -- so the INSERT-branch ASSIGNED is NOT written. The shift's origin (and any
    -- pre-assignment) is recorded by the SINGLE `create` event below instead.
    -- Transaction-local (is_local=true): auto-resets at txn end, never leaks.
    PERFORM set_config('app.audit.via_gateway', '1', true);

    INSERT INTO shifts (
        roster_id, department_id, shift_date, roster_date, start_time, end_time,
        organization_id, sub_department_id, group_type, sub_group_name, display_order,
        shift_group_id, roster_subgroup_id, role_id, remuneration_level,
        paid_break_minutes, unpaid_break_minutes, break_minutes, timezone,
        assigned_employee_id, required_skills, required_licenses, event_ids, tags, notes,
        template_id, template_group, template_sub_group, is_from_template, template_instance_id,
        lifecycle_status, created_by_user_id, creation_source, assignment_source,
        target_employment_type, target_requires_flexible,
        created_at, updated_at
    ) VALUES (
        v_roster_id,
        (p_shift_data->>'department_id')::uuid,
        v_shift_date,
        (p_shift_data->>'roster_date')::date,
        (p_shift_data->>'start_time')::time,
        (p_shift_data->>'end_time')::time,
        (p_shift_data->>'organization_id')::uuid,
        (p_shift_data->>'sub_department_id')::uuid,
        (p_shift_data->>'group_type')::template_group_type,
        (p_shift_data->>'sub_group_name'),
        COALESCE((p_shift_data->>'display_order')::integer, 0),
        v_shift_group_id,
        v_roster_subgroup_id,
        (p_shift_data->>'role_id')::uuid,
        (p_shift_data->>'remuneration_level')::smallint,
        COALESCE((p_shift_data->>'paid_break_minutes')::integer, 0),
        COALESCE((p_shift_data->>'unpaid_break_minutes')::integer, 0),
        COALESCE((p_shift_data->>'break_minutes')::integer, 0),
        COALESCE(p_shift_data->>'timezone', 'Australia/Sydney'),
        (p_shift_data->>'assigned_employee_id')::uuid,
        COALESCE(p_shift_data->'required_skills', '[]'::jsonb),
        COALESCE(p_shift_data->'required_licenses', '[]'::jsonb),
        COALESCE(p_shift_data->'event_ids', '[]'::jsonb),
        COALESCE(p_shift_data->'tags', '[]'::jsonb),
        p_shift_data->>'notes',
        (p_shift_data->>'template_id')::uuid,
        (p_shift_data->>'template_group')::template_group_type,
        p_shift_data->>'template_sub_group',
        COALESCE((p_shift_data->>'is_from_template')::boolean, false),
        (p_shift_data->>'template_instance_id')::uuid,
        'Draft'::shift_lifecycle,
        p_user_id,
        v_creation_source,
        v_assignment_source,
        -- NULLIF so an explicit '' (or an absent key) lands as NULL = "Any type",
        -- rather than tripping shifts_target_employment_type_check.
        NULLIF(p_shift_data->>'target_employment_type', ''),
        COALESCE((p_shift_data->>'target_requires_flexible')::boolean, false),
        NOW(), NOW()
    )
    RETURNING id INTO v_shift_id;

    PERFORM set_config('app.audit.via_gateway', '0', true);

    -- AUDIT: record the shift's origin so the timeline has a CREATED anchor.
    INSERT INTO public.shift_events (
        shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain
    ) VALUES (
        v_shift_id,
        (p_shift_data->>'assigned_employee_id')::uuid,
        p_user_id,
        'OP_APPLIED'::public.shift_event_type,
        jsonb_build_object(
            'op', 'create',
            'domain', 'lifecycle',
            'from_state', NULL,
            'to_state', CASE WHEN (p_shift_data->>'assigned_employee_id') IS NOT NULL THEN 'S2' ELSE 'S1' END,
            'source', 'sm_create_shift',
            'creation_source', v_creation_source,
            'assigned_employee_id', (p_shift_data->>'assigned_employee_id')::uuid,
            'assignment_source', v_assignment_source
        ),
        CASE WHEN p_user_id IS NULL THEN 'system' ELSE 'manager' END,
        'lifecycle'
    );

    RETURN v_shift_id;
END;
$$;

ALTER FUNCTION public.sm_create_shift(jsonb, uuid) OWNER TO postgres;

-- Supabase re-grants EXECUTE to BOTH `anon` and `authenticated` by default on a
-- replaced function, and revoking PUBLIC alone does not close the `authenticated`
-- grant (see 20260805002942_fairness_recompute_revoke_authenticated). Restate the
-- baseline grants explicitly so the replace does not widen exposure.
REVOKE ALL ON FUNCTION public.sm_create_shift(jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sm_create_shift(jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.sm_create_shift(jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_create_shift(jsonb, uuid) TO service_role;
