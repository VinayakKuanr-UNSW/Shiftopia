-- ================================================================
-- Users Page - Complete Database Setup
-- ================================================================
-- This file consolidates all migrations for the Users Page feature
-- Run this in Supabase SQL Editor in the order shown
-- ================================================================

-- ================================================================
-- PART 1: Skills Master Catalog (Update Existing Table)
-- ================================================================

-- Skills table already exists, add missing columns if they don't exist
ALTER TABLE public.skills 
  ADD COLUMN IF NOT EXISTS requires_expiration boolean DEFAULT false;

ALTER TABLE public.skills 
  ADD COLUMN IF NOT EXISTS default_validity_months integer;

-- Ensure index exists
CREATE INDEX IF NOT EXISTS idx_skills_category ON public.skills(category);

-- Update RLS - drop and recreate policies to ensure they match our needs
DROP POLICY IF EXISTS "Authenticated users can view skills" ON public.skills;
DROP POLICY IF EXISTS "Authenticated users can create skills" ON public.skills;
DROP POLICY IF EXISTS "Authenticated users can update skills" ON public.skills;
DROP POLICY IF EXISTS "Authenticated users can manage skills" ON public.skills;

-- Enable RLS if not already enabled
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Authenticated users can view skills"
  ON public.skills FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create skills"
  ON public.skills FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update skills"
  ON public.skills FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Insert common skills (will skip existing due to unique name constraint)
INSERT INTO public.skills (name, category, requires_expiration, default_validity_months) VALUES
  ('First Aid Lv2', 'Safety', true, 36),
  ('Manual Handling', 'Safety', true, 12),
  ('White Card', 'Safety', true, NULL),
  ('RSA Certificate', 'Compliance', true, 60),
  ('Forklift License', 'Operational', true, 60),
  ('Barista Basics', 'Operational', false, NULL),
  ('Working at Heights', 'Safety', true, 24),
  ('Fire Safety Warden', 'Safety', true, 12),
  ('Crowd Control', 'Operational', true, 60),
  ('Heavy Rigid Driver License', 'Operational', true, 60)
ON CONFLICT (name) DO NOTHING;

-- ================================================================
-- PART 2: Employee Skills (Update Existing Table)
-- ================================================================

-- Employee_skills table already exists with old schema
-- Add missing columns to match new schema

-- First, add missing columns
ALTER TABLE public.employee_skills 
  ADD COLUMN IF NOT EXISTS expiration_date date;

ALTER TABLE public.employee_skills 
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'Active' 
    CHECK (status IN ('Active', 'Expired', 'Pending', 'Revoked'));

ALTER TABLE public.employee_skills 
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.employee_skills 
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Update proficiency_level if it's the wrong type (change from integer to text)
-- Note: This will fail if data exists - you may need to handle conversion manually
DO $$ 
BEGIN
  -- Check if proficiency_level is integer type and convert to text
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'employee_skills' 
    AND column_name = 'proficiency_level' 
    AND data_type = 'integer'
  ) THEN
    -- Add temporary column
    ALTER TABLE public.employee_skills ADD COLUMN proficiency_level_new text;
    
    -- Convert existing values
    UPDATE public.employee_skills 
    SET proficiency_level_new = CASE 
      WHEN proficiency_level = 1 THEN 'Novice'
      WHEN proficiency_level = 2 THEN 'Competent'
      WHEN proficiency_level = 3 THEN 'Proficient'
      WHEN proficiency_level = 4 THEN 'Expert'
      WHEN proficiency_level = 5 THEN 'Expert'
      ELSE 'Competent'
    END;
    
    -- Drop old column and rename new one
    ALTER TABLE public.employee_skills DROP COLUMN proficiency_level;
    ALTER TABLE public.employee_skills RENAME COLUMN proficiency_level_new TO proficiency_level;
    
    -- Add constraint
    ALTER TABLE public.employee_skills 
      ADD CONSTRAINT employee_skills_proficiency_level_check 
      CHECK (proficiency_level IN ('Novice', 'Competent', 'Proficient', 'Expert'));
    
    -- Set default
    ALTER TABLE public.employee_skills 
      ALTER COLUMN proficiency_level SET DEFAULT 'Competent';
  END IF;
