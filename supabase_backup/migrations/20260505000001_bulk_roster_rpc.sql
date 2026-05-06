-- ==========================================
-- BULK ROSTER FETCH RPC FOR AUTO-SCHEDULER
-- ==========================================

CREATE OR REPLACE FUNCTION public.get_employees_shift_window_bulk(
  p_employee_ids uuid[],
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  id uuid,
  assigned_employee_id uuid,
  shift_date date,
  start_time time without time zone,
  end_time time without time zone,
  unpaid_break_minutes integer
) 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.assigned_employee_id,
    s.shift_date,
    s.start_time,
    s.end_time,
    s.unpaid_break_minutes
  FROM public.shifts s
  WHERE s.assigned_employee_id = ANY(p_employee_ids)
    AND s.shift_date >= p_start_date
    AND s.shift_date <= p_end_date
    AND s.status != 'Cancelled';
END;
$$ LANGUAGE plpgsql;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION public.get_employees_shift_window_bulk(uuid[], date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_employees_shift_window_bulk(uuid[], date, date) TO service_role;
