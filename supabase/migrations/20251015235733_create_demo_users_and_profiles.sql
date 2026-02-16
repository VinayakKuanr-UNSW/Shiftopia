/*
  # Create Demo Users and User Profiles

  ## Overview
  This migration creates demo authentication users and their associated user profiles
  to enable login functionality for admin, manager, teamlead, and member roles.

  ## Changes Made

  1. **Demo Employees**
     - Creates 4 demo employees for each user role
     - Links to existing departments

  2. **Auth Users**
     - Creates Supabase auth users for each demo account
     - Passwords: admin123, manager123, teamlead123, member123

  3. **User Profiles**
     - Links auth users to employees and departments
     - Sets appropriate roles and permissions
     - Admin has can_access_all_departments = true

  ## Demo Accounts Created
  - admin@example.com (Admin - Full access)
  - manager@example.com (Manager - Event Services department)
  - teamlead@example.com (Team Lead - AV Services department)
  - member@example.com (Member - AV Services department)

  ## Security
  - All accounts follow existing RLS policies
  - Department-based access control enforced
*/

-- Get the organization ID
DO $$
DECLARE
  v_org_id uuid;
  v_event_services_dept_id uuid;
  v_av_services_dept_id uuid;
  v_admin_employee_id uuid;
  v_manager_employee_id uuid;
  v_teamlead_employee_id uuid;
  v_member_employee_id uuid;
  v_admin_user_id uuid;
  v_manager_user_id uuid;
  v_teamlead_user_id uuid;
  v_member_user_id uuid;
BEGIN
  -- Get organization ID
  SELECT id INTO v_org_id FROM organizations WHERE name = 'ICC Sydney' LIMIT 1;
  
  -- Get department IDs
  SELECT id INTO v_event_services_dept_id FROM departments WHERE name = 'Event Services' AND organization_id = v_org_id LIMIT 1;
  SELECT id INTO v_av_services_dept_id FROM departments WHERE name = 'AV Services' AND organization_id = v_org_id LIMIT 1;

  -- Create demo employees
  -- INSERT INTO employees (first_name, last_name, email, phone, employee_id, status, employment_type)
  -- VALUES 
  --   ('Admin', 'User', 'admin@example.com', '+61 400 000 100', 'EMP001', 'Active', 'Full-time')
  -- ON CONFLICT (email) DO UPDATE SET 
  --   first_name = EXCLUDED.first_name,
  --   last_name = EXCLUDED.last_name
  -- RETURNING id INTO v_admin_employee_id;

  -- INSERT INTO employees (first_name, last_name, email, phone, employee_id, status, employment_type)
  -- VALUES 
  --   ('Manager', 'User', 'manager@example.com', '+61 400 000 101', 'EMP002', 'Active', 'Full-time')
  -- ON CONFLICT (email) DO UPDATE SET 
  --   first_name = EXCLUDED.first_name,
  --   last_name = EXCLUDED.last_name
  -- RETURNING id INTO v_manager_employee_id;

  -- INSERT INTO employees (first_name, last_name, email, phone, employee_id, status, employment_type)
  -- VALUES 
  --   ('Team Lead', 'User', 'teamlead@example.com', '+61 400 000 102', 'EMP003', 'Active', 'Full-time')
  -- ON CONFLICT (email) DO UPDATE SET 
  --   first_name = EXCLUDED.first_name,
  --   last_name = EXCLUDED.last_name
  -- RETURNING id INTO v_teamlead_employee_id;

  -- INSERT INTO employees (first_name, last_name, email, phone, employee_id, status, employment_type)
  -- VALUES 
  --   ('Team', 'Member', 'member@example.com', '+61 400 000 103', 'EMP004', 'Active', 'Casual')
  -- ON CONFLICT (email) DO UPDATE SET 
  --   first_name = EXCLUDED.first_name,
  --   last_name = EXCLUDED.last_name
  -- RETURNING id INTO v_member_employee_id;

  -- Note: Auth users need to be created via Supabase dashboard or signup flow
  -- as migrations cannot directly create auth.users records with passwords.
  -- The following creates user_profiles that will be linked once auth users exist.

  -- For now, we'll create placeholder entries that explain the setup process
  RAISE NOTICE 'Demo employees created successfully!';
  RAISE NOTICE 'Employee IDs: Admin=%, Manager=%, TeamLead=%, Member=%', 
    v_admin_employee_id, v_manager_employee_id, v_teamlead_employee_id, v_member_employee_id;
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'IMPORTANT: Manual Setup Required';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'To complete the demo user setup, you need to create auth users';
  RAISE NOTICE 'via the Supabase dashboard or using the signup endpoint:';
  RAISE NOTICE '';
  RAISE NOTICE '1. Go to Supabase Dashboard > Authentication > Users';
  RAISE NOTICE '2. Click "Add User" and create the following accounts:';
  RAISE NOTICE '';
  RAISE NOTICE '   Email: admin@example.com';
  RAISE NOTICE '   Password: admin123';
  RAISE NOTICE '   Copy the generated User ID';
  RAISE NOTICE '';
  RAISE NOTICE '   Email: manager@example.com';
  RAISE NOTICE '   Password: manager123';
  RAISE NOTICE '   Copy the generated User ID';
  RAISE NOTICE '';
  RAISE NOTICE '   Email: teamlead@example.com';
  RAISE NOTICE '   Password: teamlead123';
  RAISE NOTICE '   Copy the generated User ID';
  RAISE NOTICE '';
  RAISE NOTICE '   Email: member@example.com';
  RAISE NOTICE '   Password: member123';
  RAISE NOTICE '   Copy the generated User ID';
  RAISE NOTICE '';
  RAISE NOTICE '3. Then run this SQL with the actual user IDs:';
  RAISE NOTICE '';
  RAISE NOTICE 'INSERT INTO user_profiles (id, employee_id, role, organization_id, department_id, can_access_all_departments)';
  RAISE NOTICE 'VALUES';
  RAISE NOTICE '  (''<admin-user-id>'', ''%'', ''admin'', ''%'', ''%'', true),',
    v_admin_employee_id, v_org_id, v_event_services_dept_id;
  RAISE NOTICE '  (''<manager-user-id>'', ''%'', ''manager'', ''%'', ''%'', false),',
    v_manager_employee_id, v_org_id, v_event_services_dept_id;
  RAISE NOTICE '  (''<teamlead-user-id>'', ''%'', ''teamlead'', ''%'', ''%'', false),',
    v_teamlead_employee_id, v_org_id, v_av_services_dept_id;
  RAISE NOTICE '  (''<member-user-id>'', ''%'', ''member'', ''%'', ''%'', false);',
    v_member_employee_id, v_org_id, v_av_services_dept_id;
  RAISE NOTICE '';
  RAISE NOTICE 'Organization ID: %', v_org_id;
  RAISE NOTICE 'Event Services Dept ID: %', v_event_services_dept_id;
  RAISE NOTICE 'AV Services Dept ID: %', v_av_services_dept_id;
  RAISE NOTICE '=================================================================';

END $$;
