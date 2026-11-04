-- Trading T5 — hardening + the scenario-matrix rows no earlier test exercised
-- (docs/design/shift-trading/02-scenario-matrix.csv). Four future assigned shifts
-- become S4 for A, B, C and D. Ends by raising, so the fixture always rolls back.
--
-- Expected output (as the error text):
--   ST-091 insert REFUSED update REFUSED delete REFUSED; ST-018 TRADE_IN_PROGRESS; ST-014 COMPLIANCE_REQUIRED;
--   ST-035 FORBIDDEN; ST-034 OFFER_NOT_FOUND; ST-033 FORBIDDEN; ST-019 TRADE_IN_PROGRESS; ST-030 SWAP_NOT_OPEN;
--   ST-031 OFFER_NOT_SUBMITTED; ST-059 MANAGER_PENDING; ST-100 TIME_LOCKED; ST-102 SWAP_NOT_OPEN;
--   ST-032 OFFER_NOT_WITHDRAWABLE; ST-090 NoTrade/NoTrade
-- (ST-033/035 need C and D without swap.approve; the fixture picks such employees.)
-- Before 20261104081812: the direct writes went through, ST-019 answered
-- INVALID_STATE, and ST-100's approval swapped a shift that had already started.

DO $$
DECLARE
  sft uuid[]; emp uuid[];
  a uuid; b uuid; c uuid; d uuid; a1 uuid; b1 uuid; c1 uuid; d1 uuid;
  sw uuid; ob uuid; oc uuid; r json;
  res text := '';
  ca text; cb text; cc text; cd text;
