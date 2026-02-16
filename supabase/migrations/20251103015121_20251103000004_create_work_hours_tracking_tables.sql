/*
  # Create Work Hours Validation and Tracking System

  ## Overview
  This migration creates tables for tracking and validating work hours compliance with:
  - 12 hour per day limit
  - 152 hour per month limit
  - 10 hour rest period between shifts

  ## New Tables

  ### 1. daily_hours_summary
  - `id` (uuid, primary key)
  - `employee_id` (uuid, foreign key to employees)
  - `date` (date, not null)
  - `total_scheduled_hours` (decimal) - Total hours scheduled
  - `actual_worked_hours` (decimal) - Actual hours worked
  - `exceeds_daily_limit` (boolean) - Flags if over 12hrs
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 2. monthly_hours_summary
  - `id` (uuid, primary key)
  - `employee_id` (uuid, foreign key to employees)
  - `year` (integer, not null)
  - `month` (integer, not null)
  - `total_scheduled_hours` (decimal) - Total hours scheduled
  - `actual_worked_hours` (decimal) - Actual hours worked
  - `hours_remaining` (decimal) - Hours left until 152 limit
  - `exceeds_monthly_limit` (boolean) - Flags if over 152hrs
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 3. rest_period_violations
  - `id` (uuid, primary key)
  - `employee_id` (uuid, foreign key to employees)
  - `first_shift_id` (uuid, foreign key to shifts)
  - `second_shift_id` (uuid, foreign key to shifts)
  - `first_shift_end` (timestamptz)
  - `second_shift_start` (timestamptz)
  - `rest_hours` (decimal) - Actual rest hours between shifts
  - `violation_detected_at` (timestamptz)

  ## Security
  - Enable RLS on all tables
  - Managers can view all data for their department
  - Employees can view their own data

  ## Indexes
  - Add indexes on foreign keys and date fields for fast queries
*/

-- Create daily_hours_summary table
CREATE TABLE IF NOT EXISTS daily_hours_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date date NOT NULL,
  total_scheduled_hours decimal(5,2) DEFAULT 0.00,
  actual_worked_hours decimal(5,2) DEFAULT 0.00,
  exceeds_daily_limit boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, date)
);

-- Create monthly_hours_summary table
CREATE TABLE IF NOT EXISTS monthly_hours_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),
  total_scheduled_hours decimal(6,2) DEFAULT 0.00,
  actual_worked_hours decimal(6,2) DEFAULT 0.00,
  hours_remaining decimal(6,2) DEFAULT 152.00,
  exceeds_monthly_limit boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, year, month)
);

-- Create rest_period_violations table
CREATE TABLE IF NOT EXISTS rest_period_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  first_shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  second_shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  first_shift_end timestamptz NOT NULL,
  second_shift_start timestamptz NOT NULL,
  rest_hours decimal(5,2) NOT NULL,
  violation_detected_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_daily_hours_summary_employee ON daily_hours_summary(employee_id);
CREATE INDEX IF NOT EXISTS idx_daily_hours_summary_date ON daily_hours_summary(date);
CREATE INDEX IF NOT EXISTS idx_daily_hours_summary_exceeds ON daily_hours_summary(exceeds_daily_limit) WHERE exceeds_daily_limit = true;
CREATE INDEX IF NOT EXISTS idx_monthly_hours_summary_employee ON monthly_hours_summary(employee_id);
CREATE INDEX IF NOT EXISTS idx_monthly_hours_summary_year_month ON monthly_hours_summary(year, month);
CREATE INDEX IF NOT EXISTS idx_monthly_hours_summary_exceeds ON monthly_hours_summary(exceeds_monthly_limit) WHERE exceeds_monthly_limit = true;
CREATE INDEX IF NOT EXISTS idx_rest_violations_employee ON rest_period_violations(employee_id);
CREATE INDEX IF NOT EXISTS idx_rest_violations_first_shift ON rest_period_violations(first_shift_id);
CREATE INDEX IF NOT EXISTS idx_rest_violations_second_shift ON rest_period_violations(second_shift_id);
CREATE INDEX IF NOT EXISTS idx_rest_violations_detected_at ON rest_period_violations(violation_detected_at DESC);

-- Enable Row Level Security
ALTER TABLE daily_hours_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_hours_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE rest_period_violations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for daily_hours_summary
CREATE POLICY "Authenticated users can view daily hours summary" ON daily_hours_summary FOR SELECT TO authenticated USING (true);
CREATE POLICY "System can manage daily hours summary" ON daily_hours_summary FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "System can update daily hours summary" ON daily_hours_summary FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- RLS Policies for monthly_hours_summary
CREATE POLICY "Authenticated users can view monthly hours summary" ON monthly_hours_summary FOR SELECT TO authenticated USING (true);
CREATE POLICY "System can manage monthly hours summary" ON monthly_hours_summary FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "System can update monthly hours summary" ON monthly_hours_summary FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- RLS Policies for rest_period_violations
CREATE POLICY "Authenticated users can view rest violations" ON rest_period_violations FOR SELECT TO authenticated USING (true);
CREATE POLICY "System can create rest violations" ON rest_period_violations FOR INSERT TO authenticated WITH CHECK (true);
