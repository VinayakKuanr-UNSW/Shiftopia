-- =====================================================================
-- Dead Shift Cleanup — scenario verification script (NON-MIGRATION)
-- =====================================================================
-- PURPOSE: Hand-runnable assertions exercising cleanup_dead_shifts_batch()
-- and the extended sm_delete_shift() from 20260729020000_dead_shift_cleanup.sql.
--
-- DO NOT include this file in the migration apply path (it lives under
-- supabase/migrations/_parity/, which is excluded from `supabase db push`).
-- There is no SQL test harness in this repo (no pgTAP) — this is an
-- eyeball/diff aid, same as the other files in this directory.
--
-- RUN ONLY AGAINST A SUPABASE BRANCH OR PROD YOU'RE PREPARED TO TOUCH
-- TRANSIENTLY. This script mutates real data (clones + hard-deletes
-- synthetic shift rows, forces the global dead_shift_cleanup_rules row
-- on/off) but is wrapped in BEGIN/ROLLBACK so nothing persists. It never
-- mutates a real existing row — fixtures are entirely new synthetic rows
-- cloned from one real row's shape, deleted again before the ROLLBACK.
--
-- Each of the 13 scenarios below is its own DO block with its own
-- EXCEPTION handler, recording PASS/FAIL into a pg_temp results table
-- instead of relying on RAISE NOTICE (not reliably visible over
-- non-interactive SQL clients) or letting one failure's RAISE EXCEPTION
-- abort the rest of the script. Run the whole file in one session, then
-- read the final SELECT's result set for the verdict per scenario:
--   \i supabase/migrations/_parity/dead_shift_cleanup_scenarios.sql
--
-- Fixtures are synthetic shift rows CLONED from an existing row on the
-- target (via a dynamic column list that excludes the 3 generated columns:
-- total_hours/is_draft/is_published) rather than hand-typing the ~100-column
-- shifts table. Requires at least one pre-existing shifts row and one
-- profiles row on the target to clone from / reference.
--
-- COVERAGE NOTE: guard-table exclusion is verified for one representative
-- table per risk category (planning_requests = real FK RESTRICT blocker,
-- timesheet_audit_log = no-FK silent-orphan risk, assignment_snapshots =
-- ON DELETE CASCADE silent-loss risk) rather than all 12 guard tables —
-- the WHERE clause's NOT EXISTS pattern is identical across all 12, so this
-- is representative sampling, not exhaustive per-table fixturing.
-- =====================================================================

BEGIN;

-- ── Fixture helper: clone an existing shift row with field overrides ───────
CREATE FUNCTION pg_temp._dsc_clone_shift(p_template_id uuid, p_overrides jsonb)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_cols text;
  v_new_id uuid := gen_random_uuid();
  v_base jsonb;
  v_merged jsonb;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'shifts' AND is_generated = 'NEVER';

  SELECT to_jsonb(s) INTO v_base FROM public.shifts s WHERE s.id = p_template_id;
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'template shift % not found', p_template_id;
  END IF;

  v_merged := (v_base - 'total_hours' - 'is_draft' - 'is_published')
              || p_overrides
              || jsonb_build_object('id', v_new_id);

  EXECUTE format(
    'INSERT INTO public.shifts (%1$s) SELECT %1$s FROM jsonb_populate_record(NULL::public.shifts, $1)',
    v_cols
  ) USING v_merged;

  RETURN v_new_id;
END;
$$;

-- ── Results table (survives across DO blocks within this one transaction,
--    read back via the final SELECT below instead of relying on NOTICE) ────
CREATE TABLE pg_temp._dsc_results (scenario text PRIMARY KEY, status text NOT NULL, detail text);

-- ── Shared fixture inputs ────────────────────────────────────────────────
DO $$
DECLARE
  v_template_id uuid;
  v_profile_id uuid;
