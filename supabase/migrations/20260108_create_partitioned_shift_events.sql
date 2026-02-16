-- =============================================================================
-- Shift Audit Events - Partitioned Table with Monthly Partition Management
-- =============================================================================
-- Purpose: High-volume audit table partitioned by occurred_at for performance
-- Partitions: Monthly, auto-created for current + 2 months ahead
-- =============================================================================

-- ============================================================
-- 1. CREATE DEDICATED AUDIT ENUMs
-- ============================================================

DO $$
BEGIN
  -- shift_event_type: Types of audit events
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_event_type') THEN
    CREATE TYPE shift_event_type AS ENUM (
      'shift_created',
      'shift_updated',
      'shift_deleted',
      'shift_published',
      'shift_unpublished',
      'shift_cancelled',
      'employee_assigned',
      'employee_unassigned',
      'pushed_to_bidding',
      'removed_from_bidding',
      'bid_submitted',
      'bid_accepted',
      'bid_rejected',
      'bid_withdrawn',
      'swap_requested',
      'swap_approved',
      'swap_rejected',
      'checked_in',
      'checked_out',
      'no_show',
      'lifecycle_changed'
    );
  END IF;

  -- actor_type: Who performed the action
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'actor_type') THEN
    CREATE TYPE actor_type AS ENUM (
      'user',
      'system',
      'cron',
      'api'
    );
  END IF;

  -- event_source: Where the action originated
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_source') THEN
    CREATE TYPE event_source AS ENUM (
      'web_app',
      'mobile_app',
      'api',
      'trigger',
      'cron_job',
      'edge_function',
      'manual'
    );
  END IF;
END
$$;

-- ============================================================
-- 2. CREATE PARTITIONED SHIFT_EVENTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS shift_events (
  event_id UUID NOT NULL DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL,
  
  event_type shift_event_type NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  actor_type actor_type NOT NULL,
  actor_id UUID NULL,
  actor_role TEXT NULL,
  
  source event_source NOT NULL,
  reason TEXT NULL,
  correlation_id UUID NULL,
  
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  before_state JSONB NULL,
  after_state JSONB NULL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  PRIMARY KEY (event_id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- ============================================================
-- 3. CREATE INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_shift_events_shift_id 
  ON shift_events(shift_id);

CREATE INDEX IF NOT EXISTS idx_shift_events_occurred_at 
  ON shift_events(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_shift_events_event_type 
  ON shift_events(event_type);

CREATE INDEX IF NOT EXISTS idx_shift_events_correlation_id 
  ON shift_events(correlation_id) 
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shift_events_actor_id 
  ON shift_events(actor_id) 
  WHERE actor_id IS NOT NULL;

-- ============================================================
-- 4. ENABLE RLS
-- ============================================================

ALTER TABLE shift_events ENABLE ROW LEVEL SECURITY;

-- Authenticated users can view audit events
DROP POLICY IF EXISTS "Authenticated users can view shift events" ON shift_events;
CREATE POLICY "Authenticated users can view shift events"
  ON shift_events FOR SELECT
  TO authenticated
  USING (true);

-- System can insert audit events
DROP POLICY IF EXISTS "System can insert shift events" ON shift_events;
CREATE POLICY "System can insert shift events"
  ON shift_events FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================
-- 5. CREATE PARTITION MANAGEMENT FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION ensure_shift_events_partitions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_date DATE;
  partition_name TEXT;
  partition_start TIMESTAMPTZ;
  partition_end TIMESTAMPTZ;
  i INT;
BEGIN
  -- Create partitions for current month + next 2 months
  FOR i IN 0..2 LOOP
    -- Calculate target month in UTC
    target_date := (date_trunc('month', now() AT TIME ZONE 'UTC') + (i || ' months')::interval)::date;
    
    -- Generate partition name: shift_events_YYYY_MM
    partition_name := 'shift_events_' || to_char(target_date, 'YYYY_MM');
    
    -- Calculate partition boundaries
    partition_start := date_trunc('month', target_date AT TIME ZONE 'UTC');
    partition_end := partition_start + interval '1 month';
    
    -- Create partition if not exists (idempotent via IF NOT EXISTS)
    BEGIN
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF shift_events
         FOR VALUES FROM (%L) TO (%L)',
        partition_name, partition_start, partition_end
      );
      RAISE NOTICE 'Partition % ensured (% to %)', partition_name, partition_start, partition_end;
    EXCEPTION WHEN OTHERS THEN
      -- Log error but don't fail - allow retry on next scheduled run
      RAISE WARNING 'Failed to create partition %: %', partition_name, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- ============================================================
-- 6. CREATE INITIAL PARTITIONS
-- ============================================================

-- Create partitions for Jan, Feb, Mar 2026 (based on current date 2026-01-08)
SELECT ensure_shift_events_partitions();

-- ============================================================
-- 7. SCHEDULE VIA PG_CRON (if available)
-- ============================================================

-- Note: This requires pg_cron extension (Supabase Pro+)
-- If pg_cron is not available, use external cron to call edge function

DO $$
BEGIN
  -- Check if pg_cron extension exists
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Schedule daily at 03:00 UTC
    PERFORM cron.schedule(
      'ensure-shift-partitions',
      '0 3 * * *',
      $$SELECT ensure_shift_events_partitions()$$
    );
    RAISE NOTICE 'pg_cron job scheduled: ensure-shift-partitions at 03:00 UTC daily';
  ELSE
    RAISE NOTICE 'pg_cron not available - use external cron to trigger edge function';
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- pg_cron may not be enabled, that's okay
  RAISE NOTICE 'pg_cron scheduling skipped: %', SQLERRM;
END;
$$;

-- ============================================================
-- 8. COMMENTS
-- ============================================================

COMMENT ON TABLE shift_events IS 
  'High-volume audit trail for shift lifecycle events. Partitioned monthly by occurred_at.';

COMMENT ON FUNCTION ensure_shift_events_partitions() IS 
  'Creates monthly partitions for current + 2 months. Idempotent, safe for concurrent execution. Run daily.';
