-- A shift's EBA rate comes from its level only: no per-shift override parameter.
--
-- Covers the eba_rate_drop_override_params migration. Checks:
--   A. fn_eba_resolve_shift_rate exists only as (smallint, text, date)
--   B. it keeps its EXECUTE grants (authenticated, service_role)
--   C. internal.resolve_pay_terms calls it with three arguments
-- Ends by raising, so nothing persists.
--
-- Expected output (as the error text):  PASSED (rolled back): A B C
-- Last run: 2026-10-30 against Supabase dev — FAILED before the migration, PASSED after.

DO $$
DECLARE
  v_sigs   text;
  v_passed text := '';
BEGIN
  -- A
  SELECT string_agg(oid::regprocedure::text, ', ') INTO v_sigs
  FROM pg_proc WHERE proname = 'fn_eba_resolve_shift_rate';
  IF v_sigs IS DISTINCT FROM 'fn_eba_resolve_shift_rate(smallint,text,date)' THEN
    RAISE EXCEPTION 'FAILED (rolled back): A — signatures are %', v_sigs;
  END IF;
  v_passed := v_passed || 'A ';

  -- B
  IF NOT (has_function_privilege('authenticated', 'public.fn_eba_resolve_shift_rate(smallint,text,date)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.fn_eba_resolve_shift_rate(smallint,text,date)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — EXECUTE grant lost';
  END IF;
  v_passed := v_passed || 'B ';

  -- C
  IF (SELECT prosrc FROM pg_proc
      WHERE oid = 'internal.resolve_pay_terms(date,smallint,text,text,smallint,numeric,text,numeric,boolean)'::regprocedure)
     ~ 'fn_eba_resolve_shift_rate\([^)]*NULL' THEN
    RAISE EXCEPTION 'FAILED (rolled back): C — resolve_pay_terms still passes override arguments';
  END IF;
  v_passed := v_passed || 'C';

  RAISE EXCEPTION 'PASSED (rolled back): %', v_passed;
END
$$;
