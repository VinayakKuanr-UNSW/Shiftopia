-- ============================================================================
-- A Security member's actual meal break is recorded, not deducted
--
-- fn_sync_timesheet_actual_break (20261025120842) set
-- unpaid_break_minutes := the actual window's length for everyone. A Security
-- meal break is PAID (EBA Sch 3 §3.2(a) full-time, §5.3(a) event), so every
-- Security timesheet with an actual break lost that half hour of pay. The
-- rostered side already has this right: shifts.unpaid_break_minutes is 0 for
-- Security however long the window is.
--
-- "Security" is the shift's role, by the one rule the codebase uses for it
-- (isSecurityRoleName: the role name contains "security").
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_timesheet_actual_break()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_meal_is_paid boolean;
BEGIN
    IF NEW.actual_break_start IS NOT NULL AND NEW.actual_break_end IS NOT NULL THEN
        v_meal_is_paid := EXISTS (
            SELECT 1 FROM public.shifts s JOIN public.roles r ON r.id = s.role_id
             WHERE s.id = NEW.shift_id AND r.name ILIKE '%security%');

        NEW.unpaid_break_minutes := CASE WHEN v_meal_is_paid THEN 0
            ELSE public.shift_minutes_after_start(NEW.actual_break_start, NEW.actual_break_end) END;

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
