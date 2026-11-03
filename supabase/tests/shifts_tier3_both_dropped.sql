-- =============================================================================
-- Regression Test: Tier 3 - State Booleans, Timezone & Subgroup Drops
-- =============================================================================

DO $$
DECLARE
    v_total_cols integer;
    v_dropped_found integer;
    v_has_placement_trg boolean;
    v_has_ft_trg boolean;
    v_test_shift_id uuid;
    v_sample_shift record;
BEGIN
    -- 1. Assert column count
    SELECT count(*),
           count(*) FILTER (WHERE column_name IN ('is_draft', 'is_published', 'tz_identifier', 'group_type', 'sub_group_name'))
      INTO v_total_cols, v_dropped_found
      FROM information_schema.columns
     WHERE table_name = 'shifts';

    IF v_total_cols <> 69 THEN
        RAISE EXCEPTION 'Expected exactly 69 columns on public.shifts, found %', v_total_cols;
    END IF;

    IF v_dropped_found <> 0 THEN
        RAISE EXCEPTION 'Found % dropped columns still present on public.shifts', v_dropped_found;
    END IF;

    -- 2. Assert triggers exist
    SELECT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_shift_placement'
          AND tgrelid = 'public.shifts'::regclass
          AND NOT tgisinternal
    ) INTO v_has_placement_trg;

    IF NOT v_has_placement_trg THEN
        RAISE EXCEPTION 'Trigger trg_shift_placement missing on public.shifts';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_shift_z_office_is_ft_only'
          AND tgrelid = 'public.shifts'::regclass
          AND NOT tgisinternal
    ) INTO v_has_ft_trg;

    IF NOT v_has_ft_trg THEN
        RAISE EXCEPTION 'Trigger trg_shift_z_office_is_ft_only missing on public.shifts';
    END IF;

    -- 3. Assert a sample row can be read and updated without referencing dropped columns
    SELECT * INTO v_sample_shift FROM public.shifts LIMIT 1;
    IF FOUND THEN
        -- Test update through sm_apply_shift_op or touch
        UPDATE public.shifts
           SET notes = COALESCE(notes, '')
         WHERE id = v_sample_shift.id;
    END IF;

    -- 4. Assert get_roster_summary works
    PERFORM * FROM public.get_roster_summary(
        (SELECT organization_id FROM public.shifts LIMIT 1),
        '2026-01-01'::date,
        '2026-12-31'::date
    );

    RAISE NOTICE 'SUCCESS: Tier 3 drops verified - 69 columns, triggers intact, queries functional.';
END;
$$;