BEGIN
  SELECT array_agg(id ORDER BY start_at), array_agg(assigned_employee_id ORDER BY start_at) INTO sft, emp
    FROM (SELECT DISTINCT ON (s.assigned_employee_id) s.id, s.assigned_employee_id, s.start_at
            FROM public.shifts s
           WHERE s.assigned_employee_id IS NOT NULL AND NOT s.is_cancelled AND s.start_at > now() + interval '1 day'
             AND NOT EXISTS (SELECT 1 FROM public.app_access_certificates ac
                              JOIN public.rbac_permissions rp ON rp.access_level = ac.access_level
                             WHERE ac.user_id = s.assigned_employee_id AND ac.is_active
                               AND rp.action_code = 'swap.approve')
           ORDER BY s.assigned_employee_id, s.start_at) x;
  IF coalesce(array_length(sft, 1), 0) < 4 THEN
    RAISE EXCEPTION 'SKIPPED: need four employees without swap.approve, each with a future shift';
  END IF;
  a := emp[1]; b := emp[2]; c := emp[3]; d := emp[4]; a1 := sft[1]; b1 := sft[2]; c1 := sft[3]; d1 := sft[4];
  ca := json_build_object('sub', a, 'role', 'authenticated')::text;
  cb := json_build_object('sub', b, 'role', 'authenticated')::text;
  cc := json_build_object('sub', c, 'role', 'authenticated')::text;
  cd := json_build_object('sub', d, 'role', 'authenticated')::text;

  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET lifecycle_status = 'Published', assignment_status = 'assigned',
         assignment_outcome = 'confirmed', trading_status = 'NoTrade' WHERE id = ANY (sft[1:4]);
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', ca, true);
  sw := (public.sm_create_swap_request(a1)->>'swap_id')::uuid;

  -- ST-091 / ST-033: the client cannot write trade requests directly
  PERFORM set_config('request.jwt.claims', ca, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN INSERT INTO public.shift_swaps (requester_id, requester_shift_id, status) VALUES (a, a1, 'MANAGER_PENDING');
        res := res || 'ST-091 insert ok '; EXCEPTION WHEN insufficient_privilege THEN res := res || 'ST-091 insert REFUSED '; END;
  BEGIN UPDATE public.shift_swaps SET status = 'CANCELLED' WHERE id = sw;
        res := res || 'update ok '; EXCEPTION WHEN insufficient_privilege THEN res := res || 'update REFUSED '; END;
  BEGIN DELETE FROM public.shift_swaps WHERE id = sw;
        res := res || 'delete ok; '; EXCEPTION WHEN insufficient_privilege THEN res := res || 'delete REFUSED; '; END;
  EXECUTE 'RESET ROLE';

  -- ST-018: a shift already posted (S6) cannot be posted again
  res := res || 'ST-018 ' || coalesce(public.sm_create_swap_request(a1)->>'code', 'ok') || '; ';

  PERFORM set_config('request.jwt.claims', cb, true);
  ob := (public.sm_submit_swap_offer(sw, b1)->>'offer_id')::uuid;
  PERFORM set_config('request.jwt.claims', cc, true);
  oc := (public.sm_submit_swap_offer(sw, c1)->>'offer_id')::uuid;

  -- ST-014: acceptance needs a feasible compliance snapshot
  PERFORM set_config('request.jwt.claims', ca, true);
  res := res || 'ST-014 ' || coalesce(public.sm_accept_trade(sw, ob, b, NULL, '{"feasible": false}'::jsonb)->>'code', 'ok') || '; ';

  -- ST-035 / ST-034 / ST-033: only A declines, only B withdraws B's, only A retracts
  PERFORM set_config('request.jwt.claims', cd, true);
  res := res || 'ST-035 ' || coalesce(public.sm_decline_swap_offer(ob)->>'code', 'ok') || '; ';
  res := res || 'ST-034 ' || coalesce(public.sm_withdraw_swap_offer(ob)->>'code', 'ok') || '; ';
  res := res || 'ST-033 ' || coalesce(public.sm_cancel_swap_request(sw)->>'code', 'ok') || '; ';

  -- A accepts B: now S7
  PERFORM set_config('request.jwt.claims', ca, true);
  PERFORM public.sm_accept_trade(sw, ob, b, NULL, '{"feasible": true}'::jsonb);

  -- ST-019: a shift in manager review (S7) cannot be posted
  PERFORM set_config('request.jwt.claims', cb, true);
  res := res || 'ST-019 ' || coalesce(public.sm_create_swap_request(b1)->>'code', 'ok') || '; ';
  -- ST-030: no new offers once the request left OPEN
  PERFORM set_config('request.jwt.claims', cd, true);
  res := res || 'ST-030 ' || coalesce(public.sm_submit_swap_offer(sw, d1)->>'code', 'ok') || '; ';
  -- ST-031: A cannot decline the already-selected offer
  PERFORM set_config('request.jwt.claims', ca, true);
  res := res || 'ST-031 ' || coalesce(public.sm_decline_swap_offer(ob)->>'code', 'ok') || '; ';

  -- ST-059: unpublishing an unrelated shift leaves the trade alone
  UPDATE public.shifts SET lifecycle_status = 'Draft', assignment_outcome = NULL WHERE id = d1;
  res := res || 'ST-059 ' || (SELECT status FROM public.shift_swaps WHERE id = sw) || '; ';

  -- ST-100: approval after a shift in the trade has started is refused
  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET start_at = now() - interval '1 minute' WHERE id = b1;
  SET LOCAL session_replication_role = origin;
  BEGIN
    PERFORM public._apply_shift_op_write(a1, 'approve_trade', '{"compliance_ok": true}'::jsonb, a);
    res := res || 'ST-100 approved; ';
  EXCEPTION WHEN check_violation THEN res := res || 'ST-100 TIME_LOCKED; '; END;
  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET start_at = now() + interval '3 days' WHERE id = b1;
  SET LOCAL session_replication_role = origin;

  -- approve for real, then ST-102 / ST-032 / ST-090 on the terminal request
  PERFORM public._apply_shift_op_write(a1, 'approve_trade', '{"compliance_ok": true}'::jsonb, a);
  res := res || 'ST-102 ' || coalesce(public.sm_cancel_swap_request(sw)->>'code', 'ok') || '; ';
  PERFORM set_config('request.jwt.claims', cb, true);
  res := res || 'ST-032 ' || coalesce(public.sm_withdraw_swap_offer(ob)->>'code', 'ok') || '; ';
  res := res || 'ST-090 ' || (SELECT trading_status FROM public.shifts WHERE id = a1) || '/'
                          || (SELECT trading_status FROM public.shifts WHERE id = b1);

  RAISE EXCEPTION '%', res;
END $$;
