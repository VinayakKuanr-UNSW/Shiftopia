-- =====================================================================
--  Lock down materialized view `employee_daily_metrics`.
--
--  Why: Materialized views do NOT honor RLS — anyone with SELECT
--  privilege sees every row. The advisor flagged this as exposed via
--  the API to anon/authenticated (lint: materialized_view_in_api).
--
--  Audit (2026-04-29): the view aggregates per-employee, per-day shift
--  events. The repo's only reference is in the auto-generated TypeScript
--  schema types file (src/platform/types/supabase.ts); no client query
--  selects from it. Backend SECURITY DEFINER functions (callable by
--  authenticated) can still read it via service_role context.
--
--  Behavior change: zero for the app. Anyone trying to call
--  supabase.from('employee_daily_metrics').select(...) directly now
--  gets 403 — but nothing in src/ does that.
-- =====================================================================

REVOKE ALL ON public.employee_daily_metrics FROM anon, authenticated;

-- service_role and postgres (owner) keep their existing grants so the
-- refresh_performance_materialized_view() RPC continues to work.
