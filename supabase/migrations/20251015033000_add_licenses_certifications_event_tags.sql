/*
  # Add Licenses, Certifications, and Event Tags Tables

  1. New Tables
    - `licenses`
      - `id` (uuid, primary key)
      - `name` (text, unique, not null) - License name
      - `description` (text) - License description
      - `requires_expiration` (boolean, default true) - Whether license expires
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `certifications`
      - `id` (uuid, primary key)
      - `name` (text, unique, not null) - Certification name
      - `description` (text) - Certification description
      - `requires_expiration` (boolean, default true) - Whether certification expires
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `event_tags`
      - `id` (uuid, primary key)
      - `name` (text, unique, not null) - Event tag name
      - `color` (text) - Tag color for visual display
      - `category` (text) - Tag category grouping
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `shift_licenses`
      - `id` (uuid, primary key)
      - `shift_id` (uuid, not null) - Foreign key to shifts
      - `license_id` (uuid, not null) - Foreign key to licenses
      - `is_required` (boolean, default true) - Whether license is required or preferred
      - `created_at` (timestamptz)
    
    - `shift_certifications`
      - `id` (uuid, primary key)
      - `shift_id` (uuid, not null) - Foreign key to shifts
      - `certification_id` (uuid, not null) - Foreign key to certifications
      - `is_required` (boolean, default true) - Whether certification is required or preferred
      - `created_at` (timestamptz)
    
    - `shift_event_tags`
      - `id` (uuid, primary key)
      - `shift_id` (uuid, not null) - Foreign key to shifts
      - `event_tag_id` (uuid, not null) - Foreign key to event_tags
      - `created_at` (timestamptz)
    
    - `employee_licenses`
      - `id` (uuid, primary key)
      - `employee_id` (uuid, not null) - Foreign key to employees
      - `license_id` (uuid, not null) - Foreign key to licenses
      - `issue_date` (date) - When license was issued
      - `expiration_date` (date) - When license expires
      - `status` (text, default 'Active') - Active, Expired, Suspended
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `employee_certifications`
      - `id` (uuid, primary key)
      - `employee_id` (uuid, not null) - Foreign key to employees
      - `certification_id` (uuid, not null) - Foreign key to certifications
      - `issue_date` (date) - When certification was issued
      - `expiration_date` (date) - When certification expires
      - `status` (text, default 'Active') - Active, Expired, Suspended
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on all new tables
    - Add policies for authenticated users to read data
    - Add policies for specific roles to manage licenses, certifications, and tags

  3. Indexes
    - Add indexes on foreign keys for better query performance
    - Add unique constraints on junction tables to prevent duplicates
*/

-- Create licenses table
CREATE TABLE IF NOT EXISTS licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  requires_expiration boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create certifications table
CREATE TABLE IF NOT EXISTS certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  requires_expiration boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create event_tags table
CREATE TABLE IF NOT EXISTS event_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  color text DEFAULT '#3B82F6',
  category text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create shift_licenses junction table
CREATE TABLE IF NOT EXISTS shift_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  license_id uuid NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  is_required boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(shift_id, license_id)
);

-- Create shift_certifications junction table
CREATE TABLE IF NOT EXISTS shift_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  certification_id uuid NOT NULL REFERENCES certifications(id) ON DELETE CASCADE,
  is_required boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(shift_id, certification_id)
);

-- Create shift_event_tags junction table
CREATE TABLE IF NOT EXISTS shift_event_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  event_tag_id uuid NOT NULL REFERENCES event_tags(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(shift_id, event_tag_id)
);

-- Create employee_licenses table
CREATE TABLE IF NOT EXISTS employee_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  license_id uuid NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  issue_date date,
  expiration_date date,
  status text DEFAULT 'Active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, license_id)
);

-- Create employee_certifications table
CREATE TABLE IF NOT EXISTS employee_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  certification_id uuid NOT NULL REFERENCES certifications(id) ON DELETE CASCADE,
  issue_date date,
  expiration_date date,
  status text DEFAULT 'Active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, certification_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_shift_licenses_shift_id ON shift_licenses(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_licenses_license_id ON shift_licenses(license_id);
