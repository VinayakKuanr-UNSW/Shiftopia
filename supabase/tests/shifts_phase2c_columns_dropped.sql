-- shifts Phase 2c + 1b: deleted_at and the three never-written pay columns are gone.
--
-- Checks:
--   A. shifts has no deleted_at, currency, actual_hourly_rate, remuneration_rate,
--      and no CHECK shifts_no_soft_delete
--   B. get_shift_delta no longer returns deleted_at, still runs as the caller
--      (SECURITY INVOKER), and only authenticated / service_role may execute it
--   C. no trigger definition on shifts names deleted_at
-- Ends by raising, so nothing persists.
--
-- Expected output (as the error text):  PASSED (rolled back): A B C
-- Last run: 2026-10-30 against Supabase dev — FAILED before the migration, PASSED after.

DO $$
DECLARE
  c_fn     constant regprocedure := 'public.get_shift_delta(uuid,timestamptz,uuid[],date,date)';
  v_names  text;
  v_passed text := '';
BEGIN
  -- A
  SELECT string_agg(column_name, ', ') INTO v_names FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'shifts'
    AND column_name IN ('deleted_at', 'currency', 'actual_hourly_rate', 'remuneration_rate');
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): A — shifts still has %', v_names;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shifts_no_soft_delete') THEN
    RAISE EXCEPTION 'FAILED (rolled back): A — CHECK shifts_no_soft_delete still exists';
  END IF;
  v_passed := v_passed || 'A ';

  -- B
  IF pg_get_function_result(c_fn) ILIKE '%deleted_at%' THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — get_shift_delta still returns deleted_at';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = c_fn) THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — get_shift_delta is SECURITY DEFINER again';
  END IF;
  IF has_function_privilege('anon', c_fn, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', c_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', c_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — get_shift_delta grants changed';
  END IF;
  v_passed := v_passed || 'B ';

  -- C
  SELECT string_agg(tgname, ', ') INTO v_names FROM pg_trigger
  WHERE tgrelid = 'public.shifts'::regclass AND NOT tgisinternal
    AND pg_get_triggerdef(oid) ILIKE '%deleted_at%';
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): C — triggers still name deleted_at: %', v_names;
  END IF;
  v_passed := v_passed || 'C';

  RAISE EXCEPTION 'PASSED (rolled back): %', v_passed;
END
$$;
