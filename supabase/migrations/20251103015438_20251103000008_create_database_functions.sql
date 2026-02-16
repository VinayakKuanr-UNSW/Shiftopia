/*
  # Create Database Functions and Triggers

  ## Overview
  This migration creates database functions for validation, calculations, and automation.

  ## Functions Created

  ### 1. calculate_shift_hours
  - Calculates total and net hours for a shift

  ### 2. check_daily_hours_limit
  - Validates if adding a shift would exceed 12hr daily limit

  ### 3. check_monthly_hours_limit
  - Validates if adding a shift would exceed 152hr monthly limit

  ### 4. check_rest_period
  - Validates if there's at least 10hr rest between shifts

  ### 5. validate_shift_swap
  - Comprehensive validation for shift swaps

  ### 6. calculate_suitability_score
  - Calculates employee SSS based on multiple factors

  ### 7. update_timestamp
  - Auto-updates updated_at columns

  ### 8. calculate_timesheet_pay
  - Calculates pay based on day type and rates
*/

-- Function to calculate shift hours
CREATE OR REPLACE FUNCTION calculate_shift_hours(
  p_start_time time,
  p_end_time time,
  p_paid_break_minutes integer,
  p_unpaid_break_minutes integer
)
RETURNS TABLE(total_hours decimal, net_hours decimal) AS $$
DECLARE
  v_total_minutes integer;
  v_net_minutes integer;
BEGIN
  -- Calculate total minutes between start and end time
  v_total_minutes := EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 60;
  
  -- Handle overnight shifts (end time before start time)
  IF v_total_minutes < 0 THEN
    v_total_minutes := v_total_minutes + (24 * 60);
  END IF;
  
  -- Calculate net minutes (subtract unpaid breaks only)
  v_net_minutes := v_total_minutes - p_unpaid_break_minutes;
  
  -- Return as decimal hours
  RETURN QUERY SELECT 
    ROUND((v_total_minutes / 60.0)::numeric, 2) as total_hours,
    ROUND((v_net_minutes / 60.0)::numeric, 2) as net_hours;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to check daily hours limit (12 hours)
CREATE OR REPLACE FUNCTION check_daily_hours_limit(
  p_employee_id uuid,
  p_date date,
  p_additional_hours decimal
)
RETURNS boolean AS $$
DECLARE
  v_current_hours decimal;
  v_total_hours decimal;
BEGIN
  -- Get current scheduled hours for the day
  SELECT COALESCE(SUM(net_length), 0)
  INTO v_current_hours
  FROM shifts
  WHERE employee_id = p_employee_id
  AND shift_date = p_date;
  
  v_total_hours := v_current_hours + p_additional_hours;
  
  -- Return true if within limit, false if exceeds
  RETURN v_total_hours <= 12.0;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to check monthly hours limit (152 hours)
CREATE OR REPLACE FUNCTION check_monthly_hours_limit(
  p_employee_id uuid,
  p_date date,
  p_additional_hours decimal
)
RETURNS boolean AS $$
DECLARE
  v_current_hours decimal;
  v_total_hours decimal;
  v_year integer;
  v_month integer;
BEGIN
  v_year := EXTRACT(YEAR FROM p_date);
  v_month := EXTRACT(MONTH FROM p_date);
  
  -- Get current scheduled hours for the month
  SELECT COALESCE(SUM(net_length), 0)
  INTO v_current_hours
  FROM shifts
  WHERE employee_id = p_employee_id
  AND EXTRACT(YEAR FROM shift_date) = v_year
  AND EXTRACT(MONTH FROM shift_date) = v_month;
  
  v_total_hours := v_current_hours + p_additional_hours;
  
  -- Return true if within limit, false if exceeds
  RETURN v_total_hours <= 152.0;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to check rest period (10 hours minimum)
CREATE OR REPLACE FUNCTION check_rest_period(
  p_employee_id uuid,
  p_shift_date date,
  p_start_time time,
  p_end_time time
)
RETURNS boolean AS $$
DECLARE
  v_previous_shift_end timestamptz;
  v_next_shift_start timestamptz;
  v_current_shift_start timestamptz;
  v_current_shift_end timestamptz;
  v_rest_hours decimal;
