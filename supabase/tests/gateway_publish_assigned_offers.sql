-- The gateway must be able to publish an assigned shift that is more than
-- 4 hours away: it becomes an offer (S3 — assigned, no outcome yet).
--
-- _apply_shift_op_write('publish') wrote assignment_outcome = 'offered', a
-- value the write guard (validate_shift_state_invariants) refuses for
-- Published+assigned, so every such publish raised '[v3] … offered invalid'.
-- Puts one assigned shift in Draft 40 days out, publishes it through the
-- gateway, and checks the result. Ends by raising, so it is always rolled back.
--
-- Expected output (as the error text): PASSED (rolled back): applied, S3,
--   outcome NULL, offer Pending
-- Last run: 2026-10-30 against Supabase dev — FAILED before the fix ([v3]
--   'offered' invalid), PASSED after.

DO $$
DECLARE
  v_id  uuid;
  v_emp uuid;
  r     jsonb;
  s     record;
BEGIN
  SELECT id, assigned_employee_id INTO v_id, v_emp
    FROM public.shifts WHERE assigned_employee_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_id IS NULL THEN RAISE EXCEPTION 'SKIPPED: need one assigned shift'; END IF;

  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET
      lifecycle_status = 'Draft', assignment_status = 'assigned', assignment_outcome = NULL,
      is_cancelled = false, trading_status = 'NoTrade', bidding_status = 'not_on_bidding',
      shift_date = (now() AT TIME ZONE 'Australia/Sydney')::date + 40,
      start_time = '09:00', end_time = '13:00', start_at = NULL, end_at = NULL
  WHERE id = v_id;
  DELETE FROM public.shift_offers WHERE shift_id = v_id;
  SET LOCAL session_replication_role = origin;

  BEGIN
    r := public._apply_shift_op_write(v_id, 'publish', '{}'::jsonb, v_emp);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'FAILED (rolled back): publish raised %', SQLERRM;
  END;

  SELECT lifecycle_status, assignment_outcome,
         public.get_shift_fsm_state(lifecycle_status, assignment_status, assignment_outcome,
                                    trading_status, is_cancelled, bidding_status) AS st,
         (SELECT status FROM public.shift_offers WHERE shift_id = v_id AND employee_id = v_emp) AS offer
    INTO s FROM public.shifts WHERE id = v_id;

  IF (r->>'applied')::boolean AND s.st = 'S3' AND s.assignment_outcome IS NULL AND s.offer = 'Pending' THEN
    RAISE EXCEPTION 'PASSED (rolled back): applied, %, outcome NULL, offer %', s.st, s.offer;
  END IF;
  RAISE EXCEPTION 'FAILED (rolled back): result %, state %, outcome %, offer %', r, s.st, s.assignment_outcome, s.offer;
END $$;
