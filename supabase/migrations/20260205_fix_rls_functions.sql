-- Update user_has_delta_access to check app_access_certificates
CREATE OR REPLACE FUNCTION public.user_has_delta_access(_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM app_access_certificates 
    WHERE user_id = _user_id 
      AND access_level IN ('delta', 'epsilon')
  );
END;
$function$;

-- Update get_user_access_levels to check app_access_certificates
CREATE OR REPLACE FUNCTION public.get_user_access_levels(_user_id uuid)
 RETURNS TABLE(access_level text)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    SELECT DISTINCT access_level
    FROM app_access_certificates
    WHERE user_id = _user_id;
$function$;

-- Update has_permission to check app_access_certificates
-- This function is used to verify specific scoped access
CREATE OR REPLACE FUNCTION public.has_permission(
  _user_id uuid,
  _target_sub_dept_id uuid,
  _required_level text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  _target_dept_id UUID;
  _target_org_id UUID;
  _level_order CONSTANT TEXT[] := ARRAY['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
  _required_idx INT;
  _user_access_level TEXT;
BEGIN
  -- Get required level index
  _required_idx := array_position(_level_order, lower(_required_level));
  IF _required_idx IS NULL THEN
    RETURN FALSE; -- Invalid level
  END IF;

  -- Get hierarchy for target sub-department
  SELECT sd.department_id, d.organization_id INTO _target_dept_id, _target_org_id
  FROM sub_departments sd
  JOIN departments d ON d.id = sd.department_id
  WHERE sd.id = _target_sub_dept_id;
  
  -- If sub-department not found, maybe handle error, but here return false
  IF _target_dept_id IS NULL THEN
      RETURN FALSE;
  END IF;

  -- Check for matching certificate with sufficient access level and correct scope
  RETURN EXISTS (
    SELECT 1 FROM app_access_certificates c
    WHERE c.user_id = _user_id
      AND array_position(_level_order, lower(c.access_level)) >= _required_idx
      AND (
        -- Epsilon: Global Access implies Organization Access (and all below)
        (c.access_level = 'epsilon' AND c.organization_id = _target_org_id)
        OR
        -- Delta: Department Access
        (c.access_level = 'delta' AND c.organization_id = _target_org_id AND c.department_id = _target_dept_id)
        OR
        -- Gamma/Beta/Alpha: Sub-Dept Access
        (c.sub_department_id = _target_sub_dept_id)
        OR
        -- Fallback: If access is Department wide (but not Delta? rare case if logic allows)
        (c.department_id = _target_dept_id AND c.sub_department_id IS NULL)
        OR
        -- Fallback: If access is Org wide
        (c.organization_id = _target_org_id AND c.department_id IS NULL AND c.sub_department_id IS NULL)
      )
  );
END;
$function$;