BEGIN
  SELECT id INTO v_template_id FROM public.shifts WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1;
  SELECT id INTO v_profile_id FROM public.profiles LIMIT 1;
  IF v_template_id IS NULL THEN
    RAISE EXCEPTION 'No shifts row on this target to clone fixtures from — seed at least one shift first';
  END IF;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'No profiles row on this target — needed for FK fixtures (employee_id/initiated_by)';
  END IF;
  PERFORM set_config('dsc.template_id', v_template_id::text, false);
  PERFORM set_config('dsc.profile_id', v_profile_id::text, false);
END $$;

-- Force a permissive, deterministic config for the scenarios below. Restored
-- to its shipped defaults implicitly by ROLLBACK at the end of this script.
--
-- retention_hours = 0: shifts.updated_at is force-stamped to now() by
-- existing triggers (update_timestamp / trg_capture_shift_event) regardless
-- of what a fixture INSERT specifies — correct production behavior for an
-- audit column, but it means a freshly-cloned fixture can never be made to
-- look "old" via an updated_at override. Using retention_hours=0 makes any
-- freshly-cloned row immediately past its grace period instead, so the
-- eligibility scenarios don't depend on defeating that trigger. Scenario 6
-- (grace period NOT yet expired) temporarily raises retention_hours back up
-- just for its own assertion.
UPDATE public.dead_shift_cleanup_rules
   SET enabled = true, dry_run = false, retention_hours = 0,
       batch_size = 500, max_deletes_per_run = 1000000, max_deletes_window_hours = 24
 WHERE organization_id IS NULL AND department_id IS NULL;

-- ── Scenario 1: eligible Cancelled shift is archived (incl. shift_events
--    envelope) and hard-deleted ───────────────────────────────────────────
DO $$
DECLARE
  v_id uuid;
  v_events_len int;
BEGIN
  v_id := pg_temp._dsc_clone_shift(current_setting('dsc.template_id')::uuid, jsonb_build_object(
    'lifecycle_status', 'Cancelled', 'is_cancelled', true, 'assignment_status', 'unassigned',
    'assigned_employee_id', NULL, 'is_on_bidding', false,
    'bidding_status', 'not_on_bidding', 'trading_status', 'NoTrade', 'assignment_outcome', NULL,
    'actual_start', NULL, 'actual_end', NULL, 'actual_net_minutes', NULL, 'payroll_exported', false,
    'timesheet_id', NULL, 'compliance_snapshot', NULL, 'eligibility_snapshot', NULL,
    'compliance_checked_at', NULL, 'compliance_override', false, 'compliance_override_reason', NULL,
    'updated_at', to_jsonb(now() - interval '100 hours')));

  INSERT INTO public.shift_events (shift_id, employee_id, event_type)
  VALUES (v_id, current_setting('dsc.profile_id')::uuid, 'OFFERED');

  PERFORM public.cleanup_dead_shifts_batch(p_dry_run := false);

  IF EXISTS (SELECT 1 FROM public.shifts WHERE id = v_id) THEN
    RAISE EXCEPTION 'eligible Cancelled shift not deleted: id=%', v_id;
  END IF;
  -- >= 1, not = 1: trg_capture_shift_event may also auto-capture its own
  -- event on the fixture's INSERT, in addition to the 1 inserted above.
  SELECT jsonb_array_length(snapshot_data->'shift_events') INTO v_events_len
    FROM public.deleted_shifts WHERE id = v_id;
  IF COALESCE(v_events_len, 0) < 1 THEN
    RAISE EXCEPTION 'expected >= 1 archived shift_events row, got %: id=%', v_events_len, v_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.shift_events WHERE shift_id = v_id) THEN
    RAISE EXCEPTION 'shift_events row still live after cascade — should be gone: id=%', v_id;
  END IF;
  INSERT INTO pg_temp._dsc_results VALUES ('01_eligible_cancelled_deleted', 'PASS', NULL);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp._dsc_results VALUES ('01_eligible_cancelled_deleted', 'FAIL', SQLERRM);
