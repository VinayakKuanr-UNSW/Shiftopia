-- =============================================================================
-- Test: Verify Tier 3 Track 2A drops on public.shifts
-- Columns dropped: payroll_exported, actual_net_minutes, attendance_note
-- =============================================================================

DO $$
DECLARE
    v_dropped_count integer;
    v_total_columns integer;
    v_test_shift_id uuid;
    v_spr_rec record;
BEGIN
    -- 1. Ensure the 3 columns are gone from public.shifts
    SELECT count(*)
      INTO v_dropped_count
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'shifts'
       AND column_name  IN ('payroll_exported', 'actual_net_minutes', 'attendance_note');

    ASSERT v_dropped_count = 0,
        format('Expected 0 dropped columns remaining on public.shifts, found %s', v_dropped_count);

    -- 2. Verify shifts total column count is exactly 74
    SELECT count(*)
      INTO v_total_columns
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'shifts';

    ASSERT v_total_columns = 74,
        format('Expected 74 columns on public.shifts, found %s', v_total_columns);

    -- 3. Verify trigger trg_sync_payroll_record still exists and watches actual_start, actual_end
    ASSERT EXISTS (
        SELECT 1
          FROM pg_trigger
         WHERE tgrelid = 'public.shifts'::regclass
           AND tgname = 'trg_sync_payroll_record'
    ), 'trg_sync_payroll_record trigger missing on public.shifts';

    -- 4. Verify _sync_payroll_record function computes actual_net_minutes into shift_payroll_records
    -- Create test shift and simulate clock in + clock out
    SELECT id INTO v_test_shift_id FROM public.shifts LIMIT 1;
    IF v_test_shift_id IS NOT NULL THEN
        UPDATE public.shifts
           SET actual_start = now() - interval '2 hours',
               actual_end   = now()
         WHERE id = v_test_shift_id;

        SELECT * INTO v_spr_rec
          FROM public.shift_payroll_records
         WHERE shift_id = v_test_shift_id;

        ASSERT v_spr_rec.actual_net_minutes = 120,
            format('Expected shift_payroll_records.actual_net_minutes = 120, got %s', v_spr_rec.actual_net_minutes);
    END IF;

    RAISE EXCEPTION 'TEST_PASSED_ROLLBACK';
END;
$$;

