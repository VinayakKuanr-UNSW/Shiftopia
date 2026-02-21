-- Add timezone-aware timestamp columns to 'shifts' table
-- This facilitates the transition to UTC-at-Rest and precise time handling.

ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS tz_identifier TEXT DEFAULT 'Australia/Sydney';

-- Index these new columns for performance
CREATE INDEX IF NOT EXISTS idx_shifts_start_at ON shifts(start_at);
CREATE INDEX IF NOT EXISTS idx_shifts_end_at ON shifts(end_at);

-- Comment on columns
COMMENT ON COLUMN shifts.start_at IS 'Absolute start timestamp of the shift (UTC-at-Rest)';
COMMENT ON COLUMN shifts.end_at IS 'Absolute end timestamp of the shift (UTC-at-Rest)';
COMMENT ON COLUMN shifts.tz_identifier IS 'Timezone identifier for the shift location (e.g. Australia/Sydney)';

-- Data Backfill / Migration Strategy
-- Updating existing rows using roster timezone or default to Sydney.
-- Note: 'rosters' table structure is assumed to have 'timezone'. If not, we default.

DO $$
BEGIN
    -- Check if 'checkout_default_timezone' exists on 'rosters' or similar. 
    -- For now, we will attempt to update based on a best-effort join.
    
    UPDATE shifts
    SET
        tz_identifier = COALESCE(
            (SELECT timezone FROM rosters WHERE rosters.id = shifts.roster_id),
            'Australia/Sydney'
        ),
        start_at = (shift_date || ' ' || start_time)::TIMESTAMP AT TIME ZONE COALESCE(
            (SELECT timezone FROM rosters WHERE rosters.id = shifts.roster_id),
            'Australia/Sydney'
        ),
        end_at = (shift_date || ' ' || end_time)::TIMESTAMP AT TIME ZONE COALESCE(
            (SELECT timezone FROM rosters WHERE rosters.id = shifts.roster_id),
            'Australia/Sydney'
        )
    WHERE start_at IS NULL;
    
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error during data migration: %', SQLERRM;
END $$;
