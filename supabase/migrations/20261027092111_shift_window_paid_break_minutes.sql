-- Return paid_break_minutes from the two shift-window RPCs.
--
-- cl 39.2 measures the split-shift spread "excluding meal AND rest breaks".
-- The DB EBA trigger reads shifts.paid_break_minutes directly, but the
-- AutoScheduler solver (HC-9 / HC-13 against pinned shifts) and the V8
-- re-validation load existing shifts through these RPCs, which returned only
-- the unpaid break. Both therefore measured a wider spread than the database
-- and rejected lawful part-time split-shift days.
--
-- RETURNS TABLE cannot change in place, so each function is dropped and
-- recreated. Bodies are copied from pg_get_functiondef on 2026-10-27 with only
-- the new output column added; grants are restored to the exact prior ACL
-- (authenticated + service_role, nothing to PUBLIC or anon).

DROP FUNCTION public.get_employee_shift_window(uuid, date, date, uuid);

CREATE FUNCTION public.get_employee_shift_window(p_employee_id uuid, p_start_date date, p_end_date date, p_exclude_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, shift_date date, start_time time without time zone, end_time time without time zone, unpaid_break_minutes integer, user_contract_id uuid, paid_break_minutes integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.shift_date,
    s.start_time,
    s.end_time,
    s.unpaid_break_minutes,
    s.user_contract_id,
    s.paid_break_minutes
  FROM public.shifts s
  WHERE s.assigned_employee_id = p_employee_id
    AND s.shift_date >= p_start_date
    AND s.shift_date <= p_end_date
    AND s.lifecycle_status != 'Cancelled' -- Correct column name
    AND s.deleted_at IS NULL
    AND (p_exclude_id IS NULL OR s.id != p_exclude_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_employee_shift_window(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employee_shift_window(uuid, date, date, uuid) TO authenticated, service_role;

DROP FUNCTION public.get_employees_shift_window_bulk(uuid[], date, date);

CREATE FUNCTION public.get_employees_shift_window_bulk(p_employee_ids uuid[], p_start_date date, p_end_date date)
 RETURNS TABLE(id uuid, assigned_employee_id uuid, shift_date date, start_time time without time zone, end_time time without time zone, unpaid_break_minutes integer, user_contract_id uuid, paid_break_minutes integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_self_only boolean;
  v_wide      boolean;
BEGIN
  -- `auth.uid()`, never `current_user`: inside a SECURITY DEFINER body
  -- `current_user` is always the function OWNER and identifies nobody.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  v_self_only := NOT EXISTS (
    SELECT 1 FROM unnest(coalesce(p_employee_ids, '{}'::uuid[])) e(uid)
    WHERE e.uid IS DISTINCT FROM v_uid
  );

  IF NOT v_self_only THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.app_access_certificates ac
      JOIN public.rbac_permissions rp ON rp.access_level = ac.access_level
      WHERE ac.user_id = v_uid AND ac.is_active
        AND rp.action_code = 'shift.view' AND rp.scope::text <> 'SELF'
      UNION ALL
      SELECT 1
      FROM public.user_contracts uc
      JOIN public.rbac_permissions rp ON rp.access_level = uc.access_level
      WHERE uc.user_id = v_uid AND uc.status = 'Active'
        AND rp.action_code = 'shift.view' AND rp.scope::text <> 'SELF'
    ) INTO v_wide;

    IF NOT v_wide THEN
      RAISE EXCEPTION 'not authorised to read other employees'' rosters'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT s.id, s.assigned_employee_id, s.shift_date, s.start_time, s.end_time, s.unpaid_break_minutes, s.user_contract_id, s.paid_break_minutes
  FROM public.shifts s
  WHERE s.assigned_employee_id = ANY(p_employee_ids)
    AND s.shift_date >= p_start_date
    AND s.shift_date <= p_end_date
    AND s.lifecycle_status != 'Cancelled'
    AND s.deleted_at IS NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_employees_shift_window_bulk(uuid[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employees_shift_window_bulk(uuid[], date, date) TO authenticated, service_role;
