-- ============================================================================
--  RLS / Security Audit — read-only diagnostic queries
-- ============================================================================
--
--  Purpose
--    Surface RLS gaps, dangerous SECURITY DEFINER functions, and permissive
--    policies in the live Supabase database. Every query is a SELECT — running
--    this script does NOT change any data, schema, or policy.
--
--  How to run
--    Supabase Dashboard → SQL Editor → paste this whole file → Run.
--    (Or run section-by-section using the comment headers as bookmarks.)
--    Sections are independent; nothing depends on prior results.
--
--  How to read the output
--    Each section prints a labelled result set. A section that returns
--    ZERO rows is a pass for that check. Any rows returned are findings to
--    triage — see the "Why this matters" note above each section.
--
--  Scope
--    Targets the `public` schema by default. The auth/storage/realtime
--    schemas are Supabase-managed and excluded. Adjust the schema filter at
--    the top if you have data in custom schemas.
-- ============================================================================

-- ── Configuration ─────────────────────────────────────────────────────────────
-- If you keep tenant data outside `public`, add those schema names here.
-- (Comma-separated quoted list, e.g. ARRAY['public','app_data'].)
WITH cfg AS (SELECT ARRAY['public']::text[] AS target_schemas)

-- ── Section 1: Tables in scope without RLS enabled ────────────────────────────
-- Why this matters
--   Without RLS, anon/authenticated roles see every row that PostgREST exposes.
--   Multi-tenant data (orgs, departments, profiles) without RLS is a leak.
--   Lookup tables (roles, skills) are sometimes intentionally public — confirm
--   each row in the result is expected to be world-readable.
SELECT
    '1. Tables WITHOUT RLS enabled' AS check_name,
    n.nspname AS schema,
    c.relname AS table_name,
    pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN cfg ON n.nspname = ANY(cfg.target_schemas)
WHERE c.relkind = 'r'                  -- ordinary tables only
  AND c.relrowsecurity = false
ORDER BY pg_total_relation_size(c.oid) DESC;


-- ── Section 2: Tables with RLS enabled but ZERO policies ──────────────────────
-- Why this matters
--   RLS on + zero policies = all non-owner reads/writes silently denied. This
--   is sometimes intentional (write-only via SECURITY DEFINER RPCs), but most
--   of the time it's a bug — the team forgot to add policies after enabling RLS.
SELECT
    '2. RLS enabled but NO policies' AS check_name,
    n.nspname AS schema,
    c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND c.relrowsecurity = true
  AND n.nspname IN ('public')
  AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = n.nspname AND p.tablename = c.relname
  )
ORDER BY n.nspname, c.relname;


-- ── Section 3: Permissive `USING (true)` or `WITH CHECK (true)` policies ──────
-- Why this matters
--   `USING (true)` means "every row visible" — it negates RLS for that command.
--   Sometimes deliberate (SELECT on a public catalogue), but for INSERT/UPDATE/
--   DELETE on tenant data this is almost always a bug.
SELECT
    '3. Policies with USING (true) or WITH CHECK (true)' AS check_name,
    schemaname AS schema,
    tablename,
    policyname,
    cmd AS command,
    roles,
    qual AS using_clause,
    with_check
FROM pg_policies
WHERE schemaname IN ('public')
  AND (
      qual IN ('true', '(true)') OR
      with_check IN ('true', '(true)')
  )
ORDER BY tablename, policyname;


-- ── Section 4: Policies that never reference auth.uid() / auth.jwt() ──────────
-- Why this matters
--   Tenant-scoped tables (anything keyed by user_id, organization_id,
--   department_id) should typically check the caller's identity. Policies that
--   never reference auth.* may be too broad. Lookup/reference tables are an
--   acceptable exception — judge each row individually.
SELECT
    '4. Policies with no auth.* reference (likely too broad)' AS check_name,
    schemaname AS schema,
    tablename,
    policyname,
    cmd AS command,
    roles,
    qual AS using_clause
FROM pg_policies
WHERE schemaname IN ('public')
  AND COALESCE(qual, '') !~* '\bauth\.(uid|jwt|role)\b'
  AND COALESCE(with_check, '') !~* '\bauth\.(uid|jwt|role)\b'
ORDER BY tablename, policyname;


-- ── Section 5: INSERT/UPDATE policies missing WITH CHECK ──────────────────────
-- Why this matters
--   For INSERT and UPDATE, USING is checked against the OLD row but only
--   WITH CHECK is checked against the NEW row. An INSERT policy with no
--   WITH CHECK means anyone who passes USING can insert ANY row. UPDATE without
--   WITH CHECK lets a user modify a row they own into one they don't.
SELECT
    '5. INSERT/UPDATE policies without WITH CHECK' AS check_name,
    schemaname AS schema,
    tablename,
    policyname,
    cmd AS command,
    roles,
    qual AS using_clause
FROM pg_policies
WHERE schemaname IN ('public')
  AND cmd IN ('INSERT', 'UPDATE', 'ALL')
  AND (with_check IS NULL OR with_check = '')
ORDER BY tablename, policyname;


