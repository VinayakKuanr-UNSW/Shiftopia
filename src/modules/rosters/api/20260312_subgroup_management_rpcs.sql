-- Subgroup Management RPCs

-- 1. Delete Roster Subgroup
CREATE OR REPLACE FUNCTION public.delete_roster_subgroup(p_subgroup_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    -- Delete associated shifts first
    DELETE FROM public.shifts WHERE roster_subgroup_id = p_subgroup_id;
    
    -- Delete the subgroup
    DELETE FROM public.roster_subgroups WHERE id = p_subgroup_id;
END;
$function$;

-- 2. Rename Roster Subgroup
CREATE OR REPLACE FUNCTION public.rename_roster_subgroup(p_subgroup_id uuid, p_new_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    UPDATE public.roster_subgroups SET name = p_new_name WHERE id = p_subgroup_id;
    
    -- Sync denormalized columns in shifts
    UPDATE public.shifts 
    SET sub_group_name = p_new_name,
        template_sub_group = p_new_name
    WHERE roster_subgroup_id = p_subgroup_id;
END;
$function$;

-- 3. Clone Roster Subgroup
CREATE OR REPLACE FUNCTION public.clone_roster_subgroup(p_subgroup_id uuid, p_new_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

    -- 3. Clone shifts
    -- Note: We clear assigned_employee_id so clones start as unassigned
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
    WHERE roster_subgroup_id = p_subgroup_id AND deleted_at IS NULL;

    RETURN v_new_subgroup_id;
END;
$function$;
