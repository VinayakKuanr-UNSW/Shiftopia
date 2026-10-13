-- ─────────────────────────────────────────────────────────────────────────────
-- APPLIED TO PROD 2026-10-05 via the Supabase MCP (ledger version
-- 20261005130514). Do not re-run against production.
-- ─────────────────────────────────────────────────────────────────────────────

-- Pin search_path on the RBAC diagnostics (security advisor:
-- function_search_path_mutable). All three are SECURITY INVOKER, not executable
-- by client roles (no USAGE on schema diag), and reference only schema-qualified
-- relations, so this changes no behaviour — it only removes the mutable path.

ALTER FUNCTION diag.rbac_access_diff(text)         SET search_path = pg_catalog, public, diag;
ALTER FUNCTION diag.rbac_access_snapshot(uuid[])   SET search_path = pg_catalog, public, diag;
ALTER FUNCTION diag.rbac_ladder_probe()            SET search_path = pg_catalog, public, diag;
