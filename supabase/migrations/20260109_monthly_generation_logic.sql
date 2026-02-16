-- Migration: Monthly Roster Generation (Merge/Append)
-- Date: 2026-01-09
-- Purpose: Implement the stored procedure to apply a template to an entire month

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
    v_template_group_record RECORD;
    v_template_subgroup_record RECORD;
    v_template_shift_record RECORD;
    v_roster_day_id UUID;
    v_roster_group_id UUID;
    v_roster_subgroup_id UUID;
    v_shifts_created INTEGER := 0;
    v_days_processed INTEGER := 0;
BEGIN
    -- 1. Calculate start and end dates for the month
    BEGIN
        v_start_date := (p_month || '-01')::DATE;
        v_end_date := (v_start_date + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid month format. Expected YYYY-MM');
    END;

    -- 2. Verify Template Exists
    IF NOT EXISTS (SELECT 1 FROM roster_templates WHERE id = p_template_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template not found');
    END IF;

    -- 3. Loop through each day of the month
    v_curr_date := v_start_date;
    WHILE v_curr_date <= v_end_date LOOP
        
        -- A. Ensure roster_day exists
        -- Note: Trigger trigger_seed_fixed_roster_groups will auto-create the 3 fixed groups
        INSERT INTO roster_days (organization_id, date)
        VALUES (p_organization_id, v_curr_date)
        ON CONFLICT (organization_id, date) DO UPDATE 
        SET updated_at = NOW()
        RETURNING id INTO v_roster_day_id;

        -- B. Process Groups defined in the template
        -- We iterate through template_groups to sync subgroups and shifts
        FOR v_template_group_record IN 
            SELECT * FROM template_groups WHERE template_id = p_template_id
        LOOP
            -- Get corresponding roster_group_id
            -- Since the trigger auto-creates them, we just fetch
            SELECT id INTO v_roster_group_id 
            FROM roster_groups 
            WHERE roster_day_id = v_roster_day_id AND name = v_template_group_record.name;

            -- If for some reason it doesn't exist (e.g. manually deleted), create it
            IF v_roster_group_id IS NULL THEN
                INSERT INTO roster_groups (roster_day_id, name, color, icon, sort_order)
                VALUES (
                    v_roster_day_id, 
                    v_template_group_record.name, 
                    v_template_group_record.color, 
                    v_template_group_record.icon, 
                    v_template_group_record.sort_order
                )
                RETURNING id INTO v_roster_group_id;
            END IF;

            -- C. Process Subgroups
            FOR v_template_subgroup_record IN 
                SELECT * FROM template_subgroups WHERE group_id = v_template_group_record.id
            LOOP
                -- Sync subgroup to roster
                INSERT INTO roster_subgroups (group_id, name, template_subgroup_id, sort_order)
                VALUES (
                    v_roster_group_id, 
                    v_template_subgroup_record.name, 
                    v_template_subgroup_record.id, 
                    v_template_subgroup_record.sort_order
                )
                ON CONFLICT (group_id, name) DO UPDATE 
                SET template_subgroup_id = EXCLUDED.template_subgroup_id,
                    sort_order = EXCLUDED.sort_order
                RETURNING id INTO v_roster_subgroup_id;

                -- D. Process Shifts (The "Append" Logic)
                FOR v_template_shift_record IN 
                    SELECT * FROM template_shifts WHERE subgroup_id = v_template_subgroup_record.id
                LOOP
                    -- Insert only if this specific template shift hasn't been applied to this day yet
                    -- This prevents duplicates on mid-month updates (Append strategy)
                    IF NOT EXISTS (
                        SELECT 1 FROM roster_shifts 
                        WHERE subgroup_id = v_roster_subgroup_id 
                        AND template_shift_id = v_template_shift_record.id
                    ) THEN
                        -- Create the roster shift
                        -- Note: assigned_employee_id remains NULL (unfilled)
                        INSERT INTO roster_shifts (
                            subgroup_id,
                            template_shift_id,
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
                            is_draft,
                            is_published,
                            is_manual,
                            sort_order
                        )
                        VALUES (
                            v_roster_subgroup_id,
                            v_template_shift_record.id,
                            v_template_shift_record.role_id,
                            v_template_shift_record.role_name,
                            v_template_shift_record.remuneration_level_id,
                            v_template_shift_record.remuneration_level,
                            v_template_shift_record.start_time,
                            v_template_shift_record.end_time,
                            v_template_shift_record.paid_break_minutes,
                            v_template_shift_record.unpaid_break_minutes,
                            v_template_shift_record.required_skills,
                            v_template_shift_record.required_licenses,
                            v_template_shift_record.site_tags,
                            v_template_shift_record.event_tags,
                            v_template_shift_record.notes,
                            TRUE,  -- Always start as draft
                            FALSE, -- Not published yet
                            FALSE, -- This is a template shift, not manual
                            v_template_shift_record.sort_order
                        );
                        v_shifts_created := v_shifts_created + 1;
                    END IF;
                END LOOP;
            END LOOP;
        END LOOP;

        v_days_processed := v_days_processed + 1;
        v_curr_date := v_curr_date + 1;
    END LOOP;

    -- Update template status
    UPDATE roster_templates 
    SET status = 'published', 
        published_at = NOW() 
    WHERE id = p_template_id;

    RETURN jsonb_build_object(
        'success', true, 
        'days_processed', v_days_processed,
        'shifts_created', v_shifts_created,
        'month', p_month
    );
END;
$$;
