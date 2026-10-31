-- shifts Phase 3a: drop roster_date.
--
-- Nothing reads it — not the app, get-roster-view (v18 no longer selects it),
-- the solver, a view or a function. It was written on every insert and, until
-- 20261030091129, filled only when NULL, so a moved shift kept its old day.
-- Its three writers stop writing it; then the index and the column go.
--
-- Functions are patched from their live definitions; each replacement must hit
-- exactly as often as stated or the migration aborts.
-- Test: supabase/tests/shifts_phase3a_roster_date_dropped.sql

DO $$
DECLARE r record; v_def text; v_hits int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      (1, 'public.compute_shift_fields', '(\nBEGIN)\n\s+-- roster_date mirrors shift_date until the column is dropped \(Phase 3a\)\.\n\s+NEW\.roster_date := NEW\.shift_date;\n', '\1', 1),
      (2, 'public.sm_create_shift', 'shift_date, roster_date, start_time', 'shift_date, start_time', 1),
      (3, 'public.sm_create_shift', '\n\s+\(p_shift_data->>''roster_date''\)::date,', '', 1),
      (4, 'public.sm_move_shift',   '\n\s+roster_date\s+= COALESCE\(p_shift_date, roster_date\),', '', 1)
    ) AS t(ord, fn, pat, rep, expected) ORDER BY ord
  LOOP
    v_def := pg_get_functiondef(r.fn::regproc);
    SELECT count(*) INTO v_hits FROM regexp_matches(v_def, r.pat, 'g');
    IF v_hits <> r.expected THEN
      RAISE EXCEPTION 'patch % on %: % matches, expected %', r.ord, r.fn, v_hits, r.expected;
    END IF;
    EXECUTE regexp_replace(v_def, r.pat, r.rep, 'g');
  END LOOP;
END $$;

DROP INDEX public.idx_shifts_roster_date;
ALTER TABLE public.shifts DROP COLUMN roster_date;
