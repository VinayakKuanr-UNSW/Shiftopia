-- Migration: Force disable audit trigger during shift delete
-- Date: 2026-01-10
-- Purpose: Create a function that explicitly disables the trigger during deletion

-- Drop and recreate the cascade delete function with trigger disable
CREATE OR REPLACE FUNCTION delete_template_shifts_cascade(p_template_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- 1. Get count first
    SELECT COUNT(*) INTO v_count FROM shifts WHERE template_id = p_template_id;
    
    IF v_count > 0 THEN
        -- 2. Disable the audit trigger temporarily
        ALTER TABLE shifts DISABLE TRIGGER shifts_audit_trigger;
        
        -- 3. Delete audit events for these shifts first
        DELETE FROM shift_audit_events 
        WHERE shift_id IN (SELECT id FROM shifts WHERE template_id = p_template_id);
        
        -- 4. Delete all shifts for this template
        DELETE FROM shifts WHERE template_id = p_template_id;
        
        -- 5. Re-enable the audit trigger
        ALTER TABLE shifts ENABLE TRIGGER shifts_audit_trigger;
    END IF;
    
    RETURN v_count;
END;
$$;

-- Same for individual shift delete
CREATE OR REPLACE FUNCTION delete_shift_cascade(p_shift_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- 1. Disable the audit trigger temporarily
    ALTER TABLE shifts DISABLE TRIGGER shifts_audit_trigger;
    
    -- 2. Delete audit events for this shift
    DELETE FROM shift_audit_events WHERE shift_id = p_shift_id;
    
    -- 3. Delete the shift
    DELETE FROM shifts WHERE id = p_shift_id;
    
    -- 4. Re-enable the audit trigger
    ALTER TABLE shifts ENABLE TRIGGER shifts_audit_trigger;
    
    RETURN true;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION delete_template_shifts_cascade(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_shift_cascade(UUID) TO authenticated;
