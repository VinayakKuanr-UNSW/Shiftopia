-- Migration: 20260806120200_sm_create_shift_persists_target_and_training.sql
-- Description: Supersedes the unapplied 20260805060000. Same fix (persist
--              target_employment_type / target_requires_flexible) PLUS is_training,
--              which the same explicit-column-list whitelist was also swallowing.
--
-- PROVEN AGAINST PROD 2026-08-06 by calling the live RPC with the exact payload
-- shifts.commands.ts sends, inside a rolled-back transaction:
--     sent target_employment_type='Casual'  -> stored NULL
--     sent is_training=true                 -> stored false
--
--              `target_requires_flexible`.
--
-- THE BUG THIS CLOSES
-- -------------------
-- `shifts.target_employment_type` has existed since the baseline, and
-- `CreateShiftData` has typed it since then too -- but `sm_create_shift` builds an
-- EXPLICIT `INSERT INTO shifts (...)` column list that never included it. Any
-- caller setting the field had it silently discarded at the DB boundary with no
-- error: the insert succeeded, the column stayed NULL. (Verified against prod on
-- 2026-08-05: 0 of 892 shifts had a non-NULL target_employment_type.)
--
-- This is the same silent-drop shape as the `approve_trade` gateway bug
-- (20260731082548): a whitelist that quietly swallows an unlisted key.
--
-- Body below is prod's live definition (verified byte-identical to the baseline
-- at 20251015000000_baseline_schema.sql:13296) with ONLY the two target columns
-- added to the INSERT column list and VALUES. Nothing else is altered.

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
BEGIN
    v_roster_id          := (p_shift_data->>'roster_id')::uuid;
    v_roster_subgroup_id := (p_shift_data->>'roster_subgroup_id')::uuid;
    v_shift_group_id     := (p_shift_data->>'shift_group_id')::uuid;
    v_sub_group_name     := p_shift_data->>'sub_group_name';

    v_creation_source := COALESCE(
        p_shift_data->>'creation_source',
        CASE WHEN COALESCE((p_shift_data->>'is_from_template')::boolean, false) THEN 'template' ELSE 'manual' END
    );

    v_assignment_source := CASE
        WHEN (p_shift_data->>'assigned_employee_id') IS NOT NULL
        THEN COALESCE(p_shift_data->>'assignment_source', 'direct')
        ELSE NULL
    END;

    IF v_roster_id IS NULL THEN
        RAISE EXCEPTION 'Roster ID is required';
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
        target_employment_type, target_requires_flexible, is_training,
        created_at, updated_at
    ) VALUES (
        v_roster_id,
        (p_shift_data->>'department_id')::uuid,
        (p_shift_data->>'shift_date')::date,
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
        COALESCE((p_shift_data->>'is_training')::boolean, false),
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
