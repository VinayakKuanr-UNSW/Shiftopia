-- Migration: Update apply_template RPC for Roster Hierarchy
-- Date: 2026-02-13
-- Purpose: 
-- 1. Create apply_template_to_date_range_v2
-- 2. It will populate roster_groups and roster_subgroups from the template tables.
-- 3. It will populate shifts with links to roster_subgroups.
-- 4. CRITICAL: It will ALSO populate legacy columns (group_type, sub_group_name) to keep current frontend working.

CREATE OR REPLACE FUNCTION apply_template_to_date_range_v2(
    p_template_id uuid,
    p_start_date date,
    p_end_date date,
    p_user_id uuid
)
RETURNS jsonb
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
BEGIN
    -- 1. Validation
    IF p_start_date > p_end_date THEN
        RETURN jsonb_build_object('success', false, 'error', 'Start date must be before end date');
    END IF;

    -- 2. Get Template info
    SELECT * INTO v_template FROM roster_templates WHERE id = p_template_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template not found');
    END IF;

    -- 3. Loop through date range
    v_curr_date := p_start_date;
    WHILE v_curr_date <= p_end_date LOOP
        
        -- A. Create or get roster
        BEGIN
            INSERT INTO rosters (
                date, start_date, end_date, template_id, organization_id, 
                department_id, sub_department_id, 
                name, description, 
                groups, -- Legacy JSON: we can set this to empty array or copy from template. Let's copy for safety.
                status, is_locked, created_by
            )
            VALUES (
                v_curr_date, v_curr_date, v_curr_date, p_template_id, v_template.organization_id,
                v_template.department_id, v_template.sub_department_id,
                v_template.name || ' - ' || to_char(v_curr_date, 'DD Mon YYYY'),
                v_template.description,
                '[]'::jsonb, -- Deprecating this column effectively, putting empty json
                'draft', false, p_user_id
            )
            RETURNING id INTO v_roster_id;
        EXCEPTION WHEN unique_violation THEN
            SELECT id INTO v_roster_id FROM rosters 
            WHERE date = v_curr_date AND department_id = v_template.department_id;
        END;

        -- B. Loop through Template Groups
        FOR v_tg IN SELECT * FROM template_groups WHERE template_id = p_template_id ORDER BY sort_order LOOP
            
            -- Create Roster Group
            INSERT INTO roster_groups (roster_id, name, sort_order)
            VALUES (v_roster_id, v_tg.name, v_tg.sort_order)
            RETURNING id INTO v_rg_id;

            -- C. Loop through Template SubGroups
            FOR v_tsg IN SELECT * FROM template_subgroups WHERE group_id = v_tg.id ORDER BY sort_order LOOP
                
                -- Create Roster SubGroup
                INSERT INTO roster_subgroups (roster_group_id, name, sort_order)
                VALUES (v_rg_id, v_tsg.name, v_tsg.sort_order)
                RETURNING id INTO v_rsg_id;

                -- D. Loop through Template Shifts
                FOR v_ts IN SELECT * FROM template_shifts WHERE subgroup_id = v_tsg.id LOOP
                    
                    -- Check duplicates (simplified check)
                    IF NOT EXISTS (
                        SELECT 1 FROM shifts 
                        WHERE roster_id = v_roster_id 
                          AND template_instance_id = v_ts.id
                          AND deleted_at IS NULL
                    ) THEN
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
                            
                            -- New Hierarchy Link
                            roster_subgroup_id,

                            -- Legacy Columns (Dual Write)
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
                            v_template.organization_id,
                            v_template.department_id,
                            v_template.sub_department_id,
                            v_ts.role_id,
                            v_curr_date,
                            v_ts.start_time,
                            v_ts.end_time,
                            COALESCE(v_ts.paid_break_minutes, 0),
                            COALESCE(v_ts.unpaid_break_minutes, 0),
                            p_template_id,
                            v_ts.id,
                            true,
                            
                            -- New Hierarchy Link
                            v_rsg_id,

                            -- Legacy Columns (Map from names)
                            -- Note: This mapping mimics the hardcoded switch case in the previous version
                            -- We assume the group name matches the enum 'convention_centre' etc.
                            -- Or we just cast to text.
                            CASE LOWER(REPLACE(v_tg.name, ' ', '_'))
                                WHEN 'convention_centre' THEN 'convention_centre'::template_group_type
                                WHEN 'exhibition_centre' THEN 'exhibition_centre'::template_group_type
                                WHEN 'theatre' THEN 'theatre'::template_group_type
                                ELSE NULL -- Fallback if name doesn't match fixed types
                            END,
                            v_tsg.name, -- sub_group_name
                            
                            CASE LOWER(REPLACE(v_tg.name, ' ', '_'))
                                WHEN 'convention_centre' THEN 'convention_centre'::template_group_type
                                WHEN 'exhibition_centre' THEN 'exhibition_centre'::template_group_type
                                WHEN 'theatre' THEN 'theatre'::template_group_type
                                ELSE NULL
                            END,
                            v_tsg.name, -- template_sub_group

                            true,
                            'Draft',
                            v_ts.notes,
                            v_ts.assigned_employee_id
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
