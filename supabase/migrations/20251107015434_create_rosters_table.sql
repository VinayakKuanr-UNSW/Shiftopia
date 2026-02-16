/*
  # Create Rosters Table for Template-Based Roster Management
  
  ## Overview
  This migration creates the rosters table to store daily roster records generated from published shift templates.
  
  ## New Tables
  
  ### `rosters`
  Stores daily roster records with complete shift structure copied from templates.
  
  **Columns:**
  - `id` (uuid, primary key) - Unique identifier for the roster
  - `date` (date, not null) - The date this roster applies to
  - `template_id` (uuid, foreign key) - Reference to the shift template used
  - `department_id` (uuid, not null) - Department this roster belongs to
  - `sub_department_id` (uuid) - Sub-department if applicable
  - `groups` (jsonb, not null, default '[]'::jsonb) - Complete roster structure with groups, subgroups, and shifts
  - `status` (text, not null, default 'draft') - Roster status: 'draft' or 'published'
  - `is_locked` (boolean, not null, default false) - Whether the roster is locked for editing
  - `created_by` (uuid, foreign key) - User who created the roster
  - `updated_by` (uuid, foreign key) - User who last updated the roster
  - `created_at` (timestamptz, default now()) - Creation timestamp
  - `updated_at` (timestamptz, default now()) - Last update timestamp
  
  **Indexes:**
  - Index on `date` for efficient date queries
  - Index on `department_id` for filtering by department
  - Composite index on `(date, department_id)` for common queries
  - Index on `template_id` for template-roster relationships
  
  ## Security
  
  ### Row Level Security (RLS)
  - Enable RLS on `rosters` table
  - Policy: Authenticated users can view all rosters
  - Policy: Authenticated users can create rosters
  - Policy: Authenticated users can update non-locked rosters
  - Policy: Authenticated users can delete draft rosters they created
  
  ## Important Notes
  - The `groups` JSONB column stores the complete roster structure
  - Each roster is tied to a specific date and department
  - Locked rosters cannot be modified to preserve historical data
  - Template ID is stored for audit trail and reference
*/

-- Create rosters table
CREATE TABLE IF NOT EXISTS rosters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  template_id uuid REFERENCES shift_templates(id) ON DELETE SET NULL,
  department_id uuid NOT NULL,
  sub_department_id uuid,
  groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  is_locked boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Ensure rosters table has required columns
-- Ensure rosters table has required columns via idempotent ALTER TABLE statements
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS date date NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES shift_templates(id) ON DELETE SET NULL;
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS department_id uuid; -- Nullable first to avoid errors on existing rows
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS sub_department_id uuid;
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS groups jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published'));
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_rosters_date ON rosters(date);
CREATE INDEX IF NOT EXISTS idx_rosters_department_id ON rosters(department_id);
CREATE INDEX IF NOT EXISTS idx_rosters_date_department ON rosters(date, department_id);
CREATE INDEX IF NOT EXISTS idx_rosters_template_id ON rosters(template_id);
CREATE INDEX IF NOT EXISTS idx_rosters_status ON rosters(status);

-- Create unique constraint to prevent duplicate rosters for same date and department
CREATE UNIQUE INDEX IF NOT EXISTS idx_rosters_date_department_unique 
ON rosters(date, department_id);

-- Enable Row Level Security
ALTER TABLE rosters ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can view all rosters
DROP POLICY IF EXISTS "Authenticated users can view rosters" ON rosters;
CREATE POLICY "Authenticated users can view rosters"
  ON rosters FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Authenticated users can create rosters
DROP POLICY IF EXISTS "Authenticated users can create rosters" ON rosters;
CREATE POLICY "Authenticated users can create rosters"
  ON rosters FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy: Authenticated users can update non-locked rosters
DROP POLICY IF EXISTS "Authenticated users can update unlocked rosters" ON rosters;
CREATE POLICY "Authenticated users can update unlocked rosters"
  ON rosters FOR UPDATE
  TO authenticated
  USING (NOT is_locked)
  WITH CHECK (NOT is_locked);

-- Policy: Authenticated users can delete draft rosters they created
DROP POLICY IF EXISTS "Users can delete their own draft rosters" ON rosters;
CREATE POLICY "Users can delete their own draft rosters"
  ON rosters FOR DELETE
  TO authenticated
  USING (
    status = 'draft'
    AND created_by = auth.uid()
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_rosters_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS trigger_rosters_updated_at ON rosters;
CREATE TRIGGER trigger_rosters_updated_at
  BEFORE UPDATE ON rosters
  FOR EACH ROW
  EXECUTE FUNCTION update_rosters_updated_at();
