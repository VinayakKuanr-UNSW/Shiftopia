-- Bidding B2 — expiry and cancellation reasons (docs/design/shift-trading/03-bidding-fsm.md §7).
--
-- Fixture shifts on a rostered team, then one timer sweep:
--   ignored  S3 whose 48h deadline passed, start 30 days out -> S5, ignorer may not bid
--   offerA   S3 still pending at start                       -> S10 A (assignee kept)
--   bidB     S5 at start                                      -> S10 B
--   draftC   S1 at start                                      -> S10 C
--   draftD   S2 at start                                      -> S10 D
--   old      S2 that started before B2 went live              -> untouched (user decision)
-- A, D: no CANCELLED / LATE_CANCELLED event against the employee.
-- Finally an employee cannot write shift_bids directly.
-- It ends by raising, so the fixture rows are always rolled back.
--
-- Expected output (as the error text):
--   ignored S5 EXCLUDED; offerA S10/A kept; bidB S10/B; draftC S10/C; draftD S10/D;
--   old S2; employee-cancel-events 0; client-insert denied
-- Before the B2 migration: ignored S2, offerA S2, kickoff_cancel_code missing.

CREATE FUNCTION pg_temp.b2_shift(t record, d date, st time, en time, emp uuid, published boolean) RETURNS uuid
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
          CASE WHEN published THEN 'Published' ELSE 'Draft' END::public.shift_lifecycle,
          CASE WHEN emp IS NULL THEN 'unassigned' ELSE 'assigned' END::public.shift_assignment_status,
          emp,
          CASE WHEN published AND emp IS NULL THEN 'on_bidding' ELSE 'not_on_bidding' END::public.shift_bidding_status,
          CASE WHEN published AND emp IS NULL THEN 'bidding' WHEN published THEN 'offered' ELSE 'none' END::public.shift_fulfillment_status,
          false)
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

DO $$
DECLARE
  t record;
  e uuid[];
  ignored uuid; offer_a uuid; bid_b uuid; draft_c uuid; draft_d uuid; old_d uuid;
  d1 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 30;
  d2 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 31;
  res text := '';
  denied text := 'allowed';
BEGIN
  -- a non-FT team with rosters on d1 and d2 and two contract holders free on those days
  SELECT uc.organization_id, uc.department_id, uc.sub_department_id, uc.role_id,
         public.fn_normalize_employment_type(uc.employment_status::text) AS target,
         (array_agg(DISTINCT uc.user_id))[1:2] AS emps
    INTO t
    FROM hr.user_contracts uc
   WHERE uc.status = 'Active' AND uc.sub_department_id IS NOT NULL AND uc.role_id IS NOT NULL
     AND public.fn_normalize_employment_type(uc.employment_status::text)
         IS DISTINCT FROM public.fn_normalize_employment_type('Full Time')
     AND NOT EXISTS (SELECT 1 FROM public.shifts o WHERE o.assigned_employee_id = uc.user_id
                      AND o.shift_date BETWEEN d1 - 2 AND d2 + 2)
     AND (SELECT count(*) FROM public.rosters r
           WHERE r.department_id = uc.department_id AND r.sub_department_id = uc.sub_department_id
             AND (d1 BETWEEN r.start_date AND r.end_date OR d2 BETWEEN r.start_date AND r.end_date)) >= 2
   GROUP BY 1, 2, 3, 4, 5
  HAVING count(DISTINCT uc.user_id) >= 2
   LIMIT 1;
  IF t IS NULL THEN RAISE EXCEPTION 'SKIPPED: no rostered team with two free contract holders'; END IF;
  e := t.emps;

  ignored := pg_temp.b2_shift(t, d1, '09:00', '12:00', e[1], true);
  offer_a := pg_temp.b2_shift(t, d1, '13:00', '16:00', e[2], true);
  bid_b   := pg_temp.b2_shift(t, d1, '17:00', '20:00', NULL, true);
  draft_c := pg_temp.b2_shift(t, d2, '09:00', '12:00', NULL, false);
  draft_d := pg_temp.b2_shift(t, d2, '13:00', '16:00', e[1], false);
  old_d   := pg_temp.b2_shift(t, d2, '17:00', '20:00', e[2], false);

  -- move the clocks: the ignored offer's deadline has passed; the rest have started
  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET offer_expires_at = now() - interval '1 minute' WHERE id = ignored;
  UPDATE public.shifts SET offer_expires_at = now() - interval '1 minute', start_at = now() - interval '1 minute'
   WHERE id = offer_a;
  UPDATE public.shifts SET start_at = now() - interval '1 minute' WHERE id IN (bid_b, draft_c, draft_d);
  UPDATE public.shifts SET start_at = timestamptz '2026-11-01 00:00:00+00' WHERE id = old_d;
  SET LOCAL session_replication_role = origin;

  PERFORM public.process_shift_timers();

  PERFORM set_config('request.jwt.claims', json_build_object('sub', e[1], 'role', 'authenticated')::text, true);
  res := concat(res, 'ignored ', public.get_shift_state_id(ignored), ' ', public.sm_place_bid(ignored)->>'code', '; ');
  PERFORM set_config('request.jwt.claims', '', true);
  res := concat(res, 'offerA ', public.get_shift_state_id(offer_a), '/',
                (SELECT kickoff_cancel_code || CASE WHEN assigned_employee_id = e[2] THEN ' kept' ELSE ' lost' END
                   FROM public.shifts WHERE id = offer_a), '; ');
  res := concat(res, 'bidB ', public.get_shift_state_id(bid_b), '/', (SELECT kickoff_cancel_code FROM public.shifts WHERE id = bid_b), '; ');
  res := concat(res, 'draftC ', public.get_shift_state_id(draft_c), '/', (SELECT kickoff_cancel_code FROM public.shifts WHERE id = draft_c), '; ');
  res := concat(res, 'draftD ', public.get_shift_state_id(draft_d), '/', (SELECT kickoff_cancel_code FROM public.shifts WHERE id = draft_d), '; ');
  res := concat(res, 'old ', public.get_shift_state_id(old_d), '; ');
  res := concat(res, 'employee-cancel-events ',
                (SELECT count(*) FROM public.shift_events WHERE shift_id IN (offer_a, draft_d)
                   AND event_type IN ('CANCELLED', 'LATE_CANCELLED')), '; ');

  -- clients no longer write shift_bids
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.shift_bids (shift_id, employee_id, status) VALUES (bid_b, e[1], 'pending');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := 'denied';
  END;
  RESET ROLE;
  res := concat(res, 'client-insert ', denied);

  RAISE EXCEPTION '%', res;
END $$;
