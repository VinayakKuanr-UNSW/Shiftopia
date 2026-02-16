-- Migration: fix_delete_cascade
-- Description: Ensures delete_shift_cascade RPC exists and correctly handles dependencies

CREATE OR REPLACE FUNCTION public.delete_shift_cascade(p_shift_id uuid, p_deleted_by uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_shift_exists boolean;
BEGIN
    -- Check if shift exists
    SELECT EXISTS (SELECT 1 FROM public.shifts WHERE id = p_shift_id) INTO v_shift_exists;
    
    IF NOT v_shift_exists THEN
        RETURN false;
    END IF;

    -- Delete related records (dependencies)
    
    -- 1. Shift Bids
    DELETE FROM public.shift_bids WHERE shift_id = p_shift_id;
    
    -- 2. Audit Logs
    DELETE FROM public.shift_audit_log WHERE shift_id = p_shift_id;

    -- 3. Roster Shift Assignments (if exists)
    DELETE FROM public.roster_shift_assignments WHERE shift_id = p_shift_id;

    -- 4. Delete the shift itself
    DELETE FROM public.shifts WHERE id = p_shift_id;

    RETURN true;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error deleting shift %: %', p_shift_id, SQLERRM;
        RETURN false;
END;
$function$;
