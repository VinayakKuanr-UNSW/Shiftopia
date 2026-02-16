DO $$
DECLARE
    v_shift_id UUID;
    v_res JSONB;
BEGIN
    -- 1. Create a dummy S6 shift (Starts in 1.5 hours)
    INSERT INTO shifts (
        role_id, 
        start_time, 
        end_time, 
        shift_date, 
        lifecycle_status, 
        is_published, 
        assigned_employee_id, 
        assignment_outcome,
        is_on_bidding,
        is_urgent,
        bidding_enabled
    ) VALUES (
        (SELECT id FROM roles LIMIT 1),
        (NOW() + INTERVAL '1 hour 30 minutes')::time,
        (NOW() + INTERVAL '5 hours')::time,
        CURRENT_DATE,
        'published',
        TRUE,
        NULL,
        NULL,
        TRUE,
        TRUE,
        TRUE
    ) RETURNING id INTO v_shift_id;
    
    RAISE NOTICE 'Created Shift: %', v_shift_id;

    -- 2. Attempt Unpublish
    BEGIN
        v_res := unpublish_shift(v_shift_id);
        RAISE NOTICE 'Success: %', v_res;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Caught Exception: % %', SQLERRM, SQLSTATE;
    END;

    -- Cleanup
    -- DELETE FROM shifts WHERE id = v_shift_id;
END $$;
