-- Update the apply_template_to_date_range_v2 RPC to include legacy columns for the UI
-- Removed items_count and deleted_at as they don't exist in the current schema.
-- Fixed syntax errors (END LOOP).

CREATE OR REPLACE FUNCTION public.apply_template_to_date_range_v2(
    p_template_id uuid,
    p_start_date date,
    p_end_date date,
    p_user_id uuid,
    p_force_stack boolean DEFAULT false,
    p_source text DEFAULT 'roster_modal'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
    v_template record;
    v_curr_date date;
    v_roster_id uuid;
    v_batch_id uuid;
    v_total_shifts integer := 0;
    v_tg record;   -- Template Group
    v_tsg record;  -- Template Subgroup
    v_ts record;   -- Template Shift
    v_rg_id uuid;  -- Roster Group ID
    v_rsg_id uuid; -- Roster Subgroup ID
    v_external_id text;
    v_shift_start_timestamp timestamptz;
    v_shift_end_timestamp timestamptz;
BEGIN
    -- 1. Fetch Template
    SELECT * INTO v_template FROM roster_templates WHERE id = p_template_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template not found');
    END IF;

    -- 2. Create Template Batch record
    INSERT INTO roster_template_batches (
        template_id, applied_at, applied_by, start_date, end_date, source
    )
    VALUES (
        p_template_id, now(), p_user_id, p_start_date, p_end_date, p_source
    )
    RETURNING id INTO v_batch_id;

    -- 3. Loop through date range
    FOR v_curr_date IN (SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date) LOOP
        
        -- 4. Find or Create Roster for this date
        SELECT id INTO v_roster_id 
        FROM rosters 
        WHERE start_date = v_curr_date 
          AND department_id = v_template.department_id
          AND sub_department_id = v_template.sub_department_id
        LIMIT 1;

        IF v_roster_id IS NULL THEN
            INSERT INTO rosters (
                start_date, end_date, template_id, organization_id,
                department_id, sub_department_id,
                description, status, is_locked, created_by
            )
            VALUES (
                v_curr_date, v_curr_date, p_template_id, v_template.organization_id,
                v_template.department_id, v_template.sub_department_id,
                v_template.description, 'draft', false, p_user_id
            )
            RETURNING id INTO v_roster_id;

            -- Auto-create groups for the new roster
            FOR v_tg IN (SELECT * FROM template_groups WHERE template_id = p_template_id) LOOP
                -- Look up the canonical group type based on name if external_id is missing
                v_external_id := CASE LOWER(REPLACE(v_tg.name, ' ', '_'))
                    WHEN 'convention_centre' THEN 'convention_centre'
                    WHEN 'exhibition_centre' THEN 'exhibition_centre'
                    WHEN 'theatre' THEN 'theatre'
                    ELSE LOWER(REPLACE(v_tg.name, ' ', '_'))
                END;
                
                -- Refined mapping for Exhibition Centre
                IF LOWER(v_tg.name) = 'exhibition centre' THEN
                    v_external_id := 'exhibition_centre';
                END IF;

                INSERT INTO roster_groups (roster_id, name, external_id, color, sort_order)
                VALUES (v_roster_id, v_tg.name, v_external_id, v_tg.color, v_tg.sort_order)
                RETURNING id INTO v_rg_id;

                FOR v_tsg IN (SELECT * FROM template_subgroups WHERE group_id = v_tg.id) LOOP
                    INSERT INTO roster_subgroups (roster_group_id, name, sort_order)
                    VALUES (v_rg_id, v_tsg.name, v_tsg.sort_order);
                END LOOP;
            END LOOP;
        END IF;

        -- 5. Insert shifts from template for this date
        FOR v_tg IN (SELECT * FROM template_groups WHERE template_id = p_template_id) LOOP
            
            -- Re-calc external ID for legacy columns
            v_external_id := CASE LOWER(REPLACE(v_tg.name, ' ', '_'))
                WHEN 'convention_centre' THEN 'convention_centre'
                WHEN 'exhibition_centre' THEN 'exhibition_centre'
                WHEN 'theatre' THEN 'theatre'
                ELSE LOWER(REPLACE(v_tg.name, ' ', '_'))
            END;

            FOR v_tsg IN (SELECT * FROM template_subgroups WHERE group_id = v_tg.id) LOOP
                -- Find the corresponding roster subgroup
                SELECT rsg.id INTO v_rsg_id
                FROM roster_subgroups rsg
                JOIN roster_groups rg ON rsg.roster_group_id = rg.id
                WHERE rg.roster_id = v_roster_id
                  AND rg.name = v_tg.name
                  AND rsg.name = v_tsg.name;

                FOR v_ts IN (SELECT * FROM template_shifts WHERE subgroup_id = v_tsg.id) LOOP
                    v_shift_start_timestamp := (v_curr_date || ' ' || v_ts.start_time)::timestamp AT TIME ZONE 'Australia/Sydney';
                    v_shift_end_timestamp := (v_curr_date || ' ' || v_ts.end_time)::timestamp AT TIME ZONE 'Australia/Sydney';
                    
                    IF v_ts.end_time < v_ts.start_time THEN
                        v_shift_end_timestamp := v_shift_end_timestamp + interval '1 day';
                    END IF;

                    INSERT INTO shifts (
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
                        lifecycle_status, notes, assigned_employee_id
                    )
                    VALUES (
                        v_roster_id, v_template.organization_id, v_template.department_id, v_template.sub_department_id,
                        v_ts.role_id, v_curr_date, v_ts.start_time, v_ts.end_time,
                        v_shift_start_timestamp, v_shift_end_timestamp, 'Australia/Sydney',
                        COALESCE(v_ts.paid_break_minutes, 0), COALESCE(v_ts.unpaid_break_minutes, 0),
                        p_template_id, v_ts.id, true,
                        v_batch_id,
                        v_rsg_id,
                        v_external_id::template_group_type,
                        v_tsg.name,
                        v_external_id::template_group_type,
                        v_tsg.name,
                        'Draft', v_ts.notes, v_ts.assigned_employee_id
                    );
                    
                    v_total_shifts := v_total_shifts + 1;
                END LOOP;
            END LOOP;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true, 
        'shifts_created', v_total_shifts, 
        'batch_id', v_batch_id,
        'roster_id', v_roster_id
    );
END;
$body$;
