-- Migration: 20260805120000_apply_template_use_roster_resolver.sql
-- Description: `apply_template_to_date_range_v2` delegates its inline find-or-create
--              to `sm_resolve_roster`. Fixes a NULL-safety bug and closes an
--              authorization bypass.
--
-- BUG FIXED (correctness)
-- -----------------------
-- The inline lookup this replaces reads:
--
--     SELECT id INTO v_roster_id FROM rosters
--      WHERE start_date = v_curr_date
--        AND department_id = v_dept_id
--        AND sub_department_id = v_sub_dept_id      -- <-- NULL-unsafe
--
-- When the target sub-department is NULL, `sub_department_id = NULL` is never
-- true, so the SELECT misses, the INSERT below it fires, and it collides with
-- uk_rosters_date_dept_subdept (whose third column is
-- COALESCE(sub_department_id, '000...')) -> 23505, aborting the entire apply and
-- rolling back every shift created so far in the range.
--
-- Latent rather than live today: all 163 prod rosters have a non-null
-- sub_department_id (verified 2026-08-05). Removing the frontend activation gate
-- makes cold, never-activated scopes reachable, so this is fixed rather than
-- inherited. sm_resolve_roster uses IS NOT DISTINCT FROM plus ON CONFLICT.
--
-- BUG FIXED (authorization)
-- -------------------------
-- This function is SECURITY DEFINER and had no authorization check whatsoever,
-- so it bypassed the rosters_insert_rbac policy entirely -- any authenticated
-- user could create rosters in any organization. sm_resolve_roster restores the
-- `roster.edit` check on the creation path.
--
-- DELIBERATELY NOT CHANGED
-- ------------------------
-- p_allow_past is passed as TRUE. That is not an oversight and not a relaxation:
-- this function has ALWAYS created roster containers for past dates, and it has
-- its own finer-grained control for the thing that actually matters -- the
-- per-shift `v_shift_start_timestamp <= now()` soft-skip below, which is
-- timestamp-precise where a date-level block would be a day-level approximation
-- (a shift starting later TODAY has not started yet). Making the roster container
-- refuse past dates here would abort whole ranges that today merely skip a few
-- shifts, which is a behaviour change well outside this migration's purpose.
--
-- The "no shifts in the past" rule is enforced where it belongs: the per-shift
-- guard here, and the p_force_stack default at the call site (see the frontend
-- change in useRosterMutations.ts shipped alongside this migration).
--
-- Body below is prod's live definition, verified byte-identical to
-- 20260707120000_audit_create_event_for_template_and_clone_shifts.sql. The ONLY
-- delta is the roster find-or-create block in step 4.

