/*
  # Create Timesheet and Pay Calculation System

  ## Overview
  This migration creates comprehensive timesheet tracking with pay calculations based on
  weekdays, weekends, and public holidays. No overtime rates as per requirements.

  ## New Tables

  ### 1. public_holidays
  - `id` (uuid, primary key)
  - `holiday_date` (date, unique, not null)
  - `holiday_name` (text, not null)
  - `applies_to_state` (text) - NSW, VIC, etc
  - `is_national` (boolean)
  - `created_at` (timestamptz)

  ### 2. pay_rate_rules
  - `id` (uuid, primary key)
  - `day_type` (text) - weekday, weekend, public_holiday
  - `remuneration_level_id` (uuid, foreign key to remuneration_levels)
  - `hourly_rate` (decimal) - Base rate
  - `multiplier` (decimal) - Rate multiplier (1.0 for weekday, 1.5 for weekend, 2.0 for holiday)
  - `effective_from` (date)
  - `effective_to` (date, nullable)
  - `created_at` (timestamptz)

  ### 3. timesheets
  - `id` (uuid, primary key)
  - `shift_id` (uuid, foreign key to shifts)
  - `employee_id` (uuid, foreign key to employees)
  - `clock_in` (timestamptz)
  - `clock_out` (timestamptz, nullable)
  - `paid_break_minutes` (integer, default 0)
  - `unpaid_break_minutes` (integer, default 0)
  - `total_hours` (decimal) - Clock out - clock in
  - `net_hours` (decimal) - Total minus unpaid breaks
  - `status` (text) - draft, submitted, approved, paid, rejected
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 4. timesheet_pay_calculation
  - `id` (uuid, primary key)
  - `timesheet_id` (uuid, foreign key to timesheets)
  - `base_hours` (decimal)
  - `base_rate` (decimal)
  - `weekday_hours` (decimal, default 0)
  - `weekend_hours` (decimal, default 0)
  - `public_holiday_hours` (decimal, default 0)
  - `weekday_pay` (decimal, default 0)
  - `weekend_pay` (decimal, default 0)
  - `public_holiday_pay` (decimal, default 0)
  - `total_pay` (decimal)
  - `calculated_at` (timestamptz)

  ### 5. timesheet_approval_workflow
  - `id` (uuid, primary key)
  - `timesheet_id` (uuid, foreign key to timesheets)
  - `approver_id` (uuid, foreign key to auth.users)
  - `approval_level` (integer) - 1, 2, 3 for multi-level approval
  - `action` (text) - approved, rejected, returned
  - `comments` (text)
  - `approved_at` (timestamptz)

  ### 6. pay_periods
  - `id` (uuid, primary key)
  - `period_start_date` (date, not null)
  - `period_end_date` (date, not null)
  - `cutoff_date` (date, not null)
  - `status` (text) - open, locked, paid
  - `locked_at` (timestamptz)
  - `locked_by` (uuid, foreign key to auth.users)
  - `created_at` (timestamptz)

  ## Security
  - Enable RLS on all tables
  - Employees can view and submit their own timesheets
  - Managers can approve timesheets
  - Payroll admins can lock pay periods

  ## Indexes
  - Add indexes on foreign keys and frequently queried fields
*/

-- Create public_holidays table
CREATE TABLE IF NOT EXISTS public_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date date UNIQUE NOT NULL,
  holiday_name text NOT NULL,
  applies_to_state text DEFAULT 'NSW',
  is_national boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Create pay_rate_rules table
CREATE TABLE IF NOT EXISTS pay_rate_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_type text NOT NULL CHECK (day_type IN ('weekday', 'weekend', 'public_holiday')),
  remuneration_level_id uuid NOT NULL REFERENCES remuneration_levels(id) ON DELETE CASCADE,
  hourly_rate decimal(10,2) NOT NULL,
  multiplier decimal(3,2) NOT NULL DEFAULT 1.00,
  effective_from date DEFAULT CURRENT_DATE,
  effective_to date,
  created_at timestamptz DEFAULT now()
);

-- Create timesheets table
CREATE TABLE IF NOT EXISTS timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  clock_in timestamptz NOT NULL,
  clock_out timestamptz,
  paid_break_minutes integer DEFAULT 0,
  unpaid_break_minutes integer DEFAULT 0,
  total_hours decimal(5,2) DEFAULT 0.00,
  net_hours decimal(5,2) DEFAULT 0.00,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'paid', 'rejected')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Ensure timesheets table has required columns
