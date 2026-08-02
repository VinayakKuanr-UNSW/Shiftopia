-- ============================================================================
-- Dead Shift Cleanup — fix two bugs found while verifying
-- 20260729020000_dead_shift_cleanup.sql against real prod data:
--
-- 1. `SUM(deleted)` in the rolling-window budget query was unqualified.
--    `deleted` is also a cleanup_dead_shifts_batch() RETURNS TABLE column,
--    which PL/pgSQL exposes as an implicit variable throughout the function
--    body — it collided with dead_shift_cleanup_log.deleted, so EVERY
--    invocation errored with "column reference \"deleted\" is ambiguous".
--    Confirmed via cron.job_run_details: the 11:30 UTC tick already failed
--    with exactly this error.
--
-- 2. The EXCEPTION handler inserted a row into dead_shift_cleanup_log and
--    then RAISE'd again — but re-raising aborts the whole transaction,
--    which rolls back that log insert too. The "durable trail even on
--    error" the design promised never actually persisted. Fixed by
--    RAISE WARNING (does not abort the transaction, still surfaces in
--    cron.job_run_details) instead of re-raising, then returning a row
--    normally so the log insert commits.
-- ============================================================================

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

  -- FIX 1: qualify `deleted` — it collides with this function's own
  -- RETURNS TABLE column of the same name.
  SELECT COALESCE(SUM(dead_shift_cleanup_log.deleted), 0) INTO v_recent_deleted
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
  -- FIX 2: RAISE WARNING instead of re-raising — RAISE re-aborts this same
  -- transaction, which would roll back the log insert directly above,
  -- defeating the "durable trail even on error" design goal. A WARNING
  -- still surfaces in cron.job_run_details without aborting.
  RAISE WARNING 'cleanup_dead_shifts_batch failed (run_id=%): %', v_run_id, SQLERRM;
  RETURN QUERY SELECT v_run_id, COALESCE(v_effective_dry_run, true), v_scanned, v_deleted, v_capped, v_started_at, v_finished_at;
END;
$$;

COMMENT ON FUNCTION public.cleanup_dead_shifts_batch(boolean, integer) IS 'Hard-deletes Cancelled/expired-Published unassigned shifts past their retention grace period and not referenced by payroll/timesheet/compliance/planning/attendance tables. One call = one bounded batch = one transaction; archives to deleted_shifts.snapshot_data before deleting. Gated by dead_shift_cleanup_rules.enabled (unconditional kill switch). Fixed 2026-07-29: ambiguous SUM(deleted) column reference, and error-path log now actually persists (WARNING instead of re-raising).';
