-- Regression test for Tier 3 Track 1 drops.
-- Asserts:
--   A: The 6 dropped columns are absent from information_schema.columns for public.shifts.
--   B: idx_shifts_emergency_assigned_by and shifts_emergency_assigned_by_fkey are absent.
--   C: trg_sync_compliance_snapshot and _sync_compliance_snapshot are dropped.
--   D: Function definitions no longer reference the dropped columns.
--   E: Insights RPCs execute cleanly.

DO $$
DECLARE
  v_cols text[];
  v_res json;
  v_def text;
BEGIN
  -- A: Columns absent from shifts
  SELECT array_agg(column_name::text) INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'shifts'
    AND column_name IN (
      'is_locked', 'compliance_snapshot', 'compliance_checked_at',
      'compliance_override', 'emergency_assigned_by', 'emergency_assigned_at'
    );

  IF v_cols IS NOT NULL AND cardinality(v_cols) > 0 THEN
    RAISE EXCEPTION 'A: expected columns to be dropped, but found: %', v_cols;
  END IF;

  -- B: Constraints and indexes dropped
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shifts_emergency_assigned_by_fkey'
  ) THEN
    RAISE EXCEPTION 'B1: shifts_emergency_assigned_by_fkey still exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_shifts_emergency_assigned_by'
  ) THEN
    RAISE EXCEPTION 'B2: idx_shifts_emergency_assigned_by still exists';
  END IF;

  -- C: Trigger and function dropped
  IF EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_compliance_snapshot'
  ) THEN
    RAISE EXCEPTION 'C1: trg_sync_compliance_snapshot still exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = '_sync_compliance_snapshot'
  ) THEN
    RAISE EXCEPTION 'C2: _sync_compliance_snapshot still exists';
  END IF;

  -- D: Functions do not reference dropped columns on shifts
  v_def := pg_get_functiondef('public._apply_shift_op_write'::regproc);
  IF v_def ~* '\yemergency_assigned_by\y' OR v_def ~* '\yemergency_assigned_at\y' THEN
    RAISE EXCEPTION 'D1: _apply_shift_op_write still references emergency columns';
  END IF;

  v_def := pg_get_functiondef('public.delete_user_entirely'::regproc);
  IF v_def ~* '\yemergency_assigned_by\y' THEN
    RAISE EXCEPTION 'D2: delete_user_entirely still references emergency_assigned_by';
  END IF;

  v_def := pg_get_functiondef('public.sm_emergency_assign'::regproc);
  IF v_def ~* '\yemergency_assigned_at\y' OR v_def ~* '\ycompliance_checked_at\y' THEN
    RAISE EXCEPTION 'D3: sm_emergency_assign still references dropped columns';
  END IF;

  -- E: Insights RPCs execute cleanly
  v_res := public.get_insights_summary(CURRENT_DATE - 30, CURRENT_DATE + 30);
  IF v_res IS NULL THEN
    RAISE EXCEPTION 'E1: get_insights_summary returned NULL';
  END IF;

  PERFORM * FROM public.get_dept_insights_breakdown(CURRENT_DATE - 30, CURRENT_DATE + 30);

  RAISE EXCEPTION 'PASSED (rolled back): A B C D E';
END $$;