END $$;

-- Create indexes (now that columns exist)
CREATE INDEX IF NOT EXISTS idx_employee_skills_employee ON public.employee_skills(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_skills_skill ON public.employee_skills(skill_id);
CREATE INDEX IF NOT EXISTS idx_employee_skills_status ON public.employee_skills(status);
CREATE INDEX IF NOT EXISTS idx_employee_skills_expiration ON public.employee_skills(expiration_date) WHERE expiration_date IS NOT NULL;

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS public.set_skill_expiration() CASCADE;

CREATE OR REPLACE FUNCTION public.set_skill_expiration()
RETURNS TRIGGER AS $$
DECLARE
  v_default_months integer;
  v_base_date timestamptz;
BEGIN
  IF NEW.expiration_date IS NULL THEN
    SELECT default_validity_months INTO v_default_months
    FROM public.skills WHERE id = NEW.skill_id;
    
    IF v_default_months IS NOT NULL THEN
      v_base_date := COALESCE(NEW.verified_at, NEW.created_at);
      NEW.expiration_date := (v_base_date + (v_default_months || ' months')::interval)::date;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_calculate_skill_expiration ON public.employee_skills;

CREATE TRIGGER auto_calculate_skill_expiration
  BEFORE INSERT ON public.employee_skills
  FOR EACH ROW
  EXECUTE FUNCTION public.set_skill_expiration();

ALTER TABLE public.employee_skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view employee skills" ON public.employee_skills;
DROP POLICY IF EXISTS "Authenticated users can manage employee skills" ON public.employee_skills;
DROP POLICY IF EXISTS "Authenticated users can update employee skills" ON public.employee_skills;
DROP POLICY IF EXISTS "Authenticated users can delete employee skills" ON public.employee_skills;

CREATE POLICY "Authenticated users can view employee skills"
  ON public.employee_skills FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage employee skills"
  ON public.employee_skills FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update employee skills"
  ON public.employee_skills FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete employee skills"
  ON public.employee_skills FOR DELETE TO authenticated USING (true);

-- ================================================================
-- PART 3: Licenses Master Catalog (Update Existing Table)
-- ================================================================

-- Licenses table already exists, add missing columns if they don't exist
ALTER TABLE public.licenses 
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'General';

-- Ensure index exists
CREATE INDEX IF NOT EXISTS idx_licenses_category ON public.licenses(category);

-- Insert common licenses and visas
INSERT INTO public.licenses (name, description, category, requires_expiration) VALUES
  ('Subclass 500 Student Visa', 'Student visa with work limitations', 'Visa', true),
  ('Subclass 485 Temporary Graduate', 'Full work rights for graduates', 'Visa', true),
  ('Australian Citizen', 'Full unrestricted work rights', 'Visa', false),
  ('Permanent Resident', 'Full unrestricted work rights', 'Visa', false),
  ('Working at Heights', 'Safety certification for working at heights', 'Safety', true),
  ('Forklift License', 'High Risk Work License - LF', 'Operational', true),
  ('First Aid Level 2', 'Provide First Aid HLTAID011', 'Safety', true),
  ('Responsible Service of Alcohol', 'SITHFAB021', 'Compliance', true),
  ('White Card', 'Construction Induction', 'Compliance', false),
  ('Heavy Rigid Driver License', 'HR Driver License', 'Operational', true),
  ('Driver License (C Class)', 'Standard Car License', 'Operational', true)
ON CONFLICT (name) DO UPDATE 
SET category = EXCLUDED.category;

-- ================================================================
-- PART 3.1: Work Rights Verification
-- ================================================================

ALTER TABLE public.employee_licenses 
  ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'Unverified' 
    CHECK (verification_status IN ('Unverified', 'Verified', 'Failed', 'Expired'));

ALTER TABLE public.employee_licenses 
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

ALTER TABLE public.employee_licenses 
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;

ALTER TABLE public.employee_licenses 
  ADD COLUMN IF NOT EXISTS verification_metadata jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.employee_licenses 
  ADD COLUMN IF NOT EXISTS has_restricted_work_limit boolean DEFAULT false;

ALTER TABLE public.employee_licenses 
  ADD COLUMN IF NOT EXISTS license_type text DEFAULT 'Standard' 
    CHECK (license_type IN ('Standard', 'WorkRights', 'Professional'));

CREATE INDEX IF NOT EXISTS idx_employee_licenses_verification 
  ON public.employee_licenses(verification_status, license_type);

-- ================================================================
-- PART 4: Performance Metrics Table
-- ================================================================

CREATE TABLE IF NOT EXISTS public.employee_performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  quarter_year text NOT NULL,
  is_locked boolean DEFAULT false,
  
  shifts_offered integer DEFAULT 0,
  shifts_accepted integer DEFAULT 0,
  shifts_rejected integer DEFAULT 0,
  shifts_assigned integer DEFAULT 0,
  shifts_worked integer DEFAULT 0,
  shifts_swapped integer DEFAULT 0,
  
  acceptance_rate numeric(5,2) DEFAULT 0,
  rejection_rate numeric(5,2) DEFAULT 0,
  punctuality_rate numeric(5,2) DEFAULT 100,
  swap_ratio numeric(5,2) DEFAULT 0,
  
  standard_cancellations integer DEFAULT 0,
  late_cancellations integer DEFAULT 0,
  no_shows integer DEFAULT 0,
  
  cancellation_rate_standard numeric(5,2) DEFAULT 0,
  cancellation_rate_late numeric(5,2) DEFAULT 0,
  no_show_rate numeric(5,2) DEFAULT 0,
  
  metric_version integer DEFAULT 1,
  calculated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(employee_id, quarter_year)
);

