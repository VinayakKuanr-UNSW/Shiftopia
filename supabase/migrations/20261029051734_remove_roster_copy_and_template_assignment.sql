-- Rosters loses its last copy path, and template shifts lose the employee
-- they were never meant to have.
--
-- 1. clone_roster_subgroup_v2 is dropped. Its only caller was the roster
--    sub-group "Clone" action, removed from the app: copying lives in Templates
--    (copy a template, a sub-group, a shift), and a roster shift that repeats is
--    authored in a template and applied.
-- 2. template_shifts.assigned_employee_id / assigned_employee_name are dropped
--    (0 of 29 rows set; FK and index go with them). A template shift is demand,
--    not a person, so nothing person-scoped (assignment, labour compliance)
--    belongs to it; shape rules stay. Everything that read the columns changes
--    first, from its live definition:
--    - apply_template_to_date_range_v2 stamps every shift unassigned (S1); it
--      copied the template shift's employee onto the roster shift. Body from
--      20261028112606 (prosrc md5 62a8f1b76accb9a61fef18ce707e69b0).
--    - save_template_full stops writing them (prosrc md5 2a6a7c78004a2bfcdb0291ddc500b97c).
--    - delete_user_entirely stops deleting template shifts by employee
--      (prosrc md5 7b859614f852116c6e6b5f672ad30dae).
--    - v_template_full stops returning them. A view cannot lose columns in
--      place, so it is dropped and recreated WITH (security_invoker = true) and
--      the exact grants it had (CREATE OR REPLACE would also drop the option).
-- Grants on the three functions are kept by CREATE OR REPLACE.
--
-- Test: supabase/tests/roster_copy_removed.sql

-- ── 1. No roster sub-group clone ──────────────────────────────────────────
DROP FUNCTION public.clone_roster_subgroup_v2(uuid, uuid, uuid, text, text, text, date, date, boolean);