END $$;

-- ── Scenario 2: eligible Published-but-ended shift is deleted ─────────────
DO $$
DECLARE
  v_id uuid;
BEGIN
  v_id := pg_temp._dsc_clone_shift(current_setting('dsc.template_id')::uuid, jsonb_build_object(
    'lifecycle_status', 'Published', 'is_cancelled', false, 'assignment_status', 'unassigned',
    'assigned_employee_id', NULL, 'is_on_bidding', false,
    'bidding_status', 'bidding_closed_no_winner', 'trading_status', 'NoTrade', 'assignment_outcome', NULL,
    'actual_start', NULL, 'actual_end', NULL, 'actual_net_minutes', NULL, 'payroll_exported', false,
    'timesheet_id', NULL, 'compliance_snapshot', NULL, 'eligibility_snapshot', NULL,
    'compliance_checked_at', NULL, 'compliance_override', false, 'compliance_override_reason', NULL,
    'shift_date', (current_date - 3), 'start_time', '09:00:00', 'end_time', '17:00:00',
    'start_at', to_jsonb(now() - interval '75 hours'), 'end_at', to_jsonb(now() - interval '67 hours'),
    'updated_at', to_jsonb(now() - interval '100 hours')));

  PERFORM public.cleanup_dead_shifts_batch(p_dry_run := false);
  IF EXISTS (SELECT 1 FROM public.shifts WHERE id = v_id) THEN
    RAISE EXCEPTION 'eligible expired Published shift not deleted: id=%', v_id;
  END IF;
  INSERT INTO pg_temp._dsc_results VALUES ('02_eligible_published_ended_deleted', 'PASS', NULL);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp._dsc_results VALUES ('02_eligible_published_ended_deleted', 'FAIL', SQLERRM);
END $$;

-- ── Scenario 3: assigned shift is retained regardless of status ───────────
DO $$
DECLARE
  v_id uuid;
BEGIN
  v_id := pg_temp._dsc_clone_shift(current_setting('dsc.template_id')::uuid, jsonb_build_object(
    'lifecycle_status', 'Cancelled', 'is_cancelled', true, 'assignment_status', 'assigned',
    'assigned_employee_id', current_setting('dsc.profile_id')::uuid, 'is_on_bidding', false,
    'updated_at', to_jsonb(now() - interval '100 hours')));

  PERFORM public.cleanup_dead_shifts_batch(p_dry_run := false);
  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE id = v_id) THEN
    RAISE EXCEPTION 'assigned shift was deleted — must never happen: id=%', v_id;
  END IF;
  INSERT INTO pg_temp._dsc_results VALUES ('03_assigned_retained', 'PASS', NULL);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp._dsc_results VALUES ('03_assigned_retained', 'FAIL', SQLERRM);
END $$;

-- ── Scenario 4: Draft + unassigned + start already passed IS deleted (scope
--    extended 2026-07-29 to be a superset of bulk-action-engine.ts's
--    deadIds, which only catches this mid-window) ──────────────────────────
DO $$
DECLARE
  v_id uuid;
BEGIN
  v_id := pg_temp._dsc_clone_shift(current_setting('dsc.template_id')::uuid, jsonb_build_object(
    'lifecycle_status', 'Draft', 'is_cancelled', false, 'assignment_status', 'unassigned',
    'assigned_employee_id', NULL, 'is_on_bidding', false,
    'bidding_status', 'not_on_bidding', 'trading_status', 'NoTrade', 'assignment_outcome', NULL,
    'actual_start', NULL, 'actual_end', NULL, 'actual_net_minutes', NULL, 'payroll_exported', false,
    'timesheet_id', NULL, 'compliance_snapshot', NULL, 'eligibility_snapshot', NULL,
    'compliance_checked_at', NULL, 'compliance_override', false, 'compliance_override_reason', NULL,
    'shift_date', (current_date - 3), 'start_time', '09:00:00', 'end_time', '17:00:00',
    'start_at', to_jsonb(now() - interval '75 hours'), 'end_at', to_jsonb(now() - interval '67 hours'),
    'updated_at', to_jsonb(now() - interval '100 hours')));

  PERFORM public.cleanup_dead_shifts_batch(p_dry_run := false);
  IF EXISTS (SELECT 1 FROM public.shifts WHERE id = v_id) THEN
    RAISE EXCEPTION 'Draft shift with start already passed was not deleted: id=%', v_id;
  END IF;
  INSERT INTO pg_temp._dsc_results VALUES ('04_draft_start_passed_deleted', 'PASS', NULL);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp._dsc_results VALUES ('04_draft_start_passed_deleted', 'FAIL', SQLERRM);
