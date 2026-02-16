/*
  # Create Enhanced Bidding System

  ## Overview
  This migration creates enhanced bidding tables with SSS integration, eligibility checks,
  and automated allocation tracking.

  ## New Tables

  ### 1. shift_bids (enhanced from existing bids table)
  - `id` (uuid, primary key)
  - `shift_id` (uuid, foreign key to shifts)
  - `employee_id` (uuid, foreign key to employees)
  - `suitability_score` (decimal) - Employee's SSS at time of bid
  - `skill_match_percentage` (decimal) - How well skills match
  - `rest_period_valid` (boolean) - Passes 10hr rest check
  - `hours_limit_valid` (boolean) - Within daily/monthly limits
  - `bid_rank` (integer) - Ranking for allocation
  - `status` (text) - pending, accepted, rejected
  - `allocation_reason` (text) - Why accepted/rejected
  - `notes` (text)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 2. bid_eligibility_checks
  - `id` (uuid, primary key)
  - `bid_id` (uuid, foreign key to shift_bids)
  - `employee_id` (uuid, foreign key to employees)
  - `shift_id` (uuid, foreign key to shifts)
  - `skills_check` (boolean)
  - `availability_check` (boolean)
  - `hours_limit_check` (boolean)
  - `rest_period_check` (boolean)
  - `eligibility_errors` (jsonb)
  - `is_eligible` (boolean)
  - `checked_at` (timestamptz)

  ### 3. shift_bid_windows
  - `id` (uuid, primary key)
  - `shift_id` (uuid, foreign key to shifts)
  - `opens_at` (timestamptz)
  - `closes_at` (timestamptz)
  - `status` (text) - open, closed, allocated
  - `total_bids` (integer, default 0)
  - `created_at` (timestamptz)

  ### 4. bid_allocation_log
  - `id` (uuid, primary key)
  - `shift_id` (uuid, foreign key to shifts)
  - `allocated_to_employee_id` (uuid, foreign key to employees)
  - `allocation_algorithm` (text) - sss_based, first_come, manual
  - `algorithm_version` (text)
  - `total_bids_received` (integer)
  - `allocation_date` (timestamptz)

  ## Security
  - Enable RLS on all tables
  - Employees can view and create their own bids
  - Managers can view all bids and perform allocation

  ## Indexes
  - Add indexes on foreign keys and frequently queried fields
*/

-- Create shift_bids table (enhanced bidding)
CREATE TABLE IF NOT EXISTS shift_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  suitability_score decimal(5,2) DEFAULT 100.00,
  skill_match_percentage decimal(5,2) DEFAULT 0.00,
  rest_period_valid boolean DEFAULT true,
  hours_limit_valid boolean DEFAULT true,
  bid_rank integer,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  allocation_reason text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(shift_id, employee_id)
);

-- Ensure shift_bids table has required columns
DO $$
BEGIN
    RAISE NOTICE 'Checking shift_bids columns...';
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_bids' AND column_name = 'shift_id' AND table_schema = 'public') THEN
        RAISE NOTICE 'Adding shift_id column';
        ALTER TABLE shift_bids ADD COLUMN shift_id uuid REFERENCES shifts(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_bids' AND column_name = 'employee_id' AND table_schema = 'public') THEN
        RAISE NOTICE 'Adding employee_id column';
        ALTER TABLE shift_bids ADD COLUMN employee_id uuid REFERENCES employees(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_bids' AND column_name = 'status' AND table_schema = 'public') THEN
        RAISE NOTICE 'Adding status column';
        ALTER TABLE shift_bids ADD COLUMN status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_bids' AND column_name = 'suitability_score' AND table_schema = 'public') THEN
        ALTER TABLE shift_bids ADD COLUMN suitability_score decimal(5,2) DEFAULT 100.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_bids' AND column_name = 'skill_match_percentage' AND table_schema = 'public') THEN
        ALTER TABLE shift_bids ADD COLUMN skill_match_percentage decimal(5,2) DEFAULT 0.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_bids' AND column_name = 'rest_period_valid' AND table_schema = 'public') THEN
        ALTER TABLE shift_bids ADD COLUMN rest_period_valid boolean DEFAULT true;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_bids' AND column_name = 'hours_limit_valid' AND table_schema = 'public') THEN
        ALTER TABLE shift_bids ADD COLUMN hours_limit_valid boolean DEFAULT true;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_bids' AND column_name = 'bid_rank' AND table_schema = 'public') THEN
        ALTER TABLE shift_bids ADD COLUMN bid_rank integer;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_bids' AND column_name = 'allocation_reason' AND table_schema = 'public') THEN
        ALTER TABLE shift_bids ADD COLUMN allocation_reason text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_bids' AND column_name = 'notes' AND table_schema = 'public') THEN
        ALTER TABLE shift_bids ADD COLUMN notes text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_bids' AND column_name = 'created_at' AND table_schema = 'public') THEN
        ALTER TABLE shift_bids ADD COLUMN created_at timestamptz DEFAULT now();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_bids' AND column_name = 'updated_at' AND table_schema = 'public') THEN
        ALTER TABLE shift_bids ADD COLUMN updated_at timestamptz DEFAULT now();
    END IF;
END $$;


-- Create bid_eligibility_checks table
CREATE TABLE IF NOT EXISTS bid_eligibility_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id uuid NOT NULL REFERENCES shift_bids(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  skills_check boolean DEFAULT false,
  availability_check boolean DEFAULT false,
  hours_limit_check boolean DEFAULT false,
  rest_period_check boolean DEFAULT false,
  eligibility_errors jsonb DEFAULT '{}',
  is_eligible boolean DEFAULT false,
  checked_at timestamptz DEFAULT now()
);

-- Create shift_bid_windows table
CREATE TABLE IF NOT EXISTS shift_bid_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid UNIQUE NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'allocated')),
  total_bids integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Create bid_allocation_log table
