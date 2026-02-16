-- Verification: Roster JSON Sync
-- Date: 2026-02-11

BEGIN;

-- 1. Setup Test Data
DO $$
DECLARE
  v_org_id uuid := gen_random_uuid();
  v_dept_id uuid := gen_random_uuid();
  v_shift_id uuid := gen_random_uuid();
  v_roster_id uuid := gen_random_uuid();
  v_employee_id uuid := gen_random_uuid(); -- New employee to assign
  v_initial_json jsonb;
  v_updated_json jsonb;
  v_result_employee_id text;
BEGIN
  -- Create Organization
  INSERT INTO organizations (id, name, slug) VALUES (v_org_id, 'Test Org', 'test-org');
  
  -- Create Department
  INSERT INTO departments (id, organization_id, name) VALUES (v_dept_id, v_org_id, 'Test Dept');

  -- Create Employee Profile
  INSERT INTO profiles (id, organization_id, first_name, last_name, email, status) 
  VALUES (v_employee_id, v_org_id, 'Test', 'Employee', 'test@example.com', 'active');

  -- Create Shift (initially unassigned)
  INSERT INTO shifts (
    id, organization_id, department_id, sub_department_id, 
    date, start_time, end_time, status, assigned_employee_id
  ) VALUES (
    v_shift_id, v_org_id, v_dept_id, v_dept_id, -- using dept as subdept for simplicity
    CURRENT_DATE, '09:00', '17:00', 'published', NULL
  );

  -- Create Roster with JSON containing the shift
  -- Structure: groups -> subGroups -> shifts
  v_initial_json := jsonb_build_array(
    jsonb_build_object(
        'id', 1,
        'subGroups', jsonb_build_array(
            jsonb_build_object(
                'id', 1,
                'shifts', jsonb_build_array(
                    jsonb_build_object(
                        'id', v_shift_id,
                        'status', 'Open',
                        'employeeId', null
                    )
                )
            )
        )
    )
  );

  INSERT INTO rosters (id, organization_id, department_id, date, status, groups)
  VALUES (v_roster_id, v_org_id, v_dept_id, CURRENT_DATE, 'published', v_initial_json);

  -- 2. Execute Test: Update Shift and Sync
  
  -- A. Update the shift to be assigned to the employee
  UPDATE shifts 
  SET assigned_employee_id = v_employee_id 
  WHERE id = v_shift_id;

  -- B. Run the Sync Function
  PERFORM sync_roster_shift_assignment(v_shift_id);

  -- 3. Verify Result
  SELECT groups INTO v_updated_json FROM rosters WHERE id = v_roster_id;
  
  -- Check existing legacy employeeId field
  v_result_employee_id := v_updated_json->0->'subGroups'->0->'shifts'->0->>'employeeId';
  
  IF v_result_employee_id = v_employee_id::text THEN
    RAISE NOTICE 'SUCCESS: Roster JSON updated correctly. EmployeeID: %', v_result_employee_id;
  ELSE
    RAISE EXCEPTION 'FAILURE: Roster JSON not updated. Expected %, got %', v_employee_id, v_result_employee_id;
  END IF;

  -- Check new assignment object
  IF (v_updated_json->0->'subGroups'->0->'shifts'->0->'assignment'->>'employeeId') = v_employee_id::text THEN
    RAISE NOTICE 'SUCCESS: Assignment object present and correct';
  ELSE
    RAISE WARNING 'WARNING: Assignment object missing or incorrect';
  END IF;

END;
$$;

ROLLBACK; -- Clean up
