-- Trading T2 — trade lifecycle (docs/design/shift-trading/01-trading-fsm.md §5, §6, §10).
--
-- Four future assigned shifts become S4 for A, B and C. Then it walks accept,
-- reject, withdraw-from-S7, retract-from-S7, review expiry, offer lapse and
-- approval. It ends by raising, so the fixture rows are always rolled back.
-- Compliance at approval is the deferred trg_shift_eba_compliance (runs at
-- commit, which this rolled-back test never reaches); covered by the EBA tests.
--
-- Expected output (as the error text):
--   target-from-offer t; other-offer REJECTED; other-held false; both S7 t; expiry-least t;
--   reject REJECTED/REJECTED; reject-held false; repost ok; withdraw-S7 CANCELLED/WITHDRAWN;
--   withdraw-states S4/S4; cancel-S7 CANCELLED/CANCELLED; cancel-held false;
--   expire EXPIRED S4/S4; lapse EXPIRED/OPEN; approve APPROVED/ACCEPTED; swapped t; approve-held false
-- Before 20261104072151: the accepted shift came from the client, reject and
-- approve left the offer holding B's shift, and S7 withdraw/retract were refused.

DO $$
DECLARE
  sft uuid[]; emp uuid[];
  a uuid; b uuid; c uuid;
  a1 uuid; b1 uuid; c1 uuid;
  sw uuid; ob uuid; oc uuid;
  r json; s record;
  res text := '';
  claims_a text; claims_b text; claims_c text;