END $$;

-- ── Scenario 5: Published but not yet ended is retained ───────────────────
DO $$
DECLARE
  v_id uuid;
BEGIN
  v_id := pg_temp._dsc_clone_shift(current_setting('dsc.template_id')::uuid, jsonb_build_object(
    'lifecycle_status', 'Published', 'is_cancelled', false, 'assignment_status', 'unassigned',
    'assigned_employee_id', NULL, 'is_on_bidding', false,
    'bidding_status', 'bidding_closed_no_winner', 'trading_status', 'NoTrade', 'assignment_outcome', NULL,
    'actual_start', NULL, 'actual_end', NULL, 'actual_net_minutes', NULL, 'payroll_exported', false,
    'timesheet_id', NULL, 'compliance_snapshot', NULL, 'eligibility_snapshot', NULL,
    'compliance_checked_at', NULL, 'compliance_override', false, 'compliance_override_reason', NULL,
    'shift_date', (current_date + 3), 'start_time', '09:00:00', 'end_time', '17:00:00',
    'start_at', to_jsonb(now() + interval '3 days'), 'end_at', to_jsonb(now() + interval '3 days 8 hours'),
    'updated_at', to_jsonb(now() - interval '100 hours')));

  PERFORM public.cleanup_dead_shifts_batch(p_dry_run := false);
  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE id = v_id) THEN
    RAISE EXCEPTION 'not-yet-ended Published shift was deleted: id=%', v_id;
  END IF;
  INSERT INTO pg_temp._dsc_results VALUES ('05_published_not_ended_retained', 'PASS', NULL);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp._dsc_results VALUES ('05_published_not_ended_retained', 'FAIL', SQLERRM);
END $$;

-- ── Scenario 6: grace period not yet expired is retained ──────────────────
DO $$
DECLARE
  v_id uuid;
BEGIN
  v_id := pg_temp._dsc_clone_shift(current_setting('dsc.template_id')::uuid, jsonb_build_object(
    'lifecycle_status', 'Cancelled', 'is_cancelled', true, 'assignment_status', 'unassigned',
    'assigned_employee_id', NULL, 'is_on_bidding', false,
    'bidding_status', 'not_on_bidding', 'trading_status', 'NoTrade', 'assignment_outcome', NULL,
    'actual_start', NULL, 'actual_end', NULL, 'actual_net_minutes', NULL, 'payroll_exported', false,
    'timesheet_id', NULL, 'compliance_snapshot', NULL, 'eligibility_snapshot', NULL,
    'compliance_checked_at', NULL, 'compliance_override', false, 'compliance_override_reason', NULL,
    'updated_at', to_jsonb(now() - interval '1 hour')));

  -- Local override: this scenario needs a real, non-zero grace period —
  -- updated_at is freshly now() regardless of the fixture override (see
  -- preamble comment), which already satisfies "inside the grace period"
  -- for any retention_hours > 0.
  UPDATE public.dead_shift_cleanup_rules SET retention_hours = 72
   WHERE organization_id IS NULL AND department_id IS NULL;

  PERFORM public.cleanup_dead_shifts_batch(p_dry_run := false);
  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE id = v_id) THEN
    RAISE EXCEPTION 'shift within retention_hours grace period was deleted: id=%', v_id;
  END IF;

  UPDATE public.dead_shift_cleanup_rules SET retention_hours = 0
   WHERE organization_id IS NULL AND department_id IS NULL;
  INSERT INTO pg_temp._dsc_results VALUES ('06_grace_period_retained', 'PASS', NULL);
