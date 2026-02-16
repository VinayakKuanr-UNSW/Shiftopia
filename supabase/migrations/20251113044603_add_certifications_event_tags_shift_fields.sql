/*
  # Add Certifications and Event Tags System

  1. New Tables
    - `certifications` - Store certification definitions
    - `event_tags` - Store event tag definitions

  2. Modifications to shifts table
    - Add `required_skills` (jsonb array)
    - Add `required_certifications` (jsonb array)
    - Add `event_tags` (jsonb array)

  3. Security
    - Enable RLS on new tables
    - Add basic policies for authenticated users
*/

-- Create certifications table
CREATE TABLE IF NOT EXISTS certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  issuing_body text,
  validity_period_months integer DEFAULT 12,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Ensure certifications table has required columns
ALTER TABLE certifications ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE certifications ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT ''; -- Add default for existing rows if any
ALTER TABLE certifications ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE certifications ADD COLUMN IF NOT EXISTS issuing_body text;
ALTER TABLE certifications ADD COLUMN IF NOT EXISTS validity_period_months integer DEFAULT 12;
ALTER TABLE certifications ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE certifications ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_certifications_organization ON certifications(organization_id);

ALTER TABLE certifications ENABLE ROW LEVEL SECURITY;

-- Idempotent policies
DROP POLICY IF EXISTS "Allow authenticated users to view certifications" ON certifications;
CREATE POLICY "Allow authenticated users to view certifications"
  ON certifications FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to manage certifications" ON certifications;
CREATE POLICY "Allow authenticated users to manage certifications"
  ON certifications FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create event_tags table
CREATE TABLE IF NOT EXISTS event_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text DEFAULT '#3B82F6',
  icon text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Ensure event_tags table has required columns
ALTER TABLE event_tags ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE event_tags ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
ALTER TABLE event_tags ADD COLUMN IF NOT EXISTS color text DEFAULT '#3B82F6';
ALTER TABLE event_tags ADD COLUMN IF NOT EXISTS icon text;
ALTER TABLE event_tags ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE event_tags ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_event_tags_organization ON event_tags(organization_id);

ALTER TABLE event_tags ENABLE ROW LEVEL SECURITY;

-- Idempotent policies
DROP POLICY IF EXISTS "Allow authenticated users to view event tags" ON event_tags;
CREATE POLICY "Allow authenticated users to view event tags"
  ON event_tags FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to manage event tags" ON event_tags;
CREATE POLICY "Allow authenticated users to manage event tags"
  ON event_tags FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Add new columns to shifts table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shifts' AND column_name = 'required_skills'
  ) THEN
    ALTER TABLE shifts ADD COLUMN required_skills jsonb DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shifts' AND column_name = 'required_certifications'
  ) THEN
    ALTER TABLE shifts ADD COLUMN required_certifications jsonb DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shifts' AND column_name = 'event_tags'
  ) THEN
    ALTER TABLE shifts ADD COLUMN event_tags jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Create indexes on new jsonb columns for better query performance
CREATE INDEX IF NOT EXISTS idx_shifts_required_skills ON shifts USING GIN (required_skills);
CREATE INDEX IF NOT EXISTS idx_shifts_required_certifications ON shifts USING GIN (required_certifications);
CREATE INDEX IF NOT EXISTS idx_shifts_event_tags ON shifts USING GIN (event_tags);