-- FUNCTION: delete_shift_cascade
-- Performs a defined SOFT DELETE on a shift and cleans up related records.

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

    -- Audit Log (best effort)
    INSERT INTO shift_audit_log (shift_id, action, changed_by_user_id, changed_by_name)
    VALUES (p_shift_id, 'DELETE', auth.uid(), 'System (Soft Delete)');

    RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error in delete_shift_cascade: %', SQLERRM;
    RETURN FALSE;
END;
$function$;