EXCEPTION WHEN OTHERS THEN
  UPDATE public.dead_shift_cleanup_rules SET retention_hours = 0
   WHERE organization_id IS NULL AND department_id IS NULL;
  INSERT INTO pg_temp._dsc_results VALUES ('06_grace_period_retained', 'FAIL', SQLERRM);
END $$;

-- ── Scenario 7: real-FK-RESTRICT guard (planning_requests) — retained, no
--    error raised (pre-filter, not try/catch) ─────────────────────────────
DO $$
DECLARE
  v_id uuid;
BEGIN
  v_id := pg_temp._dsc_clone_shift(current_setting('dsc.template_id')::uuid, jsonb_build_object(
    'lifecycle_status', 'Cancelled', 'is_cancelled', true, 'assignment_status', 'unassigned',
    'assigned_employee_id', NULL, 'is_on_bidding', false,
    'bidding_status', 'not_on_bidding', 'trading_status', 'NoTrade', 'assignment_outcome', NULL,
    'actual_start', NULL, 'actual_end', NULL, 'actual_net_minutes', NULL, 'payroll_exported', false,
    'timesheet_id', NULL, 'compliance_snapshot', NULL, 'eligibility_snapshot', NULL,
    'compliance_checked_at', NULL, 'compliance_override', false, 'compliance_override_reason', NULL,
    'updated_at', to_jsonb(now() - interval '100 hours')));

  INSERT INTO public.planning_requests (type, shift_id, initiated_by)
  VALUES ('BID', v_id, current_setting('dsc.profile_id')::uuid);

  PERFORM public.cleanup_dead_shifts_batch(p_dry_run := false);
  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE id = v_id) THEN
    RAISE EXCEPTION 'shift referenced by planning_requests was deleted: id=%', v_id;
  END IF;
  INSERT INTO pg_temp._dsc_results VALUES ('07_guard_planning_requests_restrict', 'PASS', NULL);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp._dsc_results VALUES ('07_guard_planning_requests_restrict', 'FAIL', SQLERRM);
END $$;

-- ── Scenario 8: no-FK silent-orphan-risk guard (timesheet_audit_log) ──────
DO $$
DECLARE
  v_id uuid;
BEGIN
  v_id := pg_temp._dsc_clone_shift(current_setting('dsc.template_id')::uuid, jsonb_build_object(
    'lifecycle_status', 'Cancelled', 'is_cancelled', true, 'assignment_status', 'unassigned',
    'assigned_employee_id', NULL, 'is_on_bidding', false,
    'bidding_status', 'not_on_bidding', 'trading_status', 'NoTrade', 'assignment_outcome', NULL,
    'actual_start', NULL, 'actual_end', NULL, 'actual_net_minutes', NULL, 'payroll_exported', false,
    'timesheet_id', NULL, 'compliance_snapshot', NULL, 'eligibility_snapshot', NULL,
    'compliance_checked_at', NULL, 'compliance_override', false, 'compliance_override_reason', NULL,
    'updated_at', to_jsonb(now() - interval '100 hours')));

  INSERT INTO public.timesheet_audit_log (shift_id, event_type, source)
  VALUES (v_id, 'CREATED', 'system');

  PERFORM public.cleanup_dead_shifts_batch(p_dry_run := false);
  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE id = v_id) THEN
    RAISE EXCEPTION 'shift referenced by timesheet_audit_log was deleted: id=%', v_id;
  END IF;
  INSERT INTO pg_temp._dsc_results VALUES ('08_guard_timesheet_audit_log_no_fk', 'PASS', NULL);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp._dsc_results VALUES ('08_guard_timesheet_audit_log_no_fk', 'FAIL', SQLERRM);
