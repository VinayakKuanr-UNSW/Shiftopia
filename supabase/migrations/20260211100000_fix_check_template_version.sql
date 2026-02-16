-- Migration: Fix check_template_version RPC to match frontend interface and resolve ambiguity
-- Date: 2026-02-11
-- Purpose: Fix ambiguous column reference error by aliasing the table.

DROP FUNCTION IF EXISTS check_template_version(uuid, integer);

CREATE OR REPLACE FUNCTION public.check_template_version(p_template_id uuid, p_expected_version integer)
 RETURNS TABLE(version_match boolean, current_version integer, last_edited_by uuid, last_edited_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_curr_record record;
BEGIN
    -- Use alias 'rt' to avoid ambiguity with output parameters
    SELECT rt.version, rt.last_edited_by, rt.updated_at INTO v_curr_record
    FROM roster_templates rt
    WHERE rt.id = p_template_id;
    
    -- If template not found, return false
    IF v_curr_record IS NULL THEN
         RETURN QUERY SELECT 
            false,
            NULL::integer,
            NULL::uuid,
            NULL::timestamptz;
         RETURN;
    END IF;

    RETURN QUERY SELECT 
        (v_curr_record.version = p_expected_version),
        v_curr_record.version,
        v_curr_record.last_edited_by,
        v_curr_record.updated_at;
END;
$function$;

GRANT EXECUTE ON FUNCTION check_template_version(uuid, integer) TO authenticated;
