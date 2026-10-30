-- get_employee_shift_window: who may read whose roster.
--
-- SECURITY DEFINER and executable by every signed-in user, with no check at
-- all: any employee could read any colleague's shifts across the whole
-- organisation by guessing ids. Its sibling get_employees_shift_window_bulk has
-- carried a guard since 20260917120455; this applies the same rule, plus the one
-- legitimate employee-to-employee read the bulk function never needed.
--
-- Allowed:
--   * the employee themself;
--   * system callers (sm_request_is_system);
--   * anyone holding shift.view at wider than SELF scope — every level from
--     Team Lead up; the predicate is copied from the bulk function verbatim;
--   * the two parties to a LIVE swap. selectOffer runs as the requesting
--     employee and compliance-checks the counterparty's roster as well as
--     their own, so an alpha must be able to read exactly that one colleague,
--     and only while the swap is open.
--
-- Refused with 42501, matching the bulk function. The body and return shape are
-- otherwise those applied in 20261027092111.

CREATE OR REPLACE FUNCTION public.get_employee_shift_window(p_employee_id uuid, p_start_date date, p_end_date date, p_exclude_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, shift_date date, start_time time without time zone, end_time time without time zone, unpaid_break_minutes integer, user_contract_id uuid, paid_break_minutes integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.sm_request_is_system() AND p_employee_id IS DISTINCT FROM v_uid THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;

    IF NOT (
      EXISTS (
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
      )
      OR EXISTS (
        SELECT 1
        FROM public.planning_requests r
        WHERE r.type = 'SWAP'
          AND r.status IN ('OPEN', 'MANAGER_PENDING')
          AND (
               (r.initiated_by = v_uid AND r.target_employee_id = p_employee_id)
            OR (r.initiated_by = p_employee_id AND r.target_employee_id = v_uid)
            OR EXISTS (
                 SELECT 1 FROM public.planning_offers o
                 WHERE o.request_id = r.id
                   AND o.status IN ('SUBMITTED', 'SELECTED')
                   AND ((r.initiated_by = v_uid AND o.offered_by = p_employee_id)
                     OR (r.initiated_by = p_employee_id AND o.offered_by = v_uid)))
          )
      )
    ) THEN
      RAISE EXCEPTION 'not authorised to read this employee''s roster'
        USING ERRCODE = '42501';
    END IF;
  END IF;

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
