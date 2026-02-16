/*
  # Create Compliance Validation Functions

  ## Overview
  This migration creates database functions for validating shift compliance rules
  including overlap detection and weekly hours calculation.

  ## Functions

  ### 1. check_shift_overlap
  Checks if a proposed shift overlaps with existing shifts for an employee
  Parameters:
    - p_employee_id: UUID of the employee
    - p_shift_date: Date of the proposed shift
    - p_start_time: Start time of the proposed shift
    - p_end_time: End time of the proposed shift
    - p_exclude_shift_id: Optional shift ID to exclude (for updates)
  Returns: Boolean (true if overlap exists)

  ### 2. calculate_weekly_hours
  Calculates total hours worked by an employee in a given week
  Parameters:
    - p_employee_id: UUID of the employee
    - p_week_start_date: Start date of the week
  Returns: Decimal representing total hours

  ### 3. validate_rest_period
  Validates minimum rest period between shifts (default 11 hours)
  Parameters:
    - p_employee_id: UUID of the employee
    - p_shift_date: Date of the proposed shift
    - p_start_time: Start time of the proposed shift
    - p_end_time: End time of the proposed shift
  Returns: Boolean (true if rest period is adequate)

  ### 4. get_eligible_employees_for_shift
  Returns list of employees eligible for a shift based on role, skills, and availability
  Parameters:
    - p_shift_id: UUID of the shift
  Returns: Table of employee records
*/

