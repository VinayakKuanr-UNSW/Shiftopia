-- ============================================================================
-- Timesheets — manager edit counter (F7 / F16 📝 badge)
--
-- A denormalized count of how many times a manager has adjusted billable times
-- or breaks on a timesheet. The full before/after timeline already lives in
-- `timesheet_audit_log` (EDITED events); this is just the cheap running total
-- the UI shows as a badge.
--
-- Bumped by a BEFORE-UPDATE trigger (single row, no recursion, no bypass), and
-- ONLY for human billable/break edits — the auto-verify bot (which flips status
-- and never touches billable) and plain clock-sync / status writes don't count.
-- Bot writes are excluded via the same `app.timesheet.autopilot` GUC the
-- provenance trigger uses.
-- ============================================================================

ALTER TABLE public.timesheets
  ADD COLUMN IF NOT EXISTS edit_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.fn_timesheet_edit_count() RETURNS trigger
    LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_autopilot text := NULLIF(current_setting('app.timesheet.autopilot', true), '');
BEGIN
  IF v_autopilot IS NULL AND (
       NEW.start_time IS DISTINCT FROM OLD.start_time
    OR NEW.end_time IS DISTINCT FROM OLD.end_time
    OR NEW.paid_break_minutes IS DISTINCT FROM OLD.paid_break_minutes
    OR NEW.unpaid_break_minutes IS DISTINCT FROM OLD.unpaid_break_minutes
  ) THEN
    NEW.edit_count := COALESCE(OLD.edit_count, 0) + 1;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_timesheet_edit_count ON public.timesheets;
CREATE TRIGGER trg_timesheet_edit_count
    BEFORE UPDATE ON public.timesheets
    FOR EACH ROW EXECUTE FUNCTION public.fn_timesheet_edit_count();

COMMENT ON COLUMN public.timesheets.edit_count IS
  'Running count of manager billable/break adjustments (bumped by trg_timesheet_edit_count; bot + clock-sync writes excluded). Full history in timesheet_audit_log.';
