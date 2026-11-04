-- Trading T3 — cascades (docs/design/shift-trading/01-trading-fsm.md §6).
--
-- Three future assigned shifts become S4 for A, B and C. Each case then ends a
-- trade from outside it: unpublish, cancel, delete, and approved leave. It ends
-- by raising, so the fixture rows are always rolled back.
--
-- Expected output (as the error text):
--   unpublish-offered CANCELLED/OPEN; cancel-requester CANCELLED S4; delete-target A=S4;
--   unpublish-requester CANCELLED/CANCELLED; leave-offerer CANCELLED/OPEN
-- Before the T3 migration: every offer stayed SUBMITTED (still holding its shift),
-- the requests stayed live, and after the delete A's shift was stuck in S7.

DO $$
DECLARE
  sft uuid[]; emp uuid[];
  a uuid; b uuid; c uuid; a1 uuid; b1 uuid; c1 uuid;
  sw uuid; ob uuid; oc uuid;
  claims_a text; claims_b text; claims_c text;
  res text := '';
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

  -- 1. B's offered (held) shift is unpublished: the offer ends, A's request stays open
  PERFORM set_config('request.jwt.claims', claims_a, true);
  sw := (public.sm_create_swap_request(a1)->>'swap_id')::uuid;
  PERFORM set_config('request.jwt.claims', claims_b, true);
  ob := (public.sm_submit_swap_offer(sw, b1)->>'offer_id')::uuid;
  UPDATE public.shifts SET lifecycle_status = 'Draft' WHERE id = b1;
  res := concat(res, 'unpublish-offered ', (SELECT status FROM public.swap_offers WHERE id = ob), '/',
                (SELECT status FROM public.shift_swaps WHERE id = sw), '; ');
  UPDATE public.shifts SET lifecycle_status = 'Published' WHERE id = b1;

  -- 2. In review (S7), A's shift is cancelled: the trade ends, B's shift back to S4
  PERFORM set_config('request.jwt.claims', claims_c, true);
  oc := (public.sm_submit_swap_offer(sw, c1)->>'offer_id')::uuid;
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM public.sm_accept_trade(sw, oc, c, NULL, '{"feasible": true}'::jsonb);
  UPDATE public.shifts SET is_cancelled = true WHERE id = a1;
  res := concat(res, 'cancel-requester ', (SELECT status FROM public.shift_swaps WHERE id = sw), ' ',
                public.get_shift_state_id(c1), '; ');
  UPDATE public.shifts SET is_cancelled = false WHERE id = a1;

  -- 3. In review (S7), B's shift is deleted: A's shift must not be left in S7
  sw := (public.sm_create_swap_request(a1)->>'swap_id')::uuid;
  PERFORM set_config('request.jwt.claims', claims_c, true);
  oc := (public.sm_submit_swap_offer(sw, c1)->>'offer_id')::uuid;
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM public.sm_accept_trade(sw, oc, c, NULL, '{"feasible": true}'::jsonb);
  DELETE FROM public.shifts WHERE id = c1;
  res := concat(res, 'delete-target A=', public.get_shift_state_id(a1), '; ');

  -- 4. A's posted shift (S6) is unpublished: request and its offers end
  sw := (public.sm_create_swap_request(a1)->>'swap_id')::uuid;
  PERFORM set_config('request.jwt.claims', claims_b, true);
  ob := (public.sm_submit_swap_offer(sw, b1)->>'offer_id')::uuid;
  UPDATE public.shifts SET lifecycle_status = 'Draft' WHERE id = a1;
  res := concat(res, 'unpublish-requester ', (SELECT status FROM public.shift_swaps WHERE id = sw), '/',
                (SELECT status FROM public.swap_offers WHERE id = ob), '; ');
  UPDATE public.shifts SET lifecycle_status = 'Published', trading_status = 'NoTrade' WHERE id = a1;

  -- 5. Leave approved for B on the date of B's offered shift
  PERFORM set_config('request.jwt.claims', claims_a, true);
  sw := (public.sm_create_swap_request(a1)->>'swap_id')::uuid;
  PERFORM set_config('request.jwt.claims', claims_b, true);
  ob := (public.sm_submit_swap_offer(sw, b1)->>'offer_id')::uuid;
  INSERT INTO public.leave_requests (employee_id, leave_type, start_date, end_date, status)
  SELECT b, 'compassionate', shift_date::timestamptz, shift_date::timestamptz, 'approved' FROM public.shifts WHERE id = b1;
  res := concat(res, 'leave-offerer ', (SELECT status FROM public.swap_offers WHERE id = ob), '/',
                (SELECT status FROM public.shift_swaps WHERE id = sw));

  RAISE EXCEPTION '%', res;
END $$;
