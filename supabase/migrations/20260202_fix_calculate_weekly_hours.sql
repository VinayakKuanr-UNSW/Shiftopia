-- Fix calculate_weekly_hours function to use correct column names
-- The columns were renamed from employee_id/status to assigned_employee_id/lifecycle_status

CREATE OR REPLACE FUNCTION calculate_weekly_hours(
  p_employee_id uuid,
  p_week_start_date date
)
RETURNS decimal
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_minutes decimal;
  v_week_end_date date;
BEGIN
  -- Calculate end of week (7 days from start)
  v_week_end_date := p_week_start_date + INTERVAL '6 days';

  -- Sum up net_length (in minutes) for all shifts in the week
  SELECT COALESCE(SUM(net_length), 0)
  INTO v_total_minutes
  FROM shifts
  WHERE assigned_employee_id = p_employee_id
    AND shift_date >= p_week_start_date
    AND shift_date <= v_week_end_date
    AND lifecycle_status != 'Cancelled'
    AND deleted_at IS NULL;

  RETURN v_total_minutes;
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_weekly_hours(uuid, date) TO authenticated;