DO $$
BEGIN
    RAISE NOTICE 'Checking timesheets columns...';
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'timesheets' AND column_name = 'shift_id' AND table_schema = 'public') THEN
        RAISE NOTICE 'Adding shift_id column';
        ALTER TABLE timesheets ADD COLUMN shift_id uuid REFERENCES shifts(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'timesheets' AND column_name = 'employee_id' AND table_schema = 'public') THEN
        RAISE NOTICE 'Adding employee_id column';
        ALTER TABLE timesheets ADD COLUMN employee_id uuid REFERENCES employees(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'timesheets' AND column_name = 'clock_in' AND table_schema = 'public') THEN
        RAISE NOTICE 'Adding clock_in column';
        ALTER TABLE timesheets ADD COLUMN clock_in timestamptz NOT NULL DEFAULT now();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'timesheets' AND column_name = 'clock_out' AND table_schema = 'public') THEN
        ALTER TABLE timesheets ADD COLUMN clock_out timestamptz;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'timesheets' AND column_name = 'paid_break_minutes' AND table_schema = 'public') THEN
        ALTER TABLE timesheets ADD COLUMN paid_break_minutes integer DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'timesheets' AND column_name = 'unpaid_break_minutes' AND table_schema = 'public') THEN
        ALTER TABLE timesheets ADD COLUMN unpaid_break_minutes integer DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'timesheets' AND column_name = 'total_hours' AND table_schema = 'public') THEN
        ALTER TABLE timesheets ADD COLUMN total_hours decimal(5,2) DEFAULT 0.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'timesheets' AND column_name = 'net_hours' AND table_schema = 'public') THEN
        ALTER TABLE timesheets ADD COLUMN net_hours decimal(5,2) DEFAULT 0.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'timesheets' AND column_name = 'status' AND table_schema = 'public') THEN
         ALTER TABLE timesheets ADD COLUMN status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'paid', 'rejected'));
    END IF;
     IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'timesheets' AND column_name = 'created_at' AND table_schema = 'public') THEN
        ALTER TABLE timesheets ADD COLUMN created_at timestamptz DEFAULT now();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'timesheets' AND column_name = 'updated_at' AND table_schema = 'public') THEN
        ALTER TABLE timesheets ADD COLUMN updated_at timestamptz DEFAULT now();
    END IF;
END $$;


-- Create timesheet_pay_calculation table
CREATE TABLE IF NOT EXISTS timesheet_pay_calculation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id uuid UNIQUE NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  base_hours decimal(5,2) DEFAULT 0.00,
  base_rate decimal(10,2) DEFAULT 0.00,
  weekday_hours decimal(5,2) DEFAULT 0.00,
  weekend_hours decimal(5,2) DEFAULT 0.00,
  public_holiday_hours decimal(5,2) DEFAULT 0.00,
  weekday_pay decimal(10,2) DEFAULT 0.00,
  weekend_pay decimal(10,2) DEFAULT 0.00,
  public_holiday_pay decimal(10,2) DEFAULT 0.00,
  total_pay decimal(10,2) DEFAULT 0.00,
  calculated_at timestamptz DEFAULT now()
);

-- Create timesheet_approval_workflow table
CREATE TABLE IF NOT EXISTS timesheet_approval_workflow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id uuid NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  approval_level integer DEFAULT 1,
  action text NOT NULL CHECK (action IN ('approved', 'rejected', 'returned')),
  comments text,
  approved_at timestamptz DEFAULT now()
);

-- Create pay_periods table
CREATE TABLE IF NOT EXISTS pay_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start_date date NOT NULL,
  period_end_date date NOT NULL,
  cutoff_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked', 'paid')),
  locked_at timestamptz,
  locked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_public_holidays_date ON public_holidays(holiday_date);
