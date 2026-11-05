-- Bidding B1 — bid integrity (docs/design/shift-trading/03-bidding-fsm.md).
--
-- Builds its own S5 shifts from an existing shift's placement, with four
-- employees who hold a matching contract and have no shifts nearby. Covers:
-- placing, duplicate, drop exclusion, overlap block, withdraw + re-bid,
-- unpublish, leave, direct fill by a non-bidder, a winner picked < 4h before
-- start, and bids expiring at start. It ends by raising, so the fixture rows
-- are always rolled back.
--
-- Expected output (as the error text):
--   place pending; dup ALREADY_BID; dropped EXCLUDED; overlap V8_NO_OVERLAP; rebid pending;
--   unpublish cancelled/cancelled; republish pending; leave cancelled; fill S4 rejected;
--   urgent-pick true accepted/rejected; start expired
-- Before the B1 migration: sm_place_bid does not exist.

-- A shift on that day's roster for the chosen team (first non-Office subgroup).
CREATE FUNCTION pg_temp.b1_shift(t record, d date, st time, en time, emp uuid) RETURNS uuid
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
         assigned_employee_id, bidding_status, fulfillment_status, is_cancelled)
  VALUES (v_roster, v_sub, t.organization_id, t.department_id, t.sub_department_id, t.role_id, t.target,
          d, st, en,
          CASE WHEN emp IS NULL THEN 'Published' ELSE 'Draft' END::public.shift_lifecycle,
          CASE WHEN emp IS NULL THEN 'unassigned' ELSE 'assigned' END::public.shift_assignment_status,
          emp,
          CASE WHEN emp IS NULL THEN 'on_bidding' ELSE 'not_on_bidding' END::public.shift_bidding_status,
          CASE WHEN emp IS NULL THEN 'bidding' ELSE 'none' END::public.shift_fulfillment_status, false)
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

DO $$
DECLARE
  t record;
  e uuid[];
  f1 uuid; f2 uuid; f3 uuid;
  -- a Monday ~30 days out, so d1..d1+2 are weekdays (weekend shifts have longer minimums)
  d1 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 30
             + ((8 - extract(isodow FROM (now() AT TIME ZONE 'Australia/Sydney')::date + 30)::int) % 7);
  soon timestamp := date_trunc('hour', now() AT TIME ZONE 'Australia/Sydney') + interval '3 hours';
  r jsonb;
  res text := '';