CREATE INDEX IF NOT EXISTS idx_perf_metrics_employee ON public.employee_performance_metrics(employee_id);
CREATE INDEX IF NOT EXISTS idx_perf_metrics_quarter ON public.employee_performance_metrics(quarter_year);
CREATE INDEX IF NOT EXISTS idx_perf_metrics_locked ON public.employee_performance_metrics(is_locked);

-- Drop existing function and trigger
DROP FUNCTION IF EXISTS public.prevent_locked_quarter_updates() CASCADE;

CREATE OR REPLACE FUNCTION public.prevent_locked_quarter_updates()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_locked = true AND NEW.is_locked = true THEN
    RAISE EXCEPTION 'Cannot modify locked quarter metrics. Use explicit reprocess command to override.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_quarter_lock ON public.employee_performance_metrics;

CREATE TRIGGER enforce_quarter_lock
  BEFORE UPDATE ON public.employee_performance_metrics
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_locked_quarter_updates();

ALTER TABLE public.employee_performance_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view performance metrics" ON public.employee_performance_metrics;
DROP POLICY IF EXISTS "System can manage performance metrics" ON public.employee_performance_metrics;
DROP POLICY IF EXISTS "System can update unlocked performance metrics" ON public.employee_performance_metrics;

CREATE POLICY "Authenticated users can view performance metrics"
  ON public.employee_performance_metrics FOR SELECT TO authenticated USING (true);

CREATE POLICY "System can manage performance metrics"
  ON public.employee_performance_metrics FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "System can update unlocked performance metrics"
  ON public.employee_performance_metrics FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ================================================================
-- PART 5: Performance Calculation Functions (for background jobs)
-- ================================================================

