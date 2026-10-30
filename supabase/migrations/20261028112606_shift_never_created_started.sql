-- Shift creation: no shift may start in the past, whichever path writes it.
--
-- The rule (decision 2026-08-05) was enforced per entry point, and unevenly:
-- the Add Shift modal and the Copy Shift flow checked the DATE only, so a
-- start earlier today went through; sm_create_shift checked nothing, so any
-- caller with shift.create could write a shift that had already started; and
-- apply_template_to_date_range_v2 skipped started instances unless the caller
-- passed p_force_stack. tr_lock_past_shifts guards UPDATE/DELETE of a shift
-- that has started, never the INSERT of one, nor an UPDATE that moves a future
-- shift into the past.
--
-- 1. trg_shift_not_started refuses an INSERT, or an UPDATE that changes
--    shift_date/start_time, when the start (Sydney) is at or before now().
--    Same start computation and no-bypass policy as fn_prevent_locked_shift_
--    modification. Fires before trg_shift_placement (name order), so the
--    refusal names the real reason rather than a roster mismatch.
-- 2. apply_template_to_date_range_v2 loses p_force_stack — the one way to opt
--    out, never set by the app (RosterTemplatesDialog always sent false) — and
--    takes an advisory lock per roster day before its "already stamped?"
--    check. That check was NOT EXISTS-then-INSERT, so two concurrent applies
--    (two tabs, a retry while the first was still running) both passed it.
--    The unique index is the backstop for any other writer. Rosters are one
--    per day (0 of 388 span more), so one template shift stamps at most one
--    row per roster. Body otherwise identical to the live definition
--    (pg_get_functiondef 2026-10-28, prosrc md5 324ac51d4e1c7af502036641a4d05ff8);
--    the authz guard and caller-attribution block are kept.
-- 3. sm_create_shift attributes the shift to the caller, not to the
--    client-supplied p_user_id — the rule apply_template_to_date_range_v2 and
--    sm_bulk_publish_shifts already follow. System callers keep the id they pass.
-- 4. enforce_exactly_three_groups allows the five standard groups; renamed to
--    say what it does. Behaviour unchanged.
--
-- Test: supabase/tests/shift_never_created_started.sql

-- ── 1. No shift starts in the past ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_shift_not_started()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_start timestamptz;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.shift_date IS NOT DISTINCT FROM NEW.shift_date
     AND OLD.start_time IS NOT DISTINCT FROM NEW.start_time THEN
    RETURN NEW;
  END IF;

  v_start := (NEW.shift_date || ' ' || NEW.start_time)::timestamp AT TIME ZONE 'Australia/Sydney';
  IF v_start <= now() THEN
    RAISE EXCEPTION 'A shift cannot start in the past: % at % (Sydney time) has already passed.',
      to_char(NEW.shift_date, 'Dy DD Mon'), to_char(NEW.start_time, 'HH24:MI')
      USING ERRCODE = 'check_violation', HINT = 'SHIFT_STARTED';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_shift_not_started
  BEFORE INSERT OR UPDATE OF shift_date, start_time ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.fn_shift_not_started();

-- ── 2. Template apply: no started-shift opt-out, no double stamp ───────────
CREATE UNIQUE INDEX shifts_roster_template_instance_key
  ON public.shifts (roster_id, template_instance_id)
  WHERE template_instance_id IS NOT NULL AND deleted_at IS NULL;

DROP FUNCTION public.apply_template_to_date_range_v2(uuid, date, date, uuid, text, uuid, uuid, boolean);

CREATE FUNCTION public.apply_template_to_date_range_v2(p_template_id uuid, p_start_date date, p_end_date date, p_user_id uuid, p_source text DEFAULT 'roster_modal'::text, p_target_department_id uuid DEFAULT NULL::uuid, p_target_sub_department_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- Templates always add on top of what is there. An instance that has already
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
                                COALESCE(v_ts.paid_break_minutes, 0), COALESCE(v_ts.unpaid_break_minutes, 0), v_ts.break_start, v_ts.break_end,
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

-- A new function is EXECUTE-able by PUBLIC and, via Supabase's default
-- privileges, by anon. Restore the dropped function's grants exactly.
REVOKE ALL ON FUNCTION public.apply_template_to_date_range_v2(uuid, date, date, uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_template_to_date_range_v2(uuid, date, date, uuid, text, uuid, uuid) TO authenticated, service_role;

-- ── 3. sm_create_shift: the caller is the creator ─────────────────────────
-- Live definition (pg_get_functiondef 2026-10-28) with one block added after
-- the authz guard. Grants are kept by CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.sm_create_shift(p_shift_data jsonb, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift_id uuid;
    v_roster_id uuid;
    v_roster_subgroup_id uuid;
    v_shift_group_id uuid;
    v_sub_group_name text;
    v_creation_source text;
    v_assignment_source text;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_shift_data_action(p_shift_data, 'shift.create');
  -- Audit attribution is the CALLER, never a client-supplied id (the rule
  -- apply_template_to_date_range_v2 got on 2026-10-18). System callers
  -- (cron, service role) keep the id they pass.
  IF NOT public.sm_request_is_system() THEN
    p_user_id := auth.uid();
  END IF;
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

    PERFORM set_config('app.audit.via_gateway', '1', true);

    INSERT INTO shifts (
        roster_id, department_id, shift_date, roster_date, start_time, end_time,
        organization_id, sub_department_id, group_type, sub_group_name, display_order,
        shift_group_id, roster_subgroup_id, role_id, remuneration_level,
        paid_break_minutes, unpaid_break_minutes, break_minutes, break_start, break_end, timezone,
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
        NULLIF(p_shift_data->>'break_start', '')::time,
        NULLIF(p_shift_data->>'break_end', '')::time,
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
        NULLIF(p_shift_data->>'target_employment_type', ''),
        COALESCE((p_shift_data->>'target_requires_flexible')::boolean, false),
        COALESCE((p_shift_data->>'is_training')::boolean, false),
        NOW(), NOW()
    )
    RETURNING id INTO v_shift_id;

    PERFORM set_config('app.audit.via_gateway', '0', true);

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
$function$;

-- ── 4. Name the group guard for what it checks ────────────────────────────
ALTER FUNCTION public.enforce_exactly_three_groups() RENAME TO enforce_standard_roster_groups;
ALTER TRIGGER trigger_enforce_exactly_three_groups ON public.roster_groups
  RENAME TO trigger_enforce_standard_roster_groups;
