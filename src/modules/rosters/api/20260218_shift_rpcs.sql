-- Migration: Shift CRUD RPCs
-- Date: 2026-02-18
-- Description: Introduces sm_create_shift and sm_update_shift for centralized shift management.

-- 1. Create Shift RPC
CREATE OR REPLACE FUNCTION sm_create_shift(
    p_shift_data jsonb,
    p_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_new_shift_id uuid;
    v_result json;
    v_roster_id uuid;
BEGIN
    -- Extract mandatory fields
    v_roster_id := (p_shift_data->>'roster_id')::uuid;

    -- Basic Validation (Lock check could go here)
    -- IF is_roster_locked(v_roster_id) THEN ... END IF;

    -- Insert
    INSERT INTO shifts (
        roster_id,
        department_id,
        shift_date,
        roster_date,
        start_time,
        end_time,
        organization_id,
        sub_department_id,
        group_type,
        sub_group_name,
        display_order,
        shift_group_id,
        shift_group_id,
        shift_subgroup_id,
        roster_subgroup_id,
        role_id,
        remuneration_level_id,
        paid_break_minutes,
        unpaid_break_minutes,
        break_minutes,
        timezone,
        assigned_employee_id,
        required_skills,
        required_licenses,
        event_ids,
        tags,
        notes,
        template_id,
        template_group,
        template_sub_group,
        is_from_template,
        template_instance_id,
        lifecycle_status,
        is_draft,
        created_by_user_id,
        created_at,
        updated_at
    ) VALUES (
        v_roster_id,
        (p_shift_data->>'department_id')::uuid,
        (p_shift_data->>'shift_date')::date,
        (p_shift_data->>'roster_date')::date, -- Usually same as shift_date
        (p_shift_data->>'start_time')::time,
        (p_shift_data->>'end_time')::time,
        (p_shift_data->>'organization_id')::uuid,
        (p_shift_data->>'sub_department_id')::uuid,
        (p_shift_data->>'group_type')::template_group_type,
        (p_shift_data->>'sub_group_name'),
        COALESCE((p_shift_data->>'display_order')::integer, 0),
        (p_shift_data->>'shift_group_id')::uuid,
        (p_shift_data->>'shift_subgroup_id')::uuid,
        (p_shift_data->>'shift_subgroup_id')::uuid, -- Map to roster_subgroup_id
        (p_shift_data->>'role_id')::uuid,
        (p_shift_data->>'remuneration_level_id')::uuid,
        COALESCE((p_shift_data->>'paid_break_minutes')::integer, 0),
        COALESCE((p_shift_data->>'unpaid_break_minutes')::integer, 0),
        COALESCE((p_shift_data->>'break_minutes')::integer, 0),
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
        'Draft'::shift_lifecycle, -- Always start as Draft
        true, -- Always start as Draft
        p_user_id,
        NOW(),
        NOW()
    )
    RETURNING id INTO v_new_shift_id;

    -- Return the newly created shift
    SELECT row_to_json(s) INTO v_result
    FROM shifts s
    WHERE s.id = v_new_shift_id;

    RETURN v_result;
END;
$$;

-- 2. Update Shift RPC
CREATE OR REPLACE FUNCTION sm_update_shift(
    p_shift_id uuid,
    p_shift_data jsonb,
    p_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result json;
    v_old_shift shifts%ROWTYPE;
BEGIN
    -- Get old shift for auditing (implicit via trigger, but good to have)
    SELECT * INTO v_old_shift FROM shifts WHERE id = p_shift_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift not found: %', p_shift_id;
    END IF;

    -- Check if locked (omitted for now, but placeholder)
    
    -- Update
    UPDATE shifts SET
        roster_id = CASE WHEN p_shift_data ? 'roster_id' THEN (p_shift_data->>'roster_id')::uuid ELSE roster_id END,
        department_id = CASE WHEN p_shift_data ? 'department_id' THEN (p_shift_data->>'department_id')::uuid ELSE department_id END,
        sub_department_id = CASE WHEN p_shift_data ? 'sub_department_id' THEN (p_shift_data->>'sub_department_id')::uuid ELSE sub_department_id END,
        
        shift_date = CASE WHEN p_shift_data ? 'shift_date' THEN (p_shift_data->>'shift_date')::date ELSE shift_date END,
        roster_date = CASE WHEN p_shift_data ? 'shift_date' THEN (p_shift_data->>'shift_date')::date ELSE roster_date END, -- Sync roster_date
        
        start_time = CASE WHEN p_shift_data ? 'start_time' THEN (p_shift_data->>'start_time')::time ELSE start_time END,
        end_time = CASE WHEN p_shift_data ? 'end_time' THEN (p_shift_data->>'end_time')::time ELSE end_time END,
        
        group_type = CASE WHEN p_shift_data ? 'group_type' THEN (p_shift_data->>'group_type')::template_group_type ELSE group_type END,
        sub_group_name = CASE WHEN p_shift_data ? 'sub_group_name' THEN (p_shift_data->>'sub_group_name') ELSE sub_group_name END,
        display_order = CASE WHEN p_shift_data ? 'display_order' THEN (p_shift_data->>'display_order')::integer ELSE display_order END,
        shift_group_id = CASE WHEN p_shift_data ? 'shift_group_id' THEN (p_shift_data->>'shift_group_id')::uuid ELSE shift_group_id END,
        shift_group_id = CASE WHEN p_shift_data ? 'shift_group_id' THEN (p_shift_data->>'shift_group_id')::uuid ELSE shift_group_id END,
        shift_subgroup_id = CASE WHEN p_shift_data ? 'shift_subgroup_id' THEN (p_shift_data->>'shift_subgroup_id')::uuid ELSE shift_subgroup_id END,
        roster_subgroup_id = CASE WHEN p_shift_data ? 'shift_subgroup_id' THEN (p_shift_data->>'shift_subgroup_id')::uuid ELSE roster_subgroup_id END,
        
        role_id = CASE WHEN p_shift_data ? 'role_id' THEN (p_shift_data->>'role_id')::uuid ELSE role_id END,
        remuneration_level_id = CASE WHEN p_shift_data ? 'remuneration_level_id' THEN (p_shift_data->>'remuneration_level_id')::uuid ELSE remuneration_level_id END,
        
        paid_break_minutes = CASE WHEN p_shift_data ? 'paid_break_minutes' THEN (p_shift_data->>'paid_break_minutes')::integer ELSE paid_break_minutes END,
        unpaid_break_minutes = CASE WHEN p_shift_data ? 'unpaid_break_minutes' THEN (p_shift_data->>'unpaid_break_minutes')::integer ELSE unpaid_break_minutes END,
        break_minutes = CASE 
            WHEN p_shift_data ? 'paid_break_minutes' OR p_shift_data ? 'unpaid_break_minutes' THEN 
                COALESCE((p_shift_data->>'paid_break_minutes')::integer, paid_break_minutes, 0) + 
                COALESCE((p_shift_data->>'unpaid_break_minutes')::integer, unpaid_break_minutes, 0)
            ELSE break_minutes 
        END,
        
        timezone = CASE WHEN p_shift_data ? 'timezone' THEN (p_shift_data->>'timezone') ELSE timezone END,
        assigned_employee_id = CASE WHEN p_shift_data ? 'assigned_employee_id' THEN (p_shift_data->>'assigned_employee_id')::uuid ELSE assigned_employee_id END,
        
        required_skills = CASE WHEN p_shift_data ? 'required_skills' THEN p_shift_data->'required_skills' ELSE required_skills END,
        required_licenses = CASE WHEN p_shift_data ? 'required_licenses' THEN p_shift_data->'required_licenses' ELSE required_licenses END,
        event_ids = CASE WHEN p_shift_data ? 'event_ids' THEN p_shift_data->'event_ids' ELSE event_ids END,
        tags = CASE WHEN p_shift_data ? 'tags' THEN p_shift_data->'tags' ELSE tags END,
        notes = CASE WHEN p_shift_data ? 'notes' THEN (p_shift_data->>'notes') ELSE notes END,
        cancellation_reason = CASE WHEN p_shift_data ? 'cancellation_reason' THEN (p_shift_data->>'cancellation_reason') ELSE cancellation_reason END,
        
        last_modified_by = p_user_id,
        updated_at = NOW()
    WHERE id = p_shift_id;

    -- Return updated shift
    SELECT row_to_json(s) INTO v_result
    FROM shifts s
    WHERE s.id = p_shift_id;

    RETURN v_result;
END;
$$;
