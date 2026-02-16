
CREATE OR REPLACE FUNCTION public.compute_shift_fields()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Compute is_overnight
  NEW.is_overnight := NEW.end_time < NEW.start_time;
  
  -- Compute scheduled_length_minutes
  IF NEW.is_overnight THEN
    NEW.scheduled_length_minutes := EXTRACT(EPOCH FROM (
      ('24:00:00'::time - NEW.start_time) + NEW.end_time
    )) / 60;
  ELSE
    NEW.scheduled_length_minutes := EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 60;
  END IF;
  
  -- Compute net_length_minutes (subtract unpaid breaks only)
  NEW.net_length_minutes := NEW.scheduled_length_minutes - COALESCE(NEW.unpaid_break_minutes, 0);
  
  -- Keep break_minutes in sync
  NEW.break_minutes := COALESCE(NEW.paid_break_minutes, 0) + COALESCE(NEW.unpaid_break_minutes, 0);
  
  -- Set roster_date from shift_date
  IF NEW.roster_date IS NULL THEN
    NEW.roster_date := NEW.shift_date;
  END IF;
  
  -- Increment version on update
  IF TG_OP = 'UPDATE' THEN
    NEW.version := COALESCE(OLD.version, 0) + 1;
    NEW.updated_at := NOW();
  END IF;
  
  -- Update assignment_status (ENUM) based on assigned_employee_id
  -- We now use 'assigned'/'unassigned' enum values, NOT _text
  IF TG_OP = 'UPDATE' THEN
    IF NEW.assigned_employee_id IS NOT NULL AND OLD.assigned_employee_id IS NULL THEN
      NEW.assignment_status := 'assigned';
      NEW.assigned_at := NOW();
      -- NEW.assignment_method := 'manual'; -- If needed and column exists
    ELSIF NEW.assigned_employee_id IS NULL AND OLD.assigned_employee_id IS NOT NULL THEN
      NEW.assignment_status := 'unassigned';
      NEW.assigned_at := NULL;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.assigned_employee_id IS NOT NULL THEN
      NEW.assignment_status := 'assigned';
      NEW.assigned_at := NOW();
    END IF;
  END IF;
  
  -- Removed legacy employee_id sync
  
  RETURN NEW;
END;
$function$
