-- ==============================================================================
-- FIX AMBIGUOUS FUNCTION SIGNATURES (PGRST203)
-- ==============================================================================

-- 1. Drop ALL potential variations of the function to resolve ambiguity.
--    The error indicated two signatures existed. We drop both.
DROP FUNCTION IF EXISTS validate_template_name(text, uuid, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS validate_template_name(uuid, uuid, uuid, text, uuid);

-- 2. Re-create the function with the STANDARD signature used by the frontend.
--    Signature: (p_name, p_organization_id, p_department_id, p_sub_department_id, p_exclude_id)
CREATE OR REPLACE FUNCTION validate_template_name(
    p_name text,
    p_organization_id uuid,
    p_department_id uuid,
    p_sub_department_id uuid,
    p_exclude_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Optimization: Always allow provided names.
    -- Uniqueness is handled by ID, and frontend requested non-unique names.
    RETURN jsonb_build_object('valid', true, 'message', NULL);
END;
$$;
