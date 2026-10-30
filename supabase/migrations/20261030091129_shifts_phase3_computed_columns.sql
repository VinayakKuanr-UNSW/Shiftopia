-- shifts Phase 3b + 3c: store each time fact once; generate what is computed.
--
-- 3b  scheduled_start / scheduled_end copied start_at / end_at through a
--     second trigger that hard-coded Australia/Melbourne. Their seven readers
--     move to start_at / end_at (outputs keep the scheduled_* names), then the
--     trigger and both columns go.
--     Before start_at / end_at become the only copy, recalc_shift_utc_timestamps
--     is fixed: it added '1 day' to a timestamptz, which runs in the session zone
--     (UTC), so an overnight end_at was an hour out on both DST nights. The
--     Melbourne copy did the arithmetic on local time and was right.
-- 3c  is_overnight, scheduled_length_minutes, net_length_minutes and
--     break_minutes become GENERATED with compute_shift_fields' exact
--     arithmetic, and nothing writes them any more.
--     roster_date now always follows shift_date (it kept the old day after a
--     move); the column itself is dropped with Phase 3a once the app no longer
--     selects it.
--
-- Functions are patched from their live definitions; each replacement must hit
-- exactly as often as stated or the migration aborts.
-- Test: supabase/tests/shifts_phase3_computed_columns.sql

-- ── 3b. One conversion from local wall-clock time ─────────────────────────────
CREATE OR REPLACE FUNCTION public.recalc_shift_utc_timestamps()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.shift_date IS NOT NULL AND NEW.start_time IS NOT NULL AND NEW.end_time IS NOT NULL THEN
    -- Build the local wall-clock time first and convert once: adding '1 day'
    -- to a timestamptz happens in the session zone and is an hour out on DST nights.
    NEW.start_at := (NEW.shift_date + NEW.start_time)
                    AT TIME ZONE COALESCE(NEW.timezone, 'Australia/Sydney');
    NEW.end_at := (NEW.shift_date + CASE WHEN NEW.end_time <= NEW.start_time THEN 1 ELSE 0 END + NEW.end_time)
                  AT TIME ZONE COALESCE(NEW.timezone, 'Australia/Sydney');
  END IF;

  RETURN NEW;
END;
$function$;

DO $$
DECLARE
  v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM public.shifts
  WHERE start_at IS DISTINCT FROM (shift_date + start_time) AT TIME ZONE COALESCE(timezone, 'Australia/Sydney')
     OR end_at IS DISTINCT FROM (shift_date + CASE WHEN end_time <= start_time THEN 1 ELSE 0 END + end_time)
                                AT TIME ZONE COALESCE(timezone, 'Australia/Sydney');
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% shifts hold a start_at / end_at the fixed trigger would not produce; recompute them first', v_bad;
  END IF;
END $$;

-- ── Patch functions from their live definitions ──────────────────────────────
DO $$
DECLARE
  r      record;
  v_def  text;
  v_hits int;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- 3b readers
      (1,  'public.get_manager_scorecard',      '(\n\s+)s\.scheduled_start,',                 '\1s.start_at AS scheduled_start,', 1),
      (2,  'public.get_marketplace_kpis',       '(\n\s+)s\.scheduled_start,',                 '\1s.start_at AS scheduled_start,', 1),
      (3,  'public.sm_bulk_publish_shifts',     '\n\s+s\.scheduled_start,',                   '',                                 1),
      (4,  'public.sm_bulk_publish_shifts',     'COALESCE\(l\.scheduled_start, l\.start_at\)', 'l.start_at',                      2),
      (5,  'public.sm_refresh_shift_snapshots', '(\n\s+)s\.scheduled_start,(\n\s+)s\.scheduled_end,',
                                                '\1s.start_at AS scheduled_start,\2s.end_at AS scheduled_end,',                   1),
      (6,  'public.sm_select_bid_winner',       'v_shift\.scheduled_start',                   'v_shift.start_at',                 1),
      -- 3c writers of break_minutes
      (7,  'public.sm_create_shift',            'unpaid_break_minutes, break_minutes,',       'unpaid_break_minutes,',            1),
      (8,  'public.sm_create_shift',            '\n\s+COALESCE\(\(p_shift_data->>''break_minutes''\)::integer, 0\),', '',         1),
      (9,  'public._apply_shift_op_write',      '''shift_date'',''break_minutes'',',          '''shift_date'',',                  1),
      (10, 'public._apply_shift_op_write',
           '\n\s+break_minutes\s+= COALESCE\(\(p_payload->>''paid_break_minutes''\)::int, paid_break_minutes\)\s+\+ COALESCE\(\(p_payload->>''unpaid_break_minutes''\)::int, unpaid_break_minutes\),',
           '',                                                                                                                    1)
    ) AS t(ord, fn, pat, rep, expected)
    ORDER BY ord
  LOOP
    v_def := pg_get_functiondef(r.fn::regproc);
    SELECT count(*) INTO v_hits FROM regexp_matches(v_def, r.pat, 'g');
    IF v_hits <> r.expected THEN
      RAISE EXCEPTION 'patch % on %: % matches, expected %', r.ord, r.fn, v_hits, r.expected;
    END IF;
    EXECUTE regexp_replace(v_def, r.pat, r.rep, 'g');
  END LOOP;
