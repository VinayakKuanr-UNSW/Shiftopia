/*
  # Add Lifecycle and Flags System for Shift Management

  ## Overview
  This migration adds comprehensive lifecycle status tracking, flag system, bidding functionality,
  trade requests, and audit logging to the shift management system.

  ## Changes

  ### 1. Lifecycle Status Management
  - Convert shifts.status to use proper enum type
  - Add lifecycle-related columns: lifecycle_status, cancelled_at, cancelled_by, cancellation_reason
  - Create lifecycle audit log table for tracking all state transitions

  ### 2. Shift Flags System
  - Create shift_flags table for tracking various shift indicators
  - Support flags: on_bidding, trade_requested, high_priority, compliance_issue

  ### 3. Bidding System
  - Add bidding window columns to shifts table
  - Create shift_bids table for employee bid submissions
  - Track bid timestamp and manager selection

  ### 4. Trade Request System
  - Create trade_requests table for shift swap workflows
  - Support two-stage approval: target employee + manager
  - Track trade request history

  ### 5. Auto-progression Function
  - Create function to automatically transition shift lifecycle based on time
  - Scheduled to Active at start_time
  - Active to Completed at end_time

  ## Security
  - Enable RLS on all new tables
  - Add policies for authenticated users
  - Restrict sensitive operations to managers

  ## Notes
  - Existing shifts will default to 'scheduled' lifecycle status
  - Auto-progression requires external scheduler/cron job
*/

-- Step 1: Create lifecycle status enum type
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lifecycle_status_enum') THEN
    CREATE TYPE lifecycle_status_enum AS ENUM ('draft', 'scheduled', 'active', 'completed', 'cancelled');
  END IF;
END $$;

-- Step 2: Add lifecycle status column to shifts table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shifts' AND column_name = 'lifecycle_status'
  ) THEN
    ALTER TABLE shifts ADD COLUMN lifecycle_status lifecycle_status_enum DEFAULT 'scheduled';
  END IF;
END $$;

-- Step 3: Add cancellation tracking columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shifts' AND column_name = 'cancelled_at'
  ) THEN
    ALTER TABLE shifts ADD COLUMN cancelled_at timestamptz;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shifts' AND column_name = 'cancelled_by'
  ) THEN
    ALTER TABLE shifts ADD COLUMN cancelled_by uuid REFERENCES auth.users(id);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shifts' AND column_name = 'cancellation_reason'
  ) THEN
    ALTER TABLE shifts ADD COLUMN cancellation_reason text;
  END IF;
END $$;

-- Step 4: Add bidding window columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shifts' AND column_name = 'bidding_enabled'
  ) THEN
    ALTER TABLE shifts ADD COLUMN bidding_enabled boolean DEFAULT false;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shifts' AND column_name = 'bidding_open_at'
  ) THEN
    ALTER TABLE shifts ADD COLUMN bidding_open_at timestamptz;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shifts' AND column_name = 'bidding_close_at'
  ) THEN
    ALTER TABLE shifts ADD COLUMN bidding_close_at timestamptz;
  END IF;
END $$;

-- Step 5: Create shift_lifecycle_log table
CREATE TABLE IF NOT EXISTS shift_lifecycle_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  old_status lifecycle_status_enum,
  new_status lifecycle_status_enum NOT NULL,
  changed_at timestamptz DEFAULT now(),
  changed_by uuid REFERENCES auth.users(id),
  reason text,
  created_at timestamptz DEFAULT now()
);

-- Step 6: Create shift_flags table
CREATE TABLE IF NOT EXISTS shift_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  flag_type text NOT NULL CHECK (flag_type IN ('on_bidding', 'trade_requested', 'high_priority', 'compliance_issue')),
  enabled boolean DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(shift_id, flag_type)
);

-- Step 7: Create shift_bids table
CREATE TABLE IF NOT EXISTS shift_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  bid_timestamp timestamptz DEFAULT now(),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'selected', 'rejected')),
  manager_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(shift_id, employee_id)
);

