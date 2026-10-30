-- shifts Phase 3b/3c: each time fact is stored once and computed values are
-- generated, not copied.
--
-- Covers the shifts_phase3_computed_columns migration. Checks:
--   A. recalc_shift_utc_timestamps puts an overnight end on the right instant
--      across both DST changes (it added '1 day' in UTC, so end_at was an hour
--      out on those nights). Fired on a temp table, so no shift is touched.
--   B. scheduled_start / scheduled_end and the Australia/Melbourne trigger that
--      filled them are gone; v_shift_assignment_episodes still exposes
--      scheduled_start from start_at, runs as the caller and keeps its grants
--   C. is_overnight, scheduled_length_minutes, net_length_minutes and
--      break_minutes are GENERATED and equal the old trigger arithmetic over
--      overnight, midnight-end, seconds and NULL-break shapes, and on every row
--   D. nothing writes them any more; roster_date follows shift_date
--   E. idx_shifts_summary_covering is back with the same shape
-- Ends by raising, so nothing persists.
--
-- Expected output (as the error text):  PASSED (rolled back): A B C D E

DO $$
DECLARE
  v_bad    text;
  v_n      int;
  v_passed text := '';
  v_sched  text;
  v_net    text;
  v_brk    text;
  v_night  text;
BEGIN
  -- A
  CREATE TEMP TABLE phase3_utc_probe (
    label text, shift_date date, start_time time, end_time time, timezone text,
    start_at timestamptz, end_at timestamptz, expect_end timestamptz
  ) ON COMMIT DROP;
  CREATE TRIGGER probe_recalc BEFORE INSERT ON phase3_utc_probe
    FOR EACH ROW EXECUTE FUNCTION public.recalc_shift_utc_timestamps();
  INSERT INTO phase3_utc_probe (label, shift_date, start_time, end_time, timezone, expect_end) VALUES
    ('DST starts', '2026-10-03', '22:00', '06:00', 'Australia/Sydney', '2026-10-03 19:00:00+00'),
    ('DST ends',   '2027-04-03', '22:00', '06:00', 'Australia/Sydney', '2027-04-03 20:00:00+00'),
    ('day shift',  '2026-11-03', '09:00', '17:00', 'Australia/Sydney', '2026-11-03 06:00:00+00'),
    ('to midnight','2026-11-03', '16:00', '00:00', NULL,               '2026-11-03 13:00:00+00');
  SELECT string_agg(format('%s: end_at %s, expected %s', label, end_at, expect_end), '; ') INTO v_bad
  FROM phase3_utc_probe WHERE end_at IS DISTINCT FROM expect_end
     OR start_at IS DISTINCT FROM (shift_date + start_time) AT TIME ZONE COALESCE(timezone, 'Australia/Sydney');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): A — %', v_bad;
  END IF;
  v_passed := v_passed || 'A ';

  -- B
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.shifts'::regclass AND NOT attisdropped
             AND attname IN ('scheduled_start', 'scheduled_end')) THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — shifts still has scheduled_start / scheduled_end';
  END IF;
  IF to_regproc('public.compute_scheduled_timestamps') IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — compute_scheduled_timestamps still exists';
  END IF;
  SELECT count(*) INTO v_n FROM public.v_shift_assignment_episodes e
  JOIN public.shifts s ON s.id = e.shift_id WHERE e.scheduled_start IS DISTINCT FROM s.start_at;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — % episodes whose scheduled_start is not the shift''s start_at', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.v_shift_assignment_episodes'::regclass
                 AND 'security_invoker=on' = ANY (reloptions)) THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — v_shift_assignment_episodes lost security_invoker';
  END IF;
  IF NOT (has_table_privilege('authenticated', 'public.v_shift_assignment_episodes', 'SELECT')
          AND has_table_privilege('service_role', 'public.v_shift_assignment_episodes', 'SELECT')) THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — v_shift_assignment_episodes lost a SELECT grant';
  END IF;
  v_passed := v_passed || 'B ';

  -- C
  SELECT string_agg(attname, ', ') INTO v_bad FROM pg_attribute
  WHERE attrelid = 'public.shifts'::regclass AND NOT attisdropped AND attgenerated <> 's'
    AND attname IN ('is_overnight', 'scheduled_length_minutes', 'net_length_minutes', 'break_minutes');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): C — not generated: %', v_bad;
  END IF;
  SELECT max(pg_get_expr(d.adbin, d.adrelid)) FILTER (WHERE a.attname = 'scheduled_length_minutes'),
         max(pg_get_expr(d.adbin, d.adrelid)) FILTER (WHERE a.attname = 'net_length_minutes'),
         max(pg_get_expr(d.adbin, d.adrelid)) FILTER (WHERE a.attname = 'break_minutes'),
         max(pg_get_expr(d.adbin, d.adrelid)) FILTER (WHERE a.attname = 'is_overnight')
    INTO v_sched, v_net, v_brk, v_night
  FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = 'public.shifts'::regclass;
  -- The old compute_shift_fields arithmetic, verbatim, against the generated expressions.
  EXECUTE format($q$
    WITH t(v) AS (VALUES ('00:00'::time), ('00:30'), ('06:00'), ('09:00'), ('09:00:30'), ('17:00'), ('22:00'), ('23:59')),
    b(paid_break_minutes, unpaid_break_minutes) AS (VALUES (0, 0), (15, 30), (NULL::int, NULL::int), (10, NULL)),
    g AS (SELECT s.v AS start_time, e.v AS end_time, b.* FROM t s, t e, b),
    old AS (
      SELECT g.*, (CASE WHEN end_time < start_time
                        THEN EXTRACT(EPOCH FROM (('24:00:00'::time - start_time) + end_time)) / 60
                        ELSE EXTRACT(EPOCH FROM (end_time - start_time)) / 60 END)::integer AS o_sched
      FROM g)
    SELECT string_agg(format('%%s-%%s', start_time, end_time), ', ')
    FROM old
    WHERE (%s) IS DISTINCT FROM o_sched
       OR (%s) IS DISTINCT FROM o_sched - COALESCE(unpaid_break_minutes, 0)
       OR (%s) IS DISTINCT FROM COALESCE(paid_break_minutes, 0) + COALESCE(unpaid_break_minutes, 0)
       OR (%s) IS DISTINCT FROM (end_time < start_time)
  $q$, v_sched, v_net, v_brk, v_night) INTO v_bad;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): C — generated values differ from the old trigger for %', v_bad;
  END IF;
  SELECT count(*) INTO v_n FROM public.shifts
  WHERE is_overnight IS DISTINCT FROM (end_time < start_time)
     OR break_minutes IS DISTINCT FROM COALESCE(paid_break_minutes, 0) + COALESCE(unpaid_break_minutes, 0)
     OR net_length_minutes IS DISTINCT FROM scheduled_length_minutes - COALESCE(unpaid_break_minutes, 0);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'FAILED (rolled back): C — % stored rows disagree', v_n;
  END IF;
  v_passed := v_passed || 'C ';

  -- D
  SELECT string_agg(p.proname, ', ') INTO v_bad FROM pg_proc p
  WHERE p.oid IN ('public.compute_shift_fields'::regproc, 'public.sm_create_shift'::regproc,
                  'public._apply_shift_op_write'::regproc)
    AND p.prosrc ~ '\m(is_overnight|scheduled_length_minutes|net_length_minutes|break_minutes)\M';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): D — still writes a generated column: %', v_bad;
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.compute_shift_fields'::regproc) !~ 'NEW\.roster_date := NEW\.shift_date;'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.compute_shift_fields'::regproc) ~ 'roster_date IS NULL' THEN
    RAISE EXCEPTION 'FAILED (rolled back): D — roster_date still only filled when NULL';
  END IF;
  v_passed := v_passed || 'D ';

  -- E
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_shifts_summary_covering'
                 AND indexdef = 'CREATE INDEX idx_shifts_summary_covering ON public.shifts USING btree (organization_id, shift_date, group_type, sub_group_name) INCLUDE (assigned_employee_id, lifecycle_status, is_cancelled, net_length_minutes)') THEN
    RAISE EXCEPTION 'FAILED (rolled back): E — idx_shifts_summary_covering is missing or changed shape';
  END IF;
  v_passed := v_passed || 'E';

  RAISE EXCEPTION 'PASSED (rolled back): %', v_passed;
END $$;