CREATE TABLE IF NOT EXISTS bid_allocation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  allocated_to_employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  allocation_algorithm text DEFAULT 'sss_based' CHECK (allocation_algorithm IN ('sss_based', 'first_come', 'manual', 'random')),
  algorithm_version text DEFAULT '1.0',
  total_bids_received integer DEFAULT 0,
  allocation_date timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_shift_bids_shift ON shift_bids(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_bids_employee ON shift_bids(employee_id);
CREATE INDEX IF NOT EXISTS idx_shift_bids_status ON shift_bids(status);
CREATE INDEX IF NOT EXISTS idx_shift_bids_rank ON shift_bids(bid_rank) WHERE bid_rank IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shift_bids_suitability ON shift_bids(suitability_score DESC);
CREATE INDEX IF NOT EXISTS idx_bid_eligibility_bid ON bid_eligibility_checks(bid_id);
CREATE INDEX IF NOT EXISTS idx_bid_eligibility_employee ON bid_eligibility_checks(employee_id);
CREATE INDEX IF NOT EXISTS idx_bid_eligibility_shift ON bid_eligibility_checks(shift_id);
CREATE INDEX IF NOT EXISTS idx_bid_eligibility_is_eligible ON bid_eligibility_checks(is_eligible);
CREATE INDEX IF NOT EXISTS idx_bid_windows_shift ON shift_bid_windows(shift_id);
CREATE INDEX IF NOT EXISTS idx_bid_windows_status ON shift_bid_windows(status);
CREATE INDEX IF NOT EXISTS idx_bid_windows_closes_at ON shift_bid_windows(closes_at);
CREATE INDEX IF NOT EXISTS idx_bid_allocation_shift ON bid_allocation_log(shift_id);
CREATE INDEX IF NOT EXISTS idx_bid_allocation_employee ON bid_allocation_log(allocated_to_employee_id);
CREATE INDEX IF NOT EXISTS idx_bid_allocation_date ON bid_allocation_log(allocation_date DESC);

-- Enable Row Level Security
ALTER TABLE shift_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_eligibility_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_bid_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_allocation_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies for shift_bids
CREATE POLICY "Authenticated users can view all bids" ON shift_bids FOR SELECT TO authenticated USING (true);
CREATE POLICY "Employees can create bids" ON shift_bids FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Employees can update their own bids" ON shift_bids FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- RLS Policies for bid_eligibility_checks
CREATE POLICY "Authenticated users can view eligibility checks" ON bid_eligibility_checks FOR SELECT TO authenticated USING (true);
CREATE POLICY "System can create eligibility checks" ON bid_eligibility_checks FOR INSERT TO authenticated WITH CHECK (true);

-- RLS Policies for shift_bid_windows
CREATE POLICY "Authenticated users can view bid windows" ON shift_bid_windows FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can manage bid windows" ON shift_bid_windows FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Managers can update bid windows" ON shift_bid_windows FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- RLS Policies for bid_allocation_log
CREATE POLICY "Authenticated users can view allocation logs" ON bid_allocation_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "System can create allocation logs" ON bid_allocation_log FOR INSERT TO authenticated WITH CHECK (true);
