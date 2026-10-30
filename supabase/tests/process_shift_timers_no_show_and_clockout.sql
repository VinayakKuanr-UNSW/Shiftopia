-- process_shift_timers: the one-minute clock records no-shows and closes
-- forgotten clock-outs.
--
-- Covers 20261029065518, which moved both out of the retired 15-minute
-- sm_run_state_processor (and the 5-minute clock-out job). Three fixture
-- shifts, dated 2019 so no real leave overlaps them:
--   A ended an hour ago, nobody clocked in           -> no_show
--   B the same, but on the employee's approved leave -> stays unknown
--   C clocked in 13h ago and never out               -> auto_clock_out
-- Triggers are off only while the fixture is written; the processor runs with
-- every guard on. Ends by raising, so everything is rolled back.
--
-- Expected output (as the error text): PASSED (rolled back): A=no_show
--   B=unknown C=auto_clock_out
-- Last run: 2026-10-29 against Supabase dev — FAILED before the change
--   (A=unknown, C=checked_in), PASSED after.

DO $$
DECLARE
  ids   uuid[];
  emp_b uuid;
  r     text;
BEGIN
  SELECT array_agg(id ORDER BY id) INTO ids FROM (
    SELECT id FROM public.shifts
    WHERE assigned_employee_id IS NOT NULL
    ORDER BY id LIMIT 3) s;
  IF coalesce(array_length(ids, 1), 0) < 3 THEN
    RAISE EXCEPTION 'SKIPPED: need three assigned shifts';
  END IF;
  SELECT assigned_employee_id INTO emp_b FROM public.shifts WHERE id = ids[2];

  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET
      lifecycle_status = 'InProgress', assignment_status = 'assigned',
      assignment_outcome = 'confirmed', is_cancelled = false,
      attendance_status = 'unknown', actual_start = NULL, actual_end = NULL,
      start_at = now() - interval '3 hours', end_at = now() - interval '1 hour'
  WHERE id = ANY (ids[1:2]);
  UPDATE public.shifts SET shift_date = '2019-03-04' WHERE id = ids[1];
  UPDATE public.shifts SET shift_date = '2019-03-05' WHERE id = ids[2];
  UPDATE public.shifts SET
      lifecycle_status = 'InProgress', assignment_status = 'assigned',
      assignment_outcome = 'confirmed', is_cancelled = false,
      attendance_status = 'checked_in', actual_end = NULL, shift_date = '2019-03-07',
      start_at = now() - interval '13 hours', actual_start = now() - interval '13 hours',
      end_at = now() - interval '5 hours'
  WHERE id = ids[3];
  INSERT INTO public.leave_requests (employee_id, leave_type, start_date, end_date, status)
  VALUES (emp_b, 'ANNUAL', '2019-03-05T00:00:00Z', '2019-03-05T23:00:00Z', 'approved');
  SET LOCAL session_replication_role = origin;

  PERFORM public.process_shift_timers();

  SELECT string_agg(chr(64 + i::int) || '=' || s.attendance_status::text, ' ' ORDER BY i) INTO r
  FROM unnest(ids) WITH ORDINALITY AS u(id, i) JOIN public.shifts s ON s.id = u.id;

  IF r = 'A=no_show B=unknown C=auto_clock_out' THEN
    RAISE EXCEPTION 'PASSED (rolled back): %', r;
  END IF;
  RAISE EXCEPTION 'FAILED (rolled back): %', r;
END $$;
