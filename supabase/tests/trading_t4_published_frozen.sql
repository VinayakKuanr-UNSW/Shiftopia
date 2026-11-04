-- Trading T4 — no edits while published (docs/design/shift-trading/01-trading-fsm.md D8).
--
-- Takes two future assigned shifts and makes them S4, plus one unassigned
-- published (S5). Each probe tries one write as the database owner, so only the
-- trigger can refuse it. It ends by raising, so the fixture rows are always
-- rolled back.
--
-- Expected output (as the error text):
--   time REFUSED; notes REFUSED; order REFUSED; date REFUSED; reassign REFUSED; drop ok; fill ok;
--   unpublish-then-edit ok; legal edit S1,S2; legal assign S1,S2,S5
-- Before the T4 migration only the date change was refused (by an older guard);
-- time, notes, order and reassignment all went through, and edit/assign were
-- legal in S3-S7.

DO $$
DECLARE
  sft uuid[]; emp uuid[];
  s4 uuid; s4b uuid; other uuid;
  res text := '';
BEGIN
  SELECT array_agg(id ORDER BY start_at), array_agg(assigned_employee_id ORDER BY start_at) INTO sft, emp
    FROM (SELECT id, assigned_employee_id, start_at FROM public.shifts
           WHERE assigned_employee_id IS NOT NULL AND NOT is_cancelled AND start_at > now() + interval '1 day'
           ORDER BY start_at LIMIT 2) x;
  IF coalesce(array_length(sft, 1), 0) < 2 OR emp[1] = emp[2] THEN
    RAISE EXCEPTION 'SKIPPED: need two future assigned shifts for two employees';
  END IF;
  s4 := sft[1]; s4b := sft[2]; other := emp[2];

  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET lifecycle_status = 'Published', assignment_status = 'assigned',
         assignment_outcome = 'confirmed', trading_status = 'NoTrade' WHERE id = ANY (sft);
  SET LOCAL session_replication_role = origin;

  BEGIN UPDATE public.shifts SET start_time = start_time + interval '15 minutes' WHERE id = s4;
        res := res || 'time ok; '; EXCEPTION WHEN check_violation THEN res := res || 'time REFUSED; '; END;
  BEGIN UPDATE public.shifts SET notes = coalesce(notes, '') || ' x' WHERE id = s4;
        res := res || 'notes ok; '; EXCEPTION WHEN check_violation THEN res := res || 'notes REFUSED; '; END;
  BEGIN UPDATE public.shifts SET display_order = coalesce(display_order, 0) + 1 WHERE id = s4;
        res := res || 'order ok; '; EXCEPTION WHEN check_violation THEN res := res || 'order REFUSED; '; END;
  BEGIN UPDATE public.shifts SET shift_date = shift_date + 1 WHERE id = s4;
        res := res || 'date ok; '; EXCEPTION WHEN check_violation THEN res := res || 'date REFUSED; '; END;
  BEGIN UPDATE public.shifts SET assigned_employee_id = other WHERE id = s4;
        res := res || 'reassign ok; '; EXCEPTION WHEN check_violation THEN res := res || 'reassign REFUSED; '; END;

  -- emptying then filling a published shift is not a reassignment
  BEGIN
    UPDATE public.shifts SET assigned_employee_id = NULL, assignment_status = 'unassigned',
           assignment_outcome = NULL, bidding_status = 'on_bidding' WHERE id = s4b;
    res := res || 'drop ok; ';
  EXCEPTION WHEN check_violation THEN res := res || 'drop REFUSED; '; END;
  BEGIN
    UPDATE public.shifts SET assigned_employee_id = other, assignment_status = 'assigned',
           assignment_outcome = 'confirmed', bidding_status = 'not_on_bidding' WHERE id = s4b;
    res := res || 'fill ok; ';
  EXCEPTION WHEN check_violation THEN res := res || 'fill REFUSED; '; END;

  -- the documented way: unpublish, then edit the draft
  BEGIN
    UPDATE public.shifts SET lifecycle_status = 'Draft', assignment_outcome = NULL,
           bidding_status = 'not_on_bidding', fulfillment_status = 'none' WHERE id = s4;
    UPDATE public.shifts SET notes = coalesce(notes, '') || ' edited' WHERE id = s4;
    res := res || 'unpublish-then-edit ok; ';
  EXCEPTION WHEN check_violation THEN res := res || 'unpublish-then-edit REFUSED; '; END;

  res := res || 'legal edit ' || (SELECT string_agg(s, ',' ORDER BY s) FROM unnest(array['S1','S2','S3','S4','S5','S6','S7']) s WHERE public.fsm_op_is_legal(s, 'edit'))
             || '; legal assign ' || (SELECT string_agg(s, ',' ORDER BY s) FROM unnest(array['S1','S2','S3','S4','S5','S6','S7']) s WHERE public.fsm_op_is_legal(s, 'assign'));

  RAISE EXCEPTION '%', res;
END $$;
