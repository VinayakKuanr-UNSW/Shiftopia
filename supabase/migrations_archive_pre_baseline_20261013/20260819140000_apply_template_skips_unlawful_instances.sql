-- apply_template_to_date_range_v2 — skip the instances a template cannot
-- lawfully produce on a given date, instead of failing the whole apply.
--
-- WHY THE RPC HAS TO KNOW, NOW THAT THE TRIGGER EXISTS
-- ----------------------------------------------------
-- Every one of the 22 rows in the live template library carries
-- `day_of_week = NULL`, which the loop below reads as EVERY day. So a template
-- containing one three-hour casual shift lands on every Sunday and every public
-- holiday in whatever range a manager picks. Before `20260819120000` nothing
-- objected. As of `trg_shift_shape_3_day_typed` the INSERT raises — and because
-- this function is one transaction, ONE Christmas Day would roll back an entire
-- quarter's apply with a bare 23514 and no indication of which shift or which
-- day caused it.
--
-- That is a worse product than the gap it replaces. A manager who cannot apply
-- a quarter will apply three narrower ranges instead, and the public-holiday
-- coverage they were trying to create simply will not exist — no error, no
-- record, and the roster looks finished. A gate people route around does not
-- protect anyone; it just moves the failure somewhere nobody is looking.
--
-- So the RPC asks the SAME predicate the trigger enforces, BEFORE inserting,
-- and skips just that instance. The lawful days of the quarter are written; the
-- instances that breach cl 56.2 or the cl 12 Sunday tier are reported back by
-- date and by shift, with the clause they breach, so the manager can lengthen
-- the template shift and re-apply.
--
-- Sharing `shift_day_typed_shortfall` between the two is what makes this safe.
-- A skip rule that drifted from the enforcement rule would either abort anyway
-- (skip looser than enforce) or write rows the trigger meant to stop (skip
-- stricter, enforce never consulted). One predicate, two dispositions.
--
-- REPORTED SEPARATELY FROM `shifts_skipped`. That counter already means "starts
-- in the past, soft-skipped". Folding a compliance refusal into it would make
-- one number mean two things, and the fixes point in opposite directions: the
-- remedy for one is to pick a later date, the remedy for the other is to make
-- the shift longer.
--
-- Body is production's live definition read via pg_get_functiondef on
-- 2026-08-19. The only changes are the three new declarations, the guard before
-- the INSERT, and two extra keys on the returned object. Every existing key
-- keeps its name and meaning, so current callers are unaffected.

CREATE OR REPLACE FUNCTION public.apply_template_to_date_range_v2(
    p_template_id uuid,
    p_start_date date,
    p_end_date date,
    p_user_id uuid,
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
    -- Day-typed compliance skip (2026-08-19)
    v_breach text;
    v_shifts_skipped_unlawful integer := 0;
    v_unlawful jsonb := '[]'::jsonb;
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
        SELECT id INTO v_roster_id
        FROM rosters
        WHERE start_date = v_curr_date
          AND department_id = v_dept_id
          AND sub_department_id = v_sub_dept_id
        LIMIT 1;

        IF v_roster_id IS NULL THEN
            INSERT INTO rosters (
                start_date, end_date, template_id, organization_id,
                department_id, sub_department_id,
                description, status, is_locked, created_by
            )
            VALUES (
                v_curr_date, v_curr_date, p_template_id, v_template.organization_id,
                v_dept_id, v_sub_dept_id,
                v_template.description, 'draft', false, p_user_id
            )
            RETURNING id INTO v_roster_id;
        END IF;

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

                            -- DAY-TYPED COMPLIANCE: SOFT SKIP an instance this
                            -- template cannot lawfully produce on THIS date.
                            --
                            -- `is_training` is passed false because
                            -- `template_shifts` has no such column — which is
                            -- also why the INSERT below leaves the field to its
                            -- default, so the verdict and the row agree.
                            --
                            -- `target_employment_type` is read from the template
                            -- row for the same reason the INSERT omits it:
                            -- `fn_shift_inherit_template_row` resolves the
                            -- column from exactly this value, so this verdict
                            -- and the trigger's are taken on identical input.
                            -- A NULL here is left alone rather than defaulted —
                            -- that inherit trigger raises 23502 on it, and a
                            -- clear "target_employment_type is required" is a
                            -- better answer than a compliance verdict computed
                            -- against a guess.
                            v_breach := public.shift_day_typed_shortfall(
                                v_curr_date,
                                v_ts.start_time,
                                v_ts.end_time,
                                COALESCE(v_ts.unpaid_break_minutes, 0),
                                v_ts.target_employment_type,
                                v_ts.target_requires_flexible,
                                false,
                                v_ts.role_id
                            );
                            IF v_breach IS NOT NULL THEN
                                v_shifts_skipped_unlawful := v_shifts_skipped_unlawful + 1;
                                v_unlawful := v_unlawful || jsonb_build_object(
                                    'date',              v_curr_date,
                                    'template_shift_id', v_ts.id,
                                    'group',             v_tg.name,
                                    'sub_group',         v_tsg.name,
                                    'role_id',           v_ts.role_id,
                                    'start_time',        v_ts.start_time,
                                    'end_time',          v_ts.end_time,
                                    'breach',            v_breach
                                );
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
        'shifts_skipped_unlawful', v_shifts_skipped_unlawful,
        'unlawful_instances', v_unlawful,
        'batch_id', v_batch_id,
        'roster_id', v_roster_id
    );
END;
$function$;

ALTER FUNCTION public.apply_template_to_date_range_v2(uuid, date, date, uuid, text, uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_template_to_date_range_v2(uuid, date, date, uuid, text, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_template_to_date_range_v2(uuid, date, date, uuid, text, uuid, uuid, boolean) TO authenticated, service_role;
