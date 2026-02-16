-- Migration: Allow Deletion of Past Shifts
-- Date: 2026-02-13
-- Purpose: 
-- Modification of fn_prevent_locked_shift_modification to allow DELETE operations.
-- The user requires the ability to delete shifts at any time, even if they have "started".
-- The lock is preserved for UPDATE operations to prevent modifying history.

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
    -- We use OLD values to check if the *existing* shift is already locked
    
    -- Construct timestamp in Sydney time for the OLD shift
    v_shift_start := (OLD.shift_date || ' ' || OLD.start_time)::timestamp AT TIME ZONE 'Australia/Sydney';
    v_now_sydney := NOW() AT TIME ZONE 'Australia/Sydney';
    
    -- If shift start is in the past, it is LOCKED for modification
    IF v_shift_start <= v_now_sydney THEN
        RAISE EXCEPTION 'Cannot modify a shift that has already started (Sydney Time). Shift ID: %', OLD.id;
    END IF;
    
    RETURN NEW;
END;
$$;
