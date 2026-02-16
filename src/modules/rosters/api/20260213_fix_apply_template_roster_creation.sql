-- ==============================================================================
-- FIX: ENSURE ROSTER CREATION FOR PAST DATES
-- 1. Updates apply_template_to_date_range_v2 to ALWAYS create a roster entry for the date,
--    even if the date is in the past.
-- 2. Retains logic to SKIP creating SHIFTS if the shift time has passed.
-- 3. This resolves the frontend "Lazy Creation" race condition by ensuring rosters exist.
-- ==============================================================================

CREATE OR REPLACE FUNCTION apply_template_to_date_range_v2(
    p_template_id uuid,
    p_start_date date,
    p_end_date date,
    p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
    v_sydney_now TIMESTAMPTZ;
    v_shift_start_timestamp TIMESTAMPTZ;
    v_external_id TEXT;
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

        -- Get current Sydney time once per day loop
        v_sydney_now := NOW() AT TIME ZONE 'Australia/Sydney';

        -- [CHANGED] REMOVED THE "SKIP IF DATE IN PAST" BLOCK
        -- We WANT to create the roster structure even if the date is past.
        -- original:
        -- IF v_curr_date < v_sydney_now::date THEN
        --     v_curr_date := v_curr_date + 1;
        --     CONTINUE;
        -- END IF;

        -- A. Create or get roster (ALWAYS RUNS NOW)
        BEGIN
            INSERT INTO rosters (
                date, start_date, end_date, template_id, organization_id,
                department_id, sub_department_id,
                name, description,
                groups, -- Legacy JSON
                status, is_locked, created_by
            )
            VALUES (
                v_curr_date, v_curr_date, v_curr_date, p_template_id, v_template.organization_id,
                v_template.department_id, v_template.sub_department_id,
                v_template.name || ' - ' || to_char(v_curr_date, 'DD Mon YYYY'),
                v_template.description,
                '[]'::jsonb,
                'draft', false, p_user_id
            )
            RETURNING id INTO v_roster_id;
        EXCEPTION WHEN unique_violation THEN
            SELECT id INTO v_roster_id FROM rosters
            WHERE date = v_curr_date AND department_id = v_template.department_id;
        END;

        -- B. Loop through Template Groups
        FOR v_tg IN SELECT * FROM template_groups WHERE template_id = p_template_id ORDER BY sort_order LOOP

            -- DETERMINE EXTERNAL ID
            v_external_id := CASE LOWER(REPLACE(v_tg.name, ' ', '_'))
                WHEN 'convention_centre' THEN 'convention_centre'
                WHEN 'exhibition_centre' THEN 'exhibition_centre'
                WHEN 'theatre' THEN 'theatre'
                ELSE NULL
            END;

            -- Create Roster Group (Idempotent check)
            SELECT id INTO v_rg_id FROM roster_groups WHERE roster_id = v_roster_id AND name = v_tg.name LIMIT 1;

            IF v_rg_id IS NULL THEN
                INSERT INTO roster_groups (roster_id, name, sort_order, external_id)
                VALUES (v_roster_id, v_tg.name, v_tg.sort_order, v_external_id)
                RETURNING id INTO v_rg_id;
            ELSE
                 -- Update external_id if missing
                 UPDATE roster_groups SET external_id = v_external_id WHERE id = v_rg_id AND external_id IS NULL;
            END IF;

            -- C. Loop through Template SubGroups
            FOR v_tsg IN SELECT * FROM template_subgroups WHERE group_id = v_tg.id ORDER BY sort_order LOOP

                -- Create Roster SubGroup (Check existence)
                SELECT id INTO v_rsg_id FROM roster_subgroups WHERE roster_group_id = v_rg_id AND name = v_tsg.name LIMIT 1;

                IF v_rsg_id IS NULL THEN
                    INSERT INTO roster_subgroups (roster_group_id, name, sort_order)
                    VALUES (v_rg_id, v_tsg.name, v_tsg.sort_order)
                    RETURNING id INTO v_rsg_id;
                END IF;

                -- D. Loop through Template Shifts
                FOR v_ts IN SELECT * FROM template_shifts WHERE subgroup_id = v_tsg.id LOOP

                    -- TEMPORAL CHECK: Skip if shift start time has passed (Sydney Time)
                    -- [KEPT] We still want to avoid creating shifts in the past
                    v_shift_start_timestamp := (v_curr_date || ' ' || v_ts.start_time)::timestamp AT TIME ZONE 'Australia/Sydney';

                    IF v_shift_start_timestamp < v_sydney_now THEN
                        CONTINUE; -- Skip this shift
                    END IF;

                    -- Check duplicates
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

                            -- Legacy Columns
                            v_external_id::template_group_type,
                            v_tsg.name,

                            v_external_id::template_group_type,
                            v_tsg.name,

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

    -- 4. UPDATE TEMPLATE STATUS TO PUBLISHED & SATISFY CONSTRAINTS
    UPDATE roster_templates
    SET 
        status = 'published',
        updated_at = NOW(),
        last_used_at = NOW(),
        version = COALESCE(version, 1),
        is_active = true
    WHERE id = p_template_id;

    RETURN jsonb_build_object(
        'success', true,
        'days_processed', v_days_processed,
        'shifts_created', v_shifts_created
    );
END;
$$;
