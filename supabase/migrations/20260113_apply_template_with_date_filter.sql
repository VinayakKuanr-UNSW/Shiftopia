-- Migration: Create apply_template_to_date_range RPC with past date skipping
-- Date: 2026-01-13
-- Purpose: Apply templates to roster dates, but skip past dates in the current month

CREATE OR REPLACE FUNCTION apply_template_to_date_range(
    p_template_id uuid,
    p_start_date date,
    p_end_date date,
    p_mode text, -- 'merge' or 'replace'
    p_user_id uuid
) RETURNS jsonb[] AS $$
DECLARE
    v_current_date date := p_start_date;
    v_today date := CURRENT_DATE;
    v_shifts_created integer := 0;
    v_shifts_skipped integer := 0;
    v_days_processed integer := 0;
    v_roster_day_id uuid;
    v_organization_id uuid;
    v_template record;
    v_group record;
    v_subgroup record;
    v_shift record;
    v_roster_group_id uuid;
    v_roster_subgroup_id uuid;
BEGIN
    -- Get template and organization
    SELECT * INTO v_template 
    FROM roster_templates 
    WHERE id = p_template_id;
    
    IF NOT FOUND THEN
        RETURN ARRAY[jsonb_build_object(
            'success', false,
            'error_message', 'Template not found',
            'days_processed', 0,
            'shifts_created', 0,
            'shifts_skipped', 0
        )];
    END IF;
    
    v_organization_id := v_template.organization_id;
    
    -- Loop through each date in range
    WHILE v_current_date <= p_end_date LOOP
        -- CRITICAL: Skip past dates (dates before today)
        IF v_current_date < v_today THEN
            RAISE NOTICE 'Skipping past date: %', v_current_date;
            v_current_date := v_current_date + interval '1 day';
            CONTINUE;
        END IF;
        
        -- Get or create roster day
        SELECT id INTO v_roster_day_id
        FROM roster_days
        WHERE organization_id = v_organization_id
          AND date = v_current_date;
        
        IF NOT FOUND THEN
            INSERT INTO roster_days (organization_id, date, status, created_by, updated_by)
            VALUES (v_organization_id, v_current_date, 'draft', p_user_id, p_user_id)
            RETURNING id INTO v_roster_day_id;
        END IF;
        
        -- If replace mode, delete existing shifts for this day
        IF p_mode = 'replace' THEN
            DELETE FROM roster_shifts
            WHERE roster_subgroup_id IN (
                SELECT rs.id FROM roster_subgroups rs
                JOIN roster_groups rg ON rs.group_id = rg.id
                WHERE rg.roster_day_id = v_roster_day_id
            );
        END IF;
        
        -- Copy groups, subgroups, and shifts from template
        FOR v_group IN 
            SELECT * FROM template_groups 
            WHERE template_id = p_template_id 
            ORDER BY sort_order
        LOOP
            -- Create or get roster group
            SELECT id INTO v_roster_group_id
            FROM roster_groups
            WHERE roster_day_id = v_roster_day_id
              AND name = v_group.name;
            
            IF NOT FOUND THEN
                INSERT INTO roster_groups (roster_day_id, name, description, color, icon, sort_order)
                VALUES (v_roster_day_id, v_group.name, v_group.description, v_group.color, v_group.icon, v_group.sort_order)
                RETURNING id INTO v_roster_group_id;
            END IF;
            
            -- Copy subgroups
            FOR v_subgroup IN 
                SELECT * FROM template_subgroups 
                WHERE group_id = v_group.id 
                ORDER BY sort_order
            LOOP
                -- Create or get roster subgroup
                SELECT id INTO v_roster_subgroup_id
                FROM roster_subgroups
                WHERE group_id = v_roster_group_id
                  AND name = v_subgroup.name;
                
                IF NOT FOUND THEN
                    INSERT INTO roster_subgroups (group_id, name, description, sort_order)
                    VALUES (v_roster_group_id, v_subgroup.name, v_subgroup.description, v_subgroup.sort_order)
                    RETURNING id INTO v_roster_subgroup_id;
                END IF;
                
                -- Copy shifts (only if merge mode or replace already cleared them)
                FOR v_shift IN 
                    SELECT * FROM template_shifts 
                    WHERE subgroup_id = v_subgroup.id 
                    ORDER BY sort_order, start_time
                LOOP
                    -- In merge mode, check if shift already exists
                    IF p_mode = 'merge' THEN
                        IF EXISTS (
                            SELECT 1 FROM roster_shifts
                            WHERE roster_subgroup_id = v_roster_subgroup_id
                              AND start_time = v_shift.start_time
                              AND end_time = v_shift.end_time
                        ) THEN
                            v_shifts_skipped := v_shifts_skipped + 1;
                            CONTINUE;
                        END IF;
                    END IF;
                    
                    -- Create shift
                    INSERT INTO roster_shifts (
                        roster_subgroup_id,
                        name,
                        role_id,
                        role_name,
                        remuneration_level_id,
                        remuneration_level,
                        start_time,
                        end_time,
                        paid_break_minutes,
                        unpaid_break_minutes,
                        required_skills,
                        required_licenses,
                        site_tags,
                        event_tags,
                        notes,
                        sort_order
                    ) VALUES (
                        v_roster_subgroup_id,
                        COALESCE(v_shift.name, v_shift.role_name),
                        v_shift.role_id,
                        v_shift.role_name,
                        v_shift.remuneration_level_id,
                        v_shift.remuneration_level,
                        v_shift.start_time,
                        v_shift.end_time,
                        COALESCE(v_shift.paid_break_minutes, 0),
                        COALESCE(v_shift.unpaid_break_minutes, 0),
                        COALESCE(v_shift.required_skills, ARRAY[]::text[]),
                        COALESCE(v_shift.required_licenses, ARRAY[]::text[]),
                        COALESCE(v_shift.site_tags, ARRAY[]::text[]),
                        COALESCE(v_shift.event_tags, ARRAY[]::text[]),
                        v_shift.notes,
                        v_shift.sort_order
                    );
                    
                    v_shifts_created := v_shifts_created + 1;
                END LOOP;
            END LOOP;
        END LOOP;
        
        v_days_processed := v_days_processed + 1;
        v_current_date := v_current_date + interval '1 day';
    END LOOP;
    
    RETURN ARRAY[jsonb_build_object(
        'success', true,
        'days_processed', v_days_processed,
        'shifts_created', v_shifts_created,
        'shifts_skipped', v_shifts_skipped,
        'error_message', null
    )];
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
