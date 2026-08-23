-- ============================================================================
-- Restore security_invoker on v_shift_assignment_episodes.
--
-- Migration 20260823100000 replaced the view body from pg_get_viewdef() output
-- to move the cancellation threshold to 24h. pg_get_viewdef() returns only the
-- SELECT — it does NOT include reloptions — and CREATE OR REPLACE VIEW resets
-- any option not restated. That silently dropped the `security_invoker = on`
-- set by 20260719000200, so the view reverted to running with its owner's
-- privileges and stopped enforcing the caller's RLS on shifts and shift_events.
--
-- Caught by get_advisors: security_definer_view went from one finding to two.
-- 20260823100000 has since been amended to restate the option itself, so this
-- migration is belt-and-braces for an environment that already ran the
-- unamended version.
--
-- ANY future CREATE OR REPLACE VIEW in this project must restate reloptions.
-- ============================================================================

ALTER VIEW public.v_shift_assignment_episodes SET (security_invoker = on);
