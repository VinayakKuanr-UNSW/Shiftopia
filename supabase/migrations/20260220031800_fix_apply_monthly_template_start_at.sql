-- Update the apply_monthly_template RPC to compute and insert start_at and end_at

CREATE OR REPLACE FUNCTION public.apply_monthly_template(
    p_organization_id UUID,
    p_month TEXT,
    p_template_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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
