-- Migration: fix_shift_deletion
-- Description: Updates delete_shift_cascade to soft-delete shifts and cancel offers without referencing the deprecated shift_audit_log table.

CREATE OR REPLACE FUNCTION public.delete_shift_cascade(p_shift_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_shift_exists boolean;
BEGIN
    -- Check if shift exists
    SELECT EXISTS (SELECT 1 FROM shifts WHERE id = p_shift_id AND deleted_at IS NULL) INTO v_shift_exists;
    
    IF NOT v_shift_exists THEN
        RETURN FALSE;
    END IF;

    -- Update the shift to be soft-deleted
    -- This will fire the log_shift_changes trigger which now handles soft-delete logging
    UPDATE shifts
    SET 
        deleted_at = NOW(),
        deleted_by = auth.uid(),
        updated_at = NOW()
    WHERE id = p_shift_id;

    -- Also cancel related offers
    UPDATE shift_offers
    SET status = 'cancelled'
    WHERE shift_id = p_shift_id AND status = 'Pending';

    RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
    -- Log error but don't silently return false without detail in logs
    RAISE WARNING 'Error in delete_shift_cascade: %', SQLERRM;
    RETURN FALSE;
END;
$function$;