END $$;

-- ── Scenario 9: cascade-silent-loss-risk guard (assignment_snapshots) ─────
DO $$
DECLARE
  v_id uuid;
BEGIN
  v_id := pg_temp._dsc_clone_shift(current_setting('dsc.template_id')::uuid, jsonb_build_object(
    'lifecycle_status', 'Cancelled', 'is_cancelled', true, 'assignment_status', 'unassigned',
    'assigned_employee_id', NULL, 'is_on_bidding', false,
    'bidding_status', 'not_on_bidding', 'trading_status', 'NoTrade', 'assignment_outcome', NULL,
    'actual_start', NULL, 'actual_end', NULL, 'actual_net_minutes', NULL, 'payroll_exported', false,
    'timesheet_id', NULL, 'compliance_snapshot', NULL, 'eligibility_snapshot', NULL,
    'compliance_checked_at', NULL, 'compliance_override', false, 'compliance_override_reason', NULL,
    'updated_at', to_jsonb(now() - interval '100 hours')));

  INSERT INTO public.assignment_snapshots (shift_id, episode_seq, employee_id, source, became_active_at)
  VALUES (v_id, 1, current_setting('dsc.profile_id')::uuid, 'test_fixture', now());

  PERFORM public.cleanup_dead_shifts_batch(p_dry_run := false);
  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE id = v_id) THEN
    RAISE EXCEPTION 'shift referenced by assignment_snapshots was deleted: id=%', v_id;
  END IF;
  INSERT INTO pg_temp._dsc_results VALUES ('09_guard_assignment_snapshots_cascade', 'PASS', NULL);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp._dsc_results VALUES ('09_guard_assignment_snapshots_cascade', 'FAIL', SQLERRM);
END $$;

-- ── Scenario 10: dry-run produces zero deletes, zero writes ───────────────
DO $$
DECLARE
  v_id uuid;
  v_result record;
BEGIN
  v_id := pg_temp._dsc_clone_shift(current_setting('dsc.template_id')::uuid, jsonb_build_object(
    'lifecycle_status', 'Cancelled', 'is_cancelled', true, 'assignment_status', 'unassigned',
    'assigned_employee_id', NULL, 'is_on_bidding', false,
    'bidding_status', 'not_on_bidding', 'trading_status', 'NoTrade', 'assignment_outcome', NULL,
    'actual_start', NULL, 'actual_end', NULL, 'actual_net_minutes', NULL, 'payroll_exported', false,
    'timesheet_id', NULL, 'compliance_snapshot', NULL, 'eligibility_snapshot', NULL,
    'compliance_checked_at', NULL, 'compliance_override', false, 'compliance_override_reason', NULL,
    'updated_at', to_jsonb(now() - interval '100 hours')));

  SELECT * INTO v_result FROM public.cleanup_dead_shifts_batch(p_dry_run := true);
  IF v_result.deleted <> 0 THEN
    RAISE EXCEPTION 'dry-run reported deleted=%, expected 0', v_result.deleted;
  END IF;
  IF v_result.scanned = 0 THEN
    RAISE EXCEPTION 'dry-run scanned=0 — fixture shift not even found as a candidate';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE id = v_id) THEN
    RAISE EXCEPTION 'dry-run actually deleted the shift: id=%', v_id;
  END IF;
  INSERT INTO pg_temp._dsc_results VALUES ('10_dry_run_zero_writes', 'PASS', format('scanned=%s', v_result.scanned));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp._dsc_results VALUES ('10_dry_run_zero_writes', 'FAIL', SQLERRM);
END $$;

-- ── Scenario 11 (critical): enabled=false overrides an explicit
--    p_dry_run:=false call — the single most important safety property ───
DO $$
DECLARE
  v_id uuid;
  v_result record;
