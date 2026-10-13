-- ============================================================================
-- WS-B · Make SECURITY DEFINER views respect the caller's RLS
-- ============================================================================
-- Advisor (ERROR): 7 x security_definer_view. A definer view runs with the
-- view OWNER's privileges, so it returns rows the querying user's own policies
-- would deny — silently leaking pay bands (remuneration_levels) and per-employee
-- assignment history (v_shift_assignment_episodes) across employees.
--
-- Fix: flip each to security_invoker = on so the view evaluates against the
-- CALLER's grants + RLS. The base tables already enforce the correct scoping:
--   * shifts / shift_events / timesheets  -> shifts_select_*, member/manager RLS
--   * broadcast_* / group_participants     -> broadcast + participant RLS
--   * hr.roles / hr.remuneration_levels    -> RLS on + authenticated has SELECT
--                                              (verified: has_table_privilege = t)
--
-- ⚠ VALIDATION REQUIRED before applying to prod: with invoker mode a regular
-- employee sees only their OWN rows through these views (correct), and managers
-- see their scope. Exercise the manager dashboards, broadcast unread counts,
-- and episode analytics on staging to confirm no legitimate rows disappear.
-- ----------------------------------------------------------------------------
SET search_path = public;

ALTER VIEW public.roles                         SET (security_invoker = on);
ALTER VIEW public.remuneration_levels           SET (security_invoker = on);
ALTER VIEW public.v_shifts_grouped              SET (security_invoker = on);
ALTER VIEW public.v_shift_assignment_episodes   SET (security_invoker = on);
ALTER VIEW public.v_group_all_participants      SET (security_invoker = on);
ALTER VIEW public.v_broadcast_groups_with_stats SET (security_invoker = on);
ALTER VIEW public.v_unread_broadcasts_by_group  SET (security_invoker = on);

-- Belt-and-braces: ensure the caller can reach the hr catalog tables the two
-- reference views read (harmless if already granted).
GRANT USAGE ON SCHEMA hr TO authenticated;
GRANT SELECT ON hr.roles, hr.remuneration_levels TO authenticated;
