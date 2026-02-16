-- Migration: Fix v_template_full VIEW to include all shift fields
-- Date: 2026-01-12
-- Purpose: The VIEW was missing critical fields like roleName, remunerationLevel, assignedEmployeeId
-- This caused data to appear lost after saving even though it was stored in the database.

-- First, ensure template_shifts table has all required columns
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS role_name text;
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS remuneration_level_id uuid REFERENCES remuneration_levels(id);
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS remuneration_level text;
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS paid_break_minutes integer DEFAULT 0;
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS unpaid_break_minutes integer DEFAULT 0;
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS required_skills text[] DEFAULT '{}';
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS required_licenses text[] DEFAULT '{}';
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS site_tags text[] DEFAULT '{}';
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS event_tags text[] DEFAULT '{}';
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS assigned_employee_id uuid REFERENCES profiles(id);
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS assigned_employee_name text;
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS net_length_hours numeric;

-- Drop and recreate the VIEW with ALL shift fields
DROP VIEW IF EXISTS v_template_full;

CREATE OR REPLACE VIEW v_template_full AS
SELECT
    t.*,
    COALESCE(
        (
            SELECT json_agg(
                json_build_object(
                    'id', tg.id,
                    'name', tg.name,
                    'description', tg.description,
                    'color', tg.color,
                    'icon', tg.icon,
                    'sortOrder', tg.sort_order,
                    'subGroups', (
                        SELECT COALESCE(json_agg(
                            json_build_object(
                                'id', tsg.id,
                                'name', tsg.name,
                                'description', tsg.description,
                                'sortOrder', tsg.sort_order,
                                'shifts', (
                                    SELECT COALESCE(json_agg(
                                        json_build_object(
                                            'id', s.id,
                                            'name', COALESCE(s.name, s.role_name),
                                            'roleId', s.role_id,
                                            'roleName', s.role_name,
                                            'remunerationLevelId', s.remuneration_level_id,
                                            'remunerationLevel', s.remuneration_level,
                                            'startTime', to_char(s.start_time, 'HH24:MI'),
                                            'endTime', to_char(s.end_time, 'HH24:MI'),
                                            'paidBreakDuration', COALESCE(s.paid_break_minutes, 0),
                                            'unpaidBreakDuration', COALESCE(s.unpaid_break_minutes, 0),
                                            'skills', COALESCE(s.required_skills, ARRAY[]::text[]),
                                            'licenses', COALESCE(s.required_licenses, ARRAY[]::text[]),
                                            'siteTags', COALESCE(s.site_tags, ARRAY[]::text[]),
                                            'eventTags', COALESCE(s.event_tags, ARRAY[]::text[]),
                                            'notes', s.notes,
                                            'assignedEmployeeId', s.assigned_employee_id,
                                            'assignedEmployeeName', s.assigned_employee_name,
                                            'netLength', s.net_length_hours,
                                            'sortOrder', s.sort_order,
                                            'dayOfWeek', s.day_of_week
                                        ) ORDER BY s.sort_order, s.start_time
                                    ), '[]'::json)
                                    FROM template_shifts s
                                    WHERE s.subgroup_id = tsg.id
                                )
                            ) ORDER BY tsg.sort_order
                        ), '[]'::json)
                        FROM template_subgroups tsg
                        WHERE tsg.group_id = tg.id
                    )
                ) ORDER BY tg.sort_order
            )
            FROM template_groups tg
            WHERE tg.template_id = t.id
        ),
        '[]'::json
    ) as groups
FROM roster_templates t;

-- Drop any existing save_template_full functions to avoid conflicts
DROP FUNCTION IF EXISTS save_template_full(uuid, integer, character varying, text, jsonb, uuid);
DROP FUNCTION IF EXISTS save_template_full(uuid, integer, varchar, text, jsonb, uuid);
DROP FUNCTION IF EXISTS save_template_full(uuid, integer, text, text, jsonb, uuid);