-- ── 2. Template shifts have no employee ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_template_to_date_range_v2(p_template_id uuid, p_start_date date, p_end_date date, p_user_id uuid, p_source text DEFAULT 'roster_modal'::text, p_target_department_id uuid DEFAULT NULL::uuid, p_target_sub_department_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- Templates always add on top of what is there, and every shift they stamp
-- is unassigned: a template shift has no employee. An instance that has already
-- started is skipped and counted in shifts_skipped; trg_shift_not_started
-- refuses it anyway.
DECLARE
    v_template record;
    v_curr_date date;
    v_roster_id uuid;
    v_batch_id uuid;
    v_total_shifts integer := 0;
    v_shifts_skipped integer := 0;
    v_tg record;
    v_tsg record;
    v_ts record;
    v_breach_window text;
    v_rg_id uuid;
    v_rsg_id uuid;
    v_external_id text;
    v_shift_start_timestamp timestamptz;
    v_shift_end_timestamp timestamptz;
    v_dept_id uuid;
    v_sub_dept_id uuid;
    v_dow integer;
    v_new_shift_id uuid;
    v_breach text;
    v_shifts_skipped_unlawful integer := 0;
    v_unlawful jsonb := '[]'::jsonb;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_template_apply(p_template_id, p_target_department_id, p_target_sub_department_id);
  -- Audit attribution is the CALLER, never a client-supplied id (2026-10-18;
  -- the rule sm_bulk_publish_shifts got on 2026-10-13). p_user_id fed
  -- roster_template_batches.applied_by, rosters.created_by,
  -- shifts.created_by_user_id and the shift_events actor. System callers
  -- (cron, service role) keep the id they pass.
  IF NOT public.sm_request_is_system() THEN
    p_user_id := auth.uid();
  END IF;
    SELECT * INTO v_template FROM roster_templates WHERE id = p_template_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template not found');
    END IF;

    v_dept_id := COALESCE(p_target_department_id, v_template.department_id);
    v_sub_dept_id := COALESCE(p_target_sub_department_id, v_template.sub_department_id);

    INSERT INTO roster_template_batches (
        template_id, applied_at, applied_by, start_date, end_date, source
    )
    VALUES (
        p_template_id, now(), p_user_id, p_start_date, p_end_date, p_source
    )
    RETURNING id INTO v_batch_id;

    PERFORM set_config('app.audit.via_gateway', '1', true);

    FOR v_curr_date IN (SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date) LOOP

        v_dow := (EXTRACT(DOW FROM v_curr_date))::integer;

        -- One apply at a time per roster day, so the "already stamped?" check
        -- below sees what a concurrent apply committed. Dates run ascending in
        -- every apply, so overlapping ranges take these locks in the same order.
        PERFORM pg_advisory_xact_lock(hashtextextended(
            'template_apply:' || v_curr_date::text || ':' || v_dept_id::text || ':' || COALESCE(v_sub_dept_id::text, ''), 0));

        SELECT id INTO v_roster_id
        FROM rosters
        WHERE start_date = v_curr_date
          AND department_id = v_dept_id
          AND sub_department_id IS NOT DISTINCT FROM v_sub_dept_id
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

        FOR v_tg IN (SELECT * FROM template_groups WHERE template_id = p_template_id) LOOP
            v_external_id := CASE LOWER(REPLACE(v_tg.name, ' ', '_'))
                WHEN 'convention_centre' THEN 'convention_centre'
                WHEN 'exhibition_centre' THEN 'exhibition_centre'
                WHEN 'theatre' THEN 'theatre'
                WHEN 'the_cutaway' THEN 'the_cutaway'
                WHEN 'office' THEN 'office'
                ELSE NULL
            END;

            IF v_external_id IS NULL THEN
                RAISE EXCEPTION 'apply_template: unknown template group "%" — cannot map to a roster group type', v_tg.name;
            END IF;

            SELECT id INTO v_rg_id FROM roster_groups WHERE roster_id = v_roster_id AND (external_id = v_external_id OR name = v_tg.name) LIMIT 1;

            IF v_rg_id IS NULL THEN
                INSERT INTO roster_groups (roster_id, name, external_id, sort_order)
                VALUES (v_roster_id, v_tg.name, v_external_id, v_tg.sort_order)
                RETURNING id INTO v_rg_id;
            END IF;

            FOR v_tsg IN (SELECT * FROM template_subgroups WHERE group_id = v_tg.id) LOOP
                -- Same name in the same group = the same sub-group, whatever the case.
                SELECT id INTO v_rsg_id
                FROM roster_subgroups
                WHERE roster_group_id = v_rg_id AND lower(name) = lower(btrim(v_tsg.name));

                IF v_rsg_id IS NULL THEN
                    INSERT INTO roster_subgroups (roster_group_id, name, sort_order)
                    VALUES (v_rg_id, v_tsg.name, v_tsg.sort_order)
                    RETURNING id INTO v_rsg_id;
                END IF;

                FOR v_ts IN (SELECT * FROM template_shifts WHERE subgroup_id = v_tsg.id) LOOP
                    IF v_ts.day_of_week IS NULL OR v_ts.day_of_week = v_dow THEN

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

                            IF v_shift_start_timestamp <= now() THEN
                                v_shifts_skipped := v_shifts_skipped + 1;
                                CONTINUE;
                            END IF;

                            -- DAY-TYPED COMPLIANCE: soft-skip an instance this
                            -- template cannot lawfully produce on THIS date.
                            -- Same predicate trg_shift_shape_3_day_typed
                            -- enforces, so skip and enforce cannot drift.
                            v_breach_window := public.shift_break_window_breach(
                                v_ts.start_time, v_ts.end_time, COALESCE(v_ts.unpaid_break_minutes, 0),
                                v_ts.break_start, v_ts.break_end);
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
                            v_breach := COALESCE(v_breach_window, v_breach);
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
                                paid_break_minutes, unpaid_break_minutes, break_start, break_end,
                                template_id, template_instance_id, is_from_template,
                                template_batch_id,
                                roster_subgroup_id,
                                group_type,
                                sub_group_name,
                                template_group,
                                template_sub_group,
                                lifecycle_status, notes,
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
                                COALESCE(v_ts.paid_break_minutes, 0), COALESCE(v_ts.unpaid_break_minutes, 0), v_ts.break_start, v_ts.break_end,
                                p_template_id, v_ts.id, true,
                                v_batch_id,
                                v_rsg_id,
                                v_external_id::template_group_type,
                                v_tsg.name,
                                v_external_id::template_group_type,
                                v_tsg.name,
                                'Draft', v_ts.notes,
                                p_user_id,
                                to_jsonb(v_ts.required_skills),
                                to_jsonb(v_ts.required_licenses),
                                to_jsonb(v_ts.event_tags),
                                '[]'::jsonb
                            )
                            RETURNING id INTO v_new_shift_id;

                            INSERT INTO public.shift_events (
                                shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain
                            ) VALUES (
                                v_new_shift_id,
                                NULL,
                                p_user_id,
                                'OP_APPLIED'::public.shift_event_type,
                                jsonb_build_object(
                                    'op', 'create',
                                    'domain', 'lifecycle',
                                    'from_state', NULL,
                                    'to_state', 'S1',
                                    'source', 'apply_template_to_date_range_v2',
                                    'creation_source', 'template'
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

    PERFORM set_config('app.audit.via_gateway', '0', true);

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

CREATE OR REPLACE FUNCTION public.save_template_full(p_template_id uuid, p_expected_version integer, p_name text, p_description text, p_groups jsonb, p_user_id uuid)
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
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_template_edit(p_template_id);
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
                                break_start = NULLIF(v_shift->>'breakStart', '')::time,
                                break_end = NULLIF(v_shift->>'breakEnd', '')::time,
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
                                sort_order = COALESCE((v_shift->>'sortOrder')::integer, 0),
                                day_of_week = (v_shift->>'dayOfWeek')::integer,
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
                                break_start,
                                break_end,
                                required_skills,
                                required_licenses,
                                site_tags,
                                event_tags,
                                notes,
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
                                NULLIF(v_shift->>'breakStart', '')::time,
                                NULLIF(v_shift->>'breakEnd', '')::time,
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
                                COALESCE((v_shift->>'sortOrder')::integer, 0),
                                (v_shift->>'dayOfWeek')::integer,
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

CREATE OR REPLACE FUNCTION public.delete_user_entirely(user_uuid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Users can only be deleted from the database, not from the app.';
  END IF;

  PERFORM set_config('app.shift_purge', 'user', true);
  DELETE FROM public.shifts WHERE assigned_employee_id = user_uuid;
  PERFORM set_config('app.shift_purge', '', true);

  UPDATE public.shifts
     SET cancelled_by_user_id = NULLIF(cancelled_by_user_id, user_uuid),
         published_by_user_id = NULLIF(published_by_user_id, user_uuid),
         emergency_assigned_by = NULLIF(emergency_assigned_by, user_uuid),
         dropped_by_id = NULLIF(dropped_by_id, user_uuid)
   WHERE cancelled_by_user_id = user_uuid OR published_by_user_id = user_uuid
      OR emergency_assigned_by = user_uuid OR dropped_by_id = user_uuid;
  UPDATE public.timesheets SET approved_by = NULL WHERE approved_by = user_uuid;
  UPDATE public.rosters SET published_by = NULL, created_by = NULL WHERE published_by = user_uuid OR created_by = user_uuid;
  UPDATE public.availabilities SET approved_by = NULL WHERE approved_by = user_uuid;
  UPDATE public.shift_swaps SET approved_by = NULL WHERE approved_by = user_uuid;
  UPDATE public.leave_requests SET approved_by = NULL WHERE approved_by = user_uuid;
  UPDATE public.roster_templates
     SET last_edited_by = NULL, published_by = NULL, created_by = NULL
   WHERE last_edited_by = user_uuid OR published_by = user_uuid OR created_by = user_uuid;
  UPDATE public.app_access_certificates SET created_by = NULL WHERE created_by = user_uuid;
  UPDATE public.roster_template_batches SET applied_by = NULL WHERE applied_by = user_uuid;
  UPDATE public.shift_bids SET reviewed_by = NULL WHERE reviewed_by = user_uuid;

  DELETE FROM public.cancellation_history WHERE employee_id = user_uuid;
  DELETE FROM public.attendance_records WHERE employee_id = user_uuid;
  DELETE FROM public.autoschedule_assignments WHERE employee_id = user_uuid;
  DELETE FROM public.leave_requests WHERE employee_id = user_uuid;
  DELETE FROM public.app_access_certificates WHERE user_id = user_uuid;
  DELETE FROM public.user_contracts WHERE user_id = user_uuid;

  DELETE FROM public.profiles WHERE id = user_uuid;
  DELETE FROM auth.users WHERE id = user_uuid;
END;
$function$;

DROP VIEW public.v_template_full;

ALTER TABLE public.template_shifts
  DROP COLUMN assigned_employee_id,
  DROP COLUMN assigned_employee_name;

CREATE VIEW public.v_template_full WITH (security_invoker = true) AS
 SELECT id,
    name,
    description,
    status,
    organization_id,
    published_month,
    published_at,
    published_by,
    start_date,
    end_date,
    created_by,
    last_edited_by,
    version,
    created_at,
    updated_at,
    is_base_template,
    department_id,
    sub_department_id,
    ( SELECT count(*) AS count
           FROM roster_template_batches rtb
          WHERE rtb.template_id = t.id) AS applied_count,
    COALESCE(( SELECT json_agg(json_build_object('id', tg.id, 'name', tg.name, 'description', tg.description, 'color', tg.color, 'icon', tg.icon, 'sortOrder', tg.sort_order, 'subGroups', ( SELECT COALESCE(json_agg(json_build_object('id', tsg.id, 'name', tsg.name, 'description', tsg.description, 'sortOrder', tsg.sort_order, 'shifts', ( SELECT COALESCE(json_agg(json_build_object('id', s.id, 'name', COALESCE(s.name, s.role_name), 'roleId', s.role_id, 'roleName', s.role_name, 'remunerationLevelId', NULL::uuid, 'remunerationLevel', s.remuneration_level, 'remunerationLevelName', s.remuneration_level_name, 'startTime', to_char(s.start_time::interval, 'HH24:MI'::text), 'endTime', to_char(s.end_time::interval, 'HH24:MI'::text), 'paidBreakDuration', COALESCE(s.paid_break_minutes, 0), 'unpaidBreakDuration', COALESCE(s.unpaid_break_minutes, 0), 'breakStart', to_char(s.break_start::interval, 'HH24:MI'::text), 'breakEnd', to_char(s.break_end::interval, 'HH24:MI'::text), 'skills', COALESCE(s.required_skills, ARRAY[]::text[]), 'licenses', COALESCE(s.required_licenses, ARRAY[]::text[]), 'siteTags', COALESCE(s.site_tags, ARRAY[]::text[]), 'eventTags', COALESCE(s.event_tags, ARRAY[]::text[]), 'notes', s.notes, 'netLength', s.net_length_hours, 'sortOrder', s.sort_order, 'dayOfWeek', s.day_of_week, 'targetEmploymentType', s.target_employment_type, 'targetRequiresFlexible', s.target_requires_flexible) ORDER BY s.sort_order, s.start_time), '[]'::json) AS "coalesce"
                           FROM template_shifts s
                          WHERE s.subgroup_id = tsg.id)) ORDER BY tsg.sort_order), '[]'::json) AS "coalesce"
                   FROM template_subgroups tsg
                  WHERE tsg.group_id = tg.id)) ORDER BY tg.sort_order) AS json_agg
           FROM template_groups tg
          WHERE tg.template_id = t.id), '[]'::json) AS groups
   FROM roster_templates t;

REVOKE ALL ON public.v_template_full FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_template_full TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.v_template_full TO authenticated;
GRANT ALL ON public.v_template_full TO service_role;
