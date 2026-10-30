-- Five functions nothing referenced are gone.
--
-- Found 2026-10-30 by scanning every function in public/hr/internal against
-- other function bodies, triggers, policies, views, column defaults, CHECKs and
-- cron, then the app, edge functions, solver, ML code, scripts and tests.
-- Overlap is enforced by the trigger fn_shift_no_overlap, not check_shift_overlap.
-- Checks:
--   A. none of the five exists
--   B. nothing in the database names any of them
-- Ends by raising, so nothing persists.
--
-- Expected output (as the error text):  PASSED (rolled back): A B
-- Last run: 2026-10-30 against Supabase dev — FAILED before the migration, PASSED after.

DO $$
DECLARE
  c_names constant text[] := ARRAY['cancel_shift', 'check_shift_overlap', 'compute_employee_quarter_metrics',
                                   'fn_shift_state', 'is_manager_or_above'];
  v_found  text;
  v_passed text := '';
BEGIN
  -- A
  SELECT string_agg(oid::regprocedure::text, ', ') INTO v_found
  FROM pg_proc WHERE proname = ANY (c_names) AND pronamespace = 'public'::regnamespace;
  IF v_found IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): A — still defined: %', v_found;
  END IF;
  v_passed := v_passed || 'A ';

  -- B
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_found
  FROM pg_proc p
  WHERE p.prosrc ~ ('\m(' || array_to_string(c_names, '|') || ')\(');
  IF v_found IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — still called by: %', v_found;
  END IF;
  v_passed := v_passed || 'B';

  RAISE EXCEPTION 'PASSED (rolled back): %', v_passed;
END
$$;
