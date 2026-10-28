-- get_employee_shift_window: who may read whose roster during a swap.
--
-- Covers 20261028060930. Picks three employees whose only shift.view grant is
-- SELF scope (so no manager rule can let them through), opens a swap between
-- the first two with a live offer, and probes every direction. Ends by raising,
-- so the fixture rows are always rolled back.
--
-- Expected output (as the error text):
--   req->off ok; off->req ok; out->off REFUSED; req->out REFUSED; req->req ok;
--   after-close req->off REFUSED
-- Last green: 2026-10-28 against Supabase dev (before the fix, both
-- req->off and off->req were REFUSED).

DO $$
DECLARE
  emp uuid[];
  sft uuid[];
  sw  uuid := gen_random_uuid();
  res text := '';
  who text[] := array['req', 'off', 'out'];
  probes int[][] := array[array[1,2], array[2,1], array[3,2], array[1,3], array[1,1]];
  i int;
BEGIN
  SELECT array_agg(emp_id ORDER BY emp_id), array_agg(shift_id ORDER BY emp_id) INTO emp, sft
  FROM (
    SELECT s.assigned_employee_id AS emp_id, min(s.id::text)::uuid AS shift_id
    FROM public.shifts s
    WHERE s.deleted_at IS NULL AND s.assigned_employee_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.app_access_certificates ac
                      JOIN public.rbac_permissions rp ON rp.access_level = ac.access_level
                      WHERE ac.user_id = s.assigned_employee_id AND ac.is_active
                        AND rp.action_code = 'shift.view' AND rp.scope::text <> 'SELF')
      AND NOT EXISTS (SELECT 1 FROM public.user_contracts uc
                      JOIN public.rbac_permissions rp ON rp.access_level = uc.access_level
                      WHERE uc.user_id = s.assigned_employee_id AND uc.status = 'Active'
                        AND rp.action_code = 'shift.view' AND rp.scope::text <> 'SELF')
    GROUP BY s.assigned_employee_id
    LIMIT 3
  ) x;
  IF coalesce(array_length(emp, 1), 0) < 3 THEN
    RAISE EXCEPTION 'SKIPPED: need three SELF-scope employees with shifts';
  END IF;

  INSERT INTO public.shift_swaps (id, requester_id, requester_shift_id, status)
  VALUES (sw, emp[1], sft[1], 'OPEN');
  INSERT INTO public.swap_offers (swap_request_id, offerer_id, offered_shift_id, status)
  VALUES (sw, emp[2], sft[2], 'SUBMITTED');

  FOR i IN 1..array_length(probes, 1) LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', emp[probes[i][1]], 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM 1 FROM public.get_employee_shift_window(emp[probes[i][2]], '2000-01-01', '2100-01-01');
      res := res || format('%s->%s ok; ', who[probes[i][1]], who[probes[i][2]]);
    EXCEPTION WHEN insufficient_privilege THEN
      res := res || format('%s->%s REFUSED; ', who[probes[i][1]], who[probes[i][2]]);
    END;
  END LOOP;

  -- the counterparty read closes with the swap
  UPDATE public.shift_swaps SET status = 'CANCELLED' WHERE id = sw;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', emp[1], 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM 1 FROM public.get_employee_shift_window(emp[2], '2000-01-01', '2100-01-01');
    res := res || 'after-close req->off ok';
  EXCEPTION WHEN insufficient_privilege THEN
    res := res || 'after-close req->off REFUSED';
  END;

  IF res <> 'req->off ok; off->req ok; out->off REFUSED; req->out REFUSED; req->req ok; after-close req->off REFUSED' THEN
    RAISE EXCEPTION 'FAILED (rolled back): %', res;
  END IF;
  RAISE EXCEPTION 'PASSED (rolled back): %', res;
END $$;
