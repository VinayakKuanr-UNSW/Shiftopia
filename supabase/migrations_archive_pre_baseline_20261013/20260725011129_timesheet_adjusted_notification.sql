-- ============================================================================
-- Timesheets — notify the employee when a manager ADJUSTS billable time
--
-- Prod already notifies on approve/reject via the existing trigger
-- `after_timesheet_decision` → trg_timesheet_decision(). This EXTENDS that same
-- function (rather than adding a competing trigger, which would double-notify) to
-- also fire when a manager edits billable start/end or breaks WITHOUT changing the
-- status (an approve/reject already messages the employee). Keyed by edit_count so
-- each distinct edit notifies once.
--
-- The approve/reject branches are reproduced verbatim from the live prod function.
-- Requires the `timesheet_adjusted` enum value (20260725100100).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_timesheet_decision() RETURNS trigger
    LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  -- Safety: skip if no employee
  IF NEW.employee_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    PERFORM public.notify_user(
      NEW.employee_id,
      'timesheet_approved',
      'Timesheet approved',
      'Your timesheet for the shift on '
        || TO_CHAR(NEW.work_date, 'DD Mon YYYY')
        || ' has been approved',
      NEW.id,
      'timesheet',
      '/timesheet',
      'TIMESHEET_APPROVED_' || NEW.id::TEXT
    );
  ELSIF NEW.status = 'rejected' AND OLD.status <> 'rejected' THEN
    PERFORM public.notify_user(
      NEW.employee_id,
      'timesheet_rejected',
      'Timesheet needs revision',
      'Your timesheet for the shift on '
        || TO_CHAR(NEW.work_date, 'DD Mon YYYY')
        || ' was rejected — please review and resubmit',
      NEW.id,
      'timesheet',
      '/timesheet',
      'TIMESHEET_REJECTED_' || NEW.id::TEXT
    );
  -- NEW: manager adjusted billable time / breaks without changing the status.
  ELSIF NEW.status = OLD.status AND (
       NEW.start_time          IS DISTINCT FROM OLD.start_time
    OR NEW.end_time            IS DISTINCT FROM OLD.end_time
    OR NEW.paid_break_minutes  IS DISTINCT FROM OLD.paid_break_minutes
    OR NEW.unpaid_break_minutes IS DISTINCT FROM OLD.unpaid_break_minutes
  ) THEN
    PERFORM public.notify_user(
      NEW.employee_id,
      'timesheet_adjusted',
      'Timesheet adjusted',
      'A manager adjusted your billable time for the shift on '
        || TO_CHAR(NEW.work_date, 'DD Mon YYYY'),
      NEW.id,
      'timesheet',
      '/timesheet',
      'TIMESHEET_ADJUSTED_' || NEW.id::TEXT || '_' || COALESCE(NEW.edit_count, 0)::TEXT
    );
  END IF;

  RETURN NEW;
END;
$$;
