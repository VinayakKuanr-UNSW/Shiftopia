-- ============================================================================
-- Dead Shift Cleanup — hard-delete of permanently-unfillable shifts
--
-- "Dead" here means: assigned_employee_id IS NULL AND
--   (lifecycle_status = 'Cancelled' OR (lifecycle_status = 'Published' AND the
--    shift's scheduled window has fully elapsed)). These can never be staffed.
--
-- NOT the same concept as bulk-action-engine.ts's `deadIds` (Draft + unassigned
-- + already started, soft-deleted via sm_bulk_delete_shifts by setting
-- deleted_at). That is a disjoint, pre-existing bucket and is explicitly
-- excluded here (deleted_at IS NULL guard) — out of scope for this job.
--
-- Unlike sm_bulk_delete_shifts (soft tombstone only), this job HARD deletes —
-- it exists to reclaim storage/index bloat, not just hide rows from the UI.
-- Every delete is preceded by an archive snapshot (shift row + shift_events,
-- which would otherwise be silently destroyed by the ON DELETE CASCADE on
-- shift_events.shift_id + the two FK-less audit tables) into the existing
-- deleted_shifts.snapshot_data column, so nothing is lost, only moved.
--
-- Safety model:
--   * dead_shift_cleanup_rules.enabled = false ships as the default and is an
--     UNCONDITIONAL kill switch — even an explicit dry_run:=false call to
--     cleanup_dead_shifts_batch() degrades to a no-op dry run while disabled.
--   * A candidate is only ever selected if it is NOT referenced by any of the
--     12 guard tables below (payroll/timesheet/compliance/planning/attendance
--     history) and has sat past dead_shift_cleanup_rules.retention_hours since
--     its last update, to avoid deleting immediately after a manager action.
--   * One pg_cron tick = one bounded batch = one transaction (Postgres
--     functions cannot commit mid-call without dblink/autonomous
--     transactions, which nothing in this codebase uses). Backlog drains via
--     tick frequency, the same way process_shift_timers/sm_timesheet_queue_*
--     already do — not via an internal loop.
--
-- This migration additionally fixes a pre-existing gap in sm_delete_shift
-- (the interactive single-shift hard-delete RPC): it previously archived only
-- a flat to_jsonb(shift row) and lost shift_events to the cascade. It now
-- shares the same enveloped-snapshot helper as this cleanup job.
-- ============================================================================

-- ── Config (single global singleton row; org/dept columns reserved for a
--    future per-tenant override, not used today — YAGNI) ────────────────────
CREATE TABLE IF NOT EXISTS public.dead_shift_cleanup_rules (
    id                        uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    organization_id           uuid,
    department_id             uuid,
    enabled                   boolean DEFAULT false NOT NULL,
    dry_run                   boolean DEFAULT true  NOT NULL,
    retention_hours           integer DEFAULT 72    NOT NULL,
    batch_size                integer DEFAULT 200   NOT NULL,
    max_deletes_per_run       integer DEFAULT 5000  NOT NULL,
    max_deletes_window_hours  integer DEFAULT 24    NOT NULL,
    rules                     jsonb DEFAULT '{}'::jsonb NOT NULL,
    version                   integer DEFAULT 1 NOT NULL,
    updated_by                uuid,
    updated_at                timestamptz DEFAULT now() NOT NULL,
    created_at                timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT dead_shift_cleanup_retention_check CHECK (retention_hours >= 0),
    CONSTRAINT dead_shift_cleanup_batch_size_check CHECK (batch_size > 0 AND batch_size <= 2000),
    CONSTRAINT dead_shift_cleanup_max_deletes_check CHECK (max_deletes_per_run >= 0),
    CONSTRAINT dead_shift_cleanup_window_check CHECK (max_deletes_window_hours > 0),
    CONSTRAINT dead_shift_cleanup_rules_is_object CHECK (jsonb_typeof(rules) = 'object')
);

-- Singleton enforcement for the global row (organization_id/department_id
-- both NULL). A plain UNIQUE on nullable columns would not collide (NULL <>
-- NULL), so index a constant expression scoped to the global-row predicate.
CREATE UNIQUE INDEX IF NOT EXISTS dead_shift_cleanup_rules_global_uniq
    ON public.dead_shift_cleanup_rules ((0))
    WHERE organization_id IS NULL AND department_id IS NULL;

INSERT INTO public.dead_shift_cleanup_rules (organization_id, department_id)
VALUES (NULL, NULL)
ON CONFLICT DO NOTHING;

-- ── Observability: one row per invocation ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dead_shift_cleanup_log (
    id            uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    run_id        uuid NOT NULL,
    started_at    timestamptz NOT NULL,
    finished_at   timestamptz,
    dry_run       boolean NOT NULL,
    scanned       integer DEFAULT 0 NOT NULL,
    deleted       integer DEFAULT 0 NOT NULL,
    capped        boolean DEFAULT false NOT NULL,
    error         text,
    created_at    timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dead_shift_cleanup_log_started_at
    ON public.dead_shift_cleanup_log (started_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.dead_shift_cleanup_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dead_shift_cleanup_log   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dead_shift_cleanup_rules_admin_all ON public.dead_shift_cleanup_rules;
CREATE POLICY dead_shift_cleanup_rules_admin_all ON public.dead_shift_cleanup_rules
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS dead_shift_cleanup_log_admin_read ON public.dead_shift_cleanup_log;
CREATE POLICY dead_shift_cleanup_log_admin_read ON public.dead_shift_cleanup_log FOR SELECT
  USING (public.is_admin());

-- Rules: admins can read + tune (SELECT/UPDATE only — one seeded row, never
-- inserted/deleted by a client). Log: admin read-only, written exclusively by
-- the SECURITY DEFINER function below.
GRANT SELECT, UPDATE ON TABLE public.dead_shift_cleanup_rules TO authenticated, service_role;
GRANT SELECT          ON TABLE public.dead_shift_cleanup_log   TO authenticated;
GRANT SELECT, INSERT  ON TABLE public.dead_shift_cleanup_log   TO service_role;

-- ── Archive helper: envelope snapshot (shift + audit-adjacent rows that would
--    otherwise be lost) into the existing deleted_shifts.snapshot_data column.
--    Reused by both sm_delete_shift (interactive single delete) and
--    cleanup_dead_shifts_batch (this job). Archives only; does not delete —
--    callers issue the DELETE themselves so a batch caller can do one bulk
--    statement after archiving every candidate in the batch. ─────────────────
CREATE OR REPLACE FUNCTION public._archive_shift_before_delete(
    p_shift_id uuid,
    p_deleted_by uuid,
    p_deleted_reason text,
    p_archived_via text)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_snapshot jsonb;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_snapshot := jsonb_build_object(
    'shift', to_jsonb(v_shift),
    'shift_events', COALESCE((
      SELECT jsonb_agg(to_jsonb(se) ORDER BY se.event_time)
      FROM public.shift_events se WHERE se.shift_id = p_shift_id), '[]'::jsonb),
    'timesheet_audit_log', COALESCE((
      SELECT jsonb_agg(to_jsonb(tal) ORDER BY tal.created_at)
      FROM public.timesheet_audit_log tal WHERE tal.shift_id = p_shift_id), '[]'::jsonb),
    'timesheet_review_queue', COALESCE((
      SELECT jsonb_agg(to_jsonb(trq))
      FROM public.timesheet_review_queue trq WHERE trq.shift_id = p_shift_id), '[]'::jsonb),
    'archived_via', p_archived_via,
    'archived_at', now()
  );

  INSERT INTO public.deleted_shifts (
    id, department_id, organization_id, template_id,
    deleted_at, deleted_by, deleted_reason, snapshot_data
  ) VALUES (
    v_shift.id, v_shift.department_id, v_shift.organization_id, v_shift.template_id,
    now(), p_deleted_by, p_deleted_reason, v_snapshot
  )
  ON CONFLICT (id) DO UPDATE
    SET deleted_at = now(),
        deleted_by = EXCLUDED.deleted_by,
        deleted_reason = EXCLUDED.deleted_reason,
        snapshot_data = EXCLUDED.snapshot_data;
END;
$$;

REVOKE ALL ON FUNCTION public._archive_shift_before_delete(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._archive_shift_before_delete(uuid, uuid, text, text) TO service_role;

-- ── Extend the existing interactive hard-delete RPC to use the same envelope
--    (previously: inline flat to_jsonb(shift), losing shift_events to the
--    cascade). Signature/behavior otherwise unchanged. ──────────────────────
CREATE OR REPLACE FUNCTION public.sm_delete_shift(
    p_shift_id uuid,
    p_user_id uuid DEFAULT NULL::uuid,
    p_reason text DEFAULT NULL::text)
    RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_actor_id uuid;
BEGIN
  v_actor_id := COALESCE(p_user_id, auth.uid());

  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'shift_id', p_shift_id,
      'error', 'Shift not found',
      'code', 'SHIFT_NOT_FOUND'
    );
  END IF;

  PERFORM public._archive_shift_before_delete(p_shift_id, v_actor_id, p_reason, 'sm_delete_shift');

  DELETE FROM public.shifts WHERE id = p_shift_id;

  RETURN json_build_object(
    'success', true,
    'shift_id', p_shift_id,
    'message', 'Shift deleted successfully'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object(
    'success', false,
    'shift_id', p_shift_id,
    'error', SQLERRM,
    'code', SQLSTATE
  );
END;
$$;

-- ── Batch cleanup RPC (cron/service-role only) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_dead_shifts_batch(
    p_dry_run boolean DEFAULT NULL,
    p_batch_size integer DEFAULT NULL)
    RETURNS TABLE(
      run_id uuid,
      dry_run boolean,
      scanned integer,
      deleted integer,
      capped boolean,
      batch_started_at timestamptz,
      batch_finished_at timestamptz)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_started_at timestamptz := clock_timestamp();
  v_finished_at timestamptz;
  v_cfg public.dead_shift_cleanup_rules%ROWTYPE;
  v_effective_dry_run boolean;
  v_batch_size integer;
  v_recent_deleted bigint;
  v_budget integer;
  v_limit integer;
  v_candidate_ids uuid[];
  v_scanned integer := 0;
  v_deleted integer := 0;
  v_capped boolean := false;
  v_id uuid;
BEGIN
  SELECT * INTO v_cfg FROM public.dead_shift_cleanup_rules
   WHERE organization_id IS NULL AND department_id IS NULL
   LIMIT 1;

  IF NOT FOUND THEN
    v_finished_at := clock_timestamp();
    INSERT INTO public.dead_shift_cleanup_log
      (run_id, started_at, finished_at, dry_run, scanned, deleted, capped, error)
    VALUES (v_run_id, v_started_at, v_finished_at, true, 0, 0, false, 'dead_shift_cleanup_rules global row missing');
    RETURN QUERY SELECT v_run_id, true, 0, 0, false, v_started_at, v_finished_at;
    RETURN;
  END IF;

  -- enabled=false is an UNCONDITIONAL kill switch: it overrides even an
  -- explicit p_dry_run := false caller. Only flipping enabled=true in the
  -- config table can ever cause a real delete.
  v_effective_dry_run := COALESCE(p_dry_run, v_cfg.dry_run) OR NOT v_cfg.enabled;
  v_batch_size := LEAST(GREATEST(COALESCE(p_batch_size, v_cfg.batch_size), 1), 2000);

  SELECT COALESCE(SUM(deleted), 0) INTO v_recent_deleted
  FROM public.dead_shift_cleanup_log
  WHERE started_at >= now() - (v_cfg.max_deletes_window_hours * interval '1 hour');

  v_budget := GREATEST(v_cfg.max_deletes_per_run - v_recent_deleted, 0);
  v_limit := LEAST(v_batch_size, v_budget);

  IF v_limit <= 0 THEN
    v_capped := true;
    v_finished_at := clock_timestamp();
    INSERT INTO public.dead_shift_cleanup_log
      (run_id, started_at, finished_at, dry_run, scanned, deleted, capped)
    VALUES (v_run_id, v_started_at, v_finished_at, v_effective_dry_run, 0, 0, true);
    RETURN QUERY SELECT v_run_id, v_effective_dry_run, 0, 0, true, v_started_at, v_finished_at;
    RETURN;
  END IF;

  WITH candidates AS (
    SELECT s.id
    FROM public.shifts s
    WHERE s.assigned_employee_id IS NULL
      AND s.deleted_at IS NULL
      AND (
        s.lifecycle_status = 'Cancelled'
        OR (
          s.lifecycle_status = 'Published'
          AND (
            (s.end_at IS NOT NULL AND s.end_at <= now())
            OR (s.end_at IS NULL AND
                (s.shift_date::text || ' ' || s.end_time::text)::timestamp
                  AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney') <= now())
          )
        )
      )
      AND s.updated_at <= now() - (v_cfg.retention_hours * interval '1 hour')
      -- FK blockers (delete would error without this pre-filter)
      AND NOT EXISTS (SELECT 1 FROM public.planning_requests    pr  WHERE pr.shift_id  = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.assignment_decisions ad  WHERE ad.shift_id  = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.assignment_events    ae  WHERE ae.shift_id  = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.attendance_records   ar  WHERE ar.shift_id  = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.cancellation_history ch  WHERE ch.shift_id  = s.id)
      -- No FK at all — would silently orphan without this guard
      AND NOT EXISTS (SELECT 1 FROM public.timesheet_audit_log    tal WHERE tal.shift_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.timesheet_review_queue trq WHERE trq.shift_id = s.id)
      -- ON DELETE CASCADE — would succeed but silently destroy payroll/
      -- compliance/fatigue history with no archive
      AND NOT EXISTS (SELECT 1 FROM public.timesheets                 ts  WHERE ts.shift_id  = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.shift_payroll_records      spr WHERE spr.shift_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.shift_compliance_snapshots scs WHERE scs.shift_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.assignment_snapshots       asn WHERE asn.shift_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM public.rest_period_violations     rpv
                        WHERE rpv.first_shift_id = s.id OR rpv.second_shift_id = s.id)
    ORDER BY s.updated_at ASC
    LIMIT v_limit
    FOR UPDATE OF s SKIP LOCKED
  )
  SELECT array_agg(id) INTO v_candidate_ids FROM candidates;

  v_scanned := COALESCE(array_length(v_candidate_ids, 1), 0);

  IF NOT v_effective_dry_run AND v_scanned > 0 THEN
    FOREACH v_id IN ARRAY v_candidate_ids LOOP
      PERFORM public._archive_shift_before_delete(
        v_id, NULL, 'Dead shift cleanup: unfillable, past retention grace period',
        'cleanup_dead_shifts_batch');
    END LOOP;

    DELETE FROM public.shifts WHERE id = ANY(v_candidate_ids);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  v_finished_at := clock_timestamp();
  INSERT INTO public.dead_shift_cleanup_log
    (run_id, started_at, finished_at, dry_run, scanned, deleted, capped)
  VALUES (v_run_id, v_started_at, v_finished_at, v_effective_dry_run, v_scanned, v_deleted, false);

  RETURN QUERY SELECT v_run_id, v_effective_dry_run, v_scanned, v_deleted, false, v_started_at, v_finished_at;

EXCEPTION WHEN OTHERS THEN
  v_finished_at := clock_timestamp();
  INSERT INTO public.dead_shift_cleanup_log
    (run_id, started_at, finished_at, dry_run, scanned, deleted, capped, error)
  VALUES (v_run_id, v_started_at, v_finished_at, COALESCE(v_effective_dry_run, true), v_scanned, v_deleted, v_capped, SQLERRM);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_dead_shifts_batch(boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_dead_shifts_batch(boolean, integer) TO service_role;

-- ── Index for the eligibility scan ──────────────────────────────────────────
-- Note: CREATE INDEX (non-CONCURRENTLY) takes a brief lock; consider
-- CREATE INDEX CONCURRENTLY manually outside a transaction instead if
-- `shifts` is large at real apply-time.
CREATE INDEX IF NOT EXISTS idx_shifts_dead_cleanup_candidates
  ON public.shifts (lifecycle_status, updated_at) INCLUDE (end_at)
  WHERE assigned_employee_id IS NULL AND deleted_at IS NULL;

-- ── Cron registration (idempotent; mirrors the only other migration-tracked
--    cron.schedule precedent, nightly_leave_accrual) ────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dead_shift_cleanup') THEN
      PERFORM cron.unschedule('dead_shift_cleanup');
    END IF;
    -- Every 10 minutes: frequent enough to drain backlog via ticks (see
    -- header comment on the transaction-boundary model), inert regardless
    -- since dead_shift_cleanup_rules.enabled ships false.
    PERFORM cron.schedule('dead_shift_cleanup', '*/10 * * * *', 'SELECT public.cleanup_dead_shifts_batch()');
  END IF;
END $$;

COMMENT ON TABLE public.dead_shift_cleanup_rules IS 'Global config for the Dead Shift Cleanup cron job. enabled=false is an unconditional kill switch. Not to be confused with bulk-action-engine.ts''s unrelated Draft-origin "dead shift" concept.';
COMMENT ON TABLE public.dead_shift_cleanup_log IS 'One row per cleanup_dead_shifts_batch() invocation, written unconditionally (including error/capped/early-exit paths) since pg_cron discards SELECT return values.';
COMMENT ON FUNCTION public.cleanup_dead_shifts_batch(boolean, integer) IS 'Hard-deletes Cancelled/expired-Published unassigned shifts past their retention grace period and not referenced by payroll/timesheet/compliance/planning/attendance tables. One call = one bounded batch = one transaction; archives to deleted_shifts.snapshot_data before deleting. Gated by dead_shift_cleanup_rules.enabled (unconditional kill switch).';
COMMENT ON FUNCTION public._archive_shift_before_delete(uuid, uuid, text, text) IS 'Snapshots a shift row + its shift_events/timesheet_audit_log/timesheet_review_queue into deleted_shifts.snapshot_data before a hard delete. Does not delete — callers issue the DELETE separately.';
