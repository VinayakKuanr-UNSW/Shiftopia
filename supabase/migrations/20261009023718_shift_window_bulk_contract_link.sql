-- get_employees_shift_window_bulk also returns each shift's contract link —
-- the bulk twin of 20261009023631, for the AutoScheduler's history fetch.
--
-- Body from pg_get_functiondef() (md5 0f88756f9866195fdb3a05c0e2d79315); the
-- caller guard is unchanged and the only change is the extra column. DROP +
-- CREATE for the new return type; the original grants are restated.

DROP FUNCTION public.get_employees_shift_window_bulk(uuid[], date, date);

CREATE FUNCTION public.get_employees_shift_window_bulk(p_employee_ids uuid[], p_start_date date, p_end_date date)
 RETURNS TABLE(id uuid, assigned_employee_id uuid, shift_date date, start_time time without time zone, end_time time without time zone, unpaid_break_minutes integer, user_contract_id uuid)
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
  SELECT s.id, s.assigned_employee_id, s.shift_date, s.start_time, s.end_time, s.unpaid_break_minutes, s.user_contract_id
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
