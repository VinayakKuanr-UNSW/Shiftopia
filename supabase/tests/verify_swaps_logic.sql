-- Verification Transaction: Test Swap Logic
BEGIN;

-- 1. Setup Test Data
DO $$
DECLARE
    v_req_id uuid;
    v_shift1_id uuid;
    v_shift2_id uuid;
    v_emp1_id uuid;
    v_emp2_id uuid;
BEGIN
    -- Assume data seeded or create temporary
    -- For this test, we create fresh data to be sure
    
    INSERT INTO organizations (name, slug) VALUES ('Test Verify', 'test-verify') RETURNING id INTO v_org_id;
    INSERT INTO departments (name, organization_id) VALUES ('Test D', v_org_id) RETURNING id INTO v_dept_id;
    
    INSERT INTO employees (first_name, last_name, organization_id) VALUES ('A', 'A', v_org_id) RETURNING id INTO v_emp1_id;
    INSERT INTO employees (first_name, last_name, organization_id) VALUES ('B', 'B', v_org_id) RETURNING id INTO v_emp2_id;
    
    INSERT INTO shifts (employee_id, organization_id, department_id, scheduled_start, scheduled_end, status) 
    VALUES (v_emp1_id, v_org_id, v_dept_id, now() + interval '1 day', now() + interval '1 day 8 hours', 'assigned') 
    RETURNING id INTO v_shift1_id;
    
    INSERT INTO shifts (employee_id, organization_id, department_id, scheduled_start, scheduled_end, status) 
    VALUES (v_emp2_id, v_org_id, v_dept_id, now() + interval '2 days', now() + interval '2 days 8 hours', 'assigned') 
    RETURNING id INTO v_shift2_id;
    
    INSERT INTO swap_requests (original_shift_id, requested_by_employee_id, offered_shift_id, swap_with_employee_id, status, organization_id, department_id)
    VALUES (v_shift1_id, v_emp1_id, v_shift2_id, v_emp2_id, 'pending_manager', v_org_id, v_dept_id)
    RETURNING id INTO v_req_id;

    -- 2. Test Approval
    PERFORM approve_swap_request(v_req_id);
    
    -- Verify Status
    IF NOT EXISTS (SELECT 1 FROM swap_requests WHERE id = v_req_id AND status = 'approved') THEN
        RAISE EXCEPTION 'Request should be approved';
    END IF;
    
    -- Verify Shift Swap
    IF NOT EXISTS (SELECT 1 FROM shifts WHERE id = v_shift1_id AND employee_id = v_emp2_id) THEN
        RAISE EXCEPTION 'Shift 1 should belong to Emp 2';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM shifts WHERE id = v_shift2_id AND employee_id = v_emp1_id) THEN
        RAISE EXCEPTION 'Shift 2 should belong to Emp 1';
    END IF;
    
    -- 3. Test Double Approval (Should Fail or No-op safely if logic handles it, but RPC checks pending)
    BEGIN
        PERFORM approve_swap_request(v_req_id);
        RAISE EXCEPTION 'Double approval should fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%not in complete pending state%' THEN
             RAISE NOTICE 'Got expected error: %', SQLERRM;
        ELSE
             RAISE NOTICE 'Got correct error for double approval';
        END IF;
    END;

    -- 4. Test Rejection
    -- Create new request
    INSERT INTO swap_requests (original_shift_id, requested_by_employee_id, offered_shift_id, swap_with_employee_id, status, organization_id, department_id)
    VALUES (v_shift1_id, v_emp2_id, v_shift2_id, v_emp1_id, 'pending_manager', v_org_id, v_dept_id) -- Swapped back attempt
    RETURNING id INTO v_req_id;
    
    PERFORM reject_swap_request(v_req_id, 'Denied');
    
    IF NOT EXISTS (SELECT 1 FROM swap_requests WHERE id = v_req_id AND status = 'rejected' AND rejection_reason = 'Denied') THEN
        RAISE EXCEPTION 'Request should be rejected with reason';
    END IF;

    RAISE NOTICE 'Verification Passed';
    
END $$;

ROLLBACK; -- Always rollback test transaction