DROP FUNCTION IF EXISTS public.categorize_cancellation(timestamptz, timestamptz) CASCADE;

CREATE OR REPLACE FUNCTION public.categorize_cancellation(
  p_cancelled_at timestamptz,
  p_shift_start timestamptz
) RETURNS text AS $$
DECLARE
  notice_hours numeric;
BEGIN
  notice_hours := EXTRACT(EPOCH FROM (p_shift_start - p_cancelled_at)) / 3600;
  
  IF notice_hours >= 24 THEN
    RETURN 'standard';
  ELSIF notice_hours >= 4 THEN
    RETURN 'late';
  ELSE
    RETURN 'emergency';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

DROP FUNCTION IF EXISTS public.calculate_employee_metrics(uuid, date, date) CASCADE;

CREATE OR REPLACE FUNCTION public.calculate_employee_metrics(
  p_employee_id uuid,
  p_start_date date,
  p_end_date date
) RETURNS TABLE (
  shifts_offered int,
  shifts_accepted int,
  shifts_rejected int,
  shifts_assigned int,
  shifts_worked int,
  shifts_swapped int,
  standard_cancellations int,
  late_cancellations int,
  no_shows int,
  acceptance_rate numeric,
  rejection_rate numeric,
  punctuality_rate numeric,
  swap_ratio numeric,
  cancellation_rate_standard numeric,
  cancellation_rate_late numeric,
  no_show_rate numeric
) AS $$
BEGIN
  RETURN QUERY
  WITH assigned_shifts AS (
    SELECT 
      COUNT(*) as total_assigned,
      COUNT(*) FILTER (WHERE ar.status = 'on_time' OR ar.status = 'completed') as on_time,
      COUNT(*) FILTER (WHERE ar.status = 'no_show') as no_shows_count
    FROM public.roster_shift_assignments rsa
    LEFT JOIN public.attendance_records ar ON ar.shift_id = rsa.shift_id AND ar.employee_id = rsa.employee_id
    WHERE rsa.employee_id = p_employee_id
      AND rsa.scheduled_start::date BETWEEN p_start_date AND p_end_date
  ),
  cancellation_data AS (
    SELECT
      COUNT(*) FILTER (WHERE notice_period_hours >= 24) as standard_cancel,
      COUNT(*) FILTER (WHERE notice_period_hours >= 4 AND notice_period_hours < 24) as late_cancel
    FROM public.cancellation_history
    WHERE employee_id = p_employee_id
      AND cancelled_at::date BETWEEN p_start_date AND p_end_date
  )
  SELECT 
    0::int,
    0::int,
    0::int,
    COALESCE(asf.total_assigned, 0)::int,
    COALESCE(asf.on_time, 0)::int,
    0::int,
    COALESCE(cd.standard_cancel, 0)::int,
    COALESCE(cd.late_cancel, 0)::int,
    COALESCE(asf.no_shows_count, 0)::int,
    0.00::numeric,
    0.00::numeric,
    CASE WHEN asf.total_assigned > 0 
      THEN ROUND((asf.on_time::numeric / asf.total_assigned) * 100, 2) 
      ELSE 100 
    END,
    0.00::numeric,
    CASE WHEN asf.total_assigned > 0 
      THEN ROUND((cd.standard_cancel::numeric / asf.total_assigned) * 100, 2) 
      ELSE 0 
    END,
    CASE WHEN asf.total_assigned > 0 
      THEN ROUND((cd.late_cancel::numeric / asf.total_assigned) * 100, 2) 
      ELSE 0 
    END,
    CASE WHEN asf.total_assigned > 0 
      THEN ROUND((asf.no_shows_count::numeric / asf.total_assigned) * 100, 2) 
      ELSE 0 
    END
  FROM assigned_shifts asf, cancellation_data cd;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- COMPLETE!
-- ================================================================
-- All tables, indexes, triggers, and functions have been created.
-- You can now run the frontend application.
-- ================================================================
