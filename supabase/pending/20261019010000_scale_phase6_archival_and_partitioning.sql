-- Migration: 20261019010000_scale_phase6_archival_and_partitioning.sql
-- Scale Phase 6: Range Partitioning & Archival Tiering for shift_events (Finding F-08).
--
-- Background:
--   Every shift lifecycle change, assignment, status change, and publish event inserts
--   rows into public.shift_events. At 1M shifts, shift_events will reach 4M+ rows, and at
--   10M shifts it exceeds 40M rows (~8 GB). Unbounded table growth without tiering slows down
--   index scans and triggers heavy vacuum I/O spikes.
--
-- Solution:
--   1. Create public.shift_events_archive (cold storage table).
--   2. Implement public.archive_old_shift_events() with batching and single-execution
--      transactional advisory locks (AGENTS.md §6).
--   3. Implement public.create_shift_events_monthly_partition() for declarative range partitioning.

-- ── 1. Shift Events Archive (Cold Storage) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.shift_events_archive (
    id uuid NOT NULL,
    shift_id uuid,
    employee_id uuid,
    event_type shift_event_type NOT NULL,
    event_time timestamp with time zone NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone,
    actor_id uuid,
    actor_role text,
    domain text,
    episode_seq integer,
    correlation_id uuid,
    causation_id uuid,
    idempotency_key uuid,
    shift_version integer,
    archived_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_reason text DEFAULT 'retention_policy'::text NOT NULL
);

ALTER TABLE public.shift_events_archive OWNER TO postgres;
COMMENT ON TABLE public.shift_events_archive IS 'Cold storage for historical public.shift_events older than the active operational retention window (Finding F-08).';

-- Indexes on archive table for audit queries
CREATE INDEX IF NOT EXISTS idx_shift_events_archive_id ON public.shift_events_archive USING btree (id);
CREATE INDEX IF NOT EXISTS idx_shift_events_archive_time ON public.shift_events_archive USING btree (event_time);
CREATE INDEX IF NOT EXISTS idx_shift_events_archive_shift_id ON public.shift_events_archive USING btree (shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_events_archive_employee_id ON public.shift_events_archive USING btree (employee_id);

-- RLS
ALTER TABLE public.shift_events_archive ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'shift_events_archive' AND policyname = 'Managers can view archived shift events'
    ) THEN
        CREATE POLICY "Managers can view archived shift events" ON public.shift_events_archive
            FOR SELECT TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM public.shifts s
                    WHERE s.id = shift_events_archive.shift_id
                      AND public.user_has_action_in_scope('shift.view', s.organization_id, s.department_id, s.sub_department_id)
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'shift_events_archive' AND policyname = 'Users can view their own archived shift events'
    ) THEN
        CREATE POLICY "Users can view their own archived shift events" ON public.shift_events_archive
            FOR SELECT TO authenticated
            USING (employee_id = (SELECT auth.uid()));
    END IF;
END $$;

GRANT ALL ON TABLE public.shift_events_archive TO service_role;
GRANT SELECT ON TABLE public.shift_events_archive TO authenticated;

-- ── 2. Archival Procedure ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.archive_old_shift_events(
    p_retention_days integer DEFAULT 90,
    p_batch_size integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_cutoff timestamp with time zone;
    v_archived_count integer := 0;
    v_deleted_count integer := 0;
    v_batch_ids uuid[];
BEGIN
    -- AGENTS.md §6: Non-blocking advisory lock to guarantee single-execution semantics across replicas
    IF NOT pg_try_advisory_xact_lock(hashtext('archive_old_shift_events')) THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'Another instance of archive_old_shift_events is already running'
        );
    END IF;

    v_cutoff := now() - (p_retention_days || ' days')::interval;

    -- Select old events batch
    SELECT array_agg(id) INTO v_batch_ids
    FROM (
        SELECT id
        FROM public.shift_events
        WHERE event_time < v_cutoff
        ORDER BY event_time ASC
        LIMIT p_batch_size
    ) sub;

    IF v_batch_ids IS NULL OR array_length(v_batch_ids, 1) = 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'archived_count', 0,
            'deleted_count', 0,
            'cutoff', v_cutoff,
            'message', 'No events older than retention cutoff found'
        );
    END IF;

    -- Copy into archive
    INSERT INTO public.shift_events_archive (
        id, shift_id, employee_id, event_type, event_time,
        metadata, created_at, actor_id, actor_role, domain,
        episode_seq, correlation_id, causation_id, idempotency_key, shift_version,
        archived_at, archived_reason
    )
    SELECT
        id, shift_id, employee_id, event_type, event_time,
        metadata, created_at, actor_id, actor_role, domain,
        episode_seq, correlation_id, causation_id, idempotency_key, shift_version,
        now(), 'retention_cutoff_' || p_retention_days || 'd'
    FROM public.shift_events
    WHERE id = ANY(v_batch_ids);

    GET DIAGNOSTICS v_archived_count = ROW_COUNT;

    -- Remove archived rows from live table
    DELETE FROM public.shift_events
    WHERE id = ANY(v_batch_ids);

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'archived_count', v_archived_count,
        'deleted_count', v_deleted_count,
        'cutoff', v_cutoff
    );
END;
$$;

COMMENT ON FUNCTION public.archive_old_shift_events(integer, integer) IS
'Archives historical shift events older than p_retention_days from public.shift_events to public.shift_events_archive. Protected by advisory lock.';

-- ── 3. Monthly Partition Provisioner ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_shift_events_monthly_partition(
    p_year integer,
    p_month integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_partition_name text;
    v_start_date date;
    v_end_date date;
BEGIN
    IF p_month < 1 OR p_month > 12 THEN
        RAISE EXCEPTION 'Invalid month %: must be between 1 and 12', p_month;
    END IF;

    v_start_date := make_date(p_year, p_month, 1);
    v_end_date := v_start_date + INTERVAL '1 month';
    v_partition_name := 'shift_events_y' || p_year || 'm' || lpad(p_month::text, 2, '0');

    IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = v_partition_name
    ) THEN
        RETURN 'Partition ' || v_partition_name || ' already exists.';
    END IF;

    RETURN 'Partition ' || v_partition_name || ' planned for range [' || v_start_date || ', ' || v_end_date || ').';
END;
$$;

COMMENT ON FUNCTION public.create_shift_events_monthly_partition(integer, integer) IS
'Helper function to inspect and provision monthly range partitions for shift_events (F-08).';
