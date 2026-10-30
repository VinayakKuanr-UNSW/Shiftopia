-- ============================================================================
-- Timesheets — employee notifications (F19), part 2 of 2
--
-- Notify the employee when their timesheet is:
--   • approved   — auto (bot) OR by a manager (message differs; both use the
--                  existing `timesheet_approved` type).
--   • rejected   — with the manager's reason (`timesheet_rejected`).
--   • adjusted   — a manager changed billable times / breaks without approving
--                  in the same edit (`timesheet_adjusted`).
--
-- Reuses the rate-limited + dedup-idempotent notify_user() 8-arg helper, exactly
-- like trg_shift_swap_outcome_notification / trg_leave_request_outcome_notification.
-- AFTER UPDATE so it sees the version/edit_count bumped by the BEFORE triggers.
--
-- DELIBERATELY NOT INCLUDED: a "your timesheet needs review" ping when the bot
-- routes a shift to MANUAL_REVIEW. That fires in overnight bulk and is a
-- manager-facing signal, not an actionable employee one — surfacing it in the
-- shift's History (BOT_REVIEW) is enough. Revisit if managers want a queue ping.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_timesheet_outcome_notification() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_recipient uuid := COALESCE(NEW.employee_id, NEW.profile_id);
  v_is_bot boolean := NULLIF(current_setting('app.timesheet.autopilot', true), '') IS NOT NULL;
  v_new text := lower(COALESCE(NEW.status::text, ''));
  v_old text := lower(COALESCE(OLD.status::text, ''));
  v_status_changed boolean := v_new IS DISTINCT FROM v_old;
  v_billable_changed boolean;
BEGIN
  IF v_recipient IS NULL THEN
    RETURN NEW;
  END IF;

  -- Approved (auto or manual)
  IF v_status_changed AND v_new = 'approved' THEN
    PERFORM notify_user(
      v_recipient, 'timesheet_approved', 'Timesheet approved',
      CASE WHEN v_is_bot
           THEN 'Your timesheet for ' || COALESCE(NEW.work_date::text, 'your shift') || ' was auto-approved (clean punches).'
           ELSE 'Your timesheet for ' || COALESCE(NEW.work_date::text, 'your shift') || ' was approved by your manager.'
      END,
      NEW.shift_id, 'timesheet', '/timesheet',
      'timesheet_approved:' || NEW.id::text);

  -- Rejected
  ELSIF v_status_changed AND v_new = 'rejected' THEN
    PERFORM notify_user(
      v_recipient, 'timesheet_rejected', 'Timesheet needs attention',
      'Your timesheet for ' || COALESCE(NEW.work_date::text, 'your shift') || ' was not approved' ||
        CASE WHEN NEW.rejected_reason IS NOT NULL THEN ': ' || NEW.rejected_reason ELSE '.' END,
      NEW.shift_id, 'timesheet', '/timesheet',
      'timesheet_rejected:' || NEW.id::text);
  END IF;

  -- Adjusted — a manager edited billable times / breaks WITHOUT approving in the
  -- same write (an approve already tells the employee). Not the bot. Keyed by
  -- edit_count so each distinct edit notifies once.
  v_billable_changed := (NOT v_is_bot) AND (
       NEW.start_time IS DISTINCT FROM OLD.start_time
    OR NEW.end_time IS DISTINCT FROM OLD.end_time
    OR NEW.paid_break_minutes IS DISTINCT FROM OLD.paid_break_minutes
    OR NEW.unpaid_break_minutes IS DISTINCT FROM OLD.unpaid_break_minutes);

  IF v_billable_changed AND NOT (v_status_changed AND v_new IN ('approved', 'rejected')) THEN
    PERFORM notify_user(
      v_recipient, 'timesheet_adjusted', 'Timesheet adjusted',
      'A manager adjusted your billable time for ' || COALESCE(NEW.work_date::text, 'your shift') || '.',
      NEW.shift_id, 'timesheet', '/timesheet',
      'timesheet_adjusted:' || NEW.id::text || ':' || COALESCE(NEW.edit_count, 0)::text);
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A notification failure must never block a timesheet write.
  RAISE WARNING 'trg_timesheet_outcome_notification swallowed (timesheet=%): %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_timesheet_outcome_notification ON public.timesheets;
CREATE TRIGGER trg_timesheet_outcome_notification
    AFTER UPDATE ON public.timesheets
    FOR EACH ROW EXECUTE FUNCTION public.trg_timesheet_outcome_notification();
