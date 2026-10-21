-- ─────────────────────────────────────────────────────────────────────────────
-- Audit coverage: emit a CREATED origin event for every shift creation path.
--
-- Problem: only sm_create_shift (the "Add Shift" modal) wrote a create anchor
-- into shift_events. Template-apply, monthly-template, and clone paths all
-- bypassed it, leaving those shifts with "No history recorded" until a later
-- lifecycle event happened to fire.
--
-- Fixes:
--   Part 1 — Forward-fix: patch every non-sm_create_shift creation function
--            to emit OP_APPLIED(op='create', domain='lifecycle') after each
--            INSERT INTO shifts, mirroring the sm_create_shift pattern.
--            Each patched function sets app.audit.via_gateway='1' to suppress
--            the trigger's INSERT-branch ASSIGNED (avoiding double-write for
--            pre-assigned template shifts), then writes a single create event
--            that folds assignment info into metadata.
--
--   Part 2 — Backfill: synthesize a create event for every existing shift
--            that has no op:'create' row, using shifts.created_at as the
--            event timestamp.
--
-- Functions patched (7):
--   1. apply_template_to_date_range_v2  (primary Roster Planner path)
--   2. apply_monthly_template           (overload 1: org, month, template)
--   3. apply_monthly_template           (overload 2: template, org, month)
--   4. apply_monthly_template           (overload 3: template, month varchar, org)
--   5. apply_template_to_date_range     (v1 legacy)
--   6. clone_roster_subgroup            (single-subgroup clone)
--   7. clone_roster_subgroup_v2         (date-range clone)
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1: FORWARD-FIX — emit create events from all creation paths
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. apply_template_to_date_range_v2
--    (overrides 20260702155605_apply_template_cutaway_no_unassigned_fallback)
-- ─────────────────────────────────────────────────────────────────────────────

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


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. apply_monthly_template — overload 1: (org_id, month, template_id)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "public"."apply_monthly_template"("p_organization_id" "uuid", "p_month" "text", "p_template_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
    v_start_date DATE;
    v_end_date DATE;
    v_curr_date DATE;
    v_template RECORD;
    v_roster_id UUID;
    v_tg RECORD;
    v_tsg RECORD;
    v_ts RECORD;
    v_rg_id UUID;
    v_rsg_id UUID;
    v_external_id TEXT;
    v_days_processed INTEGER := 0;
    v_shifts_created INTEGER := 0;
    v_shifts_skipped INTEGER := 0;
    v_shifts_skipped_past INTEGER := 0;
    v_shifts_skipped_today INTEGER := 0;
    v_shift_start_timestamp TIMESTAMPTZ;
    v_shift_end_timestamp TIMESTAMPTZ;
    v_sydney_now TIMESTAMPTZ;
    v_new_shift_id UUID;  -- AUDIT: capture inserted shift id
BEGIN
    -- 1. Calculate start and end dates for the month
    BEGIN
        v_start_date := (p_month || '-01')::DATE;
        v_end_date := (v_start_date + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid month format. Expected YYYY-MM');
    END;

    -- 2. Get Template info
    SELECT * INTO v_template FROM roster_templates WHERE id = p_template_id;
    IF v_template IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template not found');
    END IF;

    -- AUDIT DE-DUP: suppress trigger INSERT-branch while we write our own create events.
    PERFORM set_config('app.audit.via_gateway', '1', true);

    -- 3. Loop through days
    v_curr_date := v_start_date;
    WHILE v_curr_date <= v_end_date LOOP
        
        -- Get current Sydney time once per day loop
        v_sydney_now := NOW() AT TIME ZONE 'Australia/Sydney';

        -- STRICT LOCK: Skip past dates
        IF v_curr_date < CURRENT_DATE THEN
            v_shifts_skipped := v_shifts_skipped + 1;
            v_shifts_skipped_past := v_shifts_skipped_past + 1;
            v_curr_date := v_curr_date + 1;
            CONTINUE;
        END IF;
        
        -- Create/Update roster entry
        INSERT INTO rosters (
            organization_id, department_id, sub_department_id, 
            description, status, start_date, end_date, template_id, created_by
        )
        VALUES (
            p_organization_id, v_template.department_id, v_template.sub_department_id,
            v_template.description, 'draft', v_curr_date, v_curr_date, p_template_id, auth.uid()
        )
        ON CONFLICT (start_date, department_id, COALESCE(sub_department_id, '00000000-0000-0000-0000-000000000000')) DO UPDATE SET
            organization_id = EXCLUDED.organization_id,
            template_id = EXCLUDED.template_id,
            updated_at = NOW()
        RETURNING id INTO v_roster_id;

        -- Process hierarchy: Groups -> SubGroups -> Shifts
        FOR v_tg IN SELECT * FROM template_groups WHERE template_id = p_template_id ORDER BY sort_order LOOP
            
            -- Determine External ID (for legacy mapping)
            v_external_id := CASE LOWER(REPLACE(v_tg.name, ' ', '_'))
                WHEN 'convention_centre' THEN 'convention_centre'
                WHEN 'exhibition_centre' THEN 'exhibition_centre'
                WHEN 'theatre' THEN 'theatre'
                ELSE NULL
            END;

            -- Create Roster Group
            SELECT id INTO v_rg_id FROM roster_groups WHERE roster_id = v_roster_id AND name = v_tg.name LIMIT 1;
            IF v_rg_id IS NULL THEN
                INSERT INTO roster_groups (roster_id, name, sort_order, external_id)
                VALUES (v_roster_id, v_tg.name, v_tg.sort_order, v_external_id)
                RETURNING id INTO v_rg_id;
            END IF;

            -- Process SubGroups
            FOR v_tsg IN SELECT * FROM template_subgroups WHERE group_id = v_tg.id ORDER BY sort_order LOOP
                
                -- Create Roster SubGroup
                SELECT id INTO v_rsg_id FROM roster_subgroups WHERE roster_group_id = v_rg_id AND name = v_tsg.name LIMIT 1;
                IF v_rsg_id IS NULL THEN
                    INSERT INTO roster_subgroups (roster_group_id, name, sort_order)
                    VALUES (v_rg_id, v_tsg.name, v_tsg.sort_order)
                    RETURNING id INTO v_rsg_id;
                END IF;

                -- Process Shifts
                FOR v_ts IN SELECT * FROM template_shifts WHERE subgroup_id = v_tsg.id LOOP
                    
                    -- Calculate start_at
                    v_shift_start_timestamp := (v_curr_date || ' ' || v_ts.start_time)::timestamp AT TIME ZONE 'Australia/Sydney';
                    
                    -- Calculate end_at (handle overnight shifts)
                    IF v_ts.end_time < v_ts.start_time THEN
                        v_shift_end_timestamp := ((v_curr_date + 1) || ' ' || v_ts.end_time)::timestamp AT TIME ZONE 'Australia/Sydney';
                    ELSE
                        v_shift_end_timestamp := (v_curr_date || ' ' || v_ts.end_time)::timestamp AT TIME ZONE 'Australia/Sydney';
                    END IF;

                    -- Skip past shifts if today
                    IF v_curr_date = v_sydney_now::DATE THEN
                        IF v_ts.start_time < v_sydney_now::TIME THEN
                            v_shifts_skipped_today := v_shifts_skipped_today + 1;
                            v_shifts_skipped := v_shifts_skipped + 1;
                            CONTINUE;
                        END IF;
                    END IF;

                    -- Insert shift if not exists
                    IF NOT EXISTS (
                        SELECT 1 FROM shifts 
                        WHERE roster_id = v_roster_id 
                          AND template_instance_id = v_ts.id
                          AND shift_date = v_curr_date
                    ) THEN
                        INSERT INTO shifts (
                            roster_id, organization_id, department_id, sub_department_id,
                            role_id, shift_date, start_time, end_time,
                            start_at, end_at, tz_identifier,
                            paid_break_minutes, unpaid_break_minutes,
                            roster_template_id, template_instance_id, is_from_template,
                            roster_subgroup_id, group_type, sub_group_name,
                            template_group, template_sub_group,
                            lifecycle_status, notes, assigned_employee_id
                        )
                        VALUES (
                            v_roster_id, p_organization_id, v_template.department_id, v_template.sub_department_id,
                            v_ts.role_id, v_curr_date, v_ts.start_time, v_ts.end_time,
                            v_shift_start_timestamp, v_shift_end_timestamp, 'Australia/Sydney',
                            COALESCE(v_ts.paid_break_minutes, 0),
                            COALESCE(v_ts.unpaid_break_minutes, 0),
                            p_template_id, v_ts.id, true,
                            v_rsg_id, v_external_id::template_group_type, v_tsg.name,
                            v_external_id::template_group_type, v_tsg.name,
                            'Draft', v_ts.notes, v_ts.assigned_employee_id
                        )
                        RETURNING id INTO v_new_shift_id;

                        -- AUDIT: record the shift's origin (CREATED anchor)
                        INSERT INTO public.shift_events (
                            shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain
                        ) VALUES (
                            v_new_shift_id,
                            v_ts.assigned_employee_id,
                            auth.uid(),
                            'OP_APPLIED'::public.shift_event_type,
                            jsonb_build_object(
                                'op', 'create',
                                'domain', 'lifecycle',
                                'from_state', NULL,
                                'to_state', CASE WHEN v_ts.assigned_employee_id IS NOT NULL THEN 'S2' ELSE 'S1' END,
                                'source', 'apply_monthly_template',
                                'creation_source', 'template',
                                'assigned_employee_id', v_ts.assigned_employee_id
                            ),
                            CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'manager' END,
                            'lifecycle'
                        );

                        v_shifts_created := v_shifts_created + 1;
                    END IF;
                END LOOP; -- shifts
            END LOOP; -- subgroups
        END LOOP; -- groups

        v_days_processed := v_days_processed + 1;
        v_curr_date := v_curr_date + 1;
    END LOOP;

    -- Reset the gateway guard
    PERFORM set_config('app.audit.via_gateway', '0', true);

    -- 4. Update template status to published
    -- FIRST: Unpublish any other templates for the same month/scope to avoid unique constraint violations
    UPDATE roster_templates
    SET status = 'draft',
        published_at = NULL,
        published_by = NULL
    WHERE organization_id = p_organization_id
      AND department_id = v_template.department_id
      AND sub_department_id = COALESCE(v_template.sub_department_id, '00000000-0000-0000-0000-000000000000') -- Handle null sub_department
      AND published_month = p_month
      AND status = 'published'
      AND id <> p_template_id;

    -- SECOND: Set current template to published
    UPDATE roster_templates 
    SET status = 'published', 
        published_at = NOW(),
        published_by = auth.uid(),
        published_month = p_month,
        start_date = v_start_date,
        end_date = v_end_date
    WHERE id = p_template_id;

    RETURN jsonb_build_object(
        'success', true, 
        'days_processed', v_days_processed,
        'shifts_created', v_shifts_created,
        'shifts_skipped', jsonb_build_object(
            'total', v_shifts_skipped,
            'PAST_DATE', v_shifts_skipped_past,
            'PAST_TIME_TODAY', v_shifts_skipped_today
        )
    );
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. apply_monthly_template — overload 2: (template_id, org_id, month text)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "public"."apply_monthly_template"("p_template_id" "uuid", "p_organization_id" "uuid", "p_month" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
    v_start_date DATE;
    v_end_date DATE;
    v_curr_date DATE;
    v_template RECORD;
    v_roster_id UUID;
    v_tg RECORD;
    v_tsg RECORD;
    v_ts RECORD;
    v_rg_id UUID;
    v_rsg_id UUID;
    v_external_id TEXT;
    v_days_processed INTEGER := 0;
    v_shifts_created INTEGER := 0;
    v_shifts_skipped INTEGER := 0;
    v_shifts_skipped_past INTEGER := 0;
    v_shifts_skipped_today INTEGER := 0;
    v_shift_start_time TIME;
    v_sydney_now TIMESTAMPTZ;
    v_new_shift_id UUID;  -- AUDIT: capture inserted shift id
BEGIN
    -- 1. Calculate start and end dates for the month
    BEGIN
        v_start_date := (p_month || '-01')::DATE;
        v_end_date := (v_start_date + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid month format. Expected YYYY-MM');
    END;

    -- 2. Get Template info
    SELECT * INTO v_template FROM roster_templates WHERE id = p_template_id;
    IF v_template IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template not found');
    END IF;

    -- AUDIT DE-DUP: suppress trigger INSERT-branch while we write our own create events.
    PERFORM set_config('app.audit.via_gateway', '1', true);

    -- 3. Loop through days
    v_curr_date := v_start_date;
    WHILE v_curr_date <= v_end_date LOOP
        
        -- Get current Sydney time once per day loop
        v_sydney_now := NOW() AT TIME ZONE 'Australia/Sydney';

        -- STRICT LOCK: Skip past dates
        IF v_curr_date < CURRENT_DATE THEN
            v_shifts_skipped := v_shifts_skipped + 1;
            v_shifts_skipped_past := v_shifts_skipped_past + 1;
            v_curr_date := v_curr_date + 1;
            CONTINUE;
        END IF;
        
        -- Get roster entry (Removed auto-creation)
        SELECT id INTO v_roster_id FROM rosters
        WHERE start_date = v_curr_date 
          AND department_id = v_template.department_id 
          AND organization_id = p_organization_id
        LIMIT 1;

        -- If not exists, skip this day
        IF v_roster_id IS NULL THEN
            v_days_processed := v_days_processed + 1;
            v_curr_date := v_curr_date + 1;
            CONTINUE;
        END IF;

        -- Process hierarchy: Groups -> SubGroups -> Shifts
        FOR v_tg IN SELECT * FROM template_groups WHERE template_id = p_template_id ORDER BY sort_order LOOP
            
            -- Determine External ID (for legacy mapping)
            v_external_id := CASE LOWER(REPLACE(v_tg.name, ' ', '_'))
                WHEN 'convention_centre' THEN 'convention_centre'
                WHEN 'exhibition_centre' THEN 'exhibition_centre'
                WHEN 'theatre' THEN 'theatre'
                ELSE NULL
            END;

            -- Create Roster Group
            SELECT id INTO v_rg_id FROM roster_groups WHERE roster_id = v_roster_id AND name = v_tg.name LIMIT 1;
            IF v_rg_id IS NULL THEN
                INSERT INTO roster_groups (roster_id, name, sort_order, external_id)
                VALUES (v_roster_id, v_tg.name, v_tg.sort_order, v_external_id)
                RETURNING id INTO v_rg_id;
            END IF;

            -- Process SubGroups
            FOR v_tsg IN SELECT * FROM template_subgroups WHERE group_id = v_tg.id ORDER BY sort_order LOOP
                
                -- Create Roster SubGroup
                SELECT id INTO v_rsg_id FROM roster_subgroups WHERE roster_group_id = v_rg_id AND name = v_tsg.name LIMIT 1;
                IF v_rsg_id IS NULL THEN
                    INSERT INTO roster_subgroups (roster_group_id, name, sort_order)
                    VALUES (v_rg_id, v_tsg.name, v_tsg.sort_order)
                    RETURNING id INTO v_rsg_id;
                END IF;

                -- Process Shifts
                FOR v_ts IN SELECT * FROM template_shifts WHERE subgroup_id = v_tsg.id LOOP
                    
                    -- Skip past shifts if today
                    IF v_curr_date = v_sydney_now::DATE THEN
                        IF v_ts.start_time < v_sydney_now::TIME THEN
                            v_shifts_skipped_today := v_shifts_skipped_today + 1;
                            v_shifts_skipped := v_shifts_skipped + 1;
                            CONTINUE;
                        END IF;
                    END IF;

                    -- Insert shift if not exists
                    IF NOT EXISTS (
                        SELECT 1 FROM shifts 
                        WHERE roster_id = v_roster_id 
                          AND template_instance_id = v_ts.id
                          AND shift_date = v_curr_date
                    ) THEN
                        INSERT INTO shifts (
                            roster_id, organization_id, department_id, sub_department_id,
                            role_id, shift_date, start_time, end_time,
                            paid_break_minutes, unpaid_break_minutes,
                            roster_template_id, template_instance_id, is_from_template,
                            roster_subgroup_id, group_type, sub_group_name,
                            template_group, template_sub_group,
                            lifecycle_status, notes, assigned_employee_id
                        )
                        VALUES (
                            v_roster_id, p_organization_id, v_template.department_id, v_template.sub_department_id,
                            v_ts.role_id, v_curr_date, v_ts.start_time, v_ts.end_time,
                            COALESCE(v_ts.paid_break_minutes, 0),
                            COALESCE(v_ts.unpaid_break_minutes, 0),
                            p_template_id, v_ts.id, true,
                            v_rsg_id, v_external_id::template_group_type, v_tsg.name,
                            v_external_id::template_group_type, v_tsg.name,
                            'Draft', v_ts.notes, v_ts.assigned_employee_id
                        )
                        RETURNING id INTO v_new_shift_id;

                        -- AUDIT: record the shift's origin (CREATED anchor)
                        INSERT INTO public.shift_events (
                            shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain
                        ) VALUES (
                            v_new_shift_id,
                            v_ts.assigned_employee_id,
                            auth.uid(),
                            'OP_APPLIED'::public.shift_event_type,
                            jsonb_build_object(
                                'op', 'create',
                                'domain', 'lifecycle',
                                'from_state', NULL,
                                'to_state', CASE WHEN v_ts.assigned_employee_id IS NOT NULL THEN 'S2' ELSE 'S1' END,
                                'source', 'apply_monthly_template',
                                'creation_source', 'template',
                                'assigned_employee_id', v_ts.assigned_employee_id
                            ),
                            CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'manager' END,
                            'lifecycle'
                        );

                        v_shifts_created := v_shifts_created + 1;
                    END IF;
                END LOOP; -- shifts
            END LOOP; -- subgroups
        END LOOP; -- groups

        v_days_processed := v_days_processed + 1;
        v_curr_date := v_curr_date + 1;
    END LOOP;

    -- Reset the gateway guard
    PERFORM set_config('app.audit.via_gateway', '0', true);

    -- 4. Update template status to published
    UPDATE roster_templates 
    SET status = 'published', 
        published_at = NOW(),
        published_by = auth.uid(),
        published_month = p_month,
        start_date = v_start_date,
        end_date = v_end_date
    WHERE id = p_template_id;

    RETURN jsonb_build_object(
        'success', true, 
        'days_processed', v_days_processed,
        'shifts_created', v_shifts_created,
        'shifts_skipped', jsonb_build_object(
            'total', v_shifts_skipped,
            'PAST_DATE', v_shifts_skipped_past,
            'PAST_TIME_TODAY', v_shifts_skipped_today
        )
    );
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. apply_monthly_template — overload 3: (template_id, month varchar, org_id)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "public"."apply_monthly_template"("p_template_id" "uuid", "p_month" character varying, "p_organization_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
    v_template RECORD;
    v_start_date DATE;
    v_end_date DATE;
    v_curr_date DATE;
    v_roster_id UUID;
    v_batch_id UUID;
    v_tg RECORD;
    v_tsg RECORD;
    v_ts RECORD; -- template_shift
    v_rg_id UUID; -- roster_group_id
    v_rsg_id UUID; -- roster_subgroup_id
    v_shifts_created INTEGER := 0;
    v_days_processed INTEGER := 0;
    v_shift_start_timestamp TIMESTAMPTZ;
    v_shift_end_timestamp TIMESTAMPTZ;
    v_external_id TEXT;
    v_new_shift_id UUID;  -- AUDIT: capture inserted shift id
BEGIN
    -- 1. Get Template info
    SELECT * INTO v_template FROM roster_templates WHERE id = p_template_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template not found');
    END IF;

    -- 2. Calculate dates for the month
    v_start_date := (p_month || '-01')::DATE;
    v_end_date := (v_start_date + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

    -- 3. UNPUBLISH EXISTING (NULL-safe)
    -- This handles the 409 conflict by setting previous published templates back to draft
    UPDATE roster_templates
    SET status = 'draft',
        published_at = NULL,
        published_by = NULL
    WHERE organization_id = p_organization_id
      AND department_id = v_template.department_id
      AND sub_department_id IS NOT DISTINCT FROM v_template.sub_department_id
      AND published_month = p_month
      AND status = 'published'
      AND id <> p_template_id;

    -- 4. Publish current template record
    UPDATE roster_templates 
    SET status = 'published', 
        published_at = NOW(),
        published_by = auth.uid(),
        published_month = p_month,
        start_date = v_start_date,
        end_date = v_end_date
    WHERE id = p_template_id;

    -- 5. Create Batch Record for Tracking/Undo
    INSERT INTO roster_template_batches (
        template_id, 
        start_date, 
        end_date, 
        source, 
        applied_by
    )
    VALUES (
        p_template_id, 
        v_start_date, 
        v_end_date, 
        'periodic_publish', 
        auth.uid()
    )
    RETURNING id INTO v_batch_id;

    -- AUDIT DE-DUP: suppress trigger INSERT-branch while we write our own create events.
    PERFORM set_config('app.audit.via_gateway', '1', true);

    -- 6. Loop through date range
    v_curr_date := v_start_date;
    WHILE v_curr_date <= v_end_date LOOP

        -- A. Create or get roster (NULL-safe lookup)
        SELECT id INTO v_roster_id FROM rosters
        WHERE start_date = v_curr_date 
          AND department_id = v_template.department_id 
          AND sub_department_id IS NOT DISTINCT FROM v_template.sub_department_id
        LIMIT 1;

        -- If not exists, create it
        IF v_roster_id IS NULL THEN
            INSERT INTO rosters (
                start_date, end_date, template_id, organization_id,
                department_id, sub_department_id,
                description,
                status, is_locked, created_by
            )
            VALUES (
                v_curr_date, v_curr_date, p_template_id, v_template.organization_id,
                v_template.department_id, v_template.sub_department_id,
                v_template.description,
                'draft', false, auth.uid()
            )
            RETURNING id INTO v_roster_id;
        END IF;

        -- B. Loop through Template Groups
        FOR v_tg IN SELECT * FROM template_groups WHERE template_id = p_template_id ORDER BY sort_order LOOP

            -- DETERMINE EXTERNAL ID
            v_external_id := CASE LOWER(REPLACE(v_tg.name, ' ', '_'))
                WHEN 'convention_centre' THEN 'convention_centre'
                WHEN 'exhibition_centre' THEN 'exhibition_centre'
                WHEN 'theatre' THEN 'theatre'
                ELSE NULL
            END;

            -- Create Roster Group (Idempotent check)
            v_rg_id := NULL;
            SELECT id INTO v_rg_id FROM roster_groups 
            WHERE roster_id = v_roster_id 
              AND (name = v_tg.name OR (external_id IS NOT NULL AND external_id = v_external_id))
            LIMIT 1;

            IF v_rg_id IS NULL THEN
                INSERT INTO roster_groups (roster_id, name, sort_order, external_id)
                VALUES (v_roster_id, v_tg.name, v_tg.sort_order, v_external_id)
                RETURNING id INTO v_rg_id;
            ELSE
                 UPDATE roster_groups 
                 SET external_id = COALESCE(external_id, v_external_id),
                     sort_order = LEAST(sort_order, v_tg.sort_order)
                 WHERE id = v_rg_id;
            END IF;

            -- C. Loop through Template SubGroups
            FOR v_tsg IN SELECT * FROM template_subgroups WHERE group_id = v_tg.id ORDER BY sort_order LOOP

                -- Create Roster SubGroup
                v_rsg_id := NULL;
                SELECT id INTO v_rsg_id FROM roster_subgroups WHERE roster_group_id = v_rg_id AND name = v_tsg.name LIMIT 1;

                IF v_rsg_id IS NULL THEN
                    INSERT INTO roster_subgroups (roster_group_id, name, sort_order)
                    VALUES (v_rg_id, v_tsg.name, v_tsg.sort_order)
                    RETURNING id INTO v_rsg_id;
                END IF;

                -- D. Loop through Template Shifts
                FOR v_ts IN SELECT * FROM template_shifts WHERE subgroup_id = v_tsg.id LOOP

                    -- Calculate timestamps
                    v_shift_start_timestamp := (v_curr_date || ' ' || v_ts.start_time)::timestamp AT TIME ZONE 'Australia/Sydney';
                    IF v_ts.end_time < v_ts.start_time THEN
                        v_shift_end_timestamp := ((v_curr_date + 1) || ' ' || v_ts.end_time)::timestamp AT TIME ZONE 'Australia/Sydney';
                    ELSE
                        v_shift_end_timestamp := (v_curr_date || ' ' || v_ts.end_time)::timestamp AT TIME ZONE 'Australia/Sydney';
                    END IF;

                    -- Check duplicates
                    IF NOT EXISTS (
                        SELECT 1 FROM shifts
                        WHERE roster_id = v_roster_id
                          AND template_instance_id = v_ts.id
                          AND deleted_at IS NULL
                    ) THEN
                        INSERT INTO shifts (
                            roster_id, organization_id, department_id, sub_department_id,
                            role_id, shift_date, start_time, end_time,
                            start_at, end_at, tz_identifier,
                            paid_break_minutes, unpaid_break_minutes,
                            template_id, template_instance_id, is_from_template,
                            template_batch_id,
                            roster_subgroup_id,
                            lifecycle_status, notes, assigned_employee_id
                        )
                        VALUES (
                            v_roster_id, v_template.organization_id, v_template.department_id, v_template.sub_department_id,
                            v_ts.role_id, v_curr_date, v_ts.start_time, v_ts.end_time,
                            v_shift_start_timestamp, v_shift_end_timestamp, 'Australia/Sydney',
                            COALESCE(v_ts.paid_break_minutes, 0), COALESCE(v_ts.unpaid_break_minutes, 0),
                            p_template_id, v_ts.id, true,
                            v_batch_id,
                            v_rsg_id,
                            'Draft', v_ts.notes, v_ts.assigned_employee_id
                        )
                        RETURNING id INTO v_new_shift_id;

                        -- AUDIT: record the shift's origin (CREATED anchor)
                        INSERT INTO public.shift_events (
                            shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain
                        ) VALUES (
                            v_new_shift_id,
                            v_ts.assigned_employee_id,
                            auth.uid(),
                            'OP_APPLIED'::public.shift_event_type,
                            jsonb_build_object(
                                'op', 'create',
                                'domain', 'lifecycle',
                                'from_state', NULL,
                                'to_state', CASE WHEN v_ts.assigned_employee_id IS NOT NULL THEN 'S2' ELSE 'S1' END,
                                'source', 'apply_monthly_template',
                                'creation_source', 'template',
                                'assigned_employee_id', v_ts.assigned_employee_id
                            ),
                            CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'manager' END,
                            'lifecycle'
                        );

                        v_shifts_created := v_shifts_created + 1;
                    END IF;
                END LOOP; -- shifts
            END LOOP; -- subgroups
        END LOOP; -- groups

        v_days_processed := v_days_processed + 1;
        v_curr_date := v_curr_date + 1;
    END LOOP;

    -- Reset the gateway guard
    PERFORM set_config('app.audit.via_gateway', '0', true);

    RETURN jsonb_build_object(
        'success', true,
        'days_processed', v_days_processed,
        'shifts_created', v_shifts_created,
        'batch_id', v_batch_id
    );
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. apply_template_to_date_range (v1 legacy)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "public"."apply_template_to_date_range"("p_template_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_curr_date DATE;
  v_template RECORD;
  v_roster_id UUID;
  v_groups_json JSONB;
  v_group JSONB;
  v_subgroup JSONB;
  v_shift JSONB;
  v_days_processed INTEGER := 0;
  v_shifts_created INTEGER := 0;
  v_new_shift_id UUID;  -- AUDIT: capture inserted shift id
BEGIN
  IF p_start_date > p_end_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'Start date must be before end date');
  END IF;

  SELECT * INTO v_template FROM v_template_full WHERE id = p_template_id;
  IF v_template IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Template not found');
  END IF;

  v_groups_json := COALESCE(v_template.groups::jsonb, '[]'::jsonb);

  -- AUDIT DE-DUP: suppress trigger INSERT-branch while we write our own create events.
  PERFORM set_config('app.audit.via_gateway', '1', true);

  v_curr_date := p_start_date;
  WHILE v_curr_date <= p_end_date LOOP
      IF v_curr_date < CURRENT_DATE THEN
          v_curr_date := v_curr_date + 1;
          CONTINUE;
      END IF;

      BEGIN
          INSERT INTO rosters (start_date, end_date, template_id, organization_id, department_id, sub_department_id, description, status, is_locked, created_by)
          VALUES (v_curr_date, v_curr_date, p_template_id, v_template.organization_id, v_template.department_id, v_template.sub_department_id, v_template.description, 'draft', false, p_user_id)
          RETURNING id INTO v_roster_id;
      EXCEPTION WHEN unique_violation THEN
          SELECT id INTO v_roster_id FROM rosters WHERE start_date = v_curr_date AND department_id = v_template.department_id AND (sub_department_id IS NULL OR sub_department_id = v_template.sub_department_id);
      END;

      FOR v_group IN SELECT * FROM jsonb_array_elements(v_groups_json) LOOP
          IF v_group->'subGroups' IS NOT NULL AND jsonb_typeof(v_group->'subGroups') = 'array' THEN
              FOR v_subgroup IN SELECT * FROM jsonb_array_elements(v_group->'subGroups') LOOP
                  IF v_subgroup->'shifts' IS NOT NULL AND jsonb_typeof(v_subgroup->'shifts') = 'array' THEN
                      FOR v_shift IN SELECT * FROM jsonb_array_elements(v_subgroup->'shifts') LOOP
                          IF NOT EXISTS (SELECT 1 FROM shifts WHERE roster_id = v_roster_id AND template_id = p_template_id AND template_instance_id = (v_shift->>'id')::uuid AND shift_date = v_curr_date AND deleted_at IS NULL) THEN
                              INSERT INTO shifts (
                                  roster_id, organization_id, department_id, sub_department_id, role_id, shift_date, start_time, end_time, 
                                  paid_break_minutes, unpaid_break_minutes, template_id, template_instance_id, is_from_template, 
                                  group_type, sub_group_name, template_group, template_sub_group, lifecycle_status, notes, assigned_employee_id
                              )
                              VALUES (
                                  v_roster_id, v_template.organization_id, v_template.department_id, v_template.sub_department_id, (v_shift->>'roleId')::uuid, v_curr_date, (v_shift->>'startTime')::time, (v_shift->>'endTime')::time,
                                  COALESCE((v_shift->>'paidBreakDuration')::integer, 0), COALESCE((v_shift->>'unpaidBreakDuration')::integer, 0), p_template_id, (v_shift->>'id')::uuid, true,
                                  CASE LOWER(REPLACE(v_group->>'name', ' ', '_'))
                                      WHEN 'convention_centre' THEN 'convention_centre'::template_group_type
                                      WHEN 'exhibition_centre' THEN 'exhibition_centre'::template_group_type
                                      WHEN 'theatre' THEN 'theatre'::template_group_type
                                      ELSE NULL
                                  END,
                                  v_subgroup->>'name',
                                  CASE LOWER(REPLACE(v_group->>'name', ' ', '_'))
                                      WHEN 'convention_centre' THEN 'convention_centre'::template_group_type
                                      WHEN 'exhibition_centre' THEN 'exhibition_centre'::template_group_type
                                      WHEN 'theatre' THEN 'theatre'::template_group_type
                                      ELSE NULL
                                  END,
                                  v_subgroup->>'name',
                                  'Draft',
                                  v_shift->>'notes',
                                  CASE WHEN v_shift->>'assignedEmployeeId' IS NOT NULL AND v_shift->>'assignedEmployeeId' != '' AND v_shift->>'assignedEmployeeId' != 'null' THEN (v_shift->>'assignedEmployeeId')::uuid ELSE NULL END
                              )
                              RETURNING id INTO v_new_shift_id;

                              -- AUDIT: record the shift's origin (CREATED anchor)
                              INSERT INTO public.shift_events (
                                  shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain
                              ) VALUES (
                                  v_new_shift_id,
                                  CASE WHEN v_shift->>'assignedEmployeeId' IS NOT NULL AND v_shift->>'assignedEmployeeId' != '' AND v_shift->>'assignedEmployeeId' != 'null' THEN (v_shift->>'assignedEmployeeId')::uuid ELSE NULL END,
                                  p_user_id,
                                  'OP_APPLIED'::public.shift_event_type,
                                  jsonb_build_object(
                                      'op', 'create',
                                      'domain', 'lifecycle',
                                      'from_state', NULL,
                                      'to_state', CASE WHEN v_shift->>'assignedEmployeeId' IS NOT NULL AND v_shift->>'assignedEmployeeId' != '' AND v_shift->>'assignedEmployeeId' != 'null' THEN 'S2' ELSE 'S1' END,
                                      'source', 'apply_template_to_date_range',
                                      'creation_source', 'template'
                                  ),
                                  CASE WHEN p_user_id IS NULL THEN 'system' ELSE 'manager' END,
                                  'lifecycle'
                              );

                              v_shifts_created := v_shifts_created + 1;
                          END IF;
                      END LOOP;
                  END IF;
              END LOOP;
          END IF;
      END LOOP;
      v_days_processed := v_days_processed + 1;
      v_curr_date := v_curr_date + 1;
  END LOOP;

  -- Reset the gateway guard
  PERFORM set_config('app.audit.via_gateway', '0', true);

  RETURN jsonb_build_object('success', true, 'days_processed', v_days_processed, 'shifts_created', v_shifts_created);
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. clone_roster_subgroup (single-subgroup clone)
--    Clones with assigned_employee_id = NULL, so the trigger INSERT branch
--    never fires — no gateway guard needed.  Use CTE + bulk event INSERT.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "public"."clone_roster_subgroup"("p_subgroup_id" "uuid", "p_new_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_source_subgroup record;
    v_new_subgroup_id uuid;
BEGIN
    -- 1. Get source subgroup info
    SELECT * INTO v_source_subgroup FROM public.roster_subgroups WHERE id = p_subgroup_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Subgroup not found';
    END IF;

    -- 2. Create new subgroup (place it right after the source in sort order)
    INSERT INTO public.roster_subgroups (roster_group_id, name, sort_order)
    VALUES (v_source_subgroup.roster_group_id, p_new_name, v_source_subgroup.sort_order + 1)
    RETURNING id INTO v_new_subgroup_id;

    -- 3. Clone shifts + AUDIT: emit create events for each cloned shift
    -- Note: We clear assigned_employee_id so clones start as unassigned
    WITH inserted AS (
        INSERT INTO public.shifts (
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
        SELECT 
            roster_id, organization_id, department_id, sub_department_id,
            role_id, shift_date, start_time, end_time,
            start_at, end_at, tz_identifier,
            paid_break_minutes, unpaid_break_minutes,
            template_id, template_instance_id, is_from_template,
            template_batch_id,
            v_new_subgroup_id,
            group_type,
            p_new_name,
            template_group,
            p_new_name,
            'Draft', notes, NULL,
            created_by_user_id,
            required_skills,
            required_licenses,
            event_tags,
            event_ids
        FROM public.shifts
        WHERE roster_subgroup_id = p_subgroup_id AND deleted_at IS NULL
        RETURNING id, created_by_user_id
    )
    INSERT INTO public.shift_events (
        shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain
    )
    SELECT
        i.id,
        NULL,  -- cloned shifts are unassigned
        COALESCE(i.created_by_user_id, auth.uid()),
        'OP_APPLIED'::public.shift_event_type,
        jsonb_build_object(
            'op', 'create',
            'domain', 'lifecycle',
            'from_state', NULL,
            'to_state', 'S1',
            'source', 'clone_roster_subgroup',
            'creation_source', 'sub-group cloning',
            'cloned_from_subgroup', p_subgroup_id
        ),
        CASE WHEN COALESCE(i.created_by_user_id, auth.uid()) IS NULL THEN 'system' ELSE 'manager' END,
        'lifecycle'
    FROM inserted i;

    RETURN v_new_subgroup_id;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. clone_roster_subgroup_v2 (date-range clone)
--    Inserts with assigned_employee_id absent (defaults to NULL), so the
--    trigger INSERT branch never fires — no gateway guard needed.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "public"."clone_roster_subgroup_v2"("p_org_id" "uuid", "p_dept_id" "uuid", "p_group_external_id" "text", "p_source_name" "text", "p_new_name" "text", "p_start_date" "date", "p_end_date" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_current_date DATE;
    v_roster_id UUID;
    v_rg_id UUID;
    v_source_subgroup_id UUID;
    v_new_subgroup_id UUID;
BEGIN
    v_current_date := p_start_date;
    WHILE v_current_date <= p_end_date LOOP
        -- Find roster for this date
        SELECT r.id INTO v_roster_id
        FROM rosters r
        WHERE r.start_date = v_current_date
          AND r.department_id = p_dept_id
          AND r.organization_id = p_org_id
        LIMIT 1;

        IF v_roster_id IS NOT NULL THEN
            -- Find the roster group
            SELECT rg.id INTO v_rg_id
            FROM roster_groups rg
            WHERE rg.roster_id = v_roster_id
              AND rg.external_id = p_group_external_id
            LIMIT 1;

            IF v_rg_id IS NOT NULL THEN
                -- Check if source subgroup exists
                SELECT rs.id INTO v_source_subgroup_id
                FROM roster_subgroups rs
                WHERE rs.roster_group_id = v_rg_id
                  AND rs.name = p_source_name
                LIMIT 1;

                IF v_source_subgroup_id IS NOT NULL THEN
                    -- Create or find the new subgroup
                    SELECT rs.id INTO v_new_subgroup_id
                    FROM roster_subgroups rs
                    WHERE rs.roster_group_id = v_rg_id
                      AND rs.name = p_new_name
                    LIMIT 1;

                    IF v_new_subgroup_id IS NULL THEN
                        INSERT INTO public.roster_subgroups (roster_group_id, name, sort_order)
                        VALUES (v_rg_id, p_new_name, 999)
                        RETURNING id INTO v_new_subgroup_id;
                    END IF;

                    -- C. Clone Shifts + AUDIT: emit create events
                    -- Using sub_group_name for source matching allows cloning adhoc subgroups too
                    WITH inserted AS (
                        INSERT INTO public.shifts (
                            roster_id,
                            roster_subgroup_id,
                            sub_group_name,
                            group_type,
                            shift_date,
                            start_time,
                            end_time,
                            role_id,
                            required_skills,
                            required_licenses,
                            event_tags,
                            notes,
                            lifecycle_status,
                            is_locked,
                            organization_id,
                            department_id,
                            sub_department_id,
                            timezone,
                            creation_source
                        )
                        SELECT 
                            roster_id,
                            v_new_subgroup_id, -- Link to new subgroup
                            p_new_name,        -- New name
                            group_type,
                            shift_date,
                            start_time,
                            end_time,
                            role_id,
                            required_skills,
                            required_licenses,
                            event_tags,
                            notes,
                            'Draft',          -- lifecycle_status = 'Draft'
                            false,            -- Not locked
                            organization_id,
                            department_id,
                            sub_department_id,
                            timezone,
                            'sub-group cloning' -- creation_source
                        FROM public.shifts
                        WHERE roster_id = v_roster_id 
                          AND sub_group_name = p_source_name
                        RETURNING id
                    )
                    INSERT INTO public.shift_events (
                        shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain
                    )
                    SELECT
                        i.id,
                        NULL,  -- cloned shifts are unassigned
                        auth.uid(),
                        'OP_APPLIED'::public.shift_event_type,
                        jsonb_build_object(
                            'op', 'create',
                            'domain', 'lifecycle',
                            'from_state', NULL,
                            'to_state', 'S1',
                            'source', 'clone_roster_subgroup_v2',
                            'creation_source', 'sub-group cloning',
                            'cloned_from_subgroup', p_source_name
                        ),
                        CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'manager' END,
                        'lifecycle'
                    FROM inserted i;
                END IF;
            END IF;
        END IF;

        v_current_date := v_current_date + 1;
    END LOOP;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2: BACKFILL — synthesize create events for existing shifts
-- ═══════════════════════════════════════════════════════════════════════════
-- Covers every shift (template, seed, cloned, or otherwise) that currently
-- has no op:'create' row in shift_events.  Uses shifts.created_at as the
-- event timestamp so the timeline anchor is chronologically accurate.
--
-- ON CONFLICT safety net: the uniq_shift_event constraint is
-- (shift_id, employee_id, event_type, event_time).  NULLs in employee_id
-- are treated as distinct by Postgres, so collisions for unassigned shifts
-- are theoretically impossible, but we guard anyway.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.shift_events (
    shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain
)
SELECT
    s.id,
    s.assigned_employee_id,
    s.created_by_user_id,
    'OP_APPLIED'::public.shift_event_type,
    s.created_at,
    jsonb_build_object(
        'op', 'create',
        'domain', 'lifecycle',
        'from_state', NULL,
        'to_state', CASE WHEN s.assigned_employee_id IS NOT NULL THEN 'S2' ELSE 'S1' END,
        'source', 'backfill_20260707_create_event',
        'creation_source', COALESCE(s.creation_source,
            CASE WHEN s.is_from_template THEN 'template' ELSE 'unknown' END)
    ),
    CASE WHEN s.created_by_user_id IS NULL THEN 'system' ELSE 'manager' END,
    'lifecycle'
FROM public.shifts s
WHERE s.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.shift_events se
      WHERE se.shift_id = s.id
        AND se.event_type = 'OP_APPLIED'
        AND se.metadata->>'op' = 'create'
  )
ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
