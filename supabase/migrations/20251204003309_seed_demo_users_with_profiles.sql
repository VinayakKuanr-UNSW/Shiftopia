/*
  # Seed Demo Users and User Profiles

  ## Overview
  This migration creates demo employees and sets up their user profiles
  for testing the application with different roles.

  ## Demo Accounts Created
  - admin@example.com (Admin - IT department, full access)
  - manager@example.com (Manager - Convention Centre department)
  - teamlead@example.com (Team Lead - Exhibition Centre department)
  - member@example.com (Member - Theatre department)

  ## Important Notes
  - Auth users must be created manually via Supabase Dashboard
  - After creating auth users, run the provided SQL to link them to profiles
  - Employee records are created here for reference
*/

DO $$
DECLARE
  v_org_id uuid;
  v_it_dept_id uuid;
  v_convention_dept_id uuid;
  v_exhibition_dept_id uuid;
  v_theatre_dept_id uuid;
  v_admin_employee_id uuid;
  v_manager_employee_id uuid;
  v_teamlead_employee_id uuid;
  v_member_employee_id uuid;
BEGIN
  -- Get organization and department IDs
  SELECT id INTO v_org_id FROM organizations WHERE name = 'ICC Sydney' LIMIT 1;
  SELECT id INTO v_it_dept_id FROM departments WHERE name = 'IT' AND organization_id = v_org_id LIMIT 1;
  SELECT id INTO v_convention_dept_id FROM departments WHERE name = 'Convention Centre' AND organization_id = v_org_id LIMIT 1;
  SELECT id INTO v_exhibition_dept_id FROM departments WHERE name = 'Exhibition Centre' AND organization_id = v_org_id LIMIT 1;
  SELECT id INTO v_theatre_dept_id FROM departments WHERE name = 'Theatre' AND organization_id = v_org_id LIMIT 1;

  -- Create or update demo employees
  INSERT INTO employees (first_name, last_name, email, phone, employee_id, status, employment_type)
  VALUES ('Admin', 'User', 'admin@example.com', '+61 400 000 100', 'EMP-ADMIN', 'Active', 'Full-time')
  ON CONFLICT (email) DO UPDATE SET 
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    employee_id = EXCLUDED.employee_id
  RETURNING id INTO v_admin_employee_id;

  INSERT INTO employees (first_name, last_name, email, phone, employee_id, status, employment_type)
  VALUES ('Manager', 'User', 'manager@example.com', '+61 400 000 101', 'EMP-MANAGER', 'Active', 'Full-time')
  ON CONFLICT (email) DO UPDATE SET 
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    employee_id = EXCLUDED.employee_id
  RETURNING id INTO v_manager_employee_id;

  INSERT INTO employees (first_name, last_name, email, phone, employee_id, status, employment_type)
  VALUES ('Team', 'Lead', 'teamlead@example.com', '+61 400 000 102', 'EMP-TEAMLEAD', 'Active', 'Full-time')
  ON CONFLICT (email) DO UPDATE SET 
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    employee_id = EXCLUDED.employee_id
  RETURNING id INTO v_teamlead_employee_id;

  INSERT INTO employees (first_name, last_name, email, phone, employee_id, status, employment_type)
  VALUES ('Team', 'Member', 'member@example.com', '+61 400 000 103', 'EMP-MEMBER', 'Active', 'Casual')
  ON CONFLICT (email) DO UPDATE SET 
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    employee_id = EXCLUDED.employee_id
  RETURNING id INTO v_member_employee_id;

  -- Output instructions for linking auth users to profiles
  RAISE NOTICE '========================================================================';
  RAISE NOTICE 'Demo employees created successfully!';
  RAISE NOTICE '========================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'TO COMPLETE SETUP:';
  RAISE NOTICE '1. Create auth users in Supabase Dashboard (Authentication > Users)';
  RAISE NOTICE '   - Email: admin@example.com, Password: admin123';
  RAISE NOTICE '   - Email: manager@example.com, Password: manager123';
  RAISE NOTICE '   - Email: teamlead@example.com, Password: teamlead123';
  RAISE NOTICE '   - Email: member@example.com, Password: member123';
  RAISE NOTICE '';
  RAISE NOTICE '2. Note each user''s UUID after creation';
  RAISE NOTICE '';
  RAISE NOTICE '3. Run this SQL to create profiles (replace <uuid> with actual IDs):';
  RAISE NOTICE '';
  RAISE NOTICE 'INSERT INTO user_profiles (id, employee_id, role, organization_id, department_id, can_access_all_departments)';
  RAISE NOTICE 'VALUES';
  RAISE NOTICE '  (''<admin-uuid>'', ''%'', ''admin'', ''%'', ''%'', true),',
    v_admin_employee_id, v_org_id, v_it_dept_id;
  RAISE NOTICE '  (''<manager-uuid>'', ''%'', ''manager'', ''%'', ''%'', false),',
    v_manager_employee_id, v_org_id, v_convention_dept_id;
  RAISE NOTICE '  (''<teamlead-uuid>'', ''%'', ''teamlead'', ''%'', ''%'', false),',
    v_teamlead_employee_id, v_org_id, v_exhibition_dept_id;
  RAISE NOTICE '  (''<member-uuid>'', ''%'', ''member'', ''%'', ''%'', false);',
    v_member_employee_id, v_org_id, v_theatre_dept_id;
  RAISE NOTICE '';
  RAISE NOTICE '========================================================================';

END $$;
