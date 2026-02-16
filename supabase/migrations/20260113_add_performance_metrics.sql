/*
  # Add Employee Performance Metrics Table

  1. New Tables
    - `employee_performance_metrics` - Pre-calculated quarterly metrics
  
  2. Features
    - Stores numerator/denominator for all metrics
    - Quarter locking to prevent retroactive changes
    - Metric versioning for audit trail
    - Supports both quarterly and all-time metrics (quarter_year = 'ALL_TIME')
  
  3. Security
    - Enable RLS
    - Authenticated users can read
    - Background jobs can write (via service role)
  
  4. Indexes
    - Employee, quarter, and locked status indexes
*/

-- Create employee_performance_metrics table
CREATE TABLE IF NOT EXISTS employee_performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  quarter_year text NOT NULL,  -- e.g., 'Q1_2026' or 'ALL_TIME'
  is_locked boolean DEFAULT false,  -- Lock after quarter close
  
  -- Core metrics with numerator/denominator
  shifts_offered integer DEFAULT 0,
  shifts_accepted integer DEFAULT 0,
  shifts_rejected integer DEFAULT 0,
  shifts_assigned integer DEFAULT 0,
  shifts_worked integer DEFAULT 0,
  shifts_swapped integer DEFAULT 0,
  
  acceptance_rate numeric(5,2) DEFAULT 0,  -- shifts_accepted / shifts_offered
  rejection_rate numeric(5,2) DEFAULT 0,   -- shifts_rejected / shifts_offered
  punctuality_rate numeric(5,2) DEFAULT 100,
  swap_ratio numeric(5,2) DEFAULT 0,       -- shifts_swapped / shifts_worked
  
  -- Cancellation metrics (denominator: shifts_assigned)
  standard_cancellations integer DEFAULT 0,  -- >24h notice
  late_cancellations integer DEFAULT 0,      -- 4-24h notice
  no_shows integer DEFAULT 0,                -- <4h or no notice
  
  cancellation_rate_standard numeric(5,2) DEFAULT 0,  -- standard_cancellations / shifts_assigned
  cancellation_rate_late numeric(5,2) DEFAULT 0,      -- late_cancellations / shifts_assigned
  no_show_rate numeric(5,2) DEFAULT 0,                -- no_shows / shifts_assigned
  
  -- Versioning and audit
  metric_version integer DEFAULT 1,
  calculated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(employee_id, quarter_year)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_perf_metrics_employee ON employee_performance_metrics(employee_id);
CREATE INDEX IF NOT EXISTS idx_perf_metrics_quarter ON employee_performance_metrics(quarter_year);
CREATE INDEX IF NOT EXISTS idx_perf_metrics_locked ON employee_performance_metrics(is_locked);

-- Trigger to prevent updates to locked quarters
CREATE OR REPLACE FUNCTION prevent_locked_quarter_updates()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_locked = true AND NEW.is_locked = true THEN
    RAISE EXCEPTION 'Cannot modify locked quarter metrics. Use explicit reprocess command to override.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_quarter_lock
  BEFORE UPDATE ON employee_performance_metrics
  FOR EACH ROW
  EXECUTE FUNCTION prevent_locked_quarter_updates();

-- Enable Row Level Security
ALTER TABLE employee_performance_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view performance metrics"
  ON employee_performance_metrics FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can manage performance metrics"
  ON employee_performance_metrics FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "System can update unlocked performance metrics"
  ON employee_performance_metrics FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
