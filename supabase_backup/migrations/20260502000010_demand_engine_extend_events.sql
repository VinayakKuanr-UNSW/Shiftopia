-- Demand Engine Phase 1 (D): extend venueops_events with L1 feature columns.
-- These feed the Event Feature Layer of the 9-layer demand engine.
-- All columns nullable so existing rows remain valid; backfill happens via
-- the VenueOps sync or admin UI.

ALTER TABLE public.venueops_events
    ADD COLUMN IF NOT EXISTS service_type      text,
    ADD COLUMN IF NOT EXISTS alcohol           boolean,
    ADD COLUMN IF NOT EXISTS bump_in_min       integer,
    ADD COLUMN IF NOT EXISTS bump_out_min      integer,
    ADD COLUMN IF NOT EXISTS layout_complexity text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'venueops_events_service_type_chk'
    ) THEN
        ALTER TABLE public.venueops_events
            ADD CONSTRAINT venueops_events_service_type_chk
            CHECK (service_type IS NULL OR service_type IN ('buffet','plated','cocktail','none'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'venueops_events_layout_complexity_chk'
    ) THEN
        ALTER TABLE public.venueops_events
            ADD CONSTRAINT venueops_events_layout_complexity_chk
            CHECK (layout_complexity IS NULL OR layout_complexity IN ('simple','standard','complex'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'venueops_events_bump_in_min_chk'
    ) THEN
        ALTER TABLE public.venueops_events
            ADD CONSTRAINT venueops_events_bump_in_min_chk
            CHECK (bump_in_min IS NULL OR bump_in_min >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'venueops_events_bump_out_min_chk'
    ) THEN
        ALTER TABLE public.venueops_events
            ADD CONSTRAINT venueops_events_bump_out_min_chk
            CHECK (bump_out_min IS NULL OR bump_out_min >= 0);
    END IF;
END $$;

COMMENT ON COLUMN public.venueops_events.service_type IS
    'F&B service style for the event: buffet | plated | cocktail | none. Drives L3 baseline rules.';
COMMENT ON COLUMN public.venueops_events.alcohol IS
    'True if alcohol is served. Drives security and bar staffing rules.';
COMMENT ON COLUMN public.venueops_events.bump_in_min IS
    'Setup minutes before start_date_time. Adds pre-event slices to L2 segmentation.';
COMMENT ON COLUMN public.venueops_events.bump_out_min IS
    'Pack-down minutes after end_date_time. Adds post-event slices to L2 segmentation.';
COMMENT ON COLUMN public.venueops_events.layout_complexity IS
    'Setup complexity: simple | standard | complex. Drives Logistics rules.';