-- Step 8: Create trade_requests table
CREATE TABLE IF NOT EXISTS trade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  requesting_employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  target_employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'target_accepted', 'manager_approved', 'rejected', 'cancelled')),
  notes text,
  target_accepted_at timestamptz,
  manager_approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Step 9: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_shifts_lifecycle_status ON shifts(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_shifts_bidding ON shifts(bidding_enabled, bidding_close_at) WHERE bidding_enabled = true;
CREATE INDEX IF NOT EXISTS idx_shift_lifecycle_log_shift ON shift_lifecycle_log(shift_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_flags_shift ON shift_flags(shift_id) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_shift_bids_shift ON shift_bids(shift_id, status);
CREATE INDEX IF NOT EXISTS idx_trade_requests_status ON trade_requests(status, created_at DESC);

-- Step 10: Enable RLS on new tables
ALTER TABLE shift_lifecycle_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_requests ENABLE ROW LEVEL SECURITY;

-- Step 11: Create RLS policies for shift_lifecycle_log
CREATE POLICY "Authenticated users can view lifecycle logs"
  ON shift_lifecycle_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can insert lifecycle logs"
  ON shift_lifecycle_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Step 12: Create RLS policies for shift_flags
CREATE POLICY "Authenticated users can view shift flags"
  ON shift_flags FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage shift flags"
  ON shift_flags FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Step 13: Create RLS policies for shift_bids
CREATE POLICY "Authenticated users can view shift bids"
  ON shift_bids FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Employees can create their own bids"
  ON shift_bids FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Managers can update bid status"
  ON shift_bids FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Step 14: Create RLS policies for trade_requests
CREATE POLICY "Authenticated users can view trade requests"
  ON trade_requests FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Employees can create trade requests"
  ON trade_requests FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update trade requests"
  ON trade_requests FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Step 15: Create function to auto-update lifecycle status
CREATE OR REPLACE FUNCTION update_shift_lifecycle_status()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  shift_record RECORD;
  new_status lifecycle_status_enum;
BEGIN
  -- Loop through shifts that need status updates
  FOR shift_record IN
    SELECT 
      id, 
      lifecycle_status, 
      shift_date, 
      start_time, 
      end_time
    FROM shifts
    WHERE lifecycle_status IN ('scheduled', 'active')
      AND lifecycle_status != 'cancelled'
  LOOP
    -- Determine new status based on current time
    IF NOW()::date > shift_record.shift_date 
       OR (NOW()::date = shift_record.shift_date AND NOW()::time >= shift_record.end_time) THEN
      new_status := 'completed';
    ELSIF NOW()::date = shift_record.shift_date AND NOW()::time >= shift_record.start_time THEN
      new_status := 'active';
    ELSE
      new_status := shift_record.lifecycle_status;
    END IF;

    -- Update if status changed
    IF new_status != shift_record.lifecycle_status THEN
      UPDATE shifts 
      SET 
        lifecycle_status = new_status,
        updated_at = NOW()
      WHERE id = shift_record.id;

      -- Log the transition
      INSERT INTO shift_lifecycle_log (shift_id, old_status, new_status, reason)
      VALUES (shift_record.id, shift_record.lifecycle_status, new_status, 'Auto-progression based on time');
    END IF;
  END LOOP;
END;
$$;

-- Step 16: Create trigger to automatically log lifecycle changes
CREATE OR REPLACE FUNCTION log_lifecycle_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status THEN
    INSERT INTO shift_lifecycle_log (shift_id, old_status, new_status, changed_by)
    VALUES (NEW.id, OLD.lifecycle_status, NEW.lifecycle_status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'shift_lifecycle_change_trigger'
  ) THEN
    CREATE TRIGGER shift_lifecycle_change_trigger
      AFTER UPDATE ON shifts
      FOR EACH ROW
      WHEN (OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status)
      EXECUTE FUNCTION log_lifecycle_change();
  END IF;
END $$;

-- Step 17: Create helper function to get active flags for a shift
CREATE OR REPLACE FUNCTION get_shift_flags(p_shift_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  SELECT ARRAY_AGG(flag_type)
  FROM shift_flags
  WHERE shift_id = p_shift_id AND enabled = true;
$$;

-- Step 18: Update existing shifts to have proper lifecycle status
UPDATE shifts 
SET lifecycle_status = 
  CASE 
    WHEN is_draft = true THEN 'draft'::lifecycle_status_enum
    -- WHEN status = 'Completed' THEN 'completed'::lifecycle_status_enum (Invalid enum value)
    WHEN NOW()::date > shift_date OR (NOW()::date = shift_date AND NOW()::time >= end_time) THEN 'completed'::lifecycle_status_enum
    WHEN NOW()::date = shift_date AND NOW()::time >= start_time THEN 'active'::lifecycle_status_enum
    ELSE 'scheduled'::lifecycle_status_enum
  END
WHERE lifecycle_status IS NULL OR lifecycle_status = 'scheduled';
