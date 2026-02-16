-- Function to check if a shift is locked (Past Start Time in Sydney)
CREATE OR REPLACE FUNCTION fn_is_shift_locked(p_shift_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_shift_date date;
    v_start_time time;
    v_shift_start_timestamptz timestamptz;
    v_now_sydney timestamptz;
BEGIN
    -- Get shift details
    SELECT shift_date, start_time INTO v_shift_date, v_start_time
    FROM shifts
    WHERE id = p_shift_id;

    IF NOT FOUND THEN
        RETURN FALSE; -- Or true? If it doesn't exist, it can't be locked, essentially.
    END IF;

    -- Construct timestamp in Sydney time
    -- 'Australia/Sydney' handles DST automatically.
    -- We assume the stored date/time are "local to the venue", which is Sydney.
    v_shift_start_timestamptz := (v_shift_date || ' ' || v_start_time)::timestamp AT TIME ZONE 'Australia/Sydney';
    
    -- Get current time in Sydney
    v_now_sydney := NOW() AT TIME ZONE 'Australia/Sydney';

    -- Return true if shift start is in the past
    RETURN v_shift_start_timestamptz < v_now_sydney;
END;
$$;

-- RPC for frontend to check multiple shifts efficiently (optional usage)
CREATE OR REPLACE FUNCTION fn_get_shift_lock_statuses(p_shift_ids uuid[])
RETURNS TABLE (shift_id uuid, is_locked boolean)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.id,
        fn_is_shift_locked(s.id)
    FROM shifts s
    WHERE s.id = ANY(p_shift_ids);
END;
$$;

-- Trigger Function to prevent modification of locked shifts
CREATE OR REPLACE FUNCTION fn_prevent_locked_shift_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Allow admins to bypass? Maybe. For now, strict enforcement as requested.
    -- Check if the OLD shift was locked (i.e. we are trying to change a past shift)
    
    -- Note: We check OLD values. If the shift was already in the past, it shouldn't be touched.
    -- We assume the date/time in the DB is the source of truth.
    IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') THEN
        IF fn_is_shift_locked(OLD.id) THEN
            RAISE EXCEPTION 'Cannot modify or delete a shift that has already started (Locked). Shift ID: %', OLD.id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;

-- Apply Trigger
DROP TRIGGER IF EXISTS tr_lock_past_shifts ON shifts;

CREATE TRIGGER tr_lock_past_shifts
BEFORE UPDATE OR DELETE ON shifts
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_locked_shift_modification();
