-- process_shift_timers: the one-minute clock records arrival/departure missing
-- tracks and no-shows on public.timesheets (auto-clockout retired).
--
-- Three fixture shifts, dated 2019 so no real leave overlaps them:
--   A ended an hour ago, nobody clocked in           -> is_no_show=true (arrival=missing, departure=missing)
--   B the same, but on the employee's approved leave -> untouched (no timesheets row)
--   C clocked in 13h ago and never out               -> departure_track='missing', clock_out IS NULL (no auto-clockout)
-- Triggers are off only while the fixture is written; the processor runs with
-- every guard on. Ends by raising, so everything is rolled back.
--
-- Expected output (as the error text):
--   PASSED (rolled back): A=no_show B=exempt C=missing_out

DO $$
DECLARE
  ids   uuid[];
  emp_b uuid;
  emp_c uuid;
  org_c uuid;
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
  SELECT assigned_employee_id, organization_id INTO emp_c, org_c FROM public.shifts WHERE id = ids[3];

  SET LOCAL session_replication_role = replica;
  DELETE FROM public.billables WHERE shift_id = ANY (ids);
  DELETE FROM public.timesheets WHERE shift_id = ANY (ids);

  UPDATE public.shifts SET
      lifecycle_status = 'InProgress', assignment_status = 'assigned',
      assignment_outcome = 'confirmed', is_cancelled = false,
      start_at = now() - interval '3 hours', end_at = now() - interval '1 hour'
  WHERE id = ANY (ids[1:2]);
  UPDATE public.shifts SET shift_date = '2019-03-04' WHERE id = ids[1];
  UPDATE public.shifts SET shift_date = '2019-03-05' WHERE id = ids[2];

  UPDATE public.shifts SET
      lifecycle_status = 'InProgress', assignment_status = 'assigned',
      assignment_outcome = 'confirmed', is_cancelled = false, shift_date = '2019-03-07',
      start_at = now() - interval '13 hours',
      end_at = now() - interval '5 hours'
  WHERE id = ids[3];

  INSERT INTO public.timesheets (shift_id, employee_id, organization_id, clock_in, clock_out, arrival_track, departure_track, source)
  VALUES (ids[3], emp_c, org_c, now() - interval '13 hours', NULL, 'on_time', NULL, 'clock');

  INSERT INTO public.leave_requests (employee_id, leave_type, start_date, end_date, status)
  VALUES (emp_b, 'ANNUAL', '2019-03-05T00:00:00Z', '2019-03-05T23:00:00Z', 'approved');
  SET LOCAL session_replication_role = origin;

  PERFORM public.process_shift_timers();

  SELECT string_agg(
    chr(64 + i::int) || '=' ||
    CASE
      WHEN t.id IS NULL THEN 'exempt'
      WHEN t.is_no_show THEN 'no_show'
      WHEN t.clock_in IS NOT NULL AND t.clock_out IS NULL AND t.departure_track = 'missing' THEN 'missing_out'
      ELSE coalesce(t.arrival_track::text, '?') || '/' || coalesce(t.departure_track::text, '?')
    END,
    ' ' ORDER BY i
  ) INTO r
  FROM unnest(ids) WITH ORDINALITY AS u(id, i)
  JOIN public.shifts s ON s.id = u.id
  LEFT JOIN public.timesheets t ON t.shift_id = s.id;

  IF r = 'A=no_show B=exempt C=missing_out' THEN
    RAISE EXCEPTION 'PASSED (rolled back): %', r;
  END IF;
  RAISE EXCEPTION 'FAILED (rolled back): %', r;
END $$;
