-- Migration: Allow Deletion of Past Shifts (Refined for SET NULL)
-- Date: 2026-02-13
-- Purpose: 
-- Modification of fn_prevent_locked_shift_modification to allow:
-- 1. DELETE operations (user initiated).
-- 2. UPDATE operations specifically when 'roster_template_id' is set to NULL (cascaded from ON DELETE SET NULL).

CREATE OR REPLACE FUNCTION fn_prevent_locked_shift_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_shift_start timestamptz;
    v_now_sydney timestamptz;
BEGIN
    -- Allow DELETE operations
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    -- Check if we are modifying a shift (UPDATE)
    
    -- Construct timestamp in Sydney time for the OLD shift
    v_shift_start := (OLD.shift_date || ' ' || OLD.start_time)::timestamp AT TIME ZONE 'Australia/Sydney';
    v_now_sydney := NOW() AT TIME ZONE 'Australia/Sydney';
    
    -- If shift start is in the past, it is LOCKED for modification
    IF v_shift_start <= v_now_sydney THEN
        -- EXCEPTION: Allow unlinking from roster_template (ON DELETE SET NULL cascade)
        -- We check if the roster_template_id is changing to NULL.
        IF (OLD.roster_template_id IS NOT NULL AND NEW.roster_template_id IS NULL) THEN
             -- Allow this specific update.
             RETURN NEW;
        END IF;

        RAISE EXCEPTION 'Cannot modify a shift that has already started (Sydney Time). Shift ID: %', OLD.id;
    END IF;
    
    RETURN NEW;
END;
$$;
