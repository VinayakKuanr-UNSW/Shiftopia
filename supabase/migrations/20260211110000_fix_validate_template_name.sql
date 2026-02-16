-- Migration: Fix validate_template_name RPC to remove reference to non-existent deleted_at column
-- Date: 2026-02-11
-- Purpose: The previous implementation checked deleted_at column which does not exist on roster_templates.
-- Also updates return type to use is_valid/error_message consistent with frontend types.

-- Drop function first because we are changing return type
DROP FUNCTION IF EXISTS validate_template_name(uuid, uuid, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.validate_template_name(
    p_organization_id uuid, 
    p_department_id uuid, 
    p_sub_department_id uuid, 
    p_name text, 
    p_exclude_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(is_valid boolean, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*)
    INTO v_count
    FROM roster_templates
    WHERE organization_id = p_organization_id
      AND department_id = p_department_id
      AND sub_department_id = p_sub_department_id
      AND lower(name) = lower(p_name)
      AND (p_exclude_id IS NULL OR id != p_exclude_id);
      -- Removed deleted_at check as column does not exist

    IF v_count > 0 THEN
        RETURN QUERY SELECT false, 'A template with this name already exists in this department'::text;
    ELSE
        RETURN QUERY SELECT true, NULL::text;
    END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION validate_template_name(uuid, uuid, uuid, text, uuid) TO authenticated;