BEGIN
  v_id := pg_temp._dsc_clone_shift(current_setting('dsc.template_id')::uuid, jsonb_build_object(
    'lifecycle_status', 'Cancelled', 'is_cancelled', true, 'assignment_status', 'unassigned',
    'assigned_employee_id', NULL, 'is_on_bidding', false,
    'bidding_status', 'not_on_bidding', 'trading_status', 'NoTrade', 'assignment_outcome', NULL,
    'actual_start', NULL, 'actual_end', NULL, 'actual_net_minutes', NULL, 'payroll_exported', false,
    'timesheet_id', NULL, 'compliance_snapshot', NULL, 'eligibility_snapshot', NULL,
    'compliance_checked_at', NULL, 'compliance_override', false, 'compliance_override_reason', NULL,
    'updated_at', to_jsonb(now() - interval '100 hours')));

  UPDATE public.dead_shift_cleanup_rules SET enabled = false
   WHERE organization_id IS NULL AND department_id IS NULL;

  SELECT * INTO v_result FROM public.cleanup_dead_shifts_batch(p_dry_run := false);

  IF v_result.dry_run IS NOT TRUE THEN
    RAISE EXCEPTION 'enabled=false did not force dry_run=true in the result';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE id = v_id) THEN
    RAISE EXCEPTION 'kill switch bypassed — shift deleted while enabled=false: id=%', v_id;
  END IF;

  UPDATE public.dead_shift_cleanup_rules SET enabled = true
   WHERE organization_id IS NULL AND department_id IS NULL;
  INSERT INTO pg_temp._dsc_results VALUES ('11_kill_switch_overrides_dry_run_false', 'PASS', NULL);
EXCEPTION WHEN OTHERS THEN
  UPDATE public.dead_shift_cleanup_rules SET enabled = true
   WHERE organization_id IS NULL AND department_id IS NULL;
  INSERT INTO pg_temp._dsc_results VALUES ('11_kill_switch_overrides_dry_run_false', 'FAIL', SQLERRM);
END $$;

-- ── Scenario 12: rolling max_deletes_per_run cap is enforced ──────────────
DO $$
DECLARE
  v_id uuid;
  v_result record;
BEGIN
  v_id := pg_temp._dsc_clone_shift(current_setting('dsc.template_id')::uuid, jsonb_build_object(
    'lifecycle_status', 'Cancelled', 'is_cancelled', true, 'assignment_status', 'unassigned',
    'assigned_employee_id', NULL, 'is_on_bidding', false,
    'bidding_status', 'not_on_bidding', 'trading_status', 'NoTrade', 'assignment_outcome', NULL,
    'actual_start', NULL, 'actual_end', NULL, 'actual_net_minutes', NULL, 'payroll_exported', false,
    'timesheet_id', NULL, 'compliance_snapshot', NULL, 'eligibility_snapshot', NULL,
    'compliance_checked_at', NULL, 'compliance_override', false, 'compliance_override_reason', NULL,
    'updated_at', to_jsonb(now() - interval '100 hours')));

  UPDATE public.dead_shift_cleanup_rules SET max_deletes_per_run = 3
   WHERE organization_id IS NULL AND department_id IS NULL;
  INSERT INTO public.dead_shift_cleanup_log (run_id, started_at, finished_at, dry_run, scanned, deleted, capped)
  VALUES (gen_random_uuid(), now(), now(), false, 3, 3, false);

  SELECT * INTO v_result FROM public.cleanup_dead_shifts_batch(p_dry_run := false);

  IF v_result.capped IS NOT TRUE OR v_result.deleted <> 0 THEN
    RAISE EXCEPTION 'expected capped=true, deleted=0; got capped=%, deleted=%', v_result.capped, v_result.deleted;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE id = v_id) THEN
    RAISE EXCEPTION 'shift deleted despite exhausted rolling-window budget: id=%', v_id;
  END IF;
  INSERT INTO pg_temp._dsc_results VALUES ('12_rolling_cap_enforced', 'PASS', NULL);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp._dsc_results VALUES ('12_rolling_cap_enforced', 'FAIL', SQLERRM);
