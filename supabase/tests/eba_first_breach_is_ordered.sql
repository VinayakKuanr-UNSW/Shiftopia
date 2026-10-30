-- "The first blocking breach" is the engine's own order, by contract.
--
-- The gateway (_apply_shift_op_write) and internal.trg_shift_eba_compliance
-- report one breach: LIMIT 1 over internal.eba_check_assignment(...). Without
-- ORDER BY, SQL promises no order. Checks:
--   A. every function that takes LIMIT 1 over the engine numbers its rows
--      WITH ORDINALITY and orders by that number
--   B. there is at least one such caller (guards against an empty scan)
-- Ends by raising, so nothing persists.
--
-- Expected output (as the error text):  PASSED (rolled back): A B
-- Last run: 2026-10-30 against Supabase dev — FAILED before the migration, PASSED after.

DO $$
DECLARE
  v_callers  integer;
  v_unordered text;
BEGIN
  SELECT count(*) INTO v_callers
  FROM pg_proc p
  WHERE p.prosrc ~ 'internal\.eba_check_assignment\(' AND p.proname <> 'eba_check_assignment';

  -- A: a call whose own statement (up to its semicolon) has LIMIT 1 but no
  -- WITH ORDINALITY ... ORDER BY <alias>.eba_ord.
  SELECT string_agg(DISTINCT p.oid::regprocedure::text, ', ') INTO v_unordered
  FROM pg_proc p,
       regexp_matches(p.prosrc, 'internal\.eba_check_assignment\([^;]*;', 'g') AS m(stmt)
  WHERE p.proname <> 'eba_check_assignment'
    AND m.stmt[1] ~ 'LIMIT 1'
    AND m.stmt[1] !~ 'WITH ORDINALITY AS \w+\([^)]*eba_ord\)[^;]*ORDER BY \w+\.eba_ord';
  IF v_unordered IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): A — LIMIT 1 over the engine without ORDER BY in: %', v_unordered;
  END IF;

  -- B
  IF v_callers = 0 THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — no function calls internal.eba_check_assignment';
  END IF;

  RAISE EXCEPTION 'PASSED (rolled back): A B';
END
$$;