-- Also update the save_template_full function to save all fields
-- (This function should insert/update all the columns)
CREATE OR REPLACE FUNCTION save_template_full(
    p_template_id uuid,
    p_expected_version integer,
    p_name text,
    p_description text,
    p_groups jsonb,
    p_user_id uuid
)
RETURNS TABLE (
    success boolean,
    new_version integer,
    error_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
    -- Check current version
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
    
    -- Update template metadata
    v_new_version := v_current_version + 1;
    UPDATE roster_templates
    SET 
        name = p_name,
        description = NULLIF(p_description, ''),
        version = v_new_version,
        updated_at = now(),
        last_edited_by = p_user_id
    WHERE id = p_template_id;
    
    -- Process groups
    FOR v_group IN SELECT * FROM jsonb_array_elements(p_groups)
    LOOP
        -- Check if group ID is a temp ID or real UUID
        v_group_id := NULL;
        IF (v_group->>'id') IS NOT NULL AND (v_group->>'id') NOT LIKE 'temp-%' THEN
            BEGIN
                v_group_id := (v_group->>'id')::uuid;
            EXCEPTION WHEN OTHERS THEN
                v_group_id := NULL;
            END;
        END IF;
        
        IF v_group_id IS NOT NULL THEN
            -- Update existing group
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
            -- Insert new group
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
        
        -- Process subgroups for this group
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
                    -- Update existing subgroup
                    UPDATE template_subgroups
                    SET 
                        name = v_subgroup->>'name',
                        description = v_subgroup->>'description',
                        sort_order = COALESCE((v_subgroup->>'sortOrder')::integer, 0)
                    WHERE id = v_subgroup_id;
                    
                    v_existing_subgroup_ids := array_append(v_existing_subgroup_ids, v_subgroup_id);
                ELSE
                    -- Insert new subgroup
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
                
                -- Process shifts for this subgroup
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
                            -- Update existing shift with ALL fields
                            UPDATE template_shifts
                            SET 
                                name = v_shift->>'name',
                                role_id = NULLIF(v_shift->>'roleId', '')::uuid,
                                role_name = v_shift->>'roleName',
                                remuneration_level_id = NULLIF(v_shift->>'remunerationLevelId', '')::uuid,
                                remuneration_level = v_shift->>'remunerationLevel',
                                start_time = (v_shift->>'startTime')::time,
                                end_time = (v_shift->>'endTime')::time,
                                paid_break_minutes = COALESCE((v_shift->>'paidBreakDuration')::integer, 0),
                                unpaid_break_minutes = COALESCE((v_shift->>'unpaidBreakDuration')::integer, 0),
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
                                assigned_employee_id = NULLIF(v_shift->>'assignedEmployeeId', '')::uuid,
                                assigned_employee_name = v_shift->>'assignedEmployeeName',
                                sort_order = COALESCE((v_shift->>'sortOrder')::integer, 0),
                                day_of_week = (v_shift->>'dayOfWeek')::integer
                            WHERE id = v_shift_id;
                            
                            v_existing_shift_ids := array_append(v_existing_shift_ids, v_shift_id);
                        ELSE
                            -- Insert new shift with ALL fields
                            INSERT INTO template_shifts (
                                subgroup_id,
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
                                assigned_employee_id,
                                assigned_employee_name,
                                sort_order,
                                day_of_week
                            )
                            VALUES (
                                v_subgroup_id,
                                v_shift->>'name',
                                NULLIF(v_shift->>'roleId', '')::uuid,
                                v_shift->>'roleName',
                                NULLIF(v_shift->>'remunerationLevelId', '')::uuid,
                                v_shift->>'remunerationLevel',
                                (v_shift->>'startTime')::time,
                                (v_shift->>'endTime')::time,
                                COALESCE((v_shift->>'paidBreakDuration')::integer, 0),
                                COALESCE((v_shift->>'unpaidBreakDuration')::integer, 0),
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
                                NULLIF(v_shift->>'assignedEmployeeId', '')::uuid,
                                v_shift->>'assignedEmployeeName',
                                COALESCE((v_shift->>'sortOrder')::integer, 0),
                                (v_shift->>'dayOfWeek')::integer
                            )
                            RETURNING id INTO v_shift_id;
                            
                            v_existing_shift_ids := array_append(v_existing_shift_ids, v_shift_id);
                        END IF;
                    END LOOP;
                END IF;
                
                -- Delete removed shifts from this subgroup
                DELETE FROM template_shifts
                WHERE subgroup_id = v_subgroup_id
                AND id != ALL(v_existing_shift_ids);
            END LOOP;
        END IF;
        
        -- Delete removed subgroups from this group
        DELETE FROM template_subgroups
        WHERE group_id = v_group_id
        AND id != ALL(v_existing_subgroup_ids);
    END LOOP;
    
    -- Delete removed groups from this template
    DELETE FROM template_groups
    WHERE template_id = p_template_id
    AND id != ALL(v_existing_group_ids);
    
    RETURN QUERY SELECT true, v_new_version, NULL::text;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION save_template_full(uuid, integer, text, text, jsonb, uuid) TO authenticated;