BEGIN
  -- a non-FT team (sub-dept, role, employment type) with rosters on every fixture date
  -- and >= 4 contract holders who have no shifts near now or near d1
  SELECT uc.organization_id, uc.department_id, uc.sub_department_id, uc.role_id,
         public.fn_normalize_employment_type(uc.employment_status::text) AS target,
         (array_agg(DISTINCT uc.user_id))[1:4] AS emps
    INTO t
    FROM hr.user_contracts uc
   WHERE uc.status = 'Active' AND uc.sub_department_id IS NOT NULL AND uc.role_id IS NOT NULL
     AND public.fn_normalize_employment_type(uc.employment_status::text)
         IS DISTINCT FROM public.fn_normalize_employment_type('Full Time')
     AND NOT EXISTS (SELECT 1 FROM public.shifts o WHERE o.assigned_employee_id = uc.user_id
                      AND (o.shift_date BETWEEN soon::date - 2 AND soon::date + 2
                           OR o.shift_date BETWEEN d1 - 2 AND d1 + 2))
     AND (SELECT count(*) FROM public.rosters r
           WHERE r.department_id = uc.department_id AND r.sub_department_id = uc.sub_department_id
             AND (soon::date BETWEEN r.start_date AND r.end_date OR d1 BETWEEN r.start_date AND r.end_date
                  OR d1 + 1 BETWEEN r.start_date AND r.end_date)) >= 3
   GROUP BY 1, 2, 3, 4, 5
  HAVING count(DISTINCT uc.user_id) >= 4
   LIMIT 1;
  IF t IS NULL THEN RAISE EXCEPTION 'SKIPPED: no rostered team with four free contract holders'; END IF;
  e := t.emps;

  f1 := pg_temp.b1_shift(t, d1, '09:00', '12:00', NULL);
  f2 := pg_temp.b1_shift(t, soon::date, soon::time, (soon + interval '3 hours')::time, NULL);
  f3 := pg_temp.b1_shift(t, d1 + 1, '09:00', '12:00', NULL);
  -- e[4] already works d1 09:30-12:30 (a draft), so a bid on f1 overlaps
  PERFORM pg_temp.b1_shift(t, d1, '09:30', '12:30', e[4]);
  -- e[3] dropped f1 earlier
  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET last_dropped_by = e[3] WHERE id = f1;
  SET LOCAL session_replication_role = origin;

  -- f1: place, duplicate, excluded, overlap
  PERFORM set_config('request.jwt.claims', json_build_object('sub', e[1], 'role', 'authenticated')::text, true);
  r := public.sm_place_bid(f1);
  res := concat(res, 'place ', (SELECT status FROM public.shift_bids WHERE shift_id = f1 AND employee_id = e[1]), '; ');
  r := public.sm_place_bid(f1);
  res := concat(res, 'dup ', r->>'code', '; ');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', e[3], 'role', 'authenticated')::text, true);
  res := concat(res, 'dropped ', public.sm_place_bid(f1)->>'code', '; ');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', e[4], 'role', 'authenticated')::text, true);
  res := concat(res, 'overlap ', public.sm_place_bid(f1)->>'code', '; ');

  -- withdraw and bid again
  PERFORM set_config('request.jwt.claims', json_build_object('sub', e[2], 'role', 'authenticated')::text, true);
  PERFORM public.sm_place_bid(f1);
  PERFORM public.withdraw_bid_rpc((SELECT id FROM public.shift_bids WHERE shift_id = f1 AND employee_id = e[2]), e[2]);
  PERFORM public.sm_place_bid(f1);
  res := concat(res, 'rebid ', (SELECT status FROM public.shift_bids WHERE shift_id = f1 AND employee_id = e[2]), '; ');

  -- unpublish closes both bids; republish opens a new round
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.sm_unpublish_shift(f1);
  res := concat(res, 'unpublish ', (SELECT string_agg(status, '/' ORDER BY employee_id) FROM public.shift_bids WHERE shift_id = f1), '; ');
  UPDATE public.shifts SET lifecycle_status = 'Published', bidding_status = 'on_bidding', fulfillment_status = 'bidding' WHERE id = f1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', e[1], 'role', 'authenticated')::text, true);
  PERFORM public.sm_place_bid(f1);
  res := concat(res, 'republish ', (SELECT status FROM public.shift_bids WHERE shift_id = f1 AND employee_id = e[1]), '; ');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', e[2], 'role', 'authenticated')::text, true);
  PERFORM public.sm_place_bid(f1);

  -- leave approved for e[1] on d1 cancels that bid
  INSERT INTO public.leave_requests (employee_id, leave_type, start_date, end_date, status)
  VALUES (e[1], 'compassionate', d1::timestamptz, d1::timestamptz, 'approved');
  res := concat(res, 'leave ', (SELECT status FROM public.shift_bids WHERE shift_id = f1 AND employee_id = e[1]), '; ');

  -- the manager fills f1 with e[3], who did not bid: e[2]'s bid is rejected
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.sm_emergency_assign(f1, e[3], 'test', NULL);
  res := concat(res, 'fill ', public.get_shift_state_id(f1), ' ',
                (SELECT status FROM public.shift_bids WHERE shift_id = f1 AND employee_id = e[2]), '; ');

  -- f2 starts in ~3h: a winner can still be picked
  PERFORM set_config('request.jwt.claims', json_build_object('sub', e[1], 'role', 'authenticated')::text, true);
  PERFORM public.sm_place_bid(f2);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', e[2], 'role', 'authenticated')::text, true);
  PERFORM public.sm_place_bid(f2);
  PERFORM set_config('request.jwt.claims', '', true);
  r := public.sm_select_bid_winner(f2, e[1], NULL);
  res := concat(res, 'urgent-pick ', coalesce(r->>'success', r::text), ' ',
                (SELECT string_agg(status, '/' ORDER BY (employee_id = e[1]) DESC) FROM public.shift_bids WHERE shift_id = f2), '; ');

  -- f3 reaches its start with a pending bid: the bid expires
  PERFORM set_config('request.jwt.claims', json_build_object('sub', e[4], 'role', 'authenticated')::text, true);
  PERFORM public.sm_place_bid(f3);
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET start_at = now() - interval '1 minute' WHERE id = f3;
  SET LOCAL session_replication_role = origin;
  PERFORM public.process_shift_timers();
  res := concat(res, 'start ', (SELECT status FROM public.shift_bids WHERE shift_id = f3));

  RAISE EXCEPTION '%', res;
END $$;