BEGIN
  SELECT array_agg(id ORDER BY start_at), array_agg(assigned_employee_id ORDER BY start_at) INTO sft, emp
    FROM (SELECT id, assigned_employee_id, start_at FROM public.shifts
           WHERE assigned_employee_id IS NOT NULL AND NOT is_cancelled AND start_at > now() + interval '1 day'
           ORDER BY start_at LIMIT 3) x;
  IF coalesce(array_length(sft, 1), 0) < 3 OR (SELECT count(DISTINCT e) FROM unnest(emp) e) < 3 THEN
    RAISE EXCEPTION 'SKIPPED: need three future assigned shifts across three employees';
  END IF;
  a := emp[1]; b := emp[2]; c := emp[3]; a1 := sft[1]; b1 := sft[2]; c1 := sft[3];
  claims_a := json_build_object('sub', a, 'role', 'authenticated')::text;
  claims_b := json_build_object('sub', b, 'role', 'authenticated')::text;
  claims_c := json_build_object('sub', c, 'role', 'authenticated')::text;

  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET lifecycle_status = 'Published', assignment_status = 'assigned',
         assignment_outcome = 'confirmed', trading_status = 'NoTrade' WHERE id = ANY (sft);
  SET LOCAL session_replication_role = origin;

  -- accept: B and C offer; A accepts B's but passes C's shift id
  PERFORM set_config('request.jwt.claims', claims_a, true);
  sw := (public.sm_create_swap_request(a1)->>'swap_id')::uuid;
  PERFORM set_config('request.jwt.claims', claims_b, true);
  ob := (public.sm_submit_swap_offer(sw, b1)->>'offer_id')::uuid;
  PERFORM set_config('request.jwt.claims', claims_c, true);
  oc := (public.sm_submit_swap_offer(sw, c1)->>'offer_id')::uuid;
  PERFORM set_config('request.jwt.claims', claims_a, true);
  r := public.sm_accept_trade(sw, ob, b, c1, '{"feasible": true}'::jsonb);
  IF NOT (r->>'success')::boolean THEN RAISE EXCEPTION 'FIXTURE accept: %', r; END IF;
  SELECT * INTO s FROM public.shift_swaps WHERE id = sw;
  res := concat(res, 'target-from-offer ', (s.target_shift_id = b1)::text, '; ');
  res := concat(res, 'other-offer ', (SELECT status FROM public.swap_offers WHERE id = oc), '; ');
  res := concat(res, 'other-held ', public.shift_is_held(c1)::text, '; ');
  res := concat(res, 'both S7 ', (public.get_shift_state_id(a1) = 'S7' AND public.get_shift_state_id(b1) = 'S7')::text, '; ');
  res := concat(res, 'expiry-least ', (s.expires_at = LEAST(
           (SELECT start_at FROM public.shifts WHERE id = a1), (SELECT start_at FROM public.shifts WHERE id = b1)))::text, '; ');

  -- manager rejects: trade over, offer released
  PERFORM public._apply_shift_op_write(a1, 'reject_trade', '{}'::jsonb, a);
  res := concat(res, 'reject ', (SELECT status FROM public.shift_swaps WHERE id = sw), '/', (SELECT status FROM public.swap_offers WHERE id = ob), '; ');
  res := concat(res, 'reject-held ', public.shift_is_held(b1)::text, '; ');

  -- A posts again; B offers; A accepts; B withdraws from S7
  sw := (public.sm_create_swap_request(a1)->>'swap_id')::uuid;
  res := concat(res, 'repost ', CASE WHEN sw IS NULL THEN 'FAILED' ELSE 'ok' END, '; ');
  PERFORM set_config('request.jwt.claims', claims_b, true);
  ob := (public.sm_submit_swap_offer(sw, b1)->>'offer_id')::uuid;
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM public.sm_accept_trade(sw, ob, b, NULL, '{"feasible": true}'::jsonb);
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM public.sm_withdraw_swap_offer(ob);
  res := concat(res, 'withdraw-S7 ', (SELECT status FROM public.shift_swaps WHERE id = sw), '/', (SELECT status FROM public.swap_offers WHERE id = ob), '; ');
  res := concat(res, 'withdraw-states ', public.get_shift_state_id(a1), '/', public.get_shift_state_id(b1), '; ');

  -- A retracts from S7
  PERFORM set_config('request.jwt.claims', claims_a, true);
  sw := (public.sm_create_swap_request(a1)->>'swap_id')::uuid;
  PERFORM set_config('request.jwt.claims', claims_b, true);
  ob := (public.sm_submit_swap_offer(sw, b1)->>'offer_id')::uuid;
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM public.sm_accept_trade(sw, ob, b, NULL, '{"feasible": true}'::jsonb);
  PERFORM public.sm_cancel_swap_request(sw);
  res := concat(res, 'cancel-S7 ', (SELECT status FROM public.shift_swaps WHERE id = sw), '/', (SELECT status FROM public.swap_offers WHERE id = ob), '; ');
  res := concat(res, 'cancel-held ', public.shift_is_held(b1)::text, '; ');

  -- review expires (simulated: expires_at reached)
  sw := (public.sm_create_swap_request(a1)->>'swap_id')::uuid;
  PERFORM set_config('request.jwt.claims', claims_b, true);
  ob := (public.sm_submit_swap_offer(sw, b1)->>'offer_id')::uuid;
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM public.sm_accept_trade(sw, ob, b, NULL, '{"feasible": true}'::jsonb);
  UPDATE public.shift_swaps SET expires_at = now() - interval '1 second' WHERE id = sw;
  PERFORM public.process_shift_timers();
  res := concat(res, 'expire ', (SELECT status FROM public.shift_swaps WHERE id = sw), ' ', public.get_shift_state_id(a1), '/', public.get_shift_state_id(b1), '; ');

  -- offer lapses when C's shift starts; A's request stays open
  sw := (public.sm_create_swap_request(a1)->>'swap_id')::uuid;
  PERFORM set_config('request.jwt.claims', claims_c, true);
  oc := (public.sm_submit_swap_offer(sw, c1)->>'offer_id')::uuid;
  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET start_at = now() - interval '1 minute' WHERE id = c1;
  SET LOCAL session_replication_role = origin;
  PERFORM public.process_shift_timers();
  res := concat(res, 'lapse ', (SELECT status FROM public.swap_offers WHERE id = oc), '/', (SELECT status FROM public.shift_swaps WHERE id = sw), '; ');

  -- approve on the same open request
  PERFORM set_config('request.jwt.claims', claims_b, true);
  ob := (public.sm_submit_swap_offer(sw, b1)->>'offer_id')::uuid;
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM public.sm_accept_trade(sw, ob, b, NULL, '{"feasible": true}'::jsonb);
  PERFORM public._apply_shift_op_write(a1, 'approve_trade', '{"compliance_ok": true}'::jsonb, a);
  res := concat(res, 'approve ', (SELECT status FROM public.shift_swaps WHERE id = sw), '/', (SELECT status FROM public.swap_offers WHERE id = ob), '; ');
  res := concat(res, 'swapped ', ((SELECT assigned_employee_id FROM public.shifts WHERE id = a1) = b
                           AND (SELECT assigned_employee_id FROM public.shifts WHERE id = b1) = a)::text, '; ');
  res := concat(res, 'approve-held ', public.shift_is_held(b1)::text);

  RAISE EXCEPTION '%', res;
END $$;
