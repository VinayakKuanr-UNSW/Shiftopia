-- Support 'the_cutaway' in add_roster_subgroup_range functions

-- 1. 5-argument version
CREATE OR REPLACE FUNCTION "public"."add_roster_subgroup_range"("p_org_id" "uuid", "p_group_external_id" "text", "p_name" "text", "p_start_date" "date", "p_end_date" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
    v_current_date DATE;
    v_roster_id UUID;
    v_roster_group_id UUID;
    v_group_name TEXT;
    v_sort_order INT;
BEGIN
    -- Determine group name and sort order based on external_id
    CASE p_group_external_id
        WHEN 'convention_centre' THEN
            v_group_name := 'Convention Centre';
            v_sort_order := 0;
        WHEN 'exhibition_centre' THEN
            v_group_name := 'Exhibition Centre';
            v_sort_order := 1;
        WHEN 'theatre' THEN
            v_group_name := 'Theatre';
            v_sort_order := 2;
        WHEN 'the_cutaway' THEN
            v_group_name := 'The Cutaway';
            v_sort_order := 3;
        ELSE
            RAISE EXCEPTION 'Invalid group external_id: %', p_group_external_id;
    END CASE;

    -- Iterate through dates
    v_current_date := p_start_date;
    WHILE v_current_date <= p_end_date LOOP
        
        -- 1. Get Roster (Removed auto-creation)
        SELECT id INTO v_roster_id FROM public.rosters 
        WHERE organization_id = p_org_id AND start_date = v_current_date
        LIMIT 1;

        IF v_roster_id IS NULL THEN
            RAISE EXCEPTION 'Roster not activated for date: %', v_current_date;
        END IF;

        -- 2. Ensure Group Exists (Idempotent)
        SELECT id INTO v_roster_group_id 
        FROM public.roster_groups
        WHERE roster_id = v_roster_id AND (external_id = p_group_external_id OR name = v_group_name);

        IF v_roster_group_id IS NULL THEN
            INSERT INTO public.roster_groups (
                roster_id,
                name,
                external_id,
                sort_order
            ) VALUES (
                v_roster_id,
                v_group_name,
                p_group_external_id,
                v_sort_order
            )
            RETURNING id INTO v_roster_group_id;
        END IF;

        -- 3. Ensure Subgroup Exists (Idempotent)
        IF NOT EXISTS (
            SELECT 1 FROM public.roster_subgroups 
            WHERE roster_group_id = v_roster_group_id AND name = p_name
        ) THEN
            INSERT INTO public.roster_subgroups (
                roster_group_id,
                name,
                sort_order
            ) VALUES (
                v_roster_group_id,
                p_name,
                999 -- Default sort order for ad-hoc subgroups
            );
        END IF;

        v_current_date := v_current_date + 1;
    END LOOP;
END;
$$;


-- 2. 7-argument version
CREATE OR REPLACE FUNCTION "public"."add_roster_subgroup_range"("p_org_id" "uuid", "p_dept_id" "uuid", "p_sub_dept_id" "uuid", "p_group_external_id" "text", "p_name" "text", "p_start_date" "date", "p_end_date" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
    v_current_date DATE;
    v_roster_id UUID;
    v_roster_group_id UUID;
    v_group_name TEXT;
    v_sort_order INT;
BEGIN
    -- Determine group name and sort order based on external_id
    CASE p_group_external_id
        WHEN 'convention_centre' THEN
            v_group_name := 'Convention Centre';
            v_sort_order := 0;
        WHEN 'exhibition_centre' THEN
            v_group_name := 'Exhibition Centre';
            v_sort_order := 1;
        WHEN 'theatre' THEN
            v_group_name := 'Theatre';
            v_sort_order := 2;
        WHEN 'the_cutaway' THEN
            v_group_name := 'The Cutaway';
            v_sort_order := 3;
        ELSE
            RAISE EXCEPTION 'Invalid group external_id: %', p_group_external_id;
    END CASE;

    -- Iterate through dates
    v_current_date := p_start_date;
    WHILE v_current_date <= p_end_date LOOP
        
        -- STRICT LOCK: Skip past dates
        IF v_current_date < CURRENT_DATE THEN
            v_current_date := v_current_date + 1;
            CONTINUE;
        END IF;

        -- 1. Ensure Roster Exists (Idempotent & Scoped)
        IF p_sub_dept_id IS NULL THEN
            SELECT id INTO v_roster_id FROM public.rosters 
            WHERE organization_id = p_org_id 
              AND department_id = p_dept_id
              AND sub_department_id IS NULL
              AND start_date = v_current_date
            LIMIT 1;
        ELSE
            SELECT id INTO v_roster_id FROM public.rosters 
            WHERE organization_id = p_org_id 
              AND department_id = p_dept_id
              AND sub_department_id = p_sub_dept_id
              AND start_date = v_current_date
            LIMIT 1;
        END IF;

        IF v_roster_id IS NULL THEN
            INSERT INTO public.rosters (
                organization_id,
                department_id,
                sub_department_id,
                start_date,
                end_date,
                status,
                is_locked
            ) VALUES (
                p_org_id,
                p_dept_id,
                p_sub_dept_id,
                v_current_date,
                v_current_date,
                'draft',
                false
            )
            RETURNING id INTO v_roster_id;
        END IF;

        -- 2. Ensure Group Exists (Idempotent)
        SELECT id INTO v_roster_group_id 
        FROM public.roster_groups
        WHERE roster_id = v_roster_id AND (external_id = p_group_external_id OR name = v_group_name);

        IF v_roster_group_id IS NULL THEN
            INSERT INTO public.roster_groups (
                roster_id,
                name,
                external_id,
                sort_order
            ) VALUES (
                v_roster_id,
                v_group_name,
                p_group_external_id,
                v_sort_order
            )
            RETURNING id INTO v_roster_group_id;
        END IF;

        -- 3. Ensure Subgroup Exists (Idempotent)
        IF NOT EXISTS (
            SELECT 1 FROM public.roster_subgroups 
            WHERE roster_group_id = v_roster_group_id AND name = p_name
        ) THEN
            INSERT INTO public.roster_subgroups (
                roster_group_id,
                name,
                sort_order
            ) VALUES (
                v_roster_group_id,
                p_name,
                999 -- Default sort order for ad-hoc subgroups
            );
        END IF;

        v_current_date := v_current_date + 1;
    END LOOP;
END;
$$;
