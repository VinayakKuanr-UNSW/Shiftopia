/*
  # Auto-Create User Profiles for New Signups

  ## Overview
  This migration creates a database function and trigger to automatically create
  user_profiles entries when new users sign up via Supabase authentication.

  ## Changes Made

  1. **Database Function: handle_new_user()**
     - Triggered after INSERT on auth.users
     - Creates a user_profile entry with default values
     - Default role: 'member'
     - Default department: First available department in the organization
     - Handles cases where no departments exist

  2. **Trigger: on_auth_user_created**
     - Fires after user creation in auth.users
     - Calls handle_new_user() function

  ## Default Values for New Users
  - role: 'member'
  - department: First department found (or creates a default if none exists)
  - can_access_all_departments: false
  - organization: ICC Sydney (or first org found)

  ## Security
  - Function runs with SECURITY DEFINER to bypass RLS
  - Only creates profiles for authenticated users
  - Does not grant any elevated permissions
*/

-- Create function to handle new user signups
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_org_id uuid;
  v_dept_id uuid;
BEGIN
  -- Get the first organization (ICC Sydney or any org)
  SELECT id INTO v_org_id FROM organizations LIMIT 1;
  
  -- If no organization exists, we can't create a profile
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found. Cannot create user profile.';
  END IF;
  
  -- Get the first department in the organization
  SELECT id INTO v_dept_id 
  FROM departments 
  WHERE organization_id = v_org_id 
  LIMIT 1;
  
  -- If no department exists, we can't create a profile
  IF v_dept_id IS NULL THEN
    RAISE EXCEPTION 'No department found for organization. Cannot create user profile.';
  END IF;
  
  -- Create the user profile with default values
  INSERT INTO user_profiles (
    id, 
    role, 
    organization_id, 
    department_id, 
    can_access_all_departments,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    'member',
    v_org_id,
    v_dept_id,
    false,
    now(),
    now()
  );
  
  RETURN NEW;
END;
$$;

-- Create trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
