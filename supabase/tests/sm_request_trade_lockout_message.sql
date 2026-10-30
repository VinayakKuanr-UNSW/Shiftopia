-- sm_request_trade: the 4-hour trade lockout must explain itself.
--
-- Covers 20261028105455. The refusal used
-- format('%.1fh', …); Postgres format() has no %f, so it raised and the
-- function's catch-all returned 'unrecognized format() type specifier "."'
-- instead of the lockout message. Puts one assigned shift into S4 an hour from
-- now, asks to trade it as its assignee, and checks the error text. Ends by
-- raising, so the fixture change is always rolled back.
--
-- Expected output (as the error text):  PASSED (rolled back): Cannot request
--   trade: shift starts in 1.0h (4h lockout applies)
-- Last run: 2026-10-28 against Supabase dev — FAILED before the fix, PASSED after.

DO $$
DECLARE
  v_shift uuid;
  v_emp   uuid;
  j       jsonb;
BEGIN
  SELECT id, assigned_employee_id INTO v_shift, v_emp
  FROM public.shifts
  WHERE assigned_employee_id IS NOT NULL
  LIMIT 1;
  IF v_shift IS NULL THEN
    RAISE EXCEPTION 'SKIPPED: need one assigned shift';
  END IF;

  -- fixture: S4, starting in an hour (triggers off so no guard rewrites it)
  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts
  SET lifecycle_status = 'Published', assignment_status = 'assigned',
      assignment_outcome = 'confirmed', trading_status = 'NoTrade', is_cancelled = false,
      start_at = date_trunc('second', now()) + interval '1 hour 1 minute'
  WHERE id = v_shift;
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_emp, 'role', 'authenticated')::text, true);
  j := public.sm_request_trade(v_shift, v_emp, NULL);

  IF j->>'success' = 'false' AND j->>'error' LIKE 'Cannot request trade: shift starts in 1._h (4h lockout applies)' THEN
    RAISE EXCEPTION 'PASSED (rolled back): %', j->>'error';
  END IF;
  RAISE EXCEPTION 'FAILED (rolled back): %', j;
END $$;
