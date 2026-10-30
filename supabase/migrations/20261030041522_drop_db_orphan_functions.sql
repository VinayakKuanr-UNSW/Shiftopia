-- Five functions nothing references.
--
-- Found 2026-10-30 by scanning every function in public/hr/internal against
-- other function bodies, triggers, policies, views, column defaults, CHECKs and
-- cron, then the app, edge functions, solver, ML code, scripts and tests. None
-- has a dependent object. Overlap is enforced by the trigger
-- fn_shift_no_overlap, not by check_shift_overlap.
-- Not dropped: the functions the user chose to keep on 2026-10-28 (TOIL,
-- access-matrix test helpers, certificate/contract checks, delete_user_entirely).
--
-- Test: supabase/tests/db_orphan_functions_dropped.sql.
-- Rollback: ~/Documents/superman-db-exports/2026-10-30/db-orphans/.

DROP FUNCTION public.cancel_shift(uuid, uuid, text);
DROP FUNCTION public.check_shift_overlap(uuid, date, time without time zone, time without time zone, uuid);
DROP FUNCTION public.compute_employee_quarter_metrics(uuid, text);
DROP FUNCTION public.fn_shift_state(text, text, text, text, text, boolean);
DROP FUNCTION public.is_manager_or_above();

