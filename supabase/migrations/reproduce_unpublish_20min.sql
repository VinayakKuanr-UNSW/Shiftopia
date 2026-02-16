DO $$
DECLARE
    v_shift_id UUID;
    v_template_shift RECORD;
    v_res JSONB;
BEGIN
    -- 0. Copy an existing valid shift structure
    SELECT * INTO v_template_shift FROM shifts LIMIT 1;
    
    IF v_template_shift IS NULL THEN
        RAISE EXCEPTION 'No existing shifts found to clone from';
    END IF;

    -- 1. Create a dummy S6 shift (Starts in 20 minutes)
    INSERT INTO shifts (
        roster_id,
        organization_id,
        department_id,
        sub_department_id,
        role_id, 
        start_time, 
        end_time, 
        shift_date, 
        lifecycle_status, 
        is_published, 
        is_draft,
        assigned_employee_id, 
        assignment_outcome,
        is_on_bidding,
        is_urgent,
        bidding_enabled,
        sub_group_name,
        group_type
    ) VALUES (
        v_template_shift.roster_id,
        v_template_shift.organization_id,
        v_template_shift.department_id,
        v_template_shift.sub_department_id,
        v_template_shift.role_id,
        (NOW() + INTERVAL '20 minutes')::time,
        (NOW() + INTERVAL '4 hours')::time,
        CURRENT_DATE,
        'published',
        TRUE,
        FALSE,
        NULL,
        NULL,
        TRUE,
        TRUE,
        TRUE,
        v_template_shift.sub_group_name,
        v_template_shift.group_type
    ) RETURNING id INTO v_shift_id;
    
    RAISE NOTICE 'Created Shift: %', v_shift_id;

    -- 2. Attempt Unpublish
    BEGIN
        v_res := unpublish_shift(v_shift_id);
        RAISE NOTICE 'Success: %', v_res;
        
        -- Force output to be visible if it succeeds
        PERFORM set_config('my.test_result', v_res::text, false);
        
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Unpublish Failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
    END;
END $$;
