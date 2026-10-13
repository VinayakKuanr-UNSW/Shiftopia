-- ─────────────────────────────────────────────────────────────────────────────
-- APPLIED TO PROD 2026-10-05 via the Supabase MCP (ledger version
-- 20261005123852). Do not re-run against production. Rollback-only dry-run
-- beforehand: certificate reads unchanged (employee 1, admin 102); with
-- EXECUTE revoked the template FT guard still fired (PT → FT refused 23514).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- Advisor cleanup after the 2026-10-05 hardening pass.
--
-- Nine functions were EXECUTE-able by anon (the security advisor's
-- anon_security_definer_function_executable list). Eight are trigger functions:
-- PostgREST exposes them as /rpc endpoints, but Postgres refuses to run a
-- trigger function outside a trigger, and firing a trigger performs no EXECUTE
-- check on the caller — so revoking from every client role is pure surface
-- reduction. enforce_no_ft_template_shifts is the same kind of function (an
-- invoker trigger) and also had no pinned search_path.
--
-- auth_can_manage_certificates() is different: the certificate RLS policy calls
-- it, and policy expressions run with the caller's privileges, so signed-in
-- users must keep EXECUTE. It is only taken away from PUBLIC and anon (it
-- returned false for them anyway).
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.enforce_no_ft_template_shifts()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_timesheet_review_gate()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_capture_timesheet_event()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_enforce_shift_employment_target()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_refresh_snapshots_on_event()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_seed_fixed_template_groups()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_fan_out_broadcast()                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_leave_request_outcome_notification()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_shift_swap_outcome_notification()      FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.auth_can_manage_certificates()             FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_can_manage_certificates()          TO authenticated, service_role;

ALTER FUNCTION public.enforce_no_ft_template_shifts() SET search_path = pg_catalog, public;