-- ── Section 6: SECURITY DEFINER functions without SET search_path ─────────────
-- Why this matters
--   SECURITY DEFINER functions run with the owner's privileges (typically a
--   superuser-level role) and bypass RLS. Without `SET search_path = ''` (or
--   an explicit safe path), an attacker who can create objects in a schema
--   on the search_path can hijack function calls. Required hardening for any
--   DEFINER function that touches sensitive data.
SELECT
    '6. SECURITY DEFINER functions without SET search_path' AS check_name,
    n.nspname AS schema,
    p.proname AS function_name,
    pg_get_userbyid(p.proowner) AS owner,
    p.prosecdef AS is_security_definer,
    p.proconfig AS function_settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef = true
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pgsodium', 'vault')
  AND (
      p.proconfig IS NULL
      OR NOT EXISTS (
          SELECT 1 FROM unnest(p.proconfig) AS s
          WHERE s ILIKE 'search_path=%'
      )
  )
ORDER BY n.nspname, p.proname;


-- ── Section 7: SECURITY DEFINER functions executable by anon ──────────────────
-- Why this matters
--   A SECURITY DEFINER function bypasses RLS. If `anon` (the unauthenticated
--   role used by the public Supabase API key) can EXECUTE it, the function
--   becomes a public RPC with full DB privileges of its owner. Triple-check
--   the body of every row in this result.
SELECT
    '7. SECURITY DEFINER functions callable by anon' AS check_name,
    n.nspname AS schema,
    p.proname AS function_name,
    pg_get_userbyid(p.proowner) AS owner,
    pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef = true
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
ORDER BY n.nspname, p.proname;


-- ── Section 8: Tables granting SELECT/INSERT/UPDATE/DELETE to anon ────────────
-- Why this matters
--   Even with RLS on, a privilege grant to `anon` says "we expect public users
--   to call this". For most app tables that's wrong — the public surface
--   should be RPCs, not direct table access. This catches cases where someone
--   ran `GRANT ALL ON TABLE … TO anon` during development and forgot to undo.
SELECT
    '8. Direct table grants to anon' AS check_name,
    table_schema AS schema,
    table_name,
    string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE grantee = 'anon'
  AND table_schema IN ('public')
GROUP BY table_schema, table_name
ORDER BY table_schema, table_name;


-- ── Section 9: Materialized views and foreign tables ──────────────────────────
-- Why this matters
--   RLS does NOT apply to materialized views or foreign tables — only ordinary
--   tables. If a materialized view aggregates tenant data and is exposed via
--   PostgREST, every row is visible to every caller. Either restrict via
--   GRANTs, hide from the API (`REVOKE` on the role), or back the view with
--   a SECURITY INVOKER function.
SELECT
    '9. Materialized views / foreign tables (RLS does not apply)' AS check_name,
    n.nspname AS schema,
    c.relname AS object_name,
    CASE c.relkind WHEN 'm' THEN 'materialized view' WHEN 'f' THEN 'foreign table' END AS kind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('m', 'f')
  AND n.nspname IN ('public')
ORDER BY n.nspname, c.relname;


-- ── Section 10: Multiple permissive policies on same table/role/command ───────
-- Why this matters
--   Multiple permissive policies are OR-combined. This is sometimes intentional
--   ("manager can see all, employee can see own") but can also be a sign of
--   accidental policy duplication after a refactor — an old policy left in
--   place silently widens the access surface. Worth a manual review.
SELECT
    '10. Tables with >1 permissive policy per (role, command)' AS check_name,
    schemaname AS schema,
    tablename,
    cmd AS command,
    unnest(roles) AS role_name,
    count(*) AS policy_count,
    string_agg(policyname, ', ' ORDER BY policyname) AS policies
FROM pg_policies
WHERE schemaname IN ('public')
  AND permissive = 'PERMISSIVE'
GROUP BY schemaname, tablename, cmd, unnest(roles)
HAVING count(*) > 1
ORDER BY tablename, cmd;


-- ── Section 11: Storage buckets without policies ──────────────────────────────
-- Why this matters
--   Supabase Storage uses storage.objects with RLS. A bucket with zero
--   policies is either entirely closed (no one can read) or entirely open
--   (no constraints) depending on whether the bucket is `public`. Public
--   buckets without policies = anyone with the URL pattern can list/read.
SELECT
    '11. Storage buckets and their policy counts' AS check_name,
    b.id AS bucket,
    b.public AS is_public,
    (SELECT count(*) FROM pg_policies p
       WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
         AND p.qual ILIKE '%bucket_id%' || b.id || '%') AS policies_referencing_bucket
FROM storage.buckets b
ORDER BY b.public DESC, b.id;


-- ── Section 12: Summary counts ────────────────────────────────────────────────
-- Quick at-a-glance: how many tables, how many policies, how much DEFINER code.
SELECT
    '12. Summary' AS check_name,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE c.relkind='r' AND n.nspname='public') AS public_tables,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE c.relkind='r' AND n.nspname='public' AND c.relrowsecurity=true) AS rls_enabled_tables,
    (SELECT count(*) FROM pg_policies WHERE schemaname='public') AS public_policies,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE p.prosecdef=true AND n.nspname='public') AS public_definer_functions;
