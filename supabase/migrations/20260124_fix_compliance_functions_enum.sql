-- Migration: Fix Compliance Functions Enum Value
-- Description: Updates validate_rest_period and check_shift_overlap to use lowercase 'cancelled'
-- when comparing against shift_status enum. Postgres is case-sensitive for enums.

BEGIN;

CREATE OR REPLACE FUNCTION public.validate_rest_period(p_employee_id uuid, p_shift_date date, p_start_time time without time zone, p_end_time time without time zone, p_minimum_hours integer DEFAULT 11)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
    AND status != 'cancelled' -- FIX: Use lowercase enum value
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
    AND status != 'cancelled' -- FIX: Use lowercase enum value
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
$function$;

CREATE OR REPLACE FUNCTION public.check_shift_overlap(p_employee_id uuid, p_shift_date date, p_start_time time without time zone, p_end_time time without time zone, p_exclude_shift_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_overlap_exists boolean;
  v_shift_start timestamp;
  v_shift_end timestamp;
BEGIN
  v_shift_start := p_shift_date + p_start_time;
  v_shift_end := p_shift_date + p_end_time;

  -- Handle overnight shifts
  IF p_end_time < p_start_time THEN
    v_shift_end := v_shift_end + interval '1 day';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM shifts
    WHERE employee_id = p_employee_id
    AND id != COALESCE(p_exclude_shift_id, '00000000-0000-0000-0000-000000000000')
    AND status != 'cancelled' -- FIX: Use lowercase enum value
    AND (
      -- Check for time overlap
      (shift_date + start_time, 
       CASE 
         WHEN end_time < start_time THEN shift_date + end_time + interval '1 day'
         ELSE shift_date + end_time 
       END) OVERLAPS (v_shift_start, v_shift_end)
    )
  ) INTO v_overlap_exists;

  RETURN v_overlap_exists;
END;
$function$;

COMMIT;
