-- Seed test data for Swap Requests
DO $$
DECLARE
    v_org_id uuid;
    v_dept_id uuid;
    v_emp1_id uuid;
    v_emp2_id uuid;
    v_shift1_id uuid;
    v_shift2_id uuid;
    v_request_id uuid;
BEGIN
    -- Get or create Org/Dept
    SELECT id INTO v_org_id FROM organizations LIMIT 1;
    IF v_org_id IS NULL THEN
        INSERT INTO organizations (name, slug) VALUES ('Test Org', 'test-org') RETURNING id INTO v_org_id;
    END IF;
    
    SELECT id INTO v_dept_id FROM departments WHERE organization_id = v_org_id LIMIT 1;
    IF v_dept_id IS NULL THEN
        INSERT INTO departments (name, organization_id) VALUES ('Test Dept', v_org_id) RETURNING id INTO v_dept_id;
    END IF;

    -- Get or create Employees (linked to auth.users if possible, but just employees table for FKs)
    SELECT id INTO v_emp1_id FROM employees WHERE organization_id = v_org_id LIMIT 1;
    IF v_emp1_id IS NULL THEN
         -- Create dummy employee if none
         -- (Assuming employees table structure, minimal fields)
         INSERT INTO employees (first_name, last_name, organization_id, status) 
         VALUES ('John', 'Doe', v_org_id, 'active') RETURNING id INTO v_emp1_id;
    END IF;

    SELECT id INTO v_emp2_id FROM employees WHERE organization_id = v_org_id AND id <> v_emp1_id LIMIT 1;
    IF v_emp2_id IS NULL THEN
         INSERT INTO employees (first_name, last_name, organization_id, status) 
         VALUES ('Jane', 'Smith', v_org_id, 'active') RETURNING id INTO v_emp2_id;
    END IF;

    -- Create Future Shifts
    -- Shift 1: Employee 1, 2 days from now
    INSERT INTO shifts (employee_id, organization_id, department_id, scheduled_start, scheduled_end, status)
    VALUES (
        v_emp1_id, 
        v_org_id, 
        v_dept_id, 
        (now() + interval '2 days')::timestamptz, 
        (now() + interval '2 days' + interval '8 hours')::timestamptz,
        'assigned'
    ) RETURNING id INTO v_shift1_id;

    -- Shift 2: Employee 2, 3 days from now
    INSERT INTO shifts (employee_id, organization_id, department_id, scheduled_start, scheduled_end, status)
    VALUES (
        v_emp2_id, 
        v_org_id, 
        v_dept_id, 
        (now() + interval '3 days')::timestamptz, 
        (now() + interval '3 days' + interval '8 hours')::timestamptz,
        'assigned'
    ) RETURNING id INTO v_shift2_id;

    -- Create Pending Swap Request
    INSERT INTO swap_requests (
        original_shift_id,
        requested_by_employee_id,
        swap_with_employee_id,
        offered_shift_id,
        reason,
        status,
        priority,
        organization_id,
        department_id,
        open_swap
    ) VALUES (
        v_shift1_id,
        v_emp1_id,
        v_emp2_id,
        v_shift2_id,
        'Seed Data: High Priority Swap',
        'pending_manager',
        'high',
        v_org_id,
        v_dept_id,
        false
    ) RETURNING id INTO v_request_id;

    -- Log creation in audit
    INSERT INTO swap_audit_logs (swap_request_id, previous_status, new_status, reason)
    VALUES (v_request_id, NULL, 'pending_manager', 'Initial Seed creation');

END $$;
