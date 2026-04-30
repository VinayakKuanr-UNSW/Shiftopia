-- =====================================================================
--  Convert 6 SECURITY DEFINER views to SECURITY INVOKER (PG 15+ feature)
--
--  Why: SECURITY DEFINER views run with the view owner's privileges,
--  bypassing RLS for every caller. Advisor flags this as ERROR-level
--  privilege escalation surface. INVOKER mode honors the caller's
--  policies on the underlying tables.
--
--  Audited 2026-04-29:
--   - All underlying tables have authenticated SELECT policies (or
--     equivalent ALL/public policies with auth.role() = 'authenticated').
--   - 3 views are actively used by clients (v_channels_with_stats,
--     v_unread_broadcasts_by_group, v_broadcast_groups_with_stats from
--     src/modules/broadcasts/api/broadcasts.queries.ts).
--   - Other 3 (v_shifts_grouped, v_template_full,
--     v_performance_data_quality_alerts) appear only as schema-graph
--     references in generated TS types or are server-side-only.
--
--  Rollback: ALTER VIEW <name> SET (security_invoker = false);
-- =====================================================================

ALTER VIEW public.v_shifts_grouped                  SET (security_invoker = true);
ALTER VIEW public.v_unread_broadcasts_by_group      SET (security_invoker = true);
ALTER VIEW public.v_performance_data_quality_alerts SET (security_invoker = true);
ALTER VIEW public.v_template_full                   SET (security_invoker = true);
ALTER VIEW public.v_channels_with_stats             SET (security_invoker = true);
ALTER VIEW public.v_broadcast_groups_with_stats     SET (security_invoker = true);
