-- Drop seven empty, unreferenced tables.
--
-- Checked on 2026-10-28: each holds zero rows, no function body in ANY schema,
-- view, policy or cron job names it, no foreign key points into it, and no
-- codebase (app, edge functions, optimizer, ml, scripts, SQL tests, CI) uses it.
--
-- Not dropped, though also unreferenced: shift_skills / shift_licenses (read by
-- internal.eba_check_assignment), tables other tables still reference
-- (venueops_* lookups, autoschedule_sessions), and the ones holding data
-- (dead_shift_cleanup_*, venueops_tasks, venueops_booked_spaces, the
-- _backup_* snapshots), which need an explicit decision.
--
-- No CASCADE: anything still depending on a table makes this fail.

DROP TABLE public.ml_prediction_outcomes;
DROP TABLE public.swap_validations;
DROP TABLE public.bulk_operations;
DROP TABLE public.actual_labor_attendance;
DROP TABLE public.swap_notifications;
DROP TABLE public.role_levels;
DROP TABLE public.shift_subgroups;
