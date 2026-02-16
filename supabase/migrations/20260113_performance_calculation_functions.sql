/*
  # Performance Calculation Functions

  1. Functions
    - categorize_cancellation - Classify cancellations by notice period
    - calculate_employee_metrics - Compute all metrics for employee/period
  
  2. Usage
    - Used ONLY by background jobs
    - Frontend reads from employee_performance_metrics table
  
  3. Data Sources
    - No-shows: attendance_records.status = 'no_show' (single source of truth)
    - Cancellations: cancellation_history (with notice period)
    - All denominators use shifts_assigned for cancellation metrics
*/

-- Function to categorize cancellations (excludes no-shows)
CREATE OR REPLACE FUNCTION categorize_cancellation(
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
    RETURN 'emergency';  -- <4h but still cancelled (not no-show)
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to compute metrics for employee and period (used by background jobs only)
CREATE OR REPLACE FUNCTION calculate_employee_metrics(
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
    FROM roster_shift_assignments rsa
    LEFT JOIN attendance_records ar ON ar.shift_id = rsa.shift_id AND ar.employee_id = rsa.employee_id
    WHERE rsa.employee_id = p_employee_id
      AND rsa.scheduled_start::date BETWEEN p_start_date AND p_end_date
  ),
  cancellation_data AS (
    SELECT
      COUNT(*) FILTER (WHERE notice_period_hours >= 24) as standard_cancel,
      COUNT(*) FILTER (WHERE notice_period_hours >= 4 AND notice_period_hours < 24) as late_cancel
    FROM cancellation_history
    WHERE employee_id = p_employee_id
      AND cancelled_at::date BETWEEN p_start_date AND p_end_date
  )
  SELECT 
    0::int,  -- shifts_offered (TODO: compute from shift_offers table if exists)
    0::int,  -- shifts_accepted
    0::int,  -- shifts_rejected
    COALESCE(asf.total_assigned, 0)::int,
    COALESCE(asf.on_time, 0)::int,
    0::int,  -- shifts_swapped (TODO: compute from swap data if exists)
    COALESCE(cd.standard_cancel, 0)::int,
    COALESCE(cd.late_cancel, 0)::int,
    COALESCE(asf.no_shows_count, 0)::int,
    0.00::numeric,  -- acceptance_rate (TODO)
    0.00::numeric,  -- rejection_rate (TODO)
    CASE WHEN asf.total_assigned > 0 
      THEN ROUND((asf.on_time::numeric / asf.total_assigned) * 100, 2) 
      ELSE 100 
    END,
    0.00::numeric,  -- swap_ratio (TODO)
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
