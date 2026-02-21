-- Migration: Remove is_draft from Template application RPCs
-- Date: 2026-02-20

CREATE OR REPLACE FUNCTION apply_template_to_date_range_v2(
    p_template_id uuid,
    p_start_date date,
    p_end_date date,
    p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_curr_date DATE;
    v_template RECORD;
    v_roster_id UUID;
    v_tg RECORD;
    v_tsg RECORD;
    v_ts RECORD; -- template_shift
    v_rg_id UUID; -- roster_group_id
    v_rsg_id UUID; -- roster_subgroup_id
    v_days_processed INTEGER := 0;
    v_shifts_created INTEGER := 0;
    v_sydney_now TIMESTAMPTZ;
    v_shift_start_timestamp TIMESTAMPTZ;
    v_external_id TEXT;
BEGIN
    -- Get Template info
    SELECT * INTO v_template FROM roster_templates WHERE id = p_template_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template not found');
    END IF;

    -- Loop through date range
    v_curr_date := p_start_date;
    WHILE v_curr_date <= p_end_date LOOP

        -- Get current Sydney time once per day loop
        v_sydney_now := NOW() AT TIME ZONE 'Australia/Sydney';

        -- STRICT LOCK: Skip past dates
        IF v_curr_date < CURRENT_DATE THEN
            v_curr_date := v_curr_date + 1;
            CONTINUE;
        END IF;

        -- A. Create or get roster (Removed redundant columns 'date' and 'name')
        v_roster_id := NULL;
        IF v_template.sub_department_id IS NULL THEN
            SELECT id INTO v_roster_id FROM rosters
            WHERE start_date = v_curr_date 
              AND department_id = v_template.department_id 
              AND sub_department_id IS NULL
            LIMIT 1;
        ELSE
            SELECT id INTO v_roster_id FROM rosters
            WHERE start_date = v_curr_date 
              AND department_id = v_template.department_id 
              AND sub_department_id = v_template.sub_department_id
            LIMIT 1;
        END IF;

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
                'draft', false, p_user_id
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

            -- Create Roster Group (Idempotent check by name OR external_id)
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
                 -- Update metadata if found existing group
                 UPDATE roster_groups 
                 SET external_id = COALESCE(external_id, v_external_id),
                     sort_order = LEAST(sort_order, v_tg.sort_order)
                 WHERE id = v_rg_id;
            END IF;

            -- C. Loop through Template SubGroups
            FOR v_tsg IN SELECT * FROM template_subgroups WHERE group_id = v_tg.id ORDER BY sort_order LOOP

                -- Create Roster SubGroup (Check existence by name)
                v_rsg_id := NULL;
                SELECT id INTO v_rsg_id FROM roster_subgroups WHERE roster_group_id = v_rg_id AND name = v_tsg.name LIMIT 1;

                IF v_rsg_id IS NULL THEN
                    INSERT INTO roster_subgroups (roster_group_id, name, sort_order)
                    VALUES (v_rg_id, v_tsg.name, v_tsg.sort_order)
                    RETURNING id INTO v_rsg_id;
                END IF;

                -- D. Loop through Template Shifts
                FOR v_ts IN SELECT * FROM template_shifts WHERE subgroup_id = v_tsg.id LOOP

                    -- TEMPORAL CHECK: Skip if shift start time has passed (Sydney Time)
                    v_shift_start_timestamp := (v_curr_date || ' ' || v_ts.start_time)::timestamp AT TIME ZONE 'Australia/Sydney';

                    IF v_shift_start_timestamp < v_sydney_now THEN
                        CONTINUE; -- Skip this shift
                    END IF;

                    -- Check duplicates (scoped to roster_id and template_instance_id)
                    IF NOT EXISTS (
                        SELECT 1 FROM shifts
                        WHERE roster_id = v_roster_id
                          AND template_instance_id = v_ts.id
                          AND deleted_at IS NULL
                    ) THEN
                        INSERT INTO shifts (
                            roster_id, organization_id, department_id, sub_department_id,
                            role_id, shift_date, start_time, end_time,
                            paid_break_minutes, unpaid_break_minutes,
                            template_id, template_instance_id, is_from_template,
                            roster_subgroup_id, group_type, sub_group_name,
                            template_group, template_sub_group,
                            lifecycle_status, notes, assigned_employee_id
                        )
                        VALUES (
                            v_roster_id, v_template.organization_id, v_template.department_id, v_template.sub_department_id,
                            v_ts.role_id, v_curr_date, v_ts.start_time, v_ts.end_time,
                            COALESCE(v_ts.paid_break_minutes, 0), COALESCE(v_ts.unpaid_break_minutes, 0),
                            p_template_id, v_ts.id, true,
                            v_rsg_id, v_external_id::template_group_type, v_tsg.name,
                            v_external_id::template_group_type, v_tsg.name,
                            'Draft', v_ts.notes, v_ts.assigned_employee_id
                        );

                        v_shifts_created := v_shifts_created + 1;
                    END IF;
                END LOOP; -- shifts
            END LOOP; -- subgroups
        END LOOP; -- groups

        v_days_processed := v_days_processed + 1;
        v_curr_date := v_curr_date + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'days_processed', v_days_processed,
        'shifts_created', v_shifts_created
    );
END;
$$;


CREATE OR REPLACE FUNCTION apply_monthly_template(
    p_template_id uuid,
    p_organization_id uuid,
    p_month text -- 'YYYY-MM'
) RETURNS jsonb
LANGUAGE plpgsql
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
        
        -- Create/Update roster entry (Removed redundant columns 'date' and 'name')
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
                        );
                        v_shifts_created := v_shifts_created + 1;
                    END IF;
                END LOOP; -- shifts
            END LOOP; -- subgroups
        END LOOP; -- groups

        v_days_processed := v_days_processed + 1;
        v_curr_date := v_curr_date + 1;
    END LOOP;

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
