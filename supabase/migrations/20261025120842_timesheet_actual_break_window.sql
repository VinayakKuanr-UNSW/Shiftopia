-- ============================================================================
-- Phase 3: Actual break window on timesheets
--
-- WHY: Team members and managers record when the meal break was ACTUALLY taken
-- (actual_break_start, actual_break_end). Pay uses actual times once a timesheet
-- is recorded. Fraud guard ensures the break falls inside the clocked/billable
-- window and meets cl 36.1 (30–60 minutes).
-- ============================================================================

ALTER TABLE public.timesheets
    ADD COLUMN IF NOT EXISTS actual_break_start time without time zone,
    ADD COLUMN IF NOT EXISTS actual_break_end time without time zone;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'timesheets_actual_break_window'
          AND conrelid = 'public.timesheets'::regclass
    ) THEN
        ALTER TABLE public.timesheets
            ADD CONSTRAINT timesheets_actual_break_window
            CHECK (
                (actual_break_start IS NULL AND actual_break_end IS NULL)
                OR (
                    actual_break_start IS NOT NULL
                    AND actual_break_end IS NOT NULL
                    AND public.shift_minutes_after_start(actual_break_start, actual_break_end) BETWEEN 30 AND 60
                )
            );
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_sync_timesheet_actual_break()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF NEW.actual_break_start IS NOT NULL AND NEW.actual_break_end IS NOT NULL THEN
        NEW.unpaid_break_minutes := public.shift_minutes_after_start(NEW.actual_break_start, NEW.actual_break_end);

        IF NEW.start_time IS NOT NULL AND NEW.end_time IS NOT NULL THEN
            IF public.shift_minutes_after_start(NEW.start_time, NEW.actual_break_start) >= public.shift_minutes_after_start(NEW.start_time, NEW.actual_break_end)
               OR public.shift_minutes_after_start(NEW.start_time, NEW.actual_break_end) > public.shift_minutes_after_start(NEW.start_time, NEW.end_time) THEN
                RAISE EXCEPTION 'Actual meal break must fall within the timesheet billable window (% to %)', NEW.start_time, NEW.end_time
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_timesheet_actual_break ON public.timesheets;
CREATE TRIGGER trg_sync_timesheet_actual_break
BEFORE INSERT OR UPDATE OF actual_break_start, actual_break_end, start_time, end_time
ON public.timesheets
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_timesheet_actual_break();
