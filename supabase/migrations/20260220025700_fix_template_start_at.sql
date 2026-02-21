-- Update the apply_template_to_date_range_v2 RPC to include start_at and end_at

CREATE OR REPLACE FUNCTION public.apply_template_to_date_range_v2(
    p_template_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_user_id UUID,
    p_force_override BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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
    v_shift_end_timestamp TIMESTAMPTZ;
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

                    -- Calculate start_at
                    v_shift_start_timestamp := (v_curr_date || ' ' || v_ts.start_time)::timestamp AT TIME ZONE 'Australia/Sydney';
                    
                    -- Calculate end_at (handle overnight shifts)
                    IF v_ts.end_time < v_ts.start_time THEN
                        v_shift_end_timestamp := ((v_curr_date + 1) || ' ' || v_ts.end_time)::timestamp AT TIME ZONE 'Australia/Sydney';
                    ELSE
                        v_shift_end_timestamp := (v_curr_date || ' ' || v_ts.end_time)::timestamp AT TIME ZONE 'Australia/Sydney';
                    END IF;

                    -- TEMPORAL CHECK: Skip if shift start time has passed (Sydney Time)
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
                            start_at, end_at, tz_identifier,
                            paid_break_minutes, unpaid_break_minutes,
                            template_id, template_instance_id, is_from_template,
                            roster_subgroup_id, group_type, sub_group_name,
                            template_group, template_sub_group,
                            lifecycle_status, notes, assigned_employee_id
                        )
                        VALUES (
                            v_roster_id, v_template.organization_id, v_template.department_id, v_template.sub_department_id,
                            v_ts.role_id, v_curr_date, v_ts.start_time, v_ts.end_time,
                            v_shift_start_timestamp, v_shift_end_timestamp, 'Australia/Sydney',
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