-- Function to check if a shift overlaps with existing shifts for an employee
CREATE OR REPLACE FUNCTION check_shift_overlap(
  p_employee_id uuid,
  p_shift_date date,
  p_start_time time,
  p_end_time time,
  p_exclude_shift_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_overlap_count integer;
BEGIN
  -- Check for overlapping shifts on the same date
  SELECT COUNT(*)
  INTO v_overlap_count
  FROM shifts
  WHERE employee_id = p_employee_id
    AND shift_date = p_shift_date
    AND (id != p_exclude_shift_id OR p_exclude_shift_id IS NULL)
    AND (
      -- New shift starts during existing shift
      (p_start_time >= start_time AND p_start_time < end_time)
      OR
      -- New shift ends during existing shift
      (p_end_time > start_time AND p_end_time <= end_time)
      OR
      -- New shift completely encompasses existing shift
      (p_start_time <= start_time AND p_end_time >= end_time)
    );

  RETURN v_overlap_count > 0;
END;
$$;

-- Function to calculate weekly hours for an employee
CREATE OR REPLACE FUNCTION calculate_weekly_hours(
  p_employee_id uuid,
  p_week_start_date date
)
RETURNS decimal
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_hours decimal;
  v_week_end_date date;
BEGIN
  -- Calculate end of week (7 days from start)
  v_week_end_date := p_week_start_date + INTERVAL '6 days';

  -- Sum up net_length for all shifts in the week
  SELECT COALESCE(SUM(net_length), 0)
  INTO v_total_hours
  FROM shifts
  WHERE employee_id = p_employee_id
    AND shift_date >= p_week_start_date
    AND shift_date <= v_week_end_date
    AND status != 'Cancelled';

  RETURN v_total_hours;
END;
$$;

-- Function to validate minimum rest period between shifts
CREATE OR REPLACE FUNCTION validate_rest_period(
  p_employee_id uuid,
  p_shift_date date,
  p_start_time time,
  p_end_time time,
  p_minimum_hours integer DEFAULT 11
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_previous_shift_end timestamp;
  v_next_shift_start timestamp;
  v_new_shift_start timestamp;
  v_new_shift_end timestamp;
  v_rest_period_ok boolean;
BEGIN
  v_rest_period_ok := true;
  v_new_shift_start := p_shift_date + p_start_time;
  v_new_shift_end := p_shift_date + p_end_time;

  -- Check previous shift
  SELECT shift_date + end_time
  INTO v_previous_shift_end
  FROM shifts
  WHERE employee_id = p_employee_id
    AND (shift_date < p_shift_date OR (shift_date = p_shift_date AND end_time <= p_start_time))
    AND status != 'Cancelled'
  ORDER BY shift_date DESC, end_time DESC
  LIMIT 1;

  -- If there's a previous shift, check rest period
  IF v_previous_shift_end IS NOT NULL THEN
    IF (v_new_shift_start - v_previous_shift_end) < (p_minimum_hours || ' hours')::interval THEN
      v_rest_period_ok := false;
      RETURN v_rest_period_ok;
    END IF;
  END IF;

  -- Check next shift
  SELECT shift_date + start_time
  INTO v_next_shift_start
  FROM shifts
  WHERE employee_id = p_employee_id
    AND (shift_date > p_shift_date OR (shift_date = p_shift_date AND start_time >= p_end_time))
    AND status != 'Cancelled'
  ORDER BY shift_date ASC, start_time ASC
  LIMIT 1;

  -- If there's a next shift, check rest period
  IF v_next_shift_start IS NOT NULL THEN
    IF (v_next_shift_start - v_new_shift_end) < (p_minimum_hours || ' hours')::interval THEN
      v_rest_period_ok := false;
    END IF;
  END IF;

  RETURN v_rest_period_ok;
END;
$$;

-- Function to get eligible employees for a shift
CREATE OR REPLACE FUNCTION get_eligible_employees_for_shift(
  p_shift_id uuid
)
RETURNS TABLE (
  employee_id uuid,
  employee_name text,
  employee_email text,
  has_required_skills boolean,
  current_weekly_hours decimal,
  has_availability boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role_id uuid;
  v_shift_date date;
  v_start_time time;
  v_end_time time;
  v_week_start_date date;
BEGIN
  -- Get shift details
  SELECT role_id, shift_date, start_time, end_time
  INTO v_role_id, v_shift_date, v_start_time, v_end_time
  FROM shifts
  WHERE id = p_shift_id;

  -- Calculate week start (assuming week starts on Monday)
  v_week_start_date := v_shift_date - (EXTRACT(DOW FROM v_shift_date)::integer - 1);

  RETURN QUERY
  SELECT
    e.id AS employee_id,
    e.name AS employee_name,
    e.email AS employee_email,
    true AS has_required_skills, -- Placeholder for skill matching logic
    calculate_weekly_hours(e.id, v_week_start_date) AS current_weekly_hours,
    NOT check_shift_overlap(e.id, v_shift_date, v_start_time, v_end_time) AS has_availability
  FROM employees e
  WHERE EXISTS (
    -- Employee has the required role
    SELECT 1 FROM user_profiles up
    WHERE up.employee_id = e.id
  )
  ORDER BY current_weekly_hours ASC;
END;
$$;

-- Function to calculate shift length in hours
CREATE OR REPLACE FUNCTION calculate_shift_length(
  p_start_time time,
  p_end_time time,
  p_paid_break_minutes integer DEFAULT 0,
  p_unpaid_break_minutes integer DEFAULT 0
)
RETURNS TABLE (
  total_length decimal,
  net_length decimal
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_total_minutes integer;
  v_total_hours decimal;
  v_net_hours decimal;
BEGIN
  -- Calculate total minutes between start and end time
  v_total_minutes := EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 60;

  -- If end time is before start time, assume it crosses midnight
  IF p_end_time < p_start_time THEN
    v_total_minutes := v_total_minutes + (24 * 60);
  END IF;

  -- Convert to hours
  v_total_hours := v_total_minutes::decimal / 60;

  -- Calculate net hours (excluding unpaid breaks)
  v_net_hours := (v_total_minutes - p_unpaid_break_minutes)::decimal / 60;

  RETURN QUERY SELECT v_total_hours, v_net_hours;
END;
$$;

-- Grant execute permissions to authenticated users with explicit signatures
GRANT EXECUTE ON FUNCTION check_shift_overlap(uuid, date, time, time, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_weekly_hours(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION validate_rest_period(uuid, date, time, time, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_eligible_employees_for_shift(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_shift_length(time, time, integer, integer) TO authenticated;
