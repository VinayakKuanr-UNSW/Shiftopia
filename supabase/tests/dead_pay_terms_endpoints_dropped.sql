-- Gross Pay follow-up 1: the dead pay-terms endpoints are gone, the live ones stay.
--
-- Checks:
--   A. none of the five dropped functions exists, and no function names them
--   B. public.shift_pay_terms and internal.shift_pay_terms still exist, and a
--      shifts select naming shift_pay_terms (as get-roster-view does) still runs
-- Ends by raising, so nothing persists.
--
-- Expected output (as the error text):  PASSED (rolled back): A B

DO $$
DECLARE
  v_names  text;
  v_passed text := '';
BEGIN
  -- A
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_names FROM pg_proc p
  WHERE p.proname IN ('get_shift_pay_terms', 'my_shift_pay_terms', 'get_prospective_pay_terms',
                      'shift_pay_terms_for', 'prospective_pay_terms');
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): A — still exists: %', v_names;
  END IF;
  SELECT string_agg(n.nspname || '.' || p.proname, ', ') INTO v_names
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND p.prosrc ~ '\m(get_shift_pay_terms|my_shift_pay_terms|get_prospective_pay_terms|shift_pay_terms_for|prospective_pay_terms)\M';
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): A — still named by: %', v_names;
  END IF;
  v_passed := v_passed || 'A ';

  -- B
  IF to_regprocedure('public.shift_pay_terms(public.shifts)') IS NULL
     OR to_regprocedure('internal.shift_pay_terms(public.shifts)') IS NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — a live shift_pay_terms function is missing';
  END IF;
  PERFORM public.shift_pay_terms(s) FROM public.shifts s LIMIT 5;
  v_passed := v_passed || 'B';

  RAISE EXCEPTION 'PASSED (rolled back): %', v_passed;
END $$;
