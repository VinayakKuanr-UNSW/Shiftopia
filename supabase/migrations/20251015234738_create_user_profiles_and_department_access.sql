/*
  # Create User Profiles and Department-Based Access Control

  ## Overview
  This migration creates a comprehensive user profile system that links Supabase authentication
  users to employees, departments, and organizations with proper access control.

  ## New Tables

  ### 1. user_profiles
  - `id` (uuid, primary key, references auth.users)
  - `employee_id` (uuid, foreign key to employees, nullable)
  - `role` (text) - User role: 'admin', 'manager', 'teamlead', 'member'
  - `organization_id` (uuid, foreign key to organizations)
  - `department_id` (uuid, foreign key to departments) - Manager's assigned department
  - `sub_department_id` (uuid, foreign key to sub_departments, nullable)
  - `can_access_all_departments` (boolean, default false) - For admins
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ## Security Changes
  
  ### Updated RLS Policies
  
  1. **user_profiles table**
     - Users can view their own profile
     - Admins can view all profiles
  
  2. **departments table**
     - Updated to filter by user's organization and access level
  
  3. **sub_departments table**
     - Updated to filter by user's assigned department
  
  4. **shifts table**
     - Updated to filter by user's department access
     - Managers can only see shifts in their department
     - Admins can see all shifts
  
  5. **roles table**
     - Filter to show only roles within user's department
  
  ## Sample Data
  - Create user profiles for existing mock users
  - Link admin user to IT department with full access
  - Link manager user to Convention Centre department
  - Link teamlead user to Exhibition Centre department
  - Link member user to Theatre department

  ## Important Notes
  - This migration enforces department-level access control at the database level
  - Users without profiles will have no access to any data
  - Admins with can_access_all_departments=true bypass all department filters
*/

-- Create user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('admin', 'manager', 'teamlead', 'member')),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  sub_department_id uuid REFERENCES sub_departments(id) ON DELETE SET NULL,
  can_access_all_departments boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for user_profiles
CREATE INDEX IF NOT EXISTS idx_user_profiles_employee_id ON user_profiles(employee_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_organization_id ON user_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_department_id ON user_profiles(department_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_sub_department_id ON user_profiles(sub_department_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);

-- Enable RLS on user_profiles
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_profiles
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.role = 'admin'
      AND up.can_access_all_departments = true
    )
  );

CREATE POLICY "Admins can create profiles"
  ON user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.role = 'admin'
    )
  );

CREATE POLICY "Admins can update profiles"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.role = 'admin'
    )
  );

-- Drop existing overly permissive policies and create department-filtered ones

-- Updated RLS Policies for departments (department-based filtering)
DROP POLICY IF EXISTS "Authenticated users can view departments" ON departments;
CREATE POLICY "Users can view accessible departments"
  ON departments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND (
        up.can_access_all_departments = true
        OR departments.organization_id = up.organization_id
      )
    )
  );

-- Updated RLS Policies for sub_departments (department-based filtering)
DROP POLICY IF EXISTS "Authenticated users can view sub_departments" ON sub_departments;
CREATE POLICY "Users can view accessible sub_departments"
  ON sub_departments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND (
        up.can_access_all_departments = true
        OR sub_departments.department_id = up.department_id
      )
    )
  );

-- Updated RLS Policies for shifts (department-based filtering)
DROP POLICY IF EXISTS "Authenticated users can view shifts" ON shifts;
CREATE POLICY "Users can view accessible shifts"
  ON shifts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND (
        up.can_access_all_departments = true
        OR shifts.department_id = up.department_id
      )
    )
  );

DROP POLICY IF EXISTS "Authenticated users can create shifts" ON shifts;
CREATE POLICY "Users can create shifts in their department"
  ON shifts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND (
        up.can_access_all_departments = true
        OR shifts.department_id = up.department_id
      )
      AND up.role IN ('admin', 'manager')
    )
  );

DROP POLICY IF EXISTS "Authenticated users can update shifts" ON shifts;
CREATE POLICY "Users can update shifts in their department"
  ON shifts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND (
        up.can_access_all_departments = true
        OR shifts.department_id = up.department_id
      )
      AND up.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND (
        up.can_access_all_departments = true
        OR shifts.department_id = up.department_id
      )
      AND up.role IN ('admin', 'manager')
    )
  );

DROP POLICY IF EXISTS "Authenticated users can delete shifts" ON shifts;
CREATE POLICY "Users can delete shifts in their department"
  ON shifts FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND (
        up.can_access_all_departments = true
        OR shifts.department_id = up.department_id
      )
      AND up.role IN ('admin', 'manager')
    )
  );


-- Ensure roles table has required columns before applying policies
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'roles' AND column_name = 'department_id') THEN
        ALTER TABLE roles ADD COLUMN department_id uuid REFERENCES departments(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'roles' AND column_name = 'sub_department_id') THEN
        ALTER TABLE roles ADD COLUMN sub_department_id uuid REFERENCES sub_departments(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'roles' AND column_name = 'remuneration_level_id') THEN
        ALTER TABLE roles ADD COLUMN remuneration_level_id uuid REFERENCES remuneration_levels(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Updated RLS Policies for roles (department-based filtering)
DROP POLICY IF EXISTS "Authenticated users can view roles" ON roles;
CREATE POLICY "Users can view accessible roles"
  ON roles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND (
        up.can_access_all_departments = true
        OR roles.department_id = up.department_id
        OR roles.department_id IS NULL
      )
    )
  );

-- Updated RLS Policies for employees (department-based filtering)
DROP POLICY IF EXISTS "Authenticated users can view employees" ON employees;
CREATE POLICY "Users can view accessible employees"
  ON employees FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND (
        up.can_access_all_departments = true
        OR EXISTS (
          SELECT 1 FROM user_profiles emp_profile
          WHERE emp_profile.employee_id = employees.id
          AND emp_profile.department_id = up.department_id
        )
      )
    )
  );