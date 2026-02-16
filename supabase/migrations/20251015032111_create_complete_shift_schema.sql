/*
  # Create Complete Shift Management Schema

  ## Overview
  This migration creates a comprehensive shift management system with all 15 required fields
  for proper shift tracking, scheduling, and payroll calculation.

  ## New Tables

  ### 1. organizations
  - `id` (uuid, primary key)
  - `name` (text, unique, not null) - Organization name
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 2. departments
  - `id` (uuid, primary key)
  - `organization_id` (uuid, foreign key to organizations)
  - `name` (text, not null) - Department name
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 3. sub_departments
  - `id` (uuid, primary key)
  - `department_id` (uuid, foreign key to departments)
  - `name` (text, not null) - Sub-department name
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 4. remuneration_levels
  - `id` (uuid, primary key)
  - `level` (integer, unique, not null) - Level number (1, 2, 3, etc.)
  - `description` (text) - Level description
  - `hourly_rate` (decimal, not null) - Hourly pay rate in dollars
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 5. roles
  - `id` (uuid, primary key)
  - `name` (text, not null) - Role name (e.g., "Technician", "Manager")
  - `department_id` (uuid, foreign key to departments, nullable)
  - `sub_department_id` (uuid, foreign key to sub_departments, nullable)
  - `remuneration_level_id` (uuid, foreign key to remuneration_levels, nullable)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 6. skills
  - `id` (uuid, primary key)
  - `name` (text, unique, not null) - Skill name
  - `description` (text)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 7. shift_groups
  - `id` (uuid, primary key)
  - `name` (text, not null) - Group name for template organization
  - `created_at` (timestamptz)

  ### 8. shift_subgroups
  - `id` (uuid, primary key)
  - `group_id` (uuid, foreign key to shift_groups)
  - `name` (text, not null) - Sub-group name
  - `created_at` (timestamptz)

  ### 9. employees
  - `id` (uuid, primary key)
  - `name` (text, not null) - Employee full name
  - `email` (text, unique, not null)
  - `phone` (text)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 10. shifts (Complete 15-field structure)
  - `id` (uuid, primary key)
  - `organization_id` (uuid, foreign key to organizations, not null) - Field 1
  - `department_id` (uuid, foreign key to departments, not null) - Field 2
  - `sub_department_id` (uuid, foreign key to sub_departments, not null) - Field 3
  - `role_id` (uuid, foreign key to roles, not null) - Field 4
  - `shift_date` (date, not null) - Field 5
  - `start_time` (time, not null) - Field 6
  - `end_time` (time, not null) - Field 7
  - `paid_break_duration` (integer, default 0) - Field 8 (in minutes)
  - `unpaid_break_duration` (integer, default 0) - Field 9 (in minutes)
  - `length` (decimal, not null) - Field 10 (total hours)
  - `net_length` (decimal, not null) - Field 11 (working hours after unpaid breaks)
  - `remuneration_level_id` (uuid, foreign key to remuneration_levels, not null) - Field 12
  - `employee_id` (uuid, foreign key to employees, nullable) - Field 13 (assigned employee)
  - `status` (text, default 'Open') - Field 14 (Open, Assigned, Completed, etc.)
  - `shift_group_id` (uuid, foreign key to shift_groups, nullable) - Field 15a (template grouping)
  - `shift_subgroup_id` (uuid, foreign key to shift_subgroups, nullable) - Field 15b
  - `is_draft` (boolean, default false)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 11. shift_skills (junction table)
  - Links shifts to required skills

  ## Security
  - Enable RLS on all tables
  - Add policies for authenticated users to manage data

  ## Indexes
  - Add indexes on foreign keys for performance
  - Add composite indexes for common queries
*/

-- Create organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create departments table
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, name)
);

-- Create sub_departments table
CREATE TABLE IF NOT EXISTS sub_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(department_id, name)
);

-- Create remuneration_levels table with hourly rates
CREATE TABLE IF NOT EXISTS remuneration_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level integer UNIQUE NOT NULL,
  description text,
  hourly_rate decimal(10,2) NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create roles table
CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  sub_department_id uuid REFERENCES sub_departments(id) ON DELETE SET NULL,
  remuneration_level_id uuid REFERENCES remuneration_levels(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create skills table
CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create shift_groups table
CREATE TABLE IF NOT EXISTS shift_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create shift_subgroups table
CREATE TABLE IF NOT EXISTS shift_subgroups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES shift_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create employees table
CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  phone text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create shifts table with all 15 required fields
CREATE TABLE IF NOT EXISTS shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  sub_department_id uuid NOT NULL REFERENCES sub_departments(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  shift_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  paid_break_duration integer DEFAULT 0,
  unpaid_break_duration integer DEFAULT 0,
  length decimal(5,2) NOT NULL,
  net_length decimal(5,2) NOT NULL,
  remuneration_level_id uuid NOT NULL REFERENCES remuneration_levels(id) ON DELETE RESTRICT,
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  status text DEFAULT 'Open',
  shift_group_id uuid REFERENCES shift_groups(id) ON DELETE SET NULL,
  shift_subgroup_id uuid REFERENCES shift_subgroups(id) ON DELETE SET NULL,
  is_draft boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create shift_skills junction table
CREATE TABLE IF NOT EXISTS shift_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(shift_id, skill_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_departments_organization_id ON departments(organization_id);
CREATE INDEX IF NOT EXISTS idx_sub_departments_department_id ON sub_departments(department_id);
-- CREATE INDEX IF NOT EXISTS idx_roles_department_id ON roles(department_id);
-- CREATE INDEX IF NOT EXISTS idx_roles_sub_department_id ON roles(sub_department_id);
-- CREATE INDEX IF NOT EXISTS idx_roles_remuneration_level_id ON roles(remuneration_level_id);
CREATE INDEX IF NOT EXISTS idx_shift_subgroups_group_id ON shift_subgroups(group_id);
CREATE INDEX IF NOT EXISTS idx_shifts_organization_id ON shifts(organization_id);
CREATE INDEX IF NOT EXISTS idx_shifts_department_id ON shifts(department_id);
CREATE INDEX IF NOT EXISTS idx_shifts_sub_department_id ON shifts(sub_department_id);
CREATE INDEX IF NOT EXISTS idx_shifts_role_id ON shifts(role_id);
CREATE INDEX IF NOT EXISTS idx_shifts_shift_date ON shifts(shift_date);
CREATE INDEX IF NOT EXISTS idx_shifts_employee_id ON shifts(employee_id);
CREATE INDEX IF NOT EXISTS idx_shifts_remuneration_level_id ON shifts(remuneration_level_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_shift_group_id ON shifts(shift_group_id);
CREATE INDEX IF NOT EXISTS idx_shifts_shift_subgroup_id ON shifts(shift_subgroup_id);
CREATE INDEX IF NOT EXISTS idx_shift_skills_shift_id ON shift_skills(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_skills_skill_id ON shift_skills(skill_id);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_shifts_date_status ON shifts(shift_date, status);
CREATE INDEX IF NOT EXISTS idx_shifts_employee_date ON shifts(employee_id, shift_date) WHERE employee_id IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE remuneration_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_subgroups ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_skills ENABLE ROW LEVEL SECURITY;

-- RLS Policies for organizations
CREATE POLICY "Authenticated users can view organizations"
  ON organizations FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create organizations"
  ON organizations FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update organizations"
  ON organizations FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- RLS Policies for departments
CREATE POLICY "Authenticated users can view departments"
  ON departments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage departments"
  ON departments FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update departments"
  ON departments FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- RLS Policies for sub_departments
CREATE POLICY "Authenticated users can view sub_departments"
  ON sub_departments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage sub_departments"
  ON sub_departments FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update sub_departments"
  ON sub_departments FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- RLS Policies for remuneration_levels
CREATE POLICY "Authenticated users can view remuneration_levels"
  ON remuneration_levels FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage remuneration_levels"
  ON remuneration_levels FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update remuneration_levels"
  ON remuneration_levels FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- RLS Policies for roles
CREATE POLICY "Authenticated users can view roles"
  ON roles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage roles"
  ON roles FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update roles"
  ON roles FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- RLS Policies for skills
CREATE POLICY "Authenticated users can view skills"
  ON skills FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage skills"
  ON skills FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update skills"
  ON skills FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- RLS Policies for shift_groups
CREATE POLICY "Authenticated users can view shift_groups"
  ON shift_groups FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage shift_groups"
  ON shift_groups FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update shift_groups"
  ON shift_groups FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- RLS Policies for shift_subgroups
CREATE POLICY "Authenticated users can view shift_subgroups"
  ON shift_subgroups FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage shift_subgroups"
  ON shift_subgroups FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update shift_subgroups"
  ON shift_subgroups FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- RLS Policies for employees
CREATE POLICY "Authenticated users can view employees"
  ON employees FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage employees"
  ON employees FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update employees"
  ON employees FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- RLS Policies for shifts
CREATE POLICY "Authenticated users can view shifts"
  ON shifts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create shifts"
  ON shifts FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update shifts"
  ON shifts FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete shifts"
  ON shifts FOR DELETE
  TO authenticated
  USING (true);

-- RLS Policies for shift_skills
CREATE POLICY "Authenticated users can view shift_skills"
  ON shift_skills FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage shift_skills"
  ON shift_skills FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete shift_skills"
  ON shift_skills FOR DELETE
  TO authenticated
  USING (true);

-- Insert sample organizations
-- INSERT INTO organizations (name) VALUES
--   ('ICC Sydney'),
--   ('Sydney Convention Centre')
-- ON CONFLICT (name) DO NOTHING;

-- Insert sample remuneration levels with hourly rates
-- INSERT INTO remuneration_levels (level, description, hourly_rate) VALUES
--   (1, 'Entry Level', 25.00),
--   (2, 'Intermediate', 30.00),
--   (3, 'Advanced', 35.00),
--   (4, 'Senior', 42.50),
--   (5, 'Lead', 50.00),
--   (6, 'Manager', 60.00)
-- ON CONFLICT (level) DO NOTHING;

-- Get ICC Sydney organization ID for departments
-- DO $$
-- DECLARE
--   icc_org_id uuid;
-- BEGIN
--   SELECT id INTO icc_org_id FROM organizations WHERE name = 'ICC Sydney' LIMIT 1;
-- 
--   IF icc_org_id IS NOT NULL THEN
--     -- Insert sample departments
--     INSERT INTO departments (organization_id, name) VALUES
--       (icc_org_id, 'Convention Centre'),
--       (icc_org_id, 'Exhibition Centre'),
--       (icc_org_id, 'Theatre'),
--       (icc_org_id, 'Darling Harbor Theatre'),
--       (icc_org_id, 'IT'),
--       (icc_org_id, 'Catering'),
--       (icc_org_id, 'Housekeeping')
--     ON CONFLICT (organization_id, name) DO NOTHING;
-- 
--     -- Insert sample sub-departments for Convention Centre
--     INSERT INTO sub_departments (department_id, name)
--     SELECT d.id, sd.name
--     FROM departments d
--     CROSS JOIN (VALUES
--       ('AM Base'),
--       ('PM Base'),
--       ('AM Assist'),
--       ('PM Assist'),
--       ('Late'),
--       ('Refresh')
--     ) AS sd(name)
--     WHERE d.name = 'Convention Centre' AND d.organization_id = icc_org_id
--     ON CONFLICT (department_id, name) DO NOTHING;
-- 
--     -- Insert sample sub-departments for Exhibition Centre
--     INSERT INTO sub_departments (department_id, name)
--     SELECT d.id, sd.name
--     FROM departments d
--     CROSS JOIN (VALUES
--       ('Bump-In'),
--       ('Bump-Out'),
--       ('Setup Team A'),
--       ('Setup Team B')
--     ) AS sd(name)
--     WHERE d.name = 'Exhibition Centre' AND d.organization_id = icc_org_id
--     ON CONFLICT (department_id, name) DO NOTHING;
-- 
--     -- Insert sample sub-departments for Theatre
--     INSERT INTO sub_departments (department_id, name)
--     SELECT d.id, sd.name
--     FROM departments d
--     CROSS JOIN (VALUES
--       ('Setup'),
--       ('Packdown'),
--       ('Technical Support')
--     ) AS sd(name)
--     WHERE d.name = 'Theatre' AND d.organization_id = icc_org_id
--     ON CONFLICT (department_id, name) DO NOTHING;
--   END IF;
-- END $$;

-- Insert sample roles
-- INSERT INTO roles (name, remuneration_level_id)
-- SELECT r.name, rl.id
-- FROM (VALUES
--   ('Technician', 2),
--   ('Senior Technician', 3),
--   ('Lead Technician', 4),
--   ('Manager', 5),
--   ('General Staff', 1),
--   ('Supervisor', 4),
--   ('Coordinator', 3),
--   ('Setup Crew', 2),
--   ('Audio Visual Tech', 3),
--   ('Event Staff', 1)
-- ) AS r(name, level)
-- JOIN remuneration_levels rl ON rl.level = r.level
-- ON CONFLICT DO NOTHING;

-- Insert sample skills
-- INSERT INTO skills (name, description) VALUES
--   ('Forklift Operation', 'Certified forklift operator'),
--   ('Audio Visual Setup', 'Professional AV equipment setup and operation'),
--   ('Electrical Work', 'Licensed electrical installation and maintenance'),
--   ('First Aid', 'First aid and emergency response certified'),
--   ('Rigging', 'Professional rigging and safety systems'),
--   ('Stage Management', 'Event and stage management experience'),
--   ('Customer Service', 'Professional customer interaction skills'),
--   ('Catering Service', 'Food and beverage service experience'),
--   ('Technical Support', 'IT and technical troubleshooting'),
--   ('Project Management', 'Event and project coordination')
-- ON CONFLICT (name) DO NOTHING;

-- Insert sample employees
-- INSERT INTO employees (name, email, phone) VALUES
--   ('John Smith', 'john.smith@example.com', '+61 400 000 001'),
--   ('Sarah Johnson', 'sarah.johnson@example.com', '+61 400 000 002'),
--   ('Michael Chen', 'michael.chen@example.com', '+61 400 000 003'),
--   ('Emma Wilson', 'emma.wilson@example.com', '+61 400 000 004'),
--   ('David Brown', 'david.brown@example.com', '+61 400 000 005'),
--   ('Lisa Anderson', 'lisa.anderson@example.com', '+61 400 000 006'),
--   ('James Taylor', 'james.taylor@example.com', '+61 400 000 007'),
--   ('Sophie Martin', 'sophie.martin@example.com', '+61 400 000 008'),
--   ('Daniel Lee', 'daniel.lee@example.com', '+61 400 000 009'),
--   ('Olivia White', 'olivia.white@example.com', '+61 400 000 010')
-- ON CONFLICT (email) DO NOTHING;

-- Insert sample shift groups
-- INSERT INTO shift_groups (name) VALUES
--   ('Morning Shift'),
--   ('Afternoon Shift'),
--   ('Evening Shift'),
--   ('Night Shift'),
--   ('Event Setup'),
--   ('Event Breakdown')
-- ON CONFLICT DO NOTHING;

-- Insert sample shift subgroups
-- INSERT INTO shift_subgroups (group_id, name)
-- SELECT sg.id, ssg.name
-- FROM shift_groups sg
-- CROSS JOIN (VALUES
--   ('Team A'),
--   ('Team B'),
--   ('Team C')
-- ) AS ssg(name)
-- WHERE sg.name IN ('Morning Shift', 'Afternoon Shift', 'Evening Shift')
-- ON CONFLICT DO NOTHING;