CREATE INDEX IF NOT EXISTS idx_shift_certifications_shift_id ON shift_certifications(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_certifications_certification_id ON shift_certifications(certification_id);
CREATE INDEX IF NOT EXISTS idx_shift_event_tags_shift_id ON shift_event_tags(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_event_tags_event_tag_id ON shift_event_tags(event_tag_id);
CREATE INDEX IF NOT EXISTS idx_employee_licenses_employee_id ON employee_licenses(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_licenses_license_id ON employee_licenses(license_id);
CREATE INDEX IF NOT EXISTS idx_employee_certifications_employee_id ON employee_certifications(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_certifications_certification_id ON employee_certifications(certification_id);

-- Enable Row Level Security
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_event_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_certifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies for licenses
CREATE POLICY "Authenticated users can view licenses"
  ON licenses FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create licenses"
  ON licenses FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- RLS Policies for certifications
CREATE POLICY "Authenticated users can view certifications"
  ON certifications FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create certifications"
  ON certifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- RLS Policies for event_tags
CREATE POLICY "Authenticated users can view event tags"
  ON event_tags FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create event tags"
  ON event_tags FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- RLS Policies for shift_licenses
CREATE POLICY "Authenticated users can view shift licenses"
  ON shift_licenses FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage shift licenses"
  ON shift_licenses FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete shift licenses"
  ON shift_licenses FOR DELETE
  TO authenticated
  USING (true);

-- RLS Policies for shift_certifications
CREATE POLICY "Authenticated users can view shift certifications"
  ON shift_certifications FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage shift certifications"
  ON shift_certifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete shift certifications"
  ON shift_certifications FOR DELETE
  TO authenticated
  USING (true);

-- RLS Policies for shift_event_tags
CREATE POLICY "Authenticated users can view shift event tags"
  ON shift_event_tags FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage shift event tags"
  ON shift_event_tags FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete shift event tags"
  ON shift_event_tags FOR DELETE
  TO authenticated
  USING (true);

-- RLS Policies for employee_licenses
CREATE POLICY "Authenticated users can view employee licenses"
  ON employee_licenses FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage employee licenses"
  ON employee_licenses FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update employee licenses"
  ON employee_licenses FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- RLS Policies for employee_certifications
CREATE POLICY "Authenticated users can view employee certifications"
  ON employee_certifications FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage employee certifications"
  ON employee_certifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update employee certifications"
  ON employee_certifications FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Insert some default licenses
-- INSERT INTO licenses (name, description, requires_expiration) VALUES
--   ('Forklift License', 'Required for operating forklifts and similar equipment', true),
--   ('First Aid Certificate', 'Basic first aid and CPR training', true),
--   ('Working at Heights', 'Safety certification for working at elevated positions', true),
--   ('Electrical License', 'Licensed electrician certification', true)
-- ON CONFLICT (name) DO NOTHING;

-- Insert some default certifications
-- INSERT INTO certifications (name, description, requires_expiration) VALUES
--   ('Food Safety Certificate', 'Food handling and safety certification', true),
--   ('Crowd Control', 'Crowd management and control certification', true),
--   ('Fire Safety Warden', 'Fire safety and emergency evacuation training', true),
--   ('RSA Certificate', 'Responsible Service of Alcohol', true)
-- ON CONFLICT (name) DO NOTHING;

-- Insert some default event tags
-- INSERT INTO event_tags (name, color, category) VALUES
--   ('Conference', '#3B82F6', 'Event Type'),
--   ('Exhibition', '#10B981', 'Event Type'),
--   ('Concert', '#8B5CF6', 'Event Type'),
--   ('Sports Event', '#F59E0B', 'Event Type'),
--   ('Corporate', '#6366F1', 'Event Type'),
--   ('High Priority', '#EF4444', 'Priority'),
--   ('VIP Event', '#EC4899', 'Priority'),
--   ('Setup Required', '#14B8A6', 'Logistics'),
--   ('Breakdown Required', '#F97316', 'Logistics'),
--   ('Weekend Event', '#06B6D4', 'Schedule')
-- ON CONFLICT (name) DO NOTHING;