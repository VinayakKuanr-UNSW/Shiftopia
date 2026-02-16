-- Migration: Fix apply_monthly_template Enum Casing
-- Date: 2026-02-05
-- Purpose: update shift_lifecycle value from 'draft' to 'Draft' (PascalCase)

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
BEGIN
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
        
        -- CRITICAL: Skip past dates (don't create shifts for dates before today)
        -- Use Australia/Sydney timezone to match user's local date
        IF v_curr_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Australia/Sydney')::DATE THEN
            -- RAISE NOTICE 'Skipping past date: %', v_curr_date;
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
                                    assigned_employee_id
                                )
                                VALUES (
                                    v_roster_id,
                                    p_organization_id,
                                    v_template.department_id,
                                    v_template.sub_department_id,
                                    (v_shift->>'roleId')::uuid,
                                    v_curr_date,
                                    (v_shift->>'startTime')::time,
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
                                    'Draft', -- FIX: Use PascalCase 'Draft'
                                    v_shift->>'notes',
                                    -- assigned_employee_id: from template shift if present
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

    RETURN jsonb_build_object(
        'success', true, 
        'days_processed', v_days_processed,
        'shifts_created', v_shifts_created,
        'month', p_month
    );
END;
$$;
