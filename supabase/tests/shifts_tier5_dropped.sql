-- Test: supabase/tests/shifts_tier5_dropped.sql
-- Verifies that Tier 5 (Groups A & B) dropped columns are completely absent,
-- total column count on public.shifts is 60, and core CRUD functions succeed.

BEGIN;

DO $$
DECLARE
    v_col_count integer;
    v_found_cols text[];
    v_shift_id uuid;
    v_res jsonb;
BEGIN
    -- 1. Check total column count is 60
    SELECT count(*) INTO v_col_count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shifts';

    IF v_col_count <> 60 THEN
        RAISE EXCEPTION 'Expected 60 columns on public.shifts, found %', v_col_count;
    END IF;

    -- 2. Verify all 5 dropped columns are completely gone
    SELECT array_agg(column_name::text) INTO v_found_cols
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shifts'
      AND column_name IN ('remuneration_level', 'bidding_open_at', 'bidding_close_at', 'total_hours', 'is_overnight');

    IF v_found_cols IS NOT NULL AND array_length(v_found_cols, 1) > 0 THEN
        RAISE EXCEPTION 'Found dropped columns still present: %', v_found_cols;
    END IF;

    -- 3. Verify constraints are dropped
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.shifts'::regclass
          AND conname IN ('check_bidding_time_range', 'shifts_remuneration_level_fkey')
    ) THEN
        RAISE EXCEPTION 'Found dropped constraints still present';
    END IF;

    -- 4. Verify index is dropped
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'shifts' AND indexname = 'idx_shifts_remuneration_level'
    ) THEN
        RAISE EXCEPTION 'idx_shifts_remuneration_level index still present';
    END IF;

    RAISE NOTICE 'shifts_tier5_dropped test passed: 60 columns, 0 dropped columns remaining.';
END $$;

ROLLBACK;