CREATE OR REPLACE FUNCTION public.apply_template_to_date_range_v2(
    p_template_id uuid, p_start_date date, p_end_date date, p_user_id uuid,
    p_source text DEFAULT 'roster_modal'::text,
    p_target_department_id uuid DEFAULT NULL::uuid,
    p_target_sub_department_id uuid DEFAULT NULL::uuid,
    p_force_stack boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_template record;
    v_curr_date date;
    v_roster_id uuid;
    v_batch_id uuid;
    v_total_shifts integer := 0;
    v_shifts_skipped integer := 0;
    v_tg record;   -- Template Group
    v_tsg record;  -- Template Subgroup
    v_ts record;   -- Template Shift
    v_rg_id uuid;  -- Roster Group ID
    v_rsg_id uuid; -- Roster Subgroup ID
    v_external_id text;
    v_shift_start_timestamp timestamptz;
    v_shift_end_timestamp timestamptz;
    v_dept_id uuid;
    v_sub_dept_id uuid;
    v_dow integer;
    v_new_shift_id uuid;  -- AUDIT: capture inserted shift id
BEGIN
    -- 1. Fetch Template
    SELECT * INTO v_template FROM roster_templates WHERE id = p_template_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template not found');
    END IF;

    -- Set effective IDs
    v_dept_id := COALESCE(p_target_department_id, v_template.department_id);
    v_sub_dept_id := COALESCE(p_target_sub_department_id, v_template.sub_department_id);

    -- 2. Create Template Batch record
    INSERT INTO roster_template_batches (
        template_id, applied_at, applied_by, start_date, end_date, source
    )
    VALUES (
        p_template_id, now(), p_user_id, p_start_date, p_end_date, p_source
    )
    RETURNING id INTO v_batch_id;

    -- AUDIT DE-DUP: suppress trigger INSERT-branch while we write our own create events.
    PERFORM set_config('app.audit.via_gateway', '1', true);

    -- 3. Loop through date range
    FOR v_curr_date IN (SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date) LOOP

        v_dow := (EXTRACT(DOW FROM v_curr_date))::integer;

        -- 4. Find or Create Roster for this date
        -- Delegated to sm_resolve_roster: NULL-safe on sub_department_id, race-safe,
        -- and it applies the roster.edit RBAC check this SECURITY DEFINER function
        -- would otherwise bypass. p_allow_past = true preserves the long-standing
        -- behaviour of creating containers across the whole requested range; past
        -- SHIFTS are still soft-skipped by the temporal guard further down.
        v_roster_id := public.sm_resolve_roster(
            v_template.organization_id,
            v_dept_id,
            v_sub_dept_id,
            v_curr_date,
            true
        );

        -- Ensure groups exist for this roster (idempotent)
        FOR v_tg IN (SELECT * FROM template_groups WHERE template_id = p_template_id) LOOP
            v_external_id := CASE LOWER(REPLACE(v_tg.name, ' ', '_'))
                WHEN 'convention_centre' THEN 'convention_centre'
                WHEN 'exhibition_centre' THEN 'exhibition_centre'
                WHEN 'theatre' THEN 'theatre'
                WHEN 'the_cutaway' THEN 'the_cutaway'
                ELSE NULL
            END;

            -- No silent fallback: an unmappable group name aborts the whole
            -- apply (atomic rollback) instead of creating "Unassigned" shifts.
            IF v_external_id IS NULL THEN
                RAISE EXCEPTION 'apply_template: unknown template group "%" — cannot map to a roster group type', v_tg.name;
            END IF;

            -- Try to find group first
            SELECT id INTO v_rg_id FROM roster_groups WHERE roster_id = v_roster_id AND (external_id = v_external_id OR name = v_tg.name) LIMIT 1;

            IF v_rg_id IS NULL THEN
                INSERT INTO roster_groups (roster_id, name, external_id, sort_order)
                VALUES (v_roster_id, v_tg.name, v_external_id, v_tg.sort_order)
                RETURNING id INTO v_rg_id;
            END IF;

            FOR v_tsg IN (SELECT * FROM template_subgroups WHERE group_id = v_tg.id) LOOP
                -- Ensure subgroup exists
                SELECT id INTO v_rsg_id
                FROM roster_subgroups
                WHERE roster_group_id = v_rg_id AND name = v_tsg.name;

                IF v_rsg_id IS NULL THEN
                    INSERT INTO roster_subgroups (roster_group_id, name, sort_order)
                    VALUES (v_rg_id, v_tsg.name, v_tsg.sort_order)
                    RETURNING id INTO v_rsg_id;
                END IF;

                FOR v_ts IN (SELECT * FROM template_shifts WHERE subgroup_id = v_tsg.id) LOOP
                    -- Apply day_of_week filtering
                    IF v_ts.day_of_week IS NULL OR v_ts.day_of_week = v_dow THEN

                        -- Duplicate check
                        IF NOT EXISTS (
                            SELECT 1 FROM shifts
                            WHERE roster_id = v_roster_id
                              AND template_instance_id = v_ts.id
                              AND deleted_at IS NULL
                        ) THEN
                            v_shift_start_timestamp := (v_curr_date || ' ' || v_ts.start_time)::timestamp AT TIME ZONE 'Australia/Sydney';
                            v_shift_end_timestamp := (v_curr_date || ' ' || v_ts.end_time)::timestamp AT TIME ZONE 'Australia/Sydney';

                            IF v_ts.end_time < v_ts.start_time THEN
                                v_shift_end_timestamp := v_shift_end_timestamp + interval '1 day';
                            END IF;

                            -- Temporal Validation: SOFT SKIP past shifts
                            IF NOT p_force_stack AND v_shift_start_timestamp <= now() THEN
                                v_shifts_skipped := v_shifts_skipped + 1;
                                CONTINUE;
                            END IF;

                            INSERT INTO shifts (
                                roster_id, organization_id, department_id, sub_department_id,
                                role_id, shift_date, start_time, end_time,
                                start_at, end_at, tz_identifier,
                                paid_break_minutes, unpaid_break_minutes,
                                template_id, template_instance_id, is_from_template,
                                template_batch_id,
                                roster_subgroup_id,
                                group_type,
                                sub_group_name,
                                template_group,
                                template_sub_group,
                                lifecycle_status, notes, assigned_employee_id,
                                created_by_user_id,
                                required_skills,
                                required_licenses,
                                event_tags,
                                event_ids
                            )
                            VALUES (
                                v_roster_id, v_template.organization_id, v_dept_id, v_sub_dept_id,
                                v_ts.role_id, v_curr_date, v_ts.start_time, v_ts.end_time,
                                v_shift_start_timestamp, v_shift_end_timestamp, 'Australia/Sydney',
                                COALESCE(v_ts.paid_break_minutes, 0), COALESCE(v_ts.unpaid_break_minutes, 0),
                                p_template_id, v_ts.id, true,
                                v_batch_id,
                                v_rsg_id,
                                v_external_id::template_group_type,
                                v_tsg.name,
                                v_external_id::template_group_type,
                                v_tsg.name,
                                'Draft', v_ts.notes, v_ts.assigned_employee_id,
                                p_user_id,
                                to_jsonb(v_ts.required_skills),
                                to_jsonb(v_ts.required_licenses),
                                to_jsonb(v_ts.event_tags),
                                '[]'::jsonb
                            )
                            RETURNING id INTO v_new_shift_id;

                            -- AUDIT: record the shift's origin (CREATED anchor)
                            INSERT INTO public.shift_events (
                                shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain
                            ) VALUES (
                                v_new_shift_id,
                                v_ts.assigned_employee_id,
                                p_user_id,
                                'OP_APPLIED'::public.shift_event_type,
                                jsonb_build_object(
                                    'op', 'create',
                                    'domain', 'lifecycle',
                                    'from_state', NULL,
                                    'to_state', CASE WHEN v_ts.assigned_employee_id IS NOT NULL THEN 'S2' ELSE 'S1' END,
                                    'source', 'apply_template_to_date_range_v2',
                                    'creation_source', 'template',
                                    'assigned_employee_id', v_ts.assigned_employee_id
                                ),
                                CASE WHEN p_user_id IS NULL THEN 'system' ELSE 'manager' END,
                                'lifecycle'
                            );

                            v_total_shifts := v_total_shifts + 1;
                        END IF;
                    END IF;
                END LOOP;
            END LOOP;
        END LOOP;
    END LOOP;

    -- Reset the gateway guard
    PERFORM set_config('app.audit.via_gateway', '0', true);

    -- Update Template Status
    UPDATE roster_templates
    SET
        status = 'published',
        updated_at = NOW(),
        last_used_at = NOW(),
        is_active = true
    WHERE id = p_template_id;

    RETURN jsonb_build_object(
        'success', true,
        'shifts_created', v_total_shifts,
        'shifts_skipped', v_shifts_skipped,
        'batch_id', v_batch_id,
        'roster_id', v_roster_id
    );
END;
$function$;

ALTER FUNCTION public.apply_template_to_date_range_v2(uuid, date, date, uuid, text, uuid, uuid, boolean) OWNER TO postgres;

-- Restate grants explicitly: a CREATE OR REPLACE re-grants EXECUTE to both `anon`
-- and `authenticated` by default, and revoking PUBLIC alone does not close the
-- direct `authenticated` grant.
REVOKE ALL ON FUNCTION public.apply_template_to_date_range_v2(uuid, date, date, uuid, text, uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_template_to_date_range_v2(uuid, date, date, uuid, text, uuid, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_template_to_date_range_v2(uuid, date, date, uuid, text, uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_template_to_date_range_v2(uuid, date, date, uuid, text, uuid, uuid, boolean) TO service_role;
