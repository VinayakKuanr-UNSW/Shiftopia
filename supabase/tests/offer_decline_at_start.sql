-- Declining an offer, and the dead client-side expiry path
-- (docs/design/shift-trading/03-bidding-fsm.md B-D9, B-D12).
--
-- A declined offer goes to bidding (S5) until the shift starts; after the start
-- the minute timer owns it (S10, code A), so the decline is refused. The client
-- used to send late declines and countdown expiries to sm_expire_offer_now,
-- which put the shift back to draft (S2); that function and the unused
-- two-argument sm_reject_offer overload are gone.
-- It ends by raising, so the fixture rows are always rolled back.
--
-- Expected output (as the error text):
--   decline-ok S5; decline-started SHIFT_STARTED; expire-now gone; reject-2arg gone
-- Before the migration: decline-ok S5; decline-started S5 (a started shift went
-- back to bidding); expire-now exists; reject-2arg exists.

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
  offered uuid; offered_started uuid;
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

  offered         := pg_temp.g_shift(t, d1, '09:00', '12:00', e, false);
  offered_started := pg_temp.g_shift(t, d1, '13:00', '16:00', e, false);

  -- this one has started; the sweep has not run yet
  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET start_at = now() - interval '30 seconds' WHERE id = offered_started;
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  r := public.sm_reject_offer(offered, e, 'busy');
  res := concat(res, 'decline-ok ', coalesce(r->>'code', public.get_shift_state_id(offered)), '; ');
  BEGIN
    r := public.sm_reject_offer(offered_started, e, 'busy');
    res := concat(res, 'decline-started ', coalesce(r->>'code', public.get_shift_state_id(offered_started)), '; ');
  EXCEPTION WHEN OTHERS THEN
    res := concat(res, 'decline-started raised: ', SQLERRM, '; ');
  END;

  res := concat(res, 'expire-now ', CASE WHEN to_regprocedure('public.sm_expire_offer_now(uuid)') IS NULL THEN 'gone' ELSE 'exists' END, '; ');
  res := concat(res, 'reject-2arg ', CASE WHEN to_regprocedure('public.sm_reject_offer(uuid,uuid)') IS NULL THEN 'gone' ELSE 'exists' END);

  RAISE EXCEPTION '%', res;
END $$;
