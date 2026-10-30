-- Drop the dead tables that still held data, and the two cron jobs that have
-- failed on every run since 2026-04-21.
--
-- Every table below was exported first (CSV + schema-only DDL + SHA256SUMS) to
-- ~/Documents/superman-db-exports/2026-10-28/ on the maintainer's machine; the
-- row counts in the files matched the live tables. Nothing reads or writes them:
-- no view, foreign key, trigger, cron job, or function body in any schema names
-- them, and the app only had them in the generated types.
--
--   dead_shift_cleanup_log (9,569 rows), dead_shift_cleanup_rules (1 row)
--     Their writer and its cron job are gone. The log is per-run counters only:
--     179 shifts deleted 2026-07-29..08-03, then every run from 08-04 to its
--     last on 10-03 errored ("timesheet_review_queue does not exist") and
--     deleted nothing — so it did NOT cause the 2026-09-30 shifts wipe.
--   _backup_leave_balances_casual_20261001 (34), _backup_retired_structure_20261009 (271)
--     One-off safety copies taken before the 10-01 and 10-09 data changes.
--
-- Kept, though nothing in the app reads them: venueops_booked_spaces and
-- venueops_tasks. They are part of the mirrored VenueOps dataset, and the ML
-- feature room_count is derived from venueops_booked_spaces (supabase/seed.sql).
--
-- Cron:
--   refresh_performance_metrics_hourly  calls refresh_performance_metrics(),
--     which no longer exists (3,554 failed runs).
--   daily_notify_admins_pending_dept    calls notify_admins_pending_department_assignments(),
--     which reads public.user_department_audit, also gone (191 failed runs).
--     Nothing else calls the function, so it goes too.

SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN ('refresh_performance_metrics_hourly', 'daily_notify_admins_pending_dept');

DROP FUNCTION IF EXISTS public.notify_admins_pending_department_assignments();

DROP TABLE IF EXISTS public.dead_shift_cleanup_log;
DROP TABLE IF EXISTS public.dead_shift_cleanup_rules;
DROP TABLE IF EXISTS public._backup_leave_balances_casual_20261001;
DROP TABLE IF EXISTS public._backup_retired_structure_20261009;
