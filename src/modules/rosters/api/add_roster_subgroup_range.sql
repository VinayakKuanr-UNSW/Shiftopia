-- RPC to add a subgroup to a range of dates, ensuring rosters and groups exist
CREATE OR REPLACE FUNCTION public.add_roster_subgroup_range(
    p_org_id UUID,
    p_group_external_id TEXT, -- 'convention_centre', 'exhibition_centre', 'theatre'
    p_name TEXT,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
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
        ELSE
            RAISE EXCEPTION 'Invalid group external_id: %', p_group_external_id;
    END CASE;

    -- Iterate through dates
    v_current_date := p_start_date;
    WHILE v_current_date <= p_end_date LOOP
        
        -- 1. Ensure Roster Exists (Idempotent)
        -- 1. Ensure Roster Exists (Idempotent)
        SELECT id INTO v_roster_id FROM public.rosters 
        WHERE organization_id = p_org_id AND date = v_current_date
        LIMIT 1;

        IF v_roster_id IS NULL THEN
            INSERT INTO public.rosters (
                organization_id,
                date,
                start_date,
                end_date,
                status,
                is_locked,
                name
            ) VALUES (
                p_org_id,
                v_current_date,
                v_current_date,
                v_current_date,
                'draft',
                false,
                to_char(v_current_date, 'Day DD Mon YYYY')
            )
            RETURNING id INTO v_roster_id;
        END IF;

        -- 2. Ensure Group Exists (Idempotent)
        -- We use a simple select/insert because roster_groups constraint might not be perfect or we want to be tailored
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
        -- Only insert if it doesn't exist for this group
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
