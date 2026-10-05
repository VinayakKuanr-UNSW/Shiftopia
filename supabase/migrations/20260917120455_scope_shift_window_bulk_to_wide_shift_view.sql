-- Finishes 20260917114158, which closed the ANONYMOUS hole but left any
-- authenticated user able to read any employee's roster.
--
-- WHY NOT PER-ROW FILTERING. The obvious fix — filter rows through
-- `user_has_action_in_scope('shift.view', s.organization_id, ...)` — is wrong
-- here, and dangerously so. The caller is the auto-scheduler
-- (`scheduling/data/roster-fetcher.ts`), which needs an employee's COMPLETE
-- 28-day shift window to compute V8 rolling rest/fatigue context. Employees hold
-- contracts in more than one department in this system, so per-row scoping would
-- silently drop the shifts a manager cannot see — and the solver would then
-- propose rosters that breach rest gaps, with no error anywhere. Quietly
-- weakening a compliance input is worse than the disclosure being fixed.
--
-- So authorise the CALLER, not the rows. `shift.view` alone is not the
-- discriminator: `rbac_permissions` grants it to `alpha` at scope SELF, i.e. to
-- every ordinary employee. The scope is what separates a scheduler from a
-- worker:
--     alpha SELF | beta SUB_DEPT | gamma DEPT | delta DEPT | epsilon ORG | zeta ORG
--
-- Rule: you may ask about yourself, or, if you hold `shift.view` at any scope
-- WIDER than SELF, about anyone. Verified in a rolled-back transaction against
-- production, then re-verified live after apply:
--     manager (epsilon cert) reads others -> ALLOWED, 39 rows, unfiltered
--     alpha reads others                  -> refused 42501
--     alpha reads self                    -> ALLOWED
--     anonymous                           -> refused 42501
CREATE OR REPLACE FUNCTION public.get_employees_shift_window_bulk(
  p_employee_ids uuid[],
  p_start_date   date,
  p_end_date     date
)
RETURNS TABLE(
  id                   uuid,
  assigned_employee_id uuid,
  shift_date           date,
  start_time           time without time zone,
  end_time             time without time zone,
  unpaid_break_minutes integer
)
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
  SELECT s.id, s.assigned_employee_id, s.shift_date, s.start_time, s.end_time, s.unpaid_break_minutes
  FROM public.shifts s
  WHERE s.assigned_employee_id = ANY(p_employee_ids)
    AND s.shift_date >= p_start_date
    AND s.shift_date <= p_end_date
    AND s.lifecycle_status != 'Cancelled'
    AND s.deleted_at IS NULL;
END;
$function$;

-- CREATE OR REPLACE re-applies Supabase's default grants, so revoke again, last.
REVOKE EXECUTE ON FUNCTION "public"."get_employees_shift_window_bulk"("uuid"[], "date", "date") FROM "anon";
REVOKE EXECUTE ON FUNCTION "public"."get_employees_shift_window_bulk"("uuid"[], "date", "date") FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION "public"."get_employees_shift_window_bulk"("uuid"[], "date", "date") TO "authenticated";
GRANT  EXECUTE ON FUNCTION "public"."get_employees_shift_window_bulk"("uuid"[], "date", "date") TO "service_role";
