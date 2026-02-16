/*
  # Add Employee Skills Table

  1. New Tables
    - `employee_skills` - Links employees to skills with expiry and proficiency
  
  2. Features
    - References skills master catalog
    - Auto-calculates expiration from skill defaults if not manually set
    - Tracks verification status and proficiency
  
  3. Security
    - Enable RLS
    - Authenticated users can read and manage
  
  4. Indexes
    - Employee, skill, status, and expiration indexes
*/

-- Create employee_skills table
CREATE TABLE IF NOT EXISTS employee_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  proficiency_level text DEFAULT 'Competent' CHECK (proficiency_level IN ('Novice', 'Competent', 'Proficient', 'Expert')),
  verified_at timestamptz,
  expiration_date date,  -- Manual override takes precedence
  status text DEFAULT 'Active' CHECK (status IN ('Active', 'Expired', 'Pending', 'Revoked')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, skill_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_employee_skills_employee ON employee_skills(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_skills_skill ON employee_skills(skill_id);
CREATE INDEX IF NOT EXISTS idx_employee_skills_status ON employee_skills(status);
CREATE INDEX IF NOT EXISTS idx_employee_skills_expiration ON employee_skills(expiration_date) WHERE expiration_date IS NOT NULL;

-- Auto-calculate expiration if not manually set
CREATE OR REPLACE FUNCTION set_skill_expiration()
RETURNS TRIGGER AS $$
DECLARE
  v_default_months integer;
  v_base_date timestamptz;
BEGIN
  -- Only auto-calculate if expiration_date is NULL
  IF NEW.expiration_date IS NULL THEN
    SELECT default_validity_months INTO v_default_months
    FROM skills WHERE id = NEW.skill_id;
    
    IF v_default_months IS NOT NULL THEN
      v_base_date := COALESCE(NEW.verified_at, NEW.created_at);
      NEW.expiration_date := (v_base_date + (v_default_months || ' months')::interval)::date;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_calculate_skill_expiration
  BEFORE INSERT ON employee_skills
  FOR EACH ROW
  EXECUTE FUNCTION set_skill_expiration();

-- Enable Row Level Security
ALTER TABLE employee_skills ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view employee skills"
  ON employee_skills FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage employee skills"
  ON employee_skills FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update employee skills"
  ON employee_skills FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete employee skills"
  ON employee_skills FOR DELETE
  TO authenticated
  USING (true);
