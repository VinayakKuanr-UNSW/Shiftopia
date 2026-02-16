-- Migration: Create cascade delete function for shifts
-- Date: 2026-01-10
-- Purpose: Delete shifts and their audit events properly, bypassing RLS

-- Function to delete a single shift with its audit events
CREATE OR REPLACE FUNCTION delete_shift_cascade(p_shift_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- 1. Delete audit events for this shift
    DELETE FROM shift_audit_events 
    WHERE shift_id = p_shift_id;
    
    -- 2. Delete the shift itself
    DELETE FROM shifts 
    WHERE id = p_shift_id;
    
    RETURN true;
END;
$$;

-- Function to delete all shifts for a template with their audit events
CREATE OR REPLACE FUNCTION delete_template_shifts_cascade(p_template_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_shift_ids UUID[];
    v_count INTEGER;
BEGIN
    -- 1. Get all shift IDs for this template
    SELECT ARRAY_AGG(id) INTO v_shift_ids
    FROM shifts
    WHERE template_id = p_template_id;
    
    v_count := COALESCE(array_length(v_shift_ids, 1), 0);
    
    IF v_count > 0 THEN
        -- 2. Delete all audit events for these shifts
        DELETE FROM shift_audit_events 
        WHERE shift_id = ANY(v_shift_ids);
        
        -- 3. Delete all shifts for this template
        DELETE FROM shifts 
        WHERE template_id = p_template_id;
    END IF;
    
    RETURN v_count;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION delete_shift_cascade(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_template_shifts_cascade(UUID) TO authenticated;