END $$;

-- ── Scenario 13: sm_delete_shift regression — now also archives
--    shift_events (previously lost to ON DELETE CASCADE) ──────────────────
DO $$
DECLARE
  v_id uuid;
  v_events_len int;
  v_result json;
BEGIN
  v_id := pg_temp._dsc_clone_shift(current_setting('dsc.template_id')::uuid, '{}'::jsonb);

  INSERT INTO public.shift_events (shift_id, employee_id, event_type)
  VALUES (v_id, current_setting('dsc.profile_id')::uuid, 'OFFERED'),
         (v_id, current_setting('dsc.profile_id')::uuid, 'ACCEPTED');

  v_result := public.sm_delete_shift(v_id, current_setting('dsc.profile_id')::uuid, 'scenario 13 regression check');
  IF (v_result->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'sm_delete_shift reported failure: %', v_result;
  END IF;

  -- >= 2, not = 2: trg_capture_shift_event auto-captures its own event on
  -- the fixture's INSERT (a real, expected side effect of a raw INSERT
  -- firing normal shift triggers), in addition to the 2 inserted above.
  -- The regression under test is "shift_events archived at all", not an
  -- exact count.
  SELECT jsonb_array_length(snapshot_data->'shift_events') INTO v_events_len
    FROM public.deleted_shifts WHERE id = v_id;
  IF COALESCE(v_events_len, 0) < 2 THEN
    RAISE EXCEPTION 'expected >= 2 archived shift_events rows, got %: id=%', v_events_len, v_id;
  END IF;
  INSERT INTO pg_temp._dsc_results VALUES ('13_sm_delete_shift_archives_events', 'PASS', format('archived %s events', v_events_len));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp._dsc_results VALUES ('13_sm_delete_shift_archives_events', 'FAIL', SQLERRM);
END $$;

-- ── Scenario 14: Draft + unassigned + start NOT yet passed is retained ────
DO $$
DECLARE
  v_id uuid;
BEGIN
  v_id := pg_temp._dsc_clone_shift(current_setting('dsc.template_id')::uuid, jsonb_build_object(
    'lifecycle_status', 'Draft', 'is_cancelled', false, 'assignment_status', 'unassigned',
    'assigned_employee_id', NULL, 'is_on_bidding', false,
    'bidding_status', 'not_on_bidding', 'trading_status', 'NoTrade', 'assignment_outcome', NULL,
    'actual_start', NULL, 'actual_end', NULL, 'actual_net_minutes', NULL, 'payroll_exported', false,
    'timesheet_id', NULL, 'compliance_snapshot', NULL, 'eligibility_snapshot', NULL,
    'compliance_checked_at', NULL, 'compliance_override', false, 'compliance_override_reason', NULL,
    'shift_date', (current_date + 3), 'start_time', '09:00:00', 'end_time', '17:00:00',
    'start_at', to_jsonb(now() + interval '3 days'), 'end_at', to_jsonb(now() + interval '3 days 8 hours'),
    'updated_at', to_jsonb(now() - interval '100 hours')));

  PERFORM public.cleanup_dead_shifts_batch(p_dry_run := false);
  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE id = v_id) THEN
    RAISE EXCEPTION 'Draft shift with future start was deleted: id=%', v_id;
  END IF;
  INSERT INTO pg_temp._dsc_results VALUES ('14_draft_future_start_retained', 'PASS', NULL);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp._dsc_results VALUES ('14_draft_future_start_retained', 'FAIL', SQLERRM);
END $$;

SELECT scenario, status, detail FROM pg_temp._dsc_results ORDER BY scenario;

ROLLBACK;
