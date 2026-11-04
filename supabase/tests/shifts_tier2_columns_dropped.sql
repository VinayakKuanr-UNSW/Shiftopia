-- Regression test for Tier 2 cleanup: dropping template_group, template_sub_group, and eligibility_snapshot.
-- Asserts:
--   A: The 3 dropped columns are absent from information_schema.columns.
--   B: Neither apply_template_to_date_range_v2 nor sm_create_shift nor _sync_compliance_snapshot reference the dropped columns.
--   C: trg_sync_compliance_snapshot does not listen to eligibility_snapshot.
--   D: sm_create_shift executes successfully.

DO $$
DECLARE
  v_cols text[];
  v_def text;
  v_trig text;
  v_future_date date := CURRENT_DATE + 30;
  v_shift record;
  v_roster_id uuid;
  v_new_id uuid;
  v_payload jsonb;
BEGIN
  -- A: Columns absent from shifts
  SELECT array_agg(column_name::text) INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'shifts'
    AND column_name IN ('template_group', 'template_sub_group', 'eligibility_snapshot');

  IF v_cols IS NOT NULL AND cardinality(v_cols) > 0 THEN
    RAISE EXCEPTION 'A: expected columns to be dropped, but found: %', v_cols;
  END IF;

  -- B: Function definitions do not reference the dropped columns
  v_def := pg_get_functiondef('public.apply_template_to_date_range_v2'::regproc);
  IF v_def ~* '\ytemplate_group\y' OR v_def ~* '\ytemplate_sub_group\y' THEN
    RAISE EXCEPTION 'B1: apply_template_to_date_range_v2 still references template_group or template_sub_group';
  END IF;

  v_def := pg_get_functiondef('public.sm_create_shift'::regproc);
  IF v_def ~* '\ytemplate_group\y' OR v_def ~* '\ytemplate_sub_group\y' THEN
    RAISE EXCEPTION 'B2: sm_create_shift still references template_group or template_sub_group';
  END IF;

  v_def := pg_get_functiondef('public._sync_compliance_snapshot'::regproc);
  IF v_def ~* '\yeligibility_snapshot\y' THEN
    RAISE EXCEPTION 'B3: _sync_compliance_snapshot still references eligibility_snapshot';
  END IF;

  -- C: Trigger definition does not reference eligibility_snapshot
  SELECT pg_get_triggerdef(oid) INTO v_trig
  FROM pg_trigger
  WHERE tgname = 'trg_sync_compliance_snapshot'
    AND tgrelid = 'public.shifts'::regclass;

  IF v_trig ~* '\yeligibility_snapshot\y' THEN
    RAISE EXCEPTION 'C: trg_sync_compliance_snapshot still references eligibility_snapshot: %', v_trig;
  END IF;

  -- D: Runtime shift creation works
  SELECT * INTO v_shift FROM public.shifts LIMIT 1;
  IF FOUND THEN
    INSERT INTO public.rosters (
      start_date, end_date, organization_id, department_id, sub_department_id, status
    ) VALUES (
      v_future_date, v_future_date, v_shift.organization_id, v_shift.department_id, v_shift.sub_department_id, 'draft'
    ) RETURNING id INTO v_roster_id;

    v_payload := jsonb_build_object(
      'roster_id', v_roster_id,
      'department_id', v_shift.department_id,
      'sub_department_id', v_shift.sub_department_id,
      'role_id', v_shift.role_id,
      'shift_date', v_future_date,
      'start_time', '09:00:00',
      'end_time', '13:00:00',
      'paid_break_minutes', 15,
      'unpaid_break_minutes', 0,
      'organization_id', v_shift.organization_id,
      'group_type', v_shift.group_type,
      'sub_group_name', v_shift.sub_group_name,
      'target_employment_type', 'Casual'
    );

    PERFORM set_config('role', 'service_role', true);
    v_new_id := public.sm_create_shift(v_payload, NULL);
    IF v_new_id IS NULL THEN
      RAISE EXCEPTION 'D: sm_create_shift returned NULL';
    END IF;

    UPDATE public.shifts SET compliance_snapshot = '{"valid": true}'::jsonb WHERE id = v_new_id;
  END IF;

  RAISE EXCEPTION 'PASSED (rolled back): A B C D';
END $$;

