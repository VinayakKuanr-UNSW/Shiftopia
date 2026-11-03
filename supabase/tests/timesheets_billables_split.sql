-- =============================================================================
-- Comprehensive Verification Suite: 3-Table Separation
--   1. public.shifts     (58 cols — pure roster planning & lifecycle)
--   2. public.timesheets (13 cols — ground-truth attendance actuals & tracks)
--   3. public.billables  (40 cols — manager verification, breaks, lengths & pay)
--
-- Runs live against PostgreSQL and rolls back cleanly at the end via RAISE.
-- =============================================================================

DO $$
DECLARE
  v_shifts_cols     int;
  v_ts_cols         int;
  v_bil_cols        int;
  v_retired_count   int;
  v_shift_id        uuid;
  v_emp_id          uuid;
  v_org_id          uuid;
  v_lat             double precision;
  v_lon             double precision;
  v_res             jsonb;
  v_ts              record;
  v_bil             record;
  v_locked_caught   boolean := false;
BEGIN
  -- ── 1. Schema & Retired Objects Verification ──────────────────────────────
  SELECT count(*) INTO v_shifts_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'shifts';
  ASSERT v_shifts_cols = 58, format('Expected 58 columns on public.shifts, got %s', v_shifts_cols);

  SELECT count(*) INTO v_ts_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'timesheets';
  ASSERT v_ts_cols = 13, format('Expected 13 columns on public.timesheets, got %s', v_ts_cols);

  SELECT count(*) INTO v_bil_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'billables';
  ASSERT v_bil_cols = 40, format('Expected 40 columns on public.billables, got %s', v_bil_cols);

  SELECT count(*) INTO v_retired_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('attendance_records', 'shift_payroll_records', 'gross_pay_records');
  ASSERT v_retired_count = 0, format('Expected 0 retired tables remaining, got %s', v_retired_count);

  ASSERT to_regtype('public.shift_attendance_status') IS NULL,
    'Expected public.shift_attendance_status enum to be dropped';
  ASSERT to_regprocedure('public.sm_handle_auto_clock_out()') IS NULL,
    'Expected public.sm_handle_auto_clock_out() to be dropped';

  -- ── 2. Pick a real assigned non-security shift + valid geofence coordinates
  SELECT s.id, s.assigned_employee_id, s.organization_id
    INTO v_shift_id, v_emp_id, v_org_id
    FROM public.shifts s
    LEFT JOIN hr.roles r ON r.id = s.role_id
   WHERE s.assigned_employee_id IS NOT NULL
     AND COALESCE(r.name, '') NOT ILIKE '%security%'
   ORDER BY s.id
   LIMIT 1;
  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'SKIPPED: need at least 1 assigned shift';
  END IF;

  SELECT lat, lng INTO v_lat, v_lon
    FROM public.allowed_locations
   WHERE org_id = v_org_id AND is_active = true
   LIMIT 1;
  IF v_lat IS NULL THEN
    SELECT COALESCE(venue_lat, -33.875), COALESCE(venue_lon, 151.199)
      INTO v_lat, v_lon
      FROM public.organizations
     WHERE id = v_org_id;
  END IF;

  -- ── 3. +-7.5m Grace Thresholds & Timer -> Punch Overwrite ─────────────────
  SET LOCAL session_replication_role = replica;
  DELETE FROM public.billables WHERE shift_id = v_shift_id;
  DELETE FROM public.timesheets WHERE shift_id = v_shift_id;

  UPDATE public.shifts
     SET shift_date = (now() AT TIME ZONE 'Australia/Sydney')::date,
         start_time = '09:00:00',
         end_time   = '17:00:00',
         start_at   = now() - interval '10 minutes',
         end_at     = now() + interval '5 minutes',
         unpaid_break_minutes = 30,
         paid_break_minutes   = 15,
         break_start          = '13:00:00',
         break_end            = '13:30:00',
         lifecycle_status     = 'InProgress',
         assignment_status    = 'assigned',
         assignment_outcome   = 'confirmed',
         is_cancelled         = false
   WHERE id = v_shift_id;
  SET LOCAL session_replication_role = origin;

  -- 3a. Start+0m passed with no punch -> process_shift_timers flags arrival_track='missing' (NOT no-show yet)
  PERFORM public.process_shift_timers();

  SELECT * INTO v_ts FROM public.timesheets WHERE shift_id = v_shift_id;
  ASSERT v_ts.id IS NOT NULL, 'Expected timesheets row after start_at passed';
  ASSERT v_ts.arrival_track = 'missing', format('Expected arrival_track=missing, got %s', v_ts.arrival_track);
  ASSERT v_ts.departure_track IS NULL, format('Expected departure_track IS NULL while shift running, got %s', v_ts.departure_track);
  ASSERT v_ts.is_no_show = false, 'Expected is_no_show=false while departure_track IS NULL';

  -- 3b. Late punch arrives (+10m > +7.5m) -> check_in_shift overwrites 'missing' with 'late_in'
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_emp_id, 'role', 'authenticated')::text, true);
  v_res := public.check_in_shift(v_shift_id, v_lat, v_lon);
  ASSERT (v_res->>'success')::boolean = true, format('check_in_shift failed: %s', v_res);
  ASSERT v_res->>'arrival_track' = 'late_in', format('Expected arrival_track=late_in (+10m), got %s', v_res);

  SELECT * INTO v_ts FROM public.timesheets WHERE shift_id = v_shift_id;
  ASSERT v_ts.clock_in IS NOT NULL, 'Expected clock_in to be recorded';
  ASSERT v_ts.arrival_track = 'late_in', format('Expected arrival_track=late_in in DB, got %s', v_ts.arrival_track);
  ASSERT v_ts.is_no_show = false, 'Expected is_no_show=false after check_in';

  -- 3c. Clock out within +-7.5m of end_at (-5m) -> sm_clock_out_shift records departure_track='on_time'
  --     ONLY on public.timesheets (employee actuals stay strictly separate from manager billables)
  v_res := public.sm_clock_out_shift(v_shift_id, v_emp_id, v_lat, v_lon);
  ASSERT (v_res->>'success')::boolean = true, format('sm_clock_out_shift failed: %s', v_res);
  ASSERT v_res->>'departure_track' = 'on_time', format('Expected departure_track=on_time (-5m within +-7.5m), got %s', v_res);

  SELECT * INTO v_ts FROM public.timesheets WHERE shift_id = v_shift_id;
  ASSERT v_ts.clock_out IS NOT NULL, 'Expected clock_out to be recorded';
  ASSERT v_ts.departure_track = 'on_time', format('Expected departure_track=on_time in DB, got %s', v_ts.departure_track);

  -- The live shift's billable exists (trg_sync_timesheets_on_shift_change), linked to
  -- the timesheet, and the employee's punches wrote no manager field on it.
  SELECT * INTO v_bil FROM public.billables WHERE shift_id = v_shift_id;
  ASSERT v_bil.id IS NOT NULL, 'Expected the live shift to carry a billables row';
  ASSERT v_bil.timesheet_id = v_ts.id, 'Expected billables.timesheet_id linked to timesheets.id';
  ASSERT v_bil.status = 'draft' AND v_bil.billable_start IS NULL AND v_bil.billable_end IS NULL
     AND v_bil.unpaid_break_is_manual = false,
    'Expected employee clock-out NOT to write manager fields on public.billables';

  -- 3d. Also verify early_in (-9m) and early_out (-9m) via check_in_shift / sm_clock_out_shift
  SET LOCAL session_replication_role = replica;
  DELETE FROM public.shift_events WHERE shift_id = v_shift_id AND event_time >= now();
  DELETE FROM public.billables WHERE shift_id = v_shift_id;
  DELETE FROM public.timesheets WHERE shift_id = v_shift_id;
  UPDATE public.shifts
     SET start_at = now() + interval '9 minutes',
         end_at   = now() + interval '9 minutes',
         lifecycle_status = 'Published'
   WHERE id = v_shift_id;
  SET LOCAL session_replication_role = origin;

  v_res := public.check_in_shift(v_shift_id, v_lat, v_lon);
  ASSERT v_res->>'arrival_track' = 'early_in', format('Expected early_in (-9m), got %s', v_res);

  v_res := public.sm_clock_out_shift(v_shift_id, v_emp_id, v_lat, v_lon);
  ASSERT v_res->>'departure_track' = 'early_out', format('Expected early_out (-9m), got %s', v_res);

  -- ── 4. Billables Lengths, Break Sync, Version, Edit Count & Terminal Lock ─
  SET LOCAL session_replication_role = replica;
  DELETE FROM public.shift_events WHERE shift_id = v_shift_id AND event_time >= now();
  DELETE FROM public.billables WHERE shift_id = v_shift_id;
  UPDATE public.shifts
     SET shift_date = '2020-05-04',
         start_time = '09:00:00',
         end_time   = '17:00:00',
         start_at   = '2020-05-04 09:00:00+10'::timestamptz,
         end_at     = '2020-05-04 17:00:00+10'::timestamptz,
         unpaid_break_minutes = 30,
         paid_break_minutes   = 15,
         break_start          = '13:00:00',
         break_end            = '13:30:00',
         lifecycle_status     = 'Completed'
   WHERE id = v_shift_id;
  UPDATE public.timesheets
     SET clock_in        = '2020-05-04 09:02:00+10'::timestamptz,
         clock_out       = '2020-05-04 17:03:00+10'::timestamptz,
         arrival_track   = 'on_time',
         departure_track = 'on_time'
   WHERE shift_id = v_shift_id
  RETURNING * INTO v_ts;
  SET LOCAL session_replication_role = origin;

  INSERT INTO public.billables (
    shift_id,
    employee_id,
    organization_id,
    break_start,
    break_end,
    unpaid_break_minutes,
    paid_break_minutes,
    status
  )
  VALUES (
    v_shift_id,
    v_emp_id,
    v_org_id,
    '13:00:00',
    '13:30:00',
    30,
    15,
    'submitted'
  )
  RETURNING * INTO v_bil;

  ASSERT v_bil.timesheet_id = v_ts.id, 'Expected billables.timesheet_id auto-linked to timesheets.id';
  ASSERT v_bil.unpaid_break_minutes = 30, format('Expected unpaid_break_minutes=30 copied from shift, got %s', v_bil.unpaid_break_minutes);
  ASSERT v_bil.paid_break_minutes = 15, format('Expected paid_break_minutes=15 copied from shift, got %s', v_bil.paid_break_minutes);
  ASSERT v_bil.gross_length_minutes = 480, format('Expected gross_length_minutes=480, got %s', v_bil.gross_length_minutes);
  ASSERT v_bil.net_length_minutes = 450, format('Expected net_length_minutes=450, got %s', v_bil.net_length_minutes);
  ASSERT v_bil.hours_source = 'actual', format('Expected hours_source=actual, got %s', v_bil.hours_source);
  ASSERT v_bil.version = 1 AND v_bil.edit_count = 0, 'Expected initial version=1, edit_count=0';

  -- Manager edits billable_start=09:15 and break window 12:00..12:45 (45m unpaid)
  UPDATE public.billables
     SET billable_start = '09:15:00',
         break_start    = '12:00:00',
         break_end      = '12:45:00',
         status         = 'approved'
   WHERE id = v_bil.id
  RETURNING * INTO v_bil;

  ASSERT v_bil.unpaid_break_minutes = 45, format('Expected unpaid_break_minutes=45 synced from break window, got %s', v_bil.unpaid_break_minutes);
  ASSERT v_bil.gross_length_minutes = 465, format('Expected gross_length_minutes=465 (09:15..17:00), got %s', v_bil.gross_length_minutes);
  ASSERT v_bil.net_length_minutes = 420, format('Expected net_length_minutes=420 (465 - 45), got %s', v_bil.net_length_minutes);
  ASSERT v_bil.hours_source = 'adjusted', format('Expected hours_source=adjusted, got %s', v_bil.hours_source);
  ASSERT v_bil.version = 2 AND v_bil.edit_count = 1, format('Expected version=2, edit_count=1, got v=%s e=%s', v_bil.version, v_bil.edit_count);

  -- Export to payroll -> terminal lock blocks ANY further mutation by non-service_role
  UPDATE public.billables
     SET payroll_exported = true,
         payroll_exported_at = now()
   WHERE id = v_bil.id
  RETURNING * INTO v_bil;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_emp_id, 'role', 'authenticated')::text, true);
  BEGIN
    UPDATE public.billables SET notes = 'attempted post-export edit' WHERE id = v_bil.id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%already been exported to payroll%' THEN
      v_locked_caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  ASSERT v_locked_caught, 'Expected terminal payroll-export lock exception when mutating exported billable row';

  -- ── 5. Unpublish Cleanup Trigger (fn_sync_timesheets_on_shift_change) ─────
  SET LOCAL session_replication_role = replica;
  DELETE FROM public.shift_events WHERE shift_id = v_shift_id AND event_time >= now();
  DELETE FROM public.billables WHERE shift_id = v_shift_id;
  DELETE FROM public.timesheets WHERE shift_id = v_shift_id;
  UPDATE public.shifts
     SET lifecycle_status = 'Published',
         shift_date = '2099-05-04',
         start_at   = '2099-05-04 09:00:00+10'::timestamptz,
         end_at     = '2099-05-04 17:00:00+10'::timestamptz
   WHERE id = v_shift_id;
  SET LOCAL session_replication_role = origin;

  INSERT INTO public.timesheets (shift_id, employee_id, organization_id, arrival_track, source)
  VALUES (v_shift_id, v_emp_id, v_org_id, 'missing', 'timer');
  INSERT INTO public.billables (shift_id, employee_id, organization_id, status)
  VALUES (v_shift_id, v_emp_id, v_org_id, 'draft');

  UPDATE public.shifts SET lifecycle_status = 'Draft' WHERE id = v_shift_id;

  ASSERT NOT EXISTS (SELECT 1 FROM public.timesheets WHERE shift_id = v_shift_id),
    'Expected unpunched timesheets row to be deleted when shift unpublished to Draft';
  ASSERT NOT EXISTS (SELECT 1 FROM public.billables WHERE shift_id = v_shift_id),
    'Expected draft billables row to be deleted when shift unpublished to Draft';

  RAISE EXCEPTION 'PASSED (rolled back): all 3-table separation invariants verified';
END $$;
