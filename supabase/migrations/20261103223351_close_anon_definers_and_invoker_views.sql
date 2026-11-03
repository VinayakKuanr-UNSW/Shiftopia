-- ============================================================================
-- Migration: close_anon_definers_and_invoker_views
-- Purpose:
--   Tightening only, nothing granted. Found by CI on PR #47 (rls_guard.sql and
--   tests/integration/security/anon-surface.int.test.ts).
--
--   1. CREATE OR REPLACE VIEW drops security_invoker, and the 2026-11-02 split
--      and multi-break migrations re-created v_shift_assignment_episodes and
--      v_template_full that way. Both ran with their OWNER's rights, so RLS on
--      the tables behind them did not apply to whoever queried them.
--   2. Supabase grants EXECUTE on every new function to anon. Nine new
--      SECURITY DEFINER functions kept it. The break RPCs are for signed-in
--      employees only; the rest are trigger functions nobody calls directly
--      (a trigger fires without EXECUTE; it is checked only at CREATE TRIGGER).
-- ============================================================================

ALTER VIEW public.v_shift_assignment_episodes SET (security_invoker = true);
ALTER VIEW public.v_template_full SET (security_invoker = true);

-- RPCs: signed-in callers keep EXECUTE.
REVOKE ALL ON FUNCTION public.start_break_shift(uuid, double precision, double precision) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.end_break_shift(uuid, double precision, double precision) FROM PUBLIC, anon;

-- Trigger functions: nobody calls these directly.
REVOKE ALL ON FUNCTION public.enforce_billable_review_gate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_billable_defaults_and_lengths() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_capture_billable_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sync_billables_on_timesheet_breaks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sync_timesheets_on_shift_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_timesheet_defaults() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_billable_decision() FROM PUBLIC, anon, authenticated;
