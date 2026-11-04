-- Trading T1 — offer integrity (docs/design/shift-trading/01-trading-fsm.md §4, §5, §7).
--
-- Takes four future assigned shifts and makes them S4 for A, B (two shifts) and C.
-- Then drives the offer RPCs as each employee. It ends by raising, so the fixture
-- rows are always rolled back.
--
-- Expected output (as the error text):
--   post-S3 INVALID_STATE; offer ok; second-offer OFFER_EXISTS; drop-held TRADE_IN_PROGRESS;
--   post-held TRADE_IN_PROGRESS; offer-held SHIFT_ALREADY_OFFERED; decline ok; held-after-decline false;
--   reoffer ok; withdraw ok; held-after-withdraw false; direct-insert REFUSED; giveaway REFUSED
-- Before 20261104070049 the second offer, the drop and the re-offer all succeeded,
-- the S3 post succeeded, and the direct insert and giveaway were accepted.

DO $$
DECLARE
  sft uuid[];
  emp uuid[];
  a uuid; b uuid; c uuid;
  a1 uuid; b1 uuid; b2 uuid; c1 uuid;
  sw_a uuid; sw_c uuid; off uuid;
  r json; rb jsonb;
  res text := '';
BEGIN
  SELECT array_agg(id ORDER BY start_at), array_agg(assigned_employee_id ORDER BY start_at) INTO sft, emp
    FROM (SELECT id, assigned_employee_id, start_at FROM public.shifts
           WHERE assigned_employee_id IS NOT NULL AND NOT is_cancelled AND start_at > now() + interval '1 day'
           ORDER BY start_at LIMIT 4) x;
  IF coalesce(array_length(sft, 1), 0) < 4 OR (SELECT count(DISTINCT e) FROM unnest(emp[1:3]) e) < 3 THEN
    RAISE EXCEPTION 'SKIPPED: need four future assigned shifts across three employees';
  END IF;
  a := emp[1]; b := emp[2]; c := emp[3];
  a1 := sft[1]; b1 := sft[2]; c1 := sft[3]; b2 := sft[4];

  -- Fixture: all four confirmed (S4); the fourth moves to B. Triggers are off for the setup only.
  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET lifecycle_status = 'Published', assignment_status = 'assigned',
         assignment_outcome = 'confirmed', trading_status = 'NoTrade'
   WHERE id = ANY (sft);
  UPDATE public.shifts SET assigned_employee_id = b WHERE id = b2;
  SET LOCAL session_replication_role = origin;

  -- posting requires S4
  UPDATE public.shifts SET assignment_outcome = NULL WHERE id = a1;  -- S3
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  r := public.sm_create_swap_request(a1);
  res := res || 'post-S3 ' || coalesce(r->>'code', 'ok') || '; ';
  UPDATE public.shifts SET assignment_outcome = 'confirmed' WHERE id = a1;

  r := public.sm_create_swap_request(a1);
  sw_a := (r->>'swap_id')::uuid;
  IF sw_a IS NULL THEN RAISE EXCEPTION 'FIXTURE: A could not post: %', r; END IF;

  -- B offers B1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  r := public.sm_submit_swap_offer(sw_a, b1);
  off := (r->>'offer_id')::uuid;
  res := res || 'offer ' || coalesce(r->>'code', 'ok') || '; ';

  -- I2: one active offer per peer
  r := public.sm_submit_swap_offer(sw_a, b2);
  res := res || 'second-offer ' || coalesce(r->>'code', 'ok') || '; ';

  -- I7: the held shift can't be dropped or posted
  rb := public.sm_employee_drop_shift(b1, b, 'test', NULL);
  res := res || 'drop-held ' || coalesce(rb->>'code', 'ok') || '; ';
  r := public.sm_create_swap_request(b1);
  res := res || 'post-held ' || coalesce(r->>'code', 'ok') || '; ';

  -- I3: and can't be offered into C's trade
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  sw_c := (public.sm_create_swap_request(c1)->>'swap_id')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  r := public.sm_submit_swap_offer(sw_c, b1);
  res := res || 'offer-held ' || coalesce(r->>'code', 'ok') || '; ';

  -- A declines: request stays open, hold released
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  r := public.sm_decline_swap_offer(off);
  res := res || 'decline ' || coalesce(r->>'code', 'ok') || '; ';
  res := res || 'held-after-decline ' || public.shift_is_held(b1)::text || '; ';

  -- B offers again, then withdraws
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  r := public.sm_submit_swap_offer(sw_a, b1);
  off := (r->>'offer_id')::uuid;
  res := res || 'reoffer ' || coalesce(r->>'code', 'ok') || '; ';
  r := public.sm_withdraw_swap_offer(off);
  res := res || 'withdraw ' || coalesce(r->>'code', 'ok') || '; ';
  res := res || 'held-after-withdraw ' || public.shift_is_held(b1)::text || '; ';

  -- the client can no longer write offers directly
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO public.swap_offers (swap_request_id, offerer_id, offered_shift_id, status)
    VALUES (sw_a, b, b1, 'SELECTED');
    res := res || 'direct-insert ok; ';
  EXCEPTION WHEN insufficient_privilege THEN
    res := res || 'direct-insert REFUSED; ';
  END;
  EXECUTE 'RESET ROLE';

  -- D9: no giveaways
  BEGIN
    INSERT INTO public.swap_offers (swap_request_id, offerer_id, offered_shift_id, status)
    VALUES (sw_a, b, NULL, 'SUBMITTED');
    res := res || 'giveaway ok';
  EXCEPTION WHEN not_null_violation THEN
    res := res || 'giveaway REFUSED';
  END;

  RAISE EXCEPTION '%', res;
END $$;
