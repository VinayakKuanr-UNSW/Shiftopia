-- ============================================================================
-- Timesheets — lifecycle triggers (AUTOPILOT-FREE reconciliation)
--
-- Prod drifted from the repo: the earlier autopilot migrations were never applied
-- cleanly, so prod is MISSING the timesheet lifecycle triggers the app relies on.
-- AutoPilot has been REMOVED from the module, so this installs the human-only
-- lifecycle plumbing (no bot branches, no app.timesheet.autopilot GUC):
--
--   • edit_count column + BEFORE-UPDATE bump on billable/break edits (📝 badge)
--   • version bump on every UPDATE (F18 optimistic concurrency; app also CASes)
--   • provenance trigger → append-only timesheet_audit_log (History popover)
--   • append-only guard on timesheet_audit_log
--
-- Notifications and shift_events capture are already handled by the existing prod
-- triggers `after_timesheet_decision` / `trg_capture_timesheet_event` and are left
-- untouched here (see 20260725100200 for the timesheet_adjusted notification gap).
--
-- Idempotent (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS).
-- ============================================================================

-- ── 1. edit_count column + trigger ─────────────────────────────────────────
ALTER TABLE public.timesheets
  ADD COLUMN IF NOT EXISTS edit_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.fn_timesheet_edit_count() RETURNS trigger
    LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF (NEW.start_time         IS DISTINCT FROM OLD.start_time
   OR NEW.end_time           IS DISTINCT FROM OLD.end_time
   OR NEW.paid_break_minutes IS DISTINCT FROM OLD.paid_break_minutes
   OR NEW.unpaid_break_minutes IS DISTINCT FROM OLD.unpaid_break_minutes) THEN
    NEW.edit_count := COALESCE(OLD.edit_count, 0) + 1;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_timesheet_edit_count ON public.timesheets;
CREATE TRIGGER trg_timesheet_edit_count
    BEFORE UPDATE ON public.timesheets
    FOR EACH ROW EXECUTE FUNCTION public.fn_timesheet_edit_count();

COMMENT ON COLUMN public.timesheets.edit_count IS
  'Running count of manager billable/break adjustments (bumped by trg_timesheet_edit_count). Full history in timesheet_audit_log.';

-- ── 2. version bump (optimistic concurrency F18) ───────────────────────────
ALTER TABLE public.timesheets
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.fn_timesheet_version_bump() RETURNS trigger
    LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog'
    AS $$
BEGIN
  NEW.version := COALESCE(OLD.version, 1) + 1;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_timesheet_version_bump ON public.timesheets;
CREATE TRIGGER trg_timesheet_version_bump
    BEFORE UPDATE ON public.timesheets
    FOR EACH ROW EXECUTE FUNCTION public.fn_timesheet_version_bump();

COMMENT ON COLUMN public.timesheets.version IS
  'Optimistic-lock row version, bumped on every UPDATE by trg_timesheet_version_bump. Clients pass the loaded version as a CAS guard (F18).';

-- ── 3. provenance → append-only timesheet_audit_log (History popover) ──────
CREATE OR REPLACE FUNCTION public.fn_timesheet_provenance() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_new text := lower(COALESCE(NEW.status::text, ''));
  v_old text := '';   -- OLD is NULL on INSERT; assigned in the UPDATE path only
  v_human_source text := CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
    VALUES (NEW.id, NEW.shift_id,
            CASE WHEN v_new = 'submitted' THEN 'SUBMITTED'
                 WHEN v_new = 'no_show'   THEN 'NO_SHOW'
                 WHEN v_new = 'approved'  THEN 'MANUALLY_APPROVED'
                 WHEN v_new = 'rejected'  THEN 'REJECTED'
                 ELSE 'CREATED' END,
            CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END, v_actor,
            jsonb_build_object('status', v_new));
    RETURN NEW;
  END IF;

  v_old := lower(COALESCE(OLD.status::text, ''));  -- safe here: UPDATE only

  -- Status transitions
  IF v_new IS DISTINCT FROM v_old THEN
    IF v_new = 'approved' THEN
      INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
      VALUES (NEW.id, NEW.shift_id, 'MANUALLY_APPROVED', v_human_source, v_actor, jsonb_build_object('from', v_old));
    ELSIF v_new = 'rejected' THEN
      INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
      VALUES (NEW.id, NEW.shift_id, 'REJECTED', v_human_source, v_actor, jsonb_build_object('reason', NEW.rejected_reason));
    ELSIF v_new = 'no_show' THEN
      INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
      VALUES (NEW.id, NEW.shift_id, 'NO_SHOW', v_human_source, v_actor, '{}'::jsonb);
    ELSIF v_old = 'approved' AND v_new IN ('submitted', 'draft') THEN
      INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
      VALUES (NEW.id, NEW.shift_id, 'REOPENED', v_human_source, v_actor, jsonb_build_object('to', v_new));
    ELSIF v_new = 'submitted' THEN
      INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
      VALUES (NEW.id, NEW.shift_id, 'SUBMITTED', v_human_source, v_actor, '{}'::jsonb);
    END IF;
  END IF;

  -- Billable-time / break edits (independent of a status change)
  IF NEW.start_time IS DISTINCT FROM OLD.start_time
     OR NEW.end_time IS DISTINCT FROM OLD.end_time
     OR NEW.paid_break_minutes IS DISTINCT FROM OLD.paid_break_minutes
     OR NEW.unpaid_break_minutes IS DISTINCT FROM OLD.unpaid_break_minutes THEN
    INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
    VALUES (NEW.id, NEW.shift_id, 'EDITED', v_human_source, v_actor,
            jsonb_build_object(
              'before', jsonb_build_object('start_time', OLD.start_time, 'end_time', OLD.end_time,
                                           'paid_break', OLD.paid_break_minutes, 'unpaid_break', OLD.unpaid_break_minutes),
              'after',  jsonb_build_object('start_time', NEW.start_time, 'end_time', NEW.end_time,
                                           'paid_break', NEW.paid_break_minutes, 'unpaid_break', NEW.unpaid_break_minutes),
              'arrival_variance_reason',   NEW.arrival_variance_reason,
              'departure_variance_reason', NEW.departure_variance_reason));
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_timesheet_provenance swallowed (timesheet=%): %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_timesheet_provenance ON public.timesheets;
CREATE TRIGGER trg_timesheet_provenance
    AFTER INSERT OR UPDATE ON public.timesheets
    FOR EACH ROW EXECUTE FUNCTION public.fn_timesheet_provenance();

-- ── 4. Append-only guard on the audit log ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_timesheet_audit_append_only() RETURNS trigger
    LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog'
    AS $$
BEGIN
  RAISE EXCEPTION 'timesheet_audit_log is append-only (% blocked)', TG_OP;
END; $$;

DROP TRIGGER IF EXISTS trg_timesheet_audit_append_only ON public.timesheet_audit_log;
CREATE TRIGGER trg_timesheet_audit_append_only
    BEFORE UPDATE OR DELETE ON public.timesheet_audit_log
    FOR EACH ROW EXECUTE FUNCTION public.fn_timesheet_audit_append_only();

COMMENT ON FUNCTION public.fn_timesheet_provenance() IS
  'AUTOPILOT-FREE lifecycle provenance for timesheets (CREATED/SUBMITTED/MANUALLY_APPROVED/REJECTED/EDITED/REOPENED/NO_SHOW) → append-only timesheet_audit_log.';
