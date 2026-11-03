-- Regression test: Tier 4 drops (demand_source, demand_group_id, break_minutes, is_on_bidding)
DO $$
DECLARE v_cols int; v_left int; v_fns int; v_con text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE column_name IN ('demand_source','demand_group_id','break_minutes','is_on_bidding'))
    INTO v_cols, v_left FROM information_schema.columns WHERE table_schema='public' AND table_name='shifts';
  IF v_cols <> 65 THEN RAISE EXCEPTION 'expected 65 columns, found %', v_cols; END IF;
  IF v_left <> 0 THEN RAISE EXCEPTION '% dropped columns remain', v_left; END IF;

  SELECT count(*) INTO v_fns FROM pg_proc WHERE prosrc ~ '\mis_on_bidding\M';
  IF v_fns <> 0 THEN RAISE EXCEPTION '% functions still reference is_on_bidding', v_fns; END IF;

  SELECT pg_get_constraintdef(oid) INTO v_con FROM pg_constraint
   WHERE conrelid='public.shifts'::regclass AND conname='chk_bidding_requires_unassigned';
  IF v_con IS NULL OR v_con !~ 'bidding_status' THEN RAISE EXCEPTION 'bidding invariant missing: %', v_con; END IF;

  -- The invariant still bites: an assigned shift cannot be put on bidding.
  BEGIN
    UPDATE public.shifts SET bidding_status = 'on_bidding'
     WHERE id = (SELECT id FROM public.shifts WHERE assigned_employee_id IS NOT NULL LIMIT 1);
    RAISE EXCEPTION 'INVARIANT_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'TIER4_OK';
END $$;

