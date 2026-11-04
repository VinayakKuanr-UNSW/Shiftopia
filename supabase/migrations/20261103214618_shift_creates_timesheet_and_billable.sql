-- ============================================================================
-- Migration: shift_creates_timesheet_and_billable
-- Purpose:
--   Every LIVE shift carries exactly one public.timesheets row and one
--   public.billables row, linked (billables.timesheet_id), created by the
--   database the moment the shift becomes live. Live = assigned, not Draft,
--   not cancelled — the exact inverse of the cleanup this trigger already did.
--
--   Before this, nothing in the database created a billable: check-in wrote
--   timesheets only, clock-out UPDATEd a billable that did not exist, and the
--   only creator was the Timesheets page on a manager's first save. A worked
--   but unreviewed shift therefore had no billable, so the break-sync trigger
--   had nothing to update.
--
--   Why "live" and not literally "on INSERT": timesheets.employee_id and
--   billables.employee_id are NOT NULL, and a Draft / unassigned / cancelled
--   shift has no one to attribute attendance or pay to. The rows are created
--   on INSERT when the shift is born live, otherwise on the UPDATE that makes
--   it live, and removed (when still untouched) when it stops being live.
--
--   Also: billables.paid_break_minutes is seeded from the shift and follows
--   later roster edits while it still mirrors the scheduled value and the
--   billable is an untouched draft.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_timesheets_on_shift_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_ts_id uuid;
BEGIN
  IF NEW.lifecycle_status = 'Draft'::public.shift_lifecycle
     OR NEW.assigned_employee_id IS NULL
     OR NEW.is_cancelled = true THEN
    DELETE FROM public.timesheets
     WHERE shift_id = NEW.id
       AND clock_in IS NULL
       AND clock_out IS NULL;

    DELETE FROM public.billables
     WHERE shift_id = NEW.id
       AND status = 'draft'::public.timesheet_status
       AND payroll_exported = false
       AND billable_start IS NULL
       AND billable_end IS NULL;

    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.assigned_employee_id IS DISTINCT FROM OLD.assigned_employee_id THEN
      UPDATE public.timesheets
         SET employee_id = NEW.assigned_employee_id,
             updated_at  = now()
       WHERE shift_id = NEW.id
         AND clock_in IS NULL;

      UPDATE public.billables
         SET employee_id = NEW.assigned_employee_id,
             updated_at  = now()
       WHERE shift_id = NEW.id
         AND status = 'draft'::public.timesheet_status
         AND payroll_exported = false;
    END IF;

    IF NEW.paid_break_minutes IS DISTINCT FROM OLD.paid_break_minutes THEN
      UPDATE public.billables
         SET paid_break_minutes = COALESCE(NEW.paid_break_minutes, 0)
       WHERE shift_id = NEW.id
         AND status = 'draft'::public.timesheet_status
         AND payroll_exported = false
         AND paid_break_minutes = COALESCE(OLD.paid_break_minutes, 0);
    END IF;
  END IF;

  -- The live shift's pair. Idempotent: an existing row is kept as-is.
  INSERT INTO public.timesheets (shift_id, employee_id, organization_id, source)
  VALUES (NEW.id, NEW.assigned_employee_id, NEW.organization_id, 'roster')
  ON CONFLICT (shift_id) DO NOTHING;

  SELECT id INTO v_ts_id FROM public.timesheets WHERE shift_id = NEW.id;

  -- unpaid_break_minutes is left NULL on purpose (zero-fallback rule): it is
  -- filled from timesheet_breaks punches or a manager override, never from
  -- the schedule. A billable that survived a past cleanup (manager-edited)
  -- lost its timesheet link via ON DELETE SET NULL; relink it here.
  INSERT INTO public.billables (shift_id, timesheet_id, employee_id, organization_id, paid_break_minutes)
  VALUES (NEW.id, v_ts_id, NEW.assigned_employee_id, NEW.organization_id, COALESCE(NEW.paid_break_minutes, 0))
  ON CONFLICT (shift_id) DO UPDATE
     SET timesheet_id = EXCLUDED.timesheet_id
   WHERE public.billables.timesheet_id IS NULL
     AND public.billables.payroll_exported = false;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_timesheets_on_shift_change ON public.shifts;
CREATE TRIGGER trg_sync_timesheets_on_shift_change
  AFTER INSERT OR UPDATE OF lifecycle_status, assigned_employee_id, is_cancelled, paid_break_minutes
  ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_timesheets_on_shift_change();

-- Backfill: live shifts that predate this trigger.
INSERT INTO public.timesheets (shift_id, employee_id, organization_id, source)
SELECT s.id, s.assigned_employee_id, s.organization_id, 'roster'
  FROM public.shifts s
 WHERE s.lifecycle_status <> 'Draft'::public.shift_lifecycle
   AND s.assigned_employee_id IS NOT NULL
   AND NOT s.is_cancelled
ON CONFLICT (shift_id) DO NOTHING;

INSERT INTO public.billables (shift_id, timesheet_id, employee_id, organization_id, paid_break_minutes)
SELECT s.id, t.id, s.assigned_employee_id, s.organization_id, COALESCE(s.paid_break_minutes, 0)
  FROM public.shifts s
  JOIN public.timesheets t ON t.shift_id = s.id
 WHERE s.lifecycle_status <> 'Draft'::public.shift_lifecycle
   AND s.assigned_employee_id IS NOT NULL
   AND NOT s.is_cancelled
ON CONFLICT (shift_id) DO NOTHING;
