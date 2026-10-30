-- Drop 12 function signatures that nothing calls any more.
--
-- Each was checked against the live database on 2026-10-29: no trigger, cron
-- job, policy, view, column default, check constraint or other function body
-- names it, and no code in src/, supabase/functions/, supabase/tests/, tests/,
-- scripts/, optimizer-service/ or ml/ calls it (generated types aside). Most
-- were orphaned when the earlier sweeps dropped their only callers:
--   - sm_require_self / sm_require_roster_action: guards injected 2026-10-05
--     into acknowledge_broadcast, mark_broadcast_read and
--     sm_clear_template_application, all since dropped.
--   - calculate_weekly_hours: its caller was the evaluate-compliance edge
--     function, deleted 2026-10-26.
--   - cancel_shift_v2 (both): stubs that only RAISE LEGACY_RPC_DISABLED_V3.
--   - aa_user_manages_org, check_rest_period, fn_is_shift_locked,
--     get_employee_metrics (both), resolve_audit_uuid_array/_name: no caller
--     since at least 2026-06.
--
-- Kept on purpose: check_state_machine_invariants_v3 (shift-status diagnostic;
-- the status lineages are out of this sweep's scope).
--
-- Rollback: the exact definitions and grants are in
-- ~/Documents/superman-db-exports/2026-10-29/orphaned-functions/
-- (functions.sql, grants.sql, SHA256SUMS).

DROP FUNCTION public.aa_user_manages_org(uuid, uuid);
DROP FUNCTION public.calculate_weekly_hours(uuid, date);
DROP FUNCTION public.cancel_shift_v2(uuid, text);
DROP FUNCTION public.cancel_shift_v2(uuid, text, uuid);
DROP FUNCTION public.check_rest_period(uuid, date, time without time zone, time without time zone);
DROP FUNCTION public.fn_is_shift_locked(uuid);
DROP FUNCTION public.get_employee_metrics(uuid, timestamp with time zone, timestamp with time zone);
DROP FUNCTION public.get_employee_metrics(uuid, timestamp with time zone, timestamp with time zone, uuid);
DROP FUNCTION public.resolve_audit_uuid_array(text, jsonb);
DROP FUNCTION public.resolve_audit_uuid_name(text, uuid);
DROP FUNCTION public.sm_require_roster_action(uuid, text);
DROP FUNCTION public.sm_require_self(uuid);
