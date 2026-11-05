-- Test: Cancellation reason codes C, D, E
-- Code C: Draft+Unassigned never published
-- Code D: Draft+Assigned never published
-- Code E: Published shift manually cancelled, requires explicit p_reason

DO $$
DECLARE
  t record;
  e uuid[];
  s_draft_c uuid;
  s_draft_d uuid;
  s_pub_e   uuid;
  res_c text;
  res_d text;
  res_e text;
  reason_c text;
  reason_d text;
  reason_e text;
  fail_res jsonb;
  v_roster uuid;
  v_sub uuid;
  -- a Monday ~35 days out, so d1..d1+2 are weekdays (weekend shifts have longer minimums)
  d1 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 35
             + ((8 - extract(isodow FROM (now() AT TIME ZONE 'Australia/Sydney')::date + 35)::int) % 7);
BEGIN
  -- Find an active contract team with at least 2 employees
  SELECT uc.organization_id, uc.department_id, uc.sub_department_id, uc.role_id,
         public.fn_normalize_employment_type(uc.employment_status::text) AS target,
         (array_agg(DISTINCT uc.user_id))[1:2] AS emps
    INTO t
    FROM hr.user_contracts uc
   WHERE uc.status = 'Active' AND uc.sub_department_id IS NOT NULL AND uc.role_id IS NOT NULL
     AND public.fn_normalize_employment_type(uc.employment_status::text)
         IS DISTINCT FROM public.fn_normalize_employment_type('Full Time')
     AND NOT EXISTS (SELECT 1 FROM public.shifts o WHERE o.assigned_employee_id = uc.user_id
                      AND o.shift_date BETWEEN d1 - 2 AND d1 + 2)
     AND (SELECT count(*) FROM public.rosters r
           WHERE r.department_id = uc.department_id AND r.sub_department_id = uc.sub_department_id
             AND d1 BETWEEN r.start_date AND r.end_date) >= 1
   GROUP BY 1, 2, 3, 4, 5
  HAVING count(DISTINCT uc.user_id) >= 2
   LIMIT 1;

  IF t IS NULL THEN RAISE EXCEPTION 'SKIPPED: no test team found'; END IF;
  e := t.emps;

  SELECT r.id INTO v_roster FROM public.rosters r
   WHERE r.department_id = t.department_id AND r.sub_department_id = t.sub_department_id
     AND d1 BETWEEN r.start_date AND r.end_date LIMIT 1;
  SELECT rs.id INTO v_sub FROM public.roster_subgroups rs JOIN public.roster_groups rg ON rg.id = rs.roster_group_id
   WHERE rg.roster_id = v_roster AND rg.external_id NOT ILIKE '%office%' ORDER BY rs.id LIMIT 1;

  -- 1. Create Draft Unassigned (for Code C)
  INSERT INTO public.shifts (roster_id, roster_subgroup_id, organization_id, department_id, sub_department_id, role_id,
         target_employment_type, shift_date, start_time, end_time, lifecycle_status, assignment_status,
         assigned_employee_id, bidding_status, fulfillment_status, is_cancelled)
  VALUES (v_roster, v_sub, t.organization_id, t.department_id, t.sub_department_id, t.role_id, t.target,
          d1, '09:00', '12:00', 'Draft', 'unassigned', NULL, 'not_on_bidding', 'none', false)
  RETURNING id INTO s_draft_c;

  -- 2. Create Draft Assigned (for Code D)
  INSERT INTO public.shifts (roster_id, roster_subgroup_id, organization_id, department_id, sub_department_id, role_id,
         target_employment_type, shift_date, start_time, end_time, lifecycle_status, assignment_status,
         assigned_employee_id, bidding_status, fulfillment_status, is_cancelled)
  VALUES (v_roster, v_sub, t.organization_id, t.department_id, t.sub_department_id, t.role_id, t.target,
          d1, '13:00', '16:00', 'Draft', 'assigned', e[1], 'not_on_bidding', 'none', false)
  RETURNING id INTO s_draft_d;

  -- 3. Create Published Confirmed (for Code E)
  INSERT INTO public.shifts (roster_id, roster_subgroup_id, organization_id, department_id, sub_department_id, role_id,
         target_employment_type, shift_date, start_time, end_time, lifecycle_status, assignment_status,
         assignment_outcome, assigned_employee_id, bidding_status, fulfillment_status, is_cancelled)
  VALUES (v_roster, v_sub, t.organization_id, t.department_id, t.sub_department_id, t.role_id, t.target,
          d1, '17:00', '20:00', 'Published', 'assigned', 'confirmed', e[2], 'not_on_bidding', 'none', false)
  RETURNING id INTO s_pub_e;

  -- Set start_at in past to simulate kickoff arrival for drafts C and D
  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET start_at = now() - interval '1 minute' WHERE id IN (s_draft_c, s_draft_d);
  SET LOCAL session_replication_role = origin;

  -- Run timer sweep
  PERFORM public.process_shift_timers();

  SELECT kickoff_cancel_code, last_modified_reason INTO res_c, reason_c FROM public.shifts WHERE id = s_draft_c;
  SELECT kickoff_cancel_code, last_modified_reason INTO res_d, reason_d FROM public.shifts WHERE id = s_draft_d;

  -- Test Code E requires explicit p_reason
  -- Acting as manager with shift.delete permission: system bypass via sm_request_is_system() simulation or auth
  PERFORM set_config('app.request_is_system', '1', true);
  
  fail_res := public.sm_cancel_shift(s_pub_e, '   ');
  IF (fail_res->>'code') IS DISTINCT FROM 'REASON_REQUIRED' THEN
    RAISE EXCEPTION 'Expected REASON_REQUIRED for empty reason, got: %', fail_res;
  END IF;

  -- Cancel with explicit reason
  PERFORM public.sm_cancel_shift(s_pub_e, 'Client cancelled booking');
  SELECT kickoff_cancel_code, last_modified_reason INTO res_e, reason_e FROM public.shifts WHERE id = s_pub_e;

  PERFORM set_config('app.request_is_system', '0', true);

  -- Assertions
  IF res_c IS DISTINCT FROM 'C' OR reason_c IS DISTINCT FROM 'Draft+Unassigned never published' THEN
    RAISE EXCEPTION 'Assertion failed for Code C: code=%, reason=%', res_c, reason_c;
  END IF;

  IF res_d IS DISTINCT FROM 'D' OR reason_d IS DISTINCT FROM 'Draft+Assigned never published' THEN
    RAISE EXCEPTION 'Assertion failed for Code D: code=%, reason=%', res_d, reason_d;
  END IF;

  IF res_e IS DISTINCT FROM 'E' OR reason_e IS DISTINCT FROM 'Client cancelled booking' THEN
    RAISE EXCEPTION 'Assertion failed for Code E: code=%, reason=%', res_e, reason_e;
  END IF;

  RAISE NOTICE 'SUCCESS: C=%, D=%, E=%', res_c, res_d, res_e;
  -- Rollback test fixtures
  RAISE EXCEPTION 'ROLLBACK_OK';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'ROLLBACK_OK' THEN
    RAISE NOTICE 'Test passed and cleanly rolled back';
  ELSE
    RAISE;
  END IF;
END $$;