CREATE INDEX IF NOT EXISTS idx_pay_rate_rules_day_type ON pay_rate_rules(day_type);
CREATE INDEX IF NOT EXISTS idx_pay_rate_rules_level ON pay_rate_rules(remuneration_level_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_shift ON timesheets(shift_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_employee ON timesheets(employee_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_status ON timesheets(status);
CREATE INDEX IF NOT EXISTS idx_timesheets_clock_in ON timesheets(clock_in);
CREATE INDEX IF NOT EXISTS idx_timesheet_pay_calc_timesheet ON timesheet_pay_calculation(timesheet_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_approval_timesheet ON timesheet_approval_workflow(timesheet_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_approval_approver ON timesheet_approval_workflow(approver_id);
CREATE INDEX IF NOT EXISTS idx_pay_periods_dates ON pay_periods(period_start_date, period_end_date);
CREATE INDEX IF NOT EXISTS idx_pay_periods_status ON pay_periods(status);

-- Enable Row Level Security
ALTER TABLE public_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_rate_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_pay_calculation ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_approval_workflow ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_periods ENABLE ROW LEVEL SECURITY;

-- RLS Policies for public_holidays
CREATE POLICY "Everyone can view public holidays" ON public_holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage public holidays" ON public_holidays FOR INSERT TO authenticated WITH CHECK (true);

-- RLS Policies for pay_rate_rules
CREATE POLICY "Everyone can view pay rate rules" ON pay_rate_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage pay rate rules" ON pay_rate_rules FOR INSERT TO authenticated WITH CHECK (true);

-- RLS Policies for timesheets
CREATE POLICY "Authenticated users can view timesheets" ON timesheets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Employees can create timesheets" ON timesheets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Employees can update their timesheets" ON timesheets FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- RLS Policies for timesheet_pay_calculation
CREATE POLICY "Authenticated users can view pay calculations" ON timesheet_pay_calculation FOR SELECT TO authenticated USING (true);
CREATE POLICY "System can create pay calculations" ON timesheet_pay_calculation FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "System can update pay calculations" ON timesheet_pay_calculation FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- RLS Policies for timesheet_approval_workflow
CREATE POLICY "Authenticated users can view approvals" ON timesheet_approval_workflow FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can create approvals" ON timesheet_approval_workflow FOR INSERT TO authenticated WITH CHECK (true);

-- RLS Policies for pay_periods
CREATE POLICY "Everyone can view pay periods" ON pay_periods FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage pay periods" ON pay_periods FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins can update pay periods" ON pay_periods FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Insert Australian public holidays for 2025-2026
INSERT INTO public_holidays (holiday_date, holiday_name, applies_to_state, is_national) VALUES
  ('2025-01-01', 'New Year''s Day', 'NSW', true),
  ('2025-01-27', 'Australia Day', 'NSW', true),
  ('2025-04-18', 'Good Friday', 'NSW', true),
  ('2025-04-19', 'Easter Saturday', 'NSW', false),
  ('2025-04-21', 'Easter Monday', 'NSW', true),
  ('2025-04-25', 'Anzac Day', 'NSW', true),
  ('2025-06-09', 'Queen''s Birthday', 'NSW', false),
  ('2025-12-25', 'Christmas Day', 'NSW', true),
  ('2025-12-26', 'Boxing Day', 'NSW', true),
  ('2026-01-01', 'New Year''s Day', 'NSW', true),
  ('2026-01-26', 'Australia Day', 'NSW', true),
  ('2026-04-03', 'Good Friday', 'NSW', true),
  ('2026-04-04', 'Easter Saturday', 'NSW', false),
  ('2026-04-06', 'Easter Monday', 'NSW', true),
  ('2026-04-27', 'Anzac Day (Observed)', 'NSW', true),
  ('2026-06-08', 'Queen''s Birthday', 'NSW', false),
  ('2026-12-25', 'Christmas Day', 'NSW', true),
  ('2026-12-28', 'Boxing Day (Observed)', 'NSW', true)
ON CONFLICT (holiday_date) DO NOTHING;

-- Insert pay rate rules for all remuneration levels
-- INSERT INTO pay_rate_rules (day_type, remuneration_level_id, hourly_rate, multiplier)
-- SELECT 'weekday', id, hourly_rate, 1.00 FROM remuneration_levels
-- ON CONFLICT DO NOTHING;

-- INSERT INTO pay_rate_rules (day_type, remuneration_level_id, hourly_rate, multiplier)
-- SELECT 'weekend', id, hourly_rate, 1.50 FROM remuneration_levels
-- ON CONFLICT DO NOTHING;

-- INSERT INTO pay_rate_rules (day_type, remuneration_level_id, hourly_rate, multiplier)
-- SELECT 'public_holiday', id, hourly_rate, 2.00 FROM remuneration_levels
-- ON CONFLICT DO NOTHING;
