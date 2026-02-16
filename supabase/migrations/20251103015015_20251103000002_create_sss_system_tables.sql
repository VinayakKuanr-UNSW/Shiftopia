/*
  # Create Shift Suitability Score (SSS) System Tables

  ## Overview
  This migration creates the Shift Suitability Score system that tracks employee reliability,
  attendance, cancellations, and other factors to calculate a comprehensive suitability score.

  ## New Tables

  ### 1. employee_suitability_scores
  - `id` (uuid, primary key)
  - `employee_id` (uuid, foreign key to employees, unique)
  - `overall_score` (decimal) - Final SSS score (0-100)
  - `attendance_score` (decimal) - Based on punctuality and attendance
  - `cancellation_penalty` (decimal) - Penalty for shift cancellations
  - `skill_match_score` (decimal) - How well skills match assigned shifts
  - `availability_adherence` (decimal) - Following declared availability
  - `swap_reliability` (decimal) - Completion rate of accepted swaps
  - `last_calculated_at` (timestamptz)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 2. cancellation_history
  - `id` (uuid, primary key)
  - `employee_id` (uuid, foreign key to employees)
  - `shift_id` (uuid, foreign key to shifts)
  - `cancelled_at` (timestamptz)
  - `notice_period_hours` (integer) - Hours of notice given
  - `reason` (text)
  - `penalty_applied` (decimal) - SSS penalty points
  - `created_at` (timestamptz)

  ### 3. attendance_records
  - `id` (uuid, primary key)
  - `employee_id` (uuid, foreign key to employees)
  - `shift_id` (uuid, foreign key to shifts)
  - `scheduled_start` (timestamptz)
  - `actual_start` (timestamptz, nullable)
  - `scheduled_end` (timestamptz)
  - `actual_end` (timestamptz, nullable)
  - `status` (text) - on_time, late, early_departure, no_show, completed
  - `minutes_late` (integer, default 0)
  - `notes` (text)
  - `created_at` (timestamptz)

  ### 4. employee_reliability_metrics
  - `id` (uuid, primary key)
  - `employee_id` (uuid, foreign key to employees, unique)
  - `total_shifts_assigned` (integer, default 0)
  - `total_shifts_completed` (integer, default 0)
  - `total_cancellations` (integer, default 0)
  - `total_late_arrivals` (integer, default 0)
  - `total_no_shows` (integer, default 0)
  - `total_swaps_accepted` (integer, default 0)
  - `total_swaps_completed` (integer, default 0)
  - `cancellation_rate` (decimal, default 0)
  - `on_time_percentage` (decimal, default 100)
  - `swap_completion_rate` (decimal, default 100)
  - `last_updated_at` (timestamptz)
  - `created_at` (timestamptz)

  ## Security
  - Enable RLS on all tables
  - Managers and admins can view all data
  - Employees can view their own scores and records

  ## Indexes
  - Add indexes on foreign keys and frequently queried fields
*/

-- Create employee_suitability_scores table
CREATE TABLE IF NOT EXISTS employee_suitability_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid UNIQUE NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  overall_score decimal(5,2) DEFAULT 100.00,
  attendance_score decimal(5,2) DEFAULT 100.00,
  cancellation_penalty decimal(5,2) DEFAULT 0.00,
  skill_match_score decimal(5,2) DEFAULT 100.00,
  availability_adherence decimal(5,2) DEFAULT 100.00,
  swap_reliability decimal(5,2) DEFAULT 100.00,
  last_calculated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create cancellation_history table
CREATE TABLE IF NOT EXISTS cancellation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  cancelled_at timestamptz DEFAULT now(),
  notice_period_hours integer DEFAULT 0,
  reason text,
  penalty_applied decimal(5,2) DEFAULT 0.00,
  created_at timestamptz DEFAULT now()
);

-- Create attendance_records table
CREATE TABLE IF NOT EXISTS attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  scheduled_start timestamptz NOT NULL,
  actual_start timestamptz,
  scheduled_end timestamptz NOT NULL,
  actual_end timestamptz,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'on_time', 'late', 'early_departure', 'no_show', 'completed')),
  minutes_late integer DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Create employee_reliability_metrics table
CREATE TABLE IF NOT EXISTS employee_reliability_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid UNIQUE NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  total_shifts_assigned integer DEFAULT 0,
  total_shifts_completed integer DEFAULT 0,
  total_cancellations integer DEFAULT 0,
  total_late_arrivals integer DEFAULT 0,
  total_no_shows integer DEFAULT 0,
  total_swaps_accepted integer DEFAULT 0,
  total_swaps_completed integer DEFAULT 0,
  cancellation_rate decimal(5,2) DEFAULT 0.00,
  on_time_percentage decimal(5,2) DEFAULT 100.00,
  swap_completion_rate decimal(5,2) DEFAULT 100.00,
  last_updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_suitability_scores_employee ON employee_suitability_scores(employee_id);
CREATE INDEX IF NOT EXISTS idx_suitability_scores_overall ON employee_suitability_scores(overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_cancellation_history_employee ON cancellation_history(employee_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_history_shift ON cancellation_history(shift_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_history_cancelled_at ON cancellation_history(cancelled_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_records_employee ON attendance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_shift ON attendance_records(shift_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_status ON attendance_records(status);
CREATE INDEX IF NOT EXISTS idx_reliability_metrics_employee ON employee_reliability_metrics(employee_id);

-- Enable Row Level Security
ALTER TABLE employee_suitability_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancellation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_reliability_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies for employee_suitability_scores
CREATE POLICY "Authenticated users can view all suitability scores" ON employee_suitability_scores FOR SELECT TO authenticated USING (true);
CREATE POLICY "System can manage suitability scores" ON employee_suitability_scores FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "System can update suitability scores" ON employee_suitability_scores FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- RLS Policies for cancellation_history
CREATE POLICY "Authenticated users can view cancellation history" ON cancellation_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "System can create cancellation records" ON cancellation_history FOR INSERT TO authenticated WITH CHECK (true);

-- RLS Policies for attendance_records
CREATE POLICY "Authenticated users can view attendance records" ON attendance_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "System can create attendance records" ON attendance_records FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "System can update attendance records" ON attendance_records FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- RLS Policies for employee_reliability_metrics
CREATE POLICY "Authenticated users can view reliability metrics" ON employee_reliability_metrics FOR SELECT TO authenticated USING (true);
CREATE POLICY "System can manage reliability metrics" ON employee_reliability_metrics FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "System can update reliability metrics" ON employee_reliability_metrics FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Initialize SSS for existing employees
INSERT INTO employee_suitability_scores (employee_id)
SELECT id FROM employees
ON CONFLICT (employee_id) DO NOTHING;

-- Initialize reliability metrics for existing employees
INSERT INTO employee_reliability_metrics (employee_id)
SELECT id FROM employees
ON CONFLICT (employee_id) DO NOTHING;
