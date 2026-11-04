-- =============================================================================
-- A live shift (assigned, not Draft, not cancelled) carries exactly one linked
-- public.timesheets + public.billables pair, created by
-- trg_sync_timesheets_on_shift_change. Before 20261103214618 nothing in the
-- database created a billable.
--
-- Runs live against PostgreSQL and rolls back cleanly at the end via RAISE.
-- =============================================================================

DO $$
DECLARE
  v_src     public.shifts%ROWTYPE;
  v_new_id  uuid;
  v_ts      record;
  v_bil     record;
BEGIN
  -- A real future assigned shift: its roster, contract and times already pass
  -- the placement / overlap / shape guards. Remove it (triggers off) and
  -- re-INSERT an identical copy as live (triggers on).
  SELECT s.* INTO v_src
    FROM public.shifts s
   WHERE s.assigned_employee_id IS NOT NULL
     AND s.shift_date > (now() AT TIME ZONE 'Australia/Sydney')::date
     AND NOT s.is_cancelled
   ORDER BY s.shift_date, s.id
   LIMIT 1;
  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'SKIPPED: need at least 1 future assigned shift';
  END IF;

  SET LOCAL session_replication_role = replica;
  DELETE FROM public.shifts WHERE id = v_src.id;
  SET LOCAL session_replication_role = origin;

  -- ── 1. INSERT born live -> pair created and linked ───────────────────────
  INSERT INTO public.shifts (
    roster_id, roster_subgroup_id, organization_id, department_id, sub_department_id, role_id,
    shift_date, start_time, end_time, paid_break_minutes, unpaid_break_minutes, unpaid_breaks,
    break_start, break_end, assigned_employee_id, user_contract_id,
    target_employment_type, target_requires_flexible,
    lifecycle_status, assignment_status, assignment_outcome, is_cancelled
  ) VALUES (
    v_src.roster_id, v_src.roster_subgroup_id, v_src.organization_id, v_src.department_id, v_src.sub_department_id, v_src.role_id,
    v_src.shift_date, v_src.start_time, v_src.end_time, v_src.paid_break_minutes, v_src.unpaid_break_minutes, v_src.unpaid_breaks,
    v_src.break_start, v_src.break_end, v_src.assigned_employee_id, v_src.user_contract_id,
    v_src.target_employment_type, v_src.target_requires_flexible,
    'Published', 'assigned', 'confirmed', false
  )
  RETURNING id INTO v_new_id;

  SELECT * INTO v_ts  FROM public.timesheets WHERE shift_id = v_new_id;
  SELECT * INTO v_bil FROM public.billables  WHERE shift_id = v_new_id;
  ASSERT v_ts.id IS NOT NULL, 'Expected a timesheets row for a shift inserted live';
  ASSERT v_ts.employee_id = v_src.assigned_employee_id AND v_ts.clock_in IS NULL AND v_ts.source = 'roster',
    format('Expected an unpunched roster timesheet for the assignee, got %s', row_to_json(v_ts));
  ASSERT v_bil.id IS NOT NULL, 'Expected a billables row for a shift inserted live';
  ASSERT v_bil.timesheet_id = v_ts.id, 'Expected billables.timesheet_id linked to timesheets.id';
  ASSERT v_bil.status = 'draft' AND v_bil.employee_id = v_src.assigned_employee_id,
    format('Expected a draft billable for the assignee, got %s', row_to_json(v_bil));
  ASSERT v_bil.unpaid_break_minutes IS NULL AND v_bil.unpaid_break_is_manual = false,
    format('Zero-fallback: unpaid break must NOT be seeded from the schedule, got %s', v_bil.unpaid_break_minutes);
  ASSERT v_bil.paid_break_minutes = COALESCE(v_src.paid_break_minutes, 0),
    format('Expected paid_break_minutes seeded from shift (%s), got %s', v_src.paid_break_minutes, v_bil.paid_break_minutes);
  ASSERT v_bil.net_length_minutes IS NULL, 'Expected no length on a billable before the shift has happened';

  -- ── 2. Roster edit to paid break follows while the billable still mirrors it
  UPDATE public.shifts SET paid_break_minutes = COALESCE(v_src.paid_break_minutes, 0) + 15 WHERE id = v_new_id;
  SELECT * INTO v_bil FROM public.billables WHERE shift_id = v_new_id;
  ASSERT v_bil.paid_break_minutes = COALESCE(v_src.paid_break_minutes, 0) + 15,
    format('Expected paid break to follow the roster edit, got %s', v_bil.paid_break_minutes);

  UPDATE public.billables SET paid_break_minutes = 60 WHERE id = v_bil.id; -- manager override
  UPDATE public.shifts SET paid_break_minutes = COALESCE(v_src.paid_break_minutes, 0) WHERE id = v_new_id;
  SELECT * INTO v_bil FROM public.billables WHERE shift_id = v_new_id;
  ASSERT v_bil.paid_break_minutes = 60, format('Expected a manager-set paid break to survive a roster edit, got %s', v_bil.paid_break_minutes);

  -- ── 3. Not live -> untouched pair removed; live again -> pair recreated ───
  UPDATE public.shifts SET lifecycle_status = 'Draft' WHERE id = v_new_id;
  ASSERT NOT EXISTS (SELECT 1 FROM public.timesheets WHERE shift_id = v_new_id), 'Expected timesheet removed on Draft';
  ASSERT NOT EXISTS (SELECT 1 FROM public.billables  WHERE shift_id = v_new_id), 'Expected billable removed on Draft';

  UPDATE public.shifts SET lifecycle_status = 'Published' WHERE id = v_new_id;
  SELECT * INTO v_ts  FROM public.timesheets WHERE shift_id = v_new_id;
  SELECT * INTO v_bil FROM public.billables  WHERE shift_id = v_new_id;
  ASSERT v_ts.id IS NOT NULL AND v_bil.timesheet_id = v_ts.id, 'Expected the pair recreated and linked when the shift is live again';

  -- ── 4. A manager-edited billable survives cleanup and is relinked ─────────
  -- Fixture only: the review gate rightly refuses billable times on a shift that has not happened yet.
  SET LOCAL session_replication_role = replica;
  UPDATE public.billables SET billable_start = '09:15:00' WHERE id = v_bil.id;
  SET LOCAL session_replication_role = origin;
  UPDATE public.shifts SET lifecycle_status = 'Draft' WHERE id = v_new_id;
  SELECT * INTO v_bil FROM public.billables WHERE shift_id = v_new_id;
  ASSERT v_bil.id IS NOT NULL AND v_bil.timesheet_id IS NULL, 'Expected the edited billable kept, its timesheet link cleared';

  UPDATE public.shifts SET lifecycle_status = 'Published' WHERE id = v_new_id;
  SELECT * INTO v_ts  FROM public.timesheets WHERE shift_id = v_new_id;
  SELECT * INTO v_bil FROM public.billables  WHERE shift_id = v_new_id;
  ASSERT v_bil.timesheet_id = v_ts.id, 'Expected the surviving billable relinked to the new timesheet';
  ASSERT v_bil.billable_start = '09:15:00', 'Expected the manager edit preserved across relink';

  RAISE EXCEPTION 'PASSED (rolled back): live shift carries a linked timesheet + billable';
END $$;
