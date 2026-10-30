-- Populate break_start and break_end for existing template_shifts and validate constraint
--
-- Shifts longer than 5 hours with unpaid meal breaks require break windows (cl 36.1).
-- This sets a compliant mid-shift meal break (4 hours after start time) matching
-- unpaid_break_minutes duration, and validates template_shifts_break_window.

UPDATE public.template_shifts
SET
    break_start = (start_time + interval '4 hours')::time,
    break_end = ((start_time + interval '4 hours')::time + (unpaid_break_minutes || ' minutes')::interval)::time
WHERE unpaid_break_minutes > 0 AND break_start IS NULL;

ALTER TABLE public.template_shifts VALIDATE CONSTRAINT template_shifts_break_window;
