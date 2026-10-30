-- get_shift_state_id(uuid) must read a shift's state by the same rules as
-- get_shift_fsm_state — the rules the write guard (validate_shift_state_invariants)
-- and 16 other functions use.
--
-- It kept its own copy of the rules, and sm_close_bidding / sm_manager_cancel
-- decide on it. Walks one fixture shift through every shape the write guard
-- allows and lists any shape where the two disagree. Ends by raising, so the
-- fixture is always rolled back.
--
-- Expected output (as the error text): PASSED (rolled back): 13 shapes agree
-- Last run: 2026-10-29 against Supabase dev — FAILED before the change
--   (InProgress/Completed with no confirmed outcome read INVALID; a cancelled
--   Published shift read S4), PASSED after.

DO $$
DECLARE
  v_id   uuid;
  v_emp  uuid;
  shape  record;
  by_id  text;
  ref    text;
  diffs  text[] := '{}';
  n      int := 0;
BEGIN
  SELECT id, assigned_employee_id INTO v_id, v_emp FROM public.shifts WHERE assigned_employee_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_id IS NULL THEN RAISE EXCEPTION 'SKIPPED: need one assigned shift'; END IF;

  FOR shape IN
    SELECT * FROM (VALUES
      ('Draft',      'unassigned', NULL,        'not_on_bidding', 'NoTrade',        false),
      ('Draft',      'assigned',   NULL,        'not_on_bidding', 'NoTrade',        false),
      ('Published',  'assigned',   NULL,        'not_on_bidding', 'NoTrade',        false),
      ('Published',  'assigned',   'confirmed', 'not_on_bidding', 'NoTrade',        false),
      ('Published',  'unassigned', NULL,        'on_bidding',     'NoTrade',        false),
      ('Published',  'assigned',   'confirmed', 'not_on_bidding', 'TradeRequested', false),
      ('Published',  'assigned',   'confirmed', 'not_on_bidding', 'TradeAccepted',  false),
      ('InProgress', 'assigned',   'confirmed', 'not_on_bidding', 'NoTrade',        false),
      ('InProgress', 'assigned',   NULL,        'not_on_bidding', 'NoTrade',        false),
      ('Completed',  'assigned',   'confirmed', 'not_on_bidding', 'NoTrade',        false),
      ('Completed',  'assigned',   NULL,        'not_on_bidding', 'NoTrade',        false),
      ('Cancelled',  'assigned',   'confirmed', 'not_on_bidding', 'NoTrade',        true),
      ('Published',  'assigned',   'confirmed', 'not_on_bidding', 'NoTrade',        true)
    ) AS t(l, a, o, b, tr, c)
  LOOP
    n := n + 1;
    SET LOCAL session_replication_role = replica;
    UPDATE public.shifts SET
        lifecycle_status   = shape.l::shift_lifecycle,
        assignment_status  = shape.a::shift_assignment_status,
        -- CHECK shifts_assignee_matches_status: unassigned <=> no employee
        assigned_employee_id = CASE WHEN shape.a = 'unassigned' THEN NULL ELSE v_emp END,
        assignment_outcome = shape.o::shift_assignment_outcome,
        bidding_status     = shape.b::shift_bidding_status,
        trading_status     = shape.tr::shift_trading,
        is_cancelled       = shape.c
    WHERE id = v_id;
    SET LOCAL session_replication_role = origin;

    by_id := public.get_shift_state_id(v_id);
    ref   := public.get_shift_fsm_state(shape.l::shift_lifecycle, shape.a::shift_assignment_status,
               shape.o::shift_assignment_outcome, shape.tr::shift_trading, shape.c, shape.b::shift_bidding_status);
    IF by_id IS DISTINCT FROM ref THEN
      diffs := diffs || format('%s/%s/%s/%s/cancelled=%s: by_id=%s ref=%s',
                               shape.l, shape.a, coalesce(shape.o, 'NULL'), shape.tr, shape.c, by_id, ref);
    END IF;
  END LOOP;

  IF cardinality(diffs) = 0 THEN
    RAISE EXCEPTION 'PASSED (rolled back): % shapes agree', n;
  END IF;
  RAISE EXCEPTION 'FAILED (rolled back): %', array_to_string(diffs, ' | ');
END $$;
