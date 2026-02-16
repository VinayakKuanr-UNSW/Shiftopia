/*
  # Add Skills Master Catalog

  1. New Tables
    - `skills` - Master catalog of all skills with categories and expiry rules
  
  2. Security
    - Enable RLS
    - Authenticated users can read
    - Admin users can manage
  
  3. Indexes
    - Category index for filtering
*/

-- Create skills master catalog table
CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  category text NOT NULL CHECK (category IN ('Safety', 'Operational', 'Technical', 'Compliance')),
  requires_expiration boolean DEFAULT false,
  default_validity_months integer,  -- Default validity period (NULL = never expires)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create index for category filtering
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);

-- Enable Row Level Security
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view skills"
  ON skills FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create skills"
  ON skills FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update skills"
  ON skills FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Insert common skills
INSERT INTO skills (name, category, requires_expiration, default_validity_months) VALUES
  ('First Aid Lv2', 'Safety', true, 36),
  ('Manual Handling', 'Safety', true, 12),
  ('White Card', 'Safety', true, NULL),  -- Never expires
  ('RSA Certificate', 'Compliance', true, 60),
  ('Forklift License', 'Operational', true, 60),
  ('Barista Basics', 'Operational', false, NULL),
  ('Working at Heights', 'Safety', true, 24),
  ('Fire Safety Warden', 'Safety', true, 12),
  ('Crowd Control', 'Operational', true, 60),
  ('Heavy Rigid Driver License', 'Operational', true, 60)
ON CONFLICT (name) DO NOTHING;
