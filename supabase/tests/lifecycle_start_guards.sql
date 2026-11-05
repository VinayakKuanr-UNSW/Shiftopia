-- Lifecycle start guards (docs/design/shift-trading/03-bidding-fsm.md B-D12).
--
-- The timer sweeps once a minute, so a shift can sit in a published state for up
-- to a minute after it starts. Nothing may unpublish or drop it in that gap:
-- an unpublished S5 would be swept as a draft (code C instead of B), and a drop
-- would send a started shift back to bidding. Drop is S4-only: an unanswered
-- offer (S3) is rejected, which costs the employee nothing, not dropped.
-- It ends by raising, so the fixture rows are always rolled back.
--
-- Expected output (as the error text):
--   unpublish-started SHIFT_STARTED; gateway-unpublish-started SHIFT_STARTED;
--   drop-started SHIFT_STARTED; drop-offer ILLEGAL_STATE; drop-ok S5
-- Before the migration: unpublish succeeds (S1), the gateway applies, the
-- started drop succeeds, and the S3 drop succeeds.

CREATE FUNCTION pg_temp.g_shift(t record, d date, st time, en time, emp uuid, confirmed boolean) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE v_roster uuid; v_sub uuid; v_id uuid;
BEGIN
  SELECT r.id INTO v_roster FROM public.rosters r
   WHERE r.department_id = t.department_id AND r.sub_department_id = t.sub_department_id
     AND d BETWEEN r.start_date AND r.end_date LIMIT 1;
  SELECT rs.id INTO v_sub FROM public.roster_subgroups rs JOIN public.roster_groups rg ON rg.id = rs.roster_group_id
   WHERE rg.roster_id = v_roster AND rg.external_id NOT ILIKE '%office%' ORDER BY rs.id LIMIT 1;
  INSERT INTO public.shifts (roster_id, roster_subgroup_id, organization_id, department_id, sub_department_id, role_id,
         target_employment_type, shift_date, start_time, end_time, lifecycle_status, assignment_status,
         assigned_employee_id, assignment_outcome, bidding_status, fulfillment_status, is_cancelled)
  VALUES (v_roster, v_sub, t.organization_id, t.department_id, t.sub_department_id, t.role_id, t.target,
          d, st, en, 'Published',
          CASE WHEN emp IS NULL THEN 'unassigned' ELSE 'assigned' END::public.shift_assignment_status,
          emp,
          CASE WHEN confirmed THEN 'confirmed' END::public.shift_assignment_outcome,
          CASE WHEN emp IS NULL THEN 'on_bidding' ELSE 'not_on_bidding' END::public.shift_bidding_status,
          CASE WHEN emp IS NULL THEN 'bidding' WHEN confirmed THEN 'scheduled' ELSE 'offered' END::public.shift_fulfillment_status,
          false)
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

DO $$
DECLARE
  t record;
  e uuid;
  bid_started uuid; bid_started2 uuid; conf_started uuid; offered uuid; conf_ok uuid;
  -- a Monday ~30 days out, so d1..d1+2 are weekdays (weekend shifts have longer minimums)
  d1 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 30
             + ((8 - extract(isodow FROM (now() AT TIME ZONE 'Australia/Sydney')::date + 30)::int) % 7);
  r jsonb;
  res text := '';
BEGIN
  SELECT uc.organization_id, uc.department_id, uc.sub_department_id, uc.role_id,
         public.fn_normalize_employment_type(uc.employment_status::text) AS target,
         (array_agg(DISTINCT uc.user_id))[1] AS emp
    INTO t
    FROM hr.user_contracts uc
   WHERE uc.status = 'Active' AND uc.sub_department_id IS NOT NULL AND uc.role_id IS NOT NULL
     AND public.fn_normalize_employment_type(uc.employment_status::text)
         IS DISTINCT FROM public.fn_normalize_employment_type('Full Time')
     AND NOT EXISTS (SELECT 1 FROM public.shifts o WHERE o.assigned_employee_id = uc.user_id
                      AND o.shift_date BETWEEN d1 - 2 AND d1 + 2)
     AND EXISTS (SELECT 1 FROM public.rosters r
                  WHERE r.department_id = uc.department_id AND r.sub_department_id = uc.sub_department_id
                    AND d1 BETWEEN r.start_date AND r.end_date)
   GROUP BY 1, 2, 3, 4, 5
   LIMIT 1;
  IF t IS NULL THEN RAISE EXCEPTION 'SKIPPED: no rostered team with a free contract holder'; END IF;
  e := t.emp;

  bid_started  := pg_temp.g_shift(t, d1, '06:00', '09:00', NULL, false);
  bid_started2 := pg_temp.g_shift(t, d1, '06:00', '09:00', NULL, false);
  conf_started := pg_temp.g_shift(t, d1, '09:00', '12:00', e, true);
  offered      := pg_temp.g_shift(t, d1, '13:00', '16:00', e, false);
  conf_ok      := pg_temp.g_shift(t, d1, '17:00', '20:00', e, true);

  -- these have started; the sweep has not run yet
  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET start_at = now() - interval '30 seconds' WHERE id IN (bid_started, bid_started2, conf_started);
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', '', true);
  r := public.sm_unpublish_shift(bid_started);
  res := concat(res, 'unpublish-started ', coalesce(r->>'code', public.get_shift_state_id(bid_started)), '; ');
  r := public.sm_apply_shift_op(bid_started2, (SELECT version FROM public.shifts WHERE id = bid_started2), 'unpublish', '{}'::jsonb);
  res := concat(res, 'gateway-unpublish-started ', coalesce(r->>'note', public.get_shift_state_id(bid_started2)), '; ');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  r := public.sm_employee_drop_shift(conf_started, e);
  res := concat(res, 'drop-started ', coalesce(r->>'code', public.get_shift_state_id(conf_started)), '; ');
  r := public.sm_employee_drop_shift(offered, e);
  res := concat(res, 'drop-offer ', coalesce(r->>'code', public.get_shift_state_id(offered)), '; ');
  r := public.sm_employee_drop_shift(conf_ok, e);
  res := concat(res, 'drop-ok ', public.get_shift_state_id(conf_ok));

  RAISE EXCEPTION '%', res;
END $$;
