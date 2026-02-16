-- Allow Deletion of Past Shifts
-- Problem: fn_prevent_locked_shift_modification blocks DELETE on shifts that have already started.
-- User Request: "i can delete a shift that has already started just not edit/publish"
-- Solution: Update the function to bypass the lock check if the operation is DELETE.

CREATE OR REPLACE FUNCTION public.fn_prevent_locked_shift_modification()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_shift_start timestamptz;
BEGIN
    -- Allow DELETE operations explicitly
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    -- Check if we are modifying a shift
    -- We use OLD values to check if the *existing* shift is already locked
    
    -- Construct absolute timestamp (UTC) from the Sydney-based shift date/time
    v_shift_start := (OLD.shift_date || ' ' || OLD.start_time)::timestamp AT TIME ZONE 'Australia/Sydney';
    
    -- Compare absolute times. NOW() is already absolute (timestamptz).
    IF v_shift_start <= NOW() THEN
        RAISE EXCEPTION 'Cannot modify a shift that has already started (Sydney Time). Shift ID: %', OLD.id;
    END IF;
    
    RETURN NEW;
END;
$function$;