BEGIN
  -- Construct full timestamps
  v_current_shift_start := p_shift_date + p_start_time;
  v_current_shift_end := p_shift_date + p_end_time;
  
  -- Handle overnight shifts
  IF p_end_time < p_start_time THEN
    v_current_shift_end := v_current_shift_end + interval '1 day';
  END IF;
  
  -- Check rest period before this shift
  SELECT MAX(shift_date + end_time)
  INTO v_previous_shift_end
  FROM shifts
  WHERE employee_id = p_employee_id
  AND (shift_date + end_time) < v_current_shift_start
  AND (shift_date + end_time) >= v_current_shift_start - interval '24 hours';
  
  IF v_previous_shift_end IS NOT NULL THEN
    v_rest_hours := EXTRACT(EPOCH FROM (v_current_shift_start - v_previous_shift_end)) / 3600;
    IF v_rest_hours < 10 THEN
      RETURN false;
    END IF;
  END IF;
  
  -- Check rest period after this shift
  SELECT MIN(shift_date + start_time)
  INTO v_next_shift_start
  FROM shifts
  WHERE employee_id = p_employee_id
  AND (shift_date + start_time) > v_current_shift_end
  AND (shift_date + start_time) <= v_current_shift_end + interval '24 hours';
  
  IF v_next_shift_start IS NOT NULL THEN
    v_rest_hours := EXTRACT(EPOCH FROM (v_next_shift_start - v_current_shift_end)) / 3600;
    IF v_rest_hours < 10 THEN
      RETURN false;
    END IF;
  END IF;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to validate shift swap
CREATE OR REPLACE FUNCTION validate_shift_swap(
  p_swap_request_id uuid,
  p_employee_id uuid,
  p_shift_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_shift record;
  v_daily_check boolean;
  v_monthly_check boolean;
  v_rest_check boolean;
  v_result jsonb;
BEGIN
  -- Get shift details
  SELECT shift_date, start_time, end_time, net_length
  INTO v_shift
  FROM shifts
  WHERE id = p_shift_id;
  
  -- Run all validations
  v_daily_check := check_daily_hours_limit(p_employee_id, v_shift.shift_date, v_shift.net_length);
  v_monthly_check := check_monthly_hours_limit(p_employee_id, v_shift.shift_date, v_shift.net_length);
  v_rest_check := check_rest_period(p_employee_id, v_shift.shift_date, v_shift.start_time, v_shift.end_time);
  
  -- Build result JSON
  v_result := jsonb_build_object(
    'daily_hours_check', v_daily_check,
    'monthly_hours_check', v_monthly_check,
    'rest_period_check', v_rest_check,
    'is_valid', v_daily_check AND v_monthly_check AND v_rest_check
  );
  
  -- Insert validation record
  INSERT INTO swap_validations (
    swap_request_id, employee_id, daily_hours_check, 
    monthly_hours_check, rest_period_check, is_valid, validation_errors
  ) VALUES (
    p_swap_request_id, p_employee_id, v_daily_check,
    v_monthly_check, v_rest_check, 
    (v_daily_check AND v_monthly_check AND v_rest_check),
    v_result
  );
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate suitability score
CREATE OR REPLACE FUNCTION calculate_suitability_score(p_employee_id uuid)
RETURNS decimal AS $$
DECLARE
  v_metrics record;
  v_attendance_score decimal := 100;
  v_cancellation_penalty decimal := 0;
  v_swap_reliability decimal := 100;
  v_overall_score decimal;
BEGIN
  -- Get reliability metrics
  SELECT * INTO v_metrics
  FROM employee_reliability_metrics
  WHERE employee_id = p_employee_id;
  
  IF v_metrics IS NULL THEN
    RETURN 100.00;
  END IF;
  
  -- Calculate attendance score (based on on-time percentage)
  v_attendance_score := v_metrics.on_time_percentage;
  
  -- Calculate cancellation penalty (5 points per cancellation)
  v_cancellation_penalty := LEAST(v_metrics.total_cancellations * 5, 50);
  
  -- Calculate swap reliability
  v_swap_reliability := v_metrics.swap_completion_rate;
  
  -- Calculate overall score (weighted average)
  v_overall_score := (
    (v_attendance_score * 0.4) +
    ((100 - v_cancellation_penalty) * 0.3) +
    (v_swap_reliability * 0.3)
  );
  
  -- Update suitability scores table
  INSERT INTO employee_suitability_scores (
    employee_id, overall_score, attendance_score,
    cancellation_penalty, swap_reliability, last_calculated_at
  ) VALUES (
    p_employee_id, v_overall_score, v_attendance_score,
    v_cancellation_penalty, v_swap_reliability, now()
  )
  ON CONFLICT (employee_id) DO UPDATE SET
    overall_score = v_overall_score,
    attendance_score = v_attendance_score,
    cancellation_penalty = v_cancellation_penalty,
    swap_reliability = v_swap_reliability,
    last_calculated_at = now();
  
  RETURN ROUND(v_overall_score, 2);
END;
$$ LANGUAGE plpgsql;

-- Function to auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at on relevant tables
CREATE TRIGGER update_shifts_timestamp BEFORE UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_employees_timestamp BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_swap_requests_timestamp BEFORE UPDATE ON swap_requests
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_timesheets_timestamp BEFORE UPDATE ON timesheets
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_suitability_scores_timestamp BEFORE UPDATE ON employee_suitability_scores
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();
