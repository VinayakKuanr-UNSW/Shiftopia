-- Subgroup Management RPCs v2 (Range-Aware)

-- 1. Delete Roster Subgroup v2
CREATE OR REPLACE FUNCTION public.delete_roster_subgroup_v2(
    p_org_id uuid,
    p_dept_id uuid,
    p_group_external_id text,
    p_name text,
    p_start_date date,
    p_end_date date
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_current_date DATE;
    v_roster_id UUID;
    v_roster_group_id UUID;
BEGIN
    v_current_date := p_start_date;
    WHILE v_current_date <= p_end_date LOOP
        -- Find Roster
        SELECT id INTO v_roster_id FROM public.rosters 
        WHERE organization_id = p_org_id 
          AND department_id = p_dept_id
          AND start_date = v_current_date;

        IF v_roster_id IS NOT NULL THEN
            -- Find Group
            SELECT id INTO v_roster_group_id FROM public.roster_groups
            WHERE roster_id = v_roster_id AND external_id = p_group_external_id;

            IF v_roster_group_id IS NOT NULL THEN
                -- 1. Delete associated shifts (matches by roster_id and sub_group_name)
                -- This handles both formal and ad-hoc subgroups
                DELETE FROM public.shifts 
                WHERE roster_id = v_roster_id 
                  AND sub_group_name = p_name;

                -- 2. Delete formal subgroup record
                DELETE FROM public.roster_subgroups
                WHERE roster_group_id = v_roster_group_id AND name = p_name;
            END IF;
        END IF;

        v_current_date := v_current_date + 1;
    END LOOP;
END;
$function$;

-- 2. Rename Roster Subgroup v2
CREATE OR REPLACE FUNCTION public.rename_roster_subgroup_v2(
    p_org_id uuid,
    p_dept_id uuid,
    p_group_external_id text,
    p_old_name text,
    p_new_name text,
    p_start_date date,
    p_end_date date
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_current_date DATE;
    v_roster_id UUID;
    v_roster_group_id UUID;
BEGIN
    v_current_date := p_start_date;
    WHILE v_current_date <= p_end_date LOOP
        -- Find Roster
        SELECT id INTO v_roster_id FROM public.rosters 
        WHERE organization_id = p_org_id 
          AND department_id = p_dept_id
          AND start_date = v_current_date;

        IF v_roster_id IS NOT NULL THEN
            -- Find Group
            SELECT id INTO v_roster_group_id FROM public.roster_groups
            WHERE roster_id = v_roster_id AND external_id = p_group_external_id;

            IF v_roster_group_id IS NOT NULL THEN
                -- 1. Update formal subgroup records (idempotent name change)
                UPDATE public.roster_subgroups
                SET name = p_new_name
                WHERE roster_group_id = v_roster_group_id AND name = p_old_name;

                -- 2. Update shifts (denormalized name column)
                UPDATE public.shifts
                SET sub_group_name = p_new_name
                WHERE roster_id = v_roster_id AND sub_group_name = p_old_name;
            END IF;
        END IF;

        v_current_date := v_current_date + 1;
    END LOOP;
END;
$function$;

-- 3. Clone Roster Subgroup v2 (with Shifts)
CREATE OR REPLACE FUNCTION public.clone_roster_subgroup_v2(
    p_org_id uuid,
    p_dept_id uuid,
    p_group_external_id text,
    p_source_name text,
    p_new_name text,
    p_start_date date,
    p_end_date date
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_current_date DATE;
    v_roster_id UUID;
    v_roster_group_id UUID;
    v_old_subgroup_id UUID;
    v_new_subgroup_id UUID;
BEGIN
    v_current_date := p_start_date;
    WHILE v_current_date <= p_end_date LOOP
        -- Find Roster
        SELECT id INTO v_roster_id FROM public.rosters 
        WHERE organization_id = p_org_id 
          AND department_id = p_dept_id
          AND start_date = v_current_date;

        IF v_roster_id IS NOT NULL THEN
            -- Find Group
            SELECT id INTO v_roster_group_id FROM public.roster_groups
            WHERE roster_id = v_roster_id AND external_id = p_group_external_id;

            IF v_roster_group_id IS NOT NULL THEN
                -- A. Find Source Subgroup
                SELECT id INTO v_old_subgroup_id FROM public.roster_subgroups
                WHERE roster_group_id = v_roster_group_id AND name = p_source_name;

                -- B. Create New Subgroup (even if source was adhoc, we make the clone formal)
                INSERT INTO public.roster_subgroups (
                    roster_group_id,
                    name,
                    sort_order,
                    color,
                    icon,
                    description,
                    metadata,
                    roster_pattern_id
                )
                SELECT
                    v_roster_group_id,
                    p_new_name,
                    sort_order + 1,
                    color,
                    icon,
                    description,
                    metadata,
                    roster_pattern_id
                FROM public.roster_subgroups
                WHERE id = v_old_subgroup_id
                ON CONFLICT (roster_group_id, name) DO UPDATE
                SET sort_order = EXCLUDED.sort_order
                RETURNING id INTO v_new_subgroup_id;

                -- Fallback if source subgroup wasn't found (adhoc)
                IF v_new_subgroup_id IS NULL THEN
                    INSERT INTO public.roster_subgroups (
                        roster_group_id,
                        name,
                        sort_order
                    ) VALUES (
                        v_roster_group_id,
                        p_new_name,
                        999
                    )
                    ON CONFLICT (roster_group_id, name) DO UPDATE
                    SET sort_order = EXCLUDED.sort_order
                    RETURNING id INTO v_new_subgroup_id;
                END IF;

                INSERT INTO public.shifts (
                    roster_id,
                    roster_subgroup_id,
                    sub_group_name,
                    group_type,
                    shift_date,
                    start_time,
                    end_time,
                    role_id,
                    required_skills,
                    required_licenses,
                    event_tags,
                    notes,
                    lifecycle_status,
                    is_locked,
                    organization_id,
                    department_id,
                    sub_department_id,
                    timezone,
                    creation_source,
                    -- Missing properties being added:
                    assigned_employee_id,
                    assignment_id,
                    assignment_status,
                    assignment_outcome,
                    fulfillment_status,
                    start_at,
                    end_at,
                    tz_identifier,
                    is_overnight,
                    break_minutes,
                    paid_break_minutes,
                    unpaid_break_minutes,
                    net_length_minutes,
                    remuneration_level_id,
                    remuneration_rate,
                    actual_hourly_rate,
                    currency,
                    template_id,
                    template_instance_id,
                    is_from_template,
                    template_batch_id,
                    event_ids,
                    role_level,
                    display_order,
                    is_draft,
                    is_published,
                    bidding_status,
                    bidding_priority_text
                )
                SELECT 
                    roster_id,
                    v_new_subgroup_id,
                    p_new_name,
                    group_type,
                    shift_date,
                    start_time,
                    end_time,
                    role_id,
                    required_skills,
                    required_licenses,
                    event_tags,
                    notes,
                    lifecycle_status, -- Keep source lifecycle status
                    false,            -- Clone should NOT be locked by default
                    organization_id,
                    department_id,
                    sub_department_id,
                    timezone,
                    'sub-group cloning',
                    assigned_employee_id,
                    assignment_id,
                    assignment_status,
                    assignment_outcome,
                    fulfillment_status,
                    start_at,
                    end_at,
                    tz_identifier,
                    is_overnight,
                    break_minutes,
                    paid_break_minutes,
                    unpaid_break_minutes,
                    net_length_minutes,
                    remuneration_level_id,
                    remuneration_rate,
                    actual_hourly_rate,
                    currency,
                    template_id,
                    template_instance_id,
                    is_from_template,
                    template_batch_id,
                    event_ids,
                    role_level,
                    display_order,
                    is_draft,
                    is_published,
                    bidding_status,
                    bidding_priority_text
                FROM public.shifts
                WHERE roster_id = v_roster_id 
                  AND sub_group_name = p_source_name
                  AND deleted_at IS NULL;
            END IF;
        END IF;

        v_current_date := v_current_date + 1;
    END LOOP;
END;
$function$;
