/*
  # Create/Update Shift Templates Table with Date Range Support
  
  ## Overview
  Creates or updates the shift_templates table to store reusable shift patterns
  that can be published to date ranges in the rosters system.
  
  ## Table: shift_templates
  
  **Purpose:** Store reusable shift templates with groups, subgroups, and shifts structure
  
  **Columns:**
  - `id` (uuid, primary key) - Unique template identifier
  - `name` (text, not null) - Template name
  - `description` (text) - Template description
  - `department_id` (uuid, not null) - Associated department
  - `sub_department_id` (uuid) - Associated sub-department (optional)
  - `groups` (jsonb, not null, default '[]') - Complete template structure
  - `start_date` (date) - Start date when template is active (for published templates)
  - `end_date` (date) - End date when template is active (for published templates)
  - `is_draft` (boolean, default true) - Whether template is in draft or published state
  - `created_by` (uuid) - User who created the template
  - `updated_by` (uuid) - User who last updated the template
  - `created_at` (timestamptz, default now())
  - `updated_at` (timestamptz, default now())
  
  **Indexes:**
  - Index on `department_id` for filtering
  - Index on `is_draft` for quick filtering between drafts and published
  - Index on `(start_date, end_date)` for date range queries
  
  ## Security
  - Enable RLS
  - Authenticated users can view all templates
  - Authenticated users can create templates
  - Authenticated users can update draft templates
  - Users can delete their own draft templates
*/

-- Create shift_templates table if it doesn't exist
CREATE TABLE IF NOT EXISTS shift_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  department_id uuid NOT NULL,
  sub_department_id uuid,
  groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  start_date date,
  end_date date,
  is_draft boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_date_range CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

-- Add columns if they don't exist (for existing tables)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shift_templates' AND column_name = 'start_date'
  ) THEN
    ALTER TABLE shift_templates ADD COLUMN start_date date;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shift_templates' AND column_name = 'end_date'
  ) THEN
    ALTER TABLE shift_templates ADD COLUMN end_date date;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shift_templates' AND column_name = 'groups'
  ) THEN
    ALTER TABLE shift_templates ADD COLUMN groups jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shift_templates' AND column_name = 'description'
  ) THEN
    ALTER TABLE shift_templates ADD COLUMN description text;
  END IF;
END $$;

-- Add constraint for valid date range if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'valid_date_range' AND conrelid = 'shift_templates'::regclass
  ) THEN
    ALTER TABLE shift_templates 
    ADD CONSTRAINT valid_date_range 
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);
  END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_shift_templates_department ON shift_templates(department_id);
CREATE INDEX IF NOT EXISTS idx_shift_templates_is_draft ON shift_templates(is_draft);
CREATE INDEX IF NOT EXISTS idx_shift_templates_date_range ON shift_templates(start_date, end_date);

-- Enable RLS
ALTER TABLE shift_templates ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Authenticated users can view templates" ON shift_templates;
DROP POLICY IF EXISTS "Authenticated users can create templates" ON shift_templates;
DROP POLICY IF EXISTS "Authenticated users can update draft templates" ON shift_templates;
DROP POLICY IF EXISTS "Users can delete their own draft templates" ON shift_templates;

-- Policy: Authenticated users can view all templates
CREATE POLICY "Authenticated users can view templates"
  ON shift_templates FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Authenticated users can create templates
CREATE POLICY "Authenticated users can create templates"
  ON shift_templates FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy: Authenticated users can update draft templates
CREATE POLICY "Authenticated users can update draft templates"
  ON shift_templates FOR UPDATE
  TO authenticated
  USING (is_draft = true)
  WITH CHECK (is_draft = true);

-- Policy: Users can delete their own draft templates
CREATE POLICY "Users can delete their own draft templates"
  ON shift_templates FOR DELETE
  TO authenticated
  USING (
    is_draft = true
    AND created_by = auth.uid()
  );

-- Create function to update updated_at
CREATE OR REPLACE FUNCTION update_shift_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_shift_templates_updated_at ON shift_templates;
CREATE TRIGGER trigger_shift_templates_updated_at
  BEFORE UPDATE ON shift_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_shift_templates_updated_at();
