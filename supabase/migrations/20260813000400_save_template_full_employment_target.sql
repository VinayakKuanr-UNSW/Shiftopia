-- Migration: 20260813000400_save_template_full_employment_target.sql
-- Description: `save_template_full` persists `target_employment_type` and
--              `target_requires_flexible`. Without this, adding ANY shift to
--              ANY template fails.
--
-- THE BUG
--
--   null value in column "target_employment_type" of relation "template_shifts"
--   violates not-null constraint
--
-- `20260806120000_template_shifts_employment_target.sql` made the column
-- mandatory — correctly: a shift with no employment target was being priced off
-- an `|| 'Casual'` guess. But `save_template_full`'s INSERT column list was
-- never updated to match, and the column has NO DEFAULT. So from that migration
-- onward, every attempt to add a template shift 400'd.
--
-- It went unnoticed because nothing added a template shift in between: there are
-- six template shifts in production and all six predate the constraint. The
-- Baseline FT work is what first tried to write one.
--
-- The UPDATE branch is also fixed. It could not fail (existing rows already hold
-- a value) but it silently discarded edits — change a shift from Casual to
-- Full-Time in the editor and the change was dropped on save.
--
-- NOT DEFAULTED HERE. `COALESCE(..., 'Casual')` would make the save succeed and
-- reintroduce exactly the guess the NOT NULL was added to stop. If the payload
-- omits it, the insert should fail — the caller now always sends it.
--
-- ROLLBACK: re-create the function from
--           20260805120000_apply_template_use_roster_resolver.sql's sibling
--           definition (this migration only changes the two shift branches).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.save_template_full(
    p_template_id uuid,
    p_expected_version integer,
    p_name text,
    p_description text,
    p_groups jsonb,
    p_user_id uuid
)
RETURNS TABLE(success boolean, new_version integer, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_current_version integer;
    v_new_version integer;
    v_group jsonb;
    v_subgroup jsonb;
    v_shift jsonb;
    v_group_id uuid;
    v_subgroup_id uuid;
    v_shift_id uuid;
    v_existing_group_ids uuid[] := '{}';
    v_existing_subgroup_ids uuid[] := '{}';
    v_existing_shift_ids uuid[] := '{}';
BEGIN
    SELECT version INTO v_current_version
    FROM roster_templates
    WHERE id = p_template_id;

    IF v_current_version IS NULL THEN
        RETURN QUERY SELECT false, NULL::integer, 'Template not found'::text;
        RETURN;
    END IF;

    IF v_current_version != p_expected_version THEN
        RETURN QUERY SELECT false, v_current_version, 'Version mismatch - template has been modified'::text;
        RETURN;
    END IF;

    v_new_version := v_current_version + 1;
    UPDATE roster_templates
    SET
        name = p_name,
        description = NULLIF(p_description, ''),
        version = v_new_version,
        updated_at = now(),
        last_edited_by = p_user_id
    WHERE id = p_template_id;

    FOR v_group IN SELECT * FROM jsonb_array_elements(p_groups)
    LOOP
        v_group_id := NULL;
        IF (v_group->>'id') IS NOT NULL AND (v_group->>'id') NOT LIKE 'temp-%' THEN
            BEGIN
                v_group_id := (v_group->>'id')::uuid;
            EXCEPTION WHEN OTHERS THEN
                v_group_id := NULL;
            END;
        END IF;

        IF v_group_id IS NOT NULL THEN
            UPDATE template_groups
            SET
                name = v_group->>'name',
                description = v_group->>'description',
                color = COALESCE(v_group->>'color', '#3b82f6'),
                icon = v_group->>'icon',
                sort_order = COALESCE((v_group->>'sortOrder')::integer, 0)
            WHERE id = v_group_id;

            v_existing_group_ids := array_append(v_existing_group_ids, v_group_id);
        ELSE
            INSERT INTO template_groups (template_id, name, description, color, icon, sort_order)
            VALUES (
                p_template_id,
                v_group->>'name',
                v_group->>'description',
                COALESCE(v_group->>'color', '#3b82f6'),
                v_group->>'icon',
                COALESCE((v_group->>'sortOrder')::integer, 0)
            )
            RETURNING id INTO v_group_id;

            v_existing_group_ids := array_append(v_existing_group_ids, v_group_id);
        END IF;

        IF (v_group->'subGroups') IS NOT NULL THEN
            FOR v_subgroup IN SELECT * FROM jsonb_array_elements(v_group->'subGroups')
            LOOP
                v_subgroup_id := NULL;
                IF (v_subgroup->>'id') IS NOT NULL AND (v_subgroup->>'id') NOT LIKE 'temp-%' THEN
                    BEGIN
                        v_subgroup_id := (v_subgroup->>'id')::uuid;
                    EXCEPTION WHEN OTHERS THEN
                        v_subgroup_id := NULL;
                    END;
                END IF;

                IF v_subgroup_id IS NOT NULL THEN
                    UPDATE template_subgroups
                    SET
                        name = v_subgroup->>'name',
                        description = v_subgroup->>'description',
                        sort_order = COALESCE((v_subgroup->>'sortOrder')::integer, 0)
                    WHERE id = v_subgroup_id;

                    v_existing_subgroup_ids := array_append(v_existing_subgroup_ids, v_subgroup_id);
                ELSE
                    INSERT INTO template_subgroups (group_id, name, description, sort_order)
                    VALUES (
                        v_group_id,
                        v_subgroup->>'name',
                        v_subgroup->>'description',
                        COALESCE((v_subgroup->>'sortOrder')::integer, 0)
                    )
                    RETURNING id INTO v_subgroup_id;

                    v_existing_subgroup_ids := array_append(v_existing_subgroup_ids, v_subgroup_id);
                END IF;

                IF (v_subgroup->'shifts') IS NOT NULL THEN
                    FOR v_shift IN SELECT * FROM jsonb_array_elements(v_subgroup->'shifts')
                    LOOP
                        v_shift_id := NULL;
                        IF (v_shift->>'id') IS NOT NULL AND (v_shift->>'id') NOT LIKE 'temp-%' THEN
                            BEGIN
                                v_shift_id := (v_shift->>'id')::uuid;
                            EXCEPTION WHEN OTHERS THEN
                                v_shift_id := NULL;
                            END;
                        END IF;

                        IF v_shift_id IS NOT NULL THEN
                            UPDATE template_shifts
                            SET
                                name = v_shift->>'name',
                                role_id = NULLIF(v_shift->>'roleId', '')::uuid,
                                role_name = v_shift->>'roleName',
                                remuneration_level = NULLIF(v_shift->>'remunerationLevel', '')::smallint,
                                remuneration_level_name = v_shift->>'remunerationLevelName',
                                start_time = (v_shift->>'startTime')::time,
                                end_time = (v_shift->>'endTime')::time,
                                paid_break_minutes = COALESCE((v_shift->>'paidBreakDuration')::integer, 0),
                                unpaid_break_minutes = COALESCE((v_shift->>'unpaidBreakDuration')::integer, 0),
                                required_skills = COALESCE(
                                    (SELECT array_agg(x) FROM jsonb_array_elements_text(v_shift->'skills') t(x)),
                                    '{}'
                                ),
                                required_licenses = COALESCE(
                                    (SELECT array_agg(x) FROM jsonb_array_elements_text(v_shift->'licenses') t(x)),
                                    '{}'
                                ),
                                site_tags = COALESCE(
                                    (SELECT array_agg(x) FROM jsonb_array_elements_text(v_shift->'siteTags') t(x)),
                                    '{}'
                                ),
                                event_tags = COALESCE(
                                    (SELECT array_agg(x) FROM jsonb_array_elements_text(v_shift->'eventTags') t(x)),
                                    '{}'
                                ),
                                notes = v_shift->>'notes',
                                assigned_employee_id = NULLIF(v_shift->>'assignedEmployeeId', '')::uuid,
                                assigned_employee_name = v_shift->>'assignedEmployeeName',
                                sort_order = COALESCE((v_shift->>'sortOrder')::integer, 0),
                                day_of_week = (v_shift->>'dayOfWeek')::integer,
                                -- COALESCE to the CURRENT value, not to a literal:
                                -- an older client that does not send the key must
                                -- leave the existing target alone rather than have
                                -- one invented for it.
                                target_employment_type = COALESCE(
                                    NULLIF(v_shift->>'targetEmploymentType', ''),
                                    template_shifts.target_employment_type
                                ),
                                target_requires_flexible = COALESCE(
                                    (v_shift->>'targetRequiresFlexible')::boolean,
                                    template_shifts.target_requires_flexible
                                )
                            WHERE id = v_shift_id;

                            v_existing_shift_ids := array_append(v_existing_shift_ids, v_shift_id);
                        ELSE
                            INSERT INTO template_shifts (
                                subgroup_id,
                                name,
                                role_id,
                                role_name,
                                remuneration_level,
                                remuneration_level_name,
                                start_time,
                                end_time,
                                paid_break_minutes,
                                unpaid_break_minutes,
                                required_skills,
                                required_licenses,
                                site_tags,
                                event_tags,
                                notes,
                                assigned_employee_id,
                                assigned_employee_name,
                                sort_order,
                                day_of_week,
                                target_employment_type,
                                target_requires_flexible
                            )
                            VALUES (
                                v_subgroup_id,
                                v_shift->>'name',
                                NULLIF(v_shift->>'roleId', '')::uuid,
                                v_shift->>'roleName',
                                NULLIF(v_shift->>'remunerationLevel', '')::smallint,
                                v_shift->>'remunerationLevelName',
                                (v_shift->>'startTime')::time,
                                (v_shift->>'endTime')::time,
                                COALESCE((v_shift->>'paidBreakDuration')::integer, 0),
                                COALESCE((v_shift->>'unpaidBreakDuration')::integer, 0),
                                COALESCE(
                                    (SELECT array_agg(x) FROM jsonb_array_elements_text(v_shift->'skills') t(x)),
                                    '{}'
                                ),
                                COALESCE(
                                    (SELECT array_agg(x) FROM jsonb_array_elements_text(v_shift->'licenses') t(x)),
                                    '{}'
                                ),
                                COALESCE(
                                    (SELECT array_agg(x) FROM jsonb_array_elements_text(v_shift->'siteTags') t(x)),
                                    '{}'
                                ),
                                COALESCE(
                                    (SELECT array_agg(x) FROM jsonb_array_elements_text(v_shift->'eventTags') t(x)),
                                    '{}'
                                ),
                                v_shift->>'notes',
                                NULLIF(v_shift->>'assignedEmployeeId', '')::uuid,
                                v_shift->>'assignedEmployeeName',
                                COALESCE((v_shift->>'sortOrder')::integer, 0),
                                (v_shift->>'dayOfWeek')::integer,
                                -- Deliberately NOT defaulted. See the header note.
                                NULLIF(v_shift->>'targetEmploymentType', ''),
                                COALESCE((v_shift->>'targetRequiresFlexible')::boolean, false)
                            )
                            RETURNING id INTO v_shift_id;

                            v_existing_shift_ids := array_append(v_existing_shift_ids, v_shift_id);
                        END IF;
                    END LOOP;
                END IF;

                DELETE FROM template_shifts
                WHERE subgroup_id = v_subgroup_id
                AND id != ALL(v_existing_shift_ids);
            END LOOP;
        END IF;

        DELETE FROM template_subgroups
        WHERE group_id = v_group_id
        AND id != ALL(v_existing_subgroup_ids);
    END LOOP;

    DELETE FROM template_groups
    WHERE template_id = p_template_id
    AND id != ALL(v_existing_group_ids);

    RETURN QUERY SELECT true, v_new_version, NULL::text;
END;
$function$;

ALTER FUNCTION public.save_template_full(uuid, integer, text, text, jsonb, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_template_full(uuid, integer, text, text, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_template_full(uuid, integer, text, text, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_template_full(uuid, integer, text, text, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_template_full(uuid, integer, text, text, jsonb, uuid) TO service_role;
