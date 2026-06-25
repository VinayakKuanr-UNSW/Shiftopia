-- =====================================================================
-- Security: stop anon / PUBLIC from executing the KPI + projection functions.
-- =====================================================================
-- These are SECURITY DEFINER (they bypass RLS and read org-wide data), but were
-- created without a REVOKE, so they inherited the default PUBLIC EXECUTE grant —
-- meaning the `anon` (unauthenticated) role could run them and read aggregate
-- KPI / scorecard / lifecycle data. Lock them to authenticated + service_role.
-- (Flagged by get_advisors: anon_security_definer_function_executable.)
--
-- sm_refresh_shift_snapshots is internal (only the AFTER INSERT trigger on
-- shift_events calls it, in definer context) — it needs NO role grant at all,
-- so it is locked down to service_role only.
-- =====================================================================

REVOKE EXECUTE ON FUNCTION public.get_marketplace_kpis(date, date, uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_marketplace_kpis(date, date, uuid[], uuid[], uuid[]) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_manager_scorecard(date, date, uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_manager_scorecard(date, date, uuid[], uuid[], uuid[]) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_bidding_kpis(date, date, uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_bidding_kpis(date, date, uuid[], uuid[], uuid[]) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_shift_lifecycle(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_shift_lifecycle(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.sm_refresh_shift_snapshots(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sm_refresh_shift_snapshots(uuid) TO service_role;