END $$;

-- ── 3b. The view reads start_at / end_at; keep it caller-rights ──────────────
DO $$
DECLARE
  v_def  text := pg_get_viewdef('public.v_shift_assignment_episodes'::regclass);
  v_pat  text := '(\n\s+)s\.scheduled_start,(\n\s+)s\.scheduled_end,';
  v_hits int;
BEGIN
  SELECT count(*) INTO v_hits FROM regexp_matches(v_def, v_pat, 'g');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'v_shift_assignment_episodes: % matches, expected 1', v_hits;
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_shift_assignment_episodes WITH (security_invoker = on) AS '
       || rtrim(regexp_replace(v_def, v_pat, '\1s.start_at AS scheduled_start,\2s.end_at AS scheduled_end,'), E'; \n');
END $$;

DROP TRIGGER tr_compute_scheduled_timestamps ON public.shifts;
DROP FUNCTION public.compute_scheduled_timestamps();
ALTER TABLE public.shifts DROP COLUMN scheduled_start, DROP COLUMN scheduled_end;

-- ── 3c. The trigger stops computing what the columns now generate ────────────
CREATE OR REPLACE FUNCTION public.compute_shift_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  -- roster_date mirrors shift_date until the column is dropped (Phase 3a).
  NEW.roster_date := NEW.shift_date;

  -- Increment version on update
  IF TG_OP = 'UPDATE' THEN
    NEW.version := COALESCE(OLD.version, 0) + 1;
    NEW.updated_at := NOW();
  END IF;

  -- Update assignment_status (ENUM) based on assigned_employee_id
  IF TG_OP = 'UPDATE' THEN
    IF NEW.assigned_employee_id IS NOT NULL AND OLD.assigned_employee_id IS NULL THEN
      NEW.assignment_status := 'assigned';
      NEW.assigned_at := NOW();
    ELSIF NEW.assigned_employee_id IS NULL AND OLD.assigned_employee_id IS NOT NULL THEN
      NEW.assignment_status := 'unassigned';
      NEW.assigned_at := NULL;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.assigned_employee_id IS NOT NULL THEN
      NEW.assignment_status := 'assigned';
      NEW.assigned_at := NOW();
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TEMP TABLE phase3_before ON COMMIT DROP AS
SELECT id, roster_date, shift_date, is_overnight, scheduled_length_minutes, net_length_minutes, break_minutes
FROM public.shifts;

ALTER TABLE public.shifts
  DROP COLUMN is_overnight,
  DROP COLUMN scheduled_length_minutes,
  DROP COLUMN net_length_minutes,
  DROP COLUMN break_minutes;

ALTER TABLE public.shifts
  ADD COLUMN is_overnight boolean NOT NULL
    GENERATED ALWAYS AS (end_time < start_time) STORED,
  ADD COLUMN scheduled_length_minutes integer
    GENERATED ALWAYS AS ((CASE WHEN end_time < start_time
                               THEN EXTRACT(EPOCH FROM (('24:00:00'::time - start_time) + end_time)) / 60
                               ELSE EXTRACT(EPOCH FROM (end_time - start_time)) / 60 END)::integer) STORED,
  ADD COLUMN net_length_minutes integer
    GENERATED ALWAYS AS ((CASE WHEN end_time < start_time
                               THEN EXTRACT(EPOCH FROM (('24:00:00'::time - start_time) + end_time)) / 60
                               ELSE EXTRACT(EPOCH FROM (end_time - start_time)) / 60 END)::integer
                         - COALESCE(unpaid_break_minutes, 0)) STORED,
  ADD COLUMN break_minutes integer
    GENERATED ALWAYS AS (COALESCE(paid_break_minutes, 0) + COALESCE(unpaid_break_minutes, 0)) STORED;

-- Dropped with net_length_minutes (it was an INCLUDE column).
CREATE INDEX idx_shifts_summary_covering ON public.shifts
  USING btree (organization_id, shift_date, group_type, sub_group_name)
  INCLUDE (assigned_employee_id, lifecycle_status, is_cancelled, net_length_minutes);

DO $$
DECLARE
  v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
  FROM phase3_before b JOIN public.shifts s USING (id)
  WHERE (b.is_overnight, b.scheduled_length_minutes, b.net_length_minutes, b.break_minutes)
        IS DISTINCT FROM (s.is_overnight, s.scheduled_length_minutes, s.net_length_minutes, s.break_minutes)
     OR b.roster_date IS DISTINCT FROM b.shift_date;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% shifts would change value; aborting', v_bad;
  END IF;
END $$;
