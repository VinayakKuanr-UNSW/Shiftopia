-- Migration: Add datetime-level validation to apply_monthly_template
-- Date: 2026-01-23
-- Purpose: 
--   1. Skip shifts where start_datetime has already passed (not just date)
--   2. Track skip reasons: PAST_DATE, PAST_TIME_TODAY
--   3. Return detailed summary with applied/skipped counts

CREATE OR REPLACE FUNCTION apply_monthly_template(
    p_template_id UUID,
    p_organization_id UUID,
    p_month TEXT -- Format: 'YYYY-MM'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_start_date DATE;
    v_end_date DATE;
    v_curr_date DATE;
    v_template RECORD;
    v_roster_id UUID;
    v_groups_json JSONB;
    v_group JSONB;
    v_subgroup JSONB;
    v_shift JSONB;
    v_days_processed INTEGER := 0;
    v_shifts_created INTEGER := 0;
    -- NEW: Skip tracking
    v_skipped_past_date INTEGER := 0;
    v_skipped_past_time INTEGER := 0;
    v_current_timestamp TIMESTAMP;
    v_shift_start_timestamp TIMESTAMP;
    v_shift_start_time TIME;
BEGIN
    -- Get current timestamp in user's timezone (source of truth)
    v_current_timestamp := CURRENT_TIMESTAMP AT TIME ZONE 'Australia/Sydney';

    -- 1. Calculate start and end dates for the month
    BEGIN
        v_start_date := (p_month || '-01')::DATE;
        v_end_date := (v_start_date + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid month format. Expected YYYY-MM');
    END;

    -- 2. Get Template with its groups structure from the view
    SELECT * INTO v_template 
    FROM v_template_full 
    WHERE id = p_template_id;
    
    IF v_template IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template not found');
    END IF;

    -- 3. Get the groups JSON from template
    v_groups_json := COALESCE(v_template.groups::jsonb, '[]'::jsonb);

    -- 4. Loop through each day of the month
    v_curr_date := v_start_date;
    WHILE v_curr_date <= v_end_date LOOP
        
        -- RULE: Skip entire past dates (dates strictly before today)
        IF v_curr_date < v_current_timestamp::DATE THEN
            RAISE NOTICE '[SKIP] Past date: % (today is %)', v_curr_date, v_current_timestamp::DATE;
            -- Count shifts that would have been created for this date
            -- (We don't iterate through them, just skip the date)
            v_skipped_past_date := v_skipped_past_date + 1; -- Approximate: 1 per date
            v_curr_date := v_curr_date + 1;
            CONTINUE;
        END IF;
        
        -- A. Create or get roster for this day
        BEGIN
            INSERT INTO rosters (
                date,
                start_date,
                end_date,
                template_id,
                organization_id,
                department_id,
                sub_department_id,
                name,
                description,
                groups,
                status,
                is_locked,
                created_by
            )
            VALUES (
                v_curr_date,
                v_curr_date,
                v_curr_date,
                p_template_id,
                p_organization_id,
                v_template.department_id,
                v_template.sub_department_id,
                v_template.name || ' - ' || to_char(v_curr_date, 'DD Mon YYYY'),
                v_template.description,
                v_groups_json,
                'draft',
                false,
                auth.uid()
            )
            RETURNING id INTO v_roster_id;
        EXCEPTION WHEN unique_violation THEN
            -- Roster already exists, get its ID
            SELECT id INTO v_roster_id 
            FROM rosters 
            WHERE date = v_curr_date 
              AND department_id = v_template.department_id;
        END;

        -- B. Loop through groups
        FOR v_group IN SELECT * FROM jsonb_array_elements(v_groups_json)
        LOOP
            -- C. Loop through subGroups in each group (skip if null or empty)
            IF v_group->'subGroups' IS NOT NULL 
               AND jsonb_typeof(v_group->'subGroups') = 'array' THEN
                FOR v_subgroup IN SELECT * FROM jsonb_array_elements(v_group->'subGroups')
                LOOP
                    -- D. Loop through shifts in each subgroup (skip if null or empty)
                    IF v_subgroup->'shifts' IS NOT NULL 
                       AND jsonb_typeof(v_subgroup->'shifts') = 'array' THEN
                        FOR v_shift IN SELECT * FROM jsonb_array_elements(v_subgroup->'shifts')
                        LOOP
                            -- Extract shift start time
                            v_shift_start_time := (v_shift->>'startTime')::TIME;
                            
                            -- Build full datetime for this shift
                            v_shift_start_timestamp := v_curr_date + v_shift_start_time;
                            
                            -- ============================================
                            -- RULE 1: DateTime comparison (most important)
                            -- Skip if shift_start_datetime <= current_datetime
                            -- ============================================
                            IF v_shift_start_timestamp <= v_current_timestamp THEN
                                RAISE NOTICE '[SKIP] Shift start time already passed: % (now: %)', 
                                    v_shift_start_timestamp, v_current_timestamp;
                                v_skipped_past_time := v_skipped_past_time + 1;
                                CONTINUE; -- Skip to next shift
                            END IF;
                            
                            -- Check if this shift already exists (prevent duplicates on re-apply)
                            IF NOT EXISTS (
                                SELECT 1 FROM shifts 
                                WHERE roster_id = v_roster_id 
                                  AND template_id = p_template_id
                                  AND template_instance_id = (v_shift->>'id')::uuid
                                  AND shift_date = v_curr_date
                            ) THEN
                                -- Insert the shift
                                INSERT INTO shifts (
                                    roster_id,
                                    organization_id,
                                    department_id,
                                    sub_department_id,
                                    role_id,
                                    shift_date,
                                    start_time,
                                    end_time,
                                    paid_break_minutes,
                                    unpaid_break_minutes,
                                    template_id,
                                    template_instance_id,
                                    is_from_template,
                                    group_type,
                                    sub_group_name,
                                    template_group,
                                    template_sub_group,
                                    is_draft,
                                    lifecycle_status,
                                    notes,
                                    assigned_employee_id,
                                    employee_id
                                )
                                VALUES (
                                    v_roster_id,
                                    p_organization_id,
                                    v_template.department_id,
                                    v_template.sub_department_id,
                                    (v_shift->>'roleId')::uuid,
                                    v_curr_date,
                                    v_shift_start_time,
                                    (v_shift->>'endTime')::time,
                                    COALESCE((v_shift->>'paidBreakDuration')::integer, 0),
                                    COALESCE((v_shift->>'unpaidBreakDuration')::integer, 0),
                                    p_template_id,
                                    (v_shift->>'id')::uuid,
                                    true,
                                    -- group_type: Convert group name to enum value
                                    CASE LOWER(REPLACE(v_group->>'name', ' ', '_'))
                                        WHEN 'convention_centre' THEN 'convention_centre'::template_group_type
                                        WHEN 'exhibition_centre' THEN 'exhibition_centre'::template_group_type
                                        WHEN 'theatre' THEN 'theatre'::template_group_type
                                        ELSE NULL
                                    END,
                                    v_subgroup->>'name', -- sub_group_name: use subgroup name
                                    -- template_group: Convert group name to enum value
                                    CASE LOWER(REPLACE(v_group->>'name', ' ', '_'))
                                        WHEN 'convention_centre' THEN 'convention_centre'::template_group_type
                                        WHEN 'exhibition_centre' THEN 'exhibition_centre'::template_group_type
                                        WHEN 'theatre' THEN 'theatre'::template_group_type
                                        ELSE NULL
                                    END,
                                    v_subgroup->>'name', -- template_sub_group: use subgroup name
                                    true,
                                    'draft',
                                    v_shift->>'notes',
                                    -- assigned_employee_id: from template shift if present
                                    CASE 
                                        WHEN v_shift->>'assignedEmployeeId' IS NOT NULL 
                                             AND v_shift->>'assignedEmployeeId' != '' 
                                             AND v_shift->>'assignedEmployeeId' != 'null'
                                        THEN (v_shift->>'assignedEmployeeId')::uuid 
                                        ELSE NULL 
                                    END,
                                    -- employee_id: same as assigned_employee_id
                                    CASE 
                                        WHEN v_shift->>'assignedEmployeeId' IS NOT NULL 
                                             AND v_shift->>'assignedEmployeeId' != '' 
                                             AND v_shift->>'assignedEmployeeId' != 'null'
                                        THEN (v_shift->>'assignedEmployeeId')::uuid 
                                        ELSE NULL 
                                    END
                                );
                                
                                v_shifts_created := v_shifts_created + 1;
                            END IF; -- exists check
                        END LOOP; -- shifts loop
                    END IF; -- shifts check
                END LOOP; -- subgroups loop
            END IF; -- subGroups check
        END LOOP; -- groups loop

        v_days_processed := v_days_processed + 1;
        v_curr_date := v_curr_date + 1;
    END LOOP;

    -- 5. Update template status to published
    UPDATE roster_templates 
    SET status = 'published', 
        published_at = NOW(),
        published_by = auth.uid(),
        published_month = p_month,
        start_date = v_start_date,
        end_date = v_end_date
    WHERE id = p_template_id;

    -- 6. Return detailed summary
    RETURN jsonb_build_object(
        'success', true, 
        'days_processed', v_days_processed,
        'shifts_created', v_shifts_created,
        'shifts_skipped', jsonb_build_object(
            'PAST_DATE', v_skipped_past_date,
            'PAST_TIME_TODAY', v_skipped_past_time,
            'total', v_skipped_past_date + v_skipped_past_time
        ),
        'month', p_month,
        'evaluated_at', v_current_timestamp::text
    );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION apply_monthly_template(UUID, UUID, TEXT) TO authenticated;
