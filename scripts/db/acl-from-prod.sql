-- Prints supabase/migrations/20251015000003_baseline_acl_from_prod.sql: the
-- exact grants production has on every app-owned function, table, view and
-- sequence. Read-only.
--
--   psql "$PROD_URL" -X -At -v ON_ERROR_STOP=1 -f scripts/db/acl-from-prod.sql
--
-- Normally run by scripts/db/rebaseline-from-prod.sh.
--
-- Why it is needed: pg_dump writes grants relative to Postgres' built-in
-- defaults, but a Supabase database ALSO has default privileges that hand
-- anon / authenticated / service_role every new table and function. Restoring
-- the dump therefore re-grants everything production deliberately revoked —
-- `anon` could EXECUTE every SECURITY DEFINER RPC locally. So for each object
-- this revokes the four client-facing roles and re-grants exactly what
-- production holds. Owner privileges are untouched.

\set QUIET on
\pset footer off
-- Empty search_path: ::regprocedure / ::regclass then print fully-qualified
-- names, including argument types such as public.shifts.
SET search_path = '';

SELECT '-- Supplement to the baseline schema: production''s exact grants.';
SELECT '-- GENERATED from production by scripts/db/rebaseline-from-prod.sh on '
       || to_char(now() AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD') || ' — do not edit by hand.';
SELECT '-- See scripts/db/acl-from-prod.sql for why the dump alone is not enough.';
SELECT '';

WITH app_ns AS (
    SELECT oid FROM pg_namespace
     WHERE nspname NOT LIKE 'pg\_%' AND nspname NOT IN (
           'information_schema', 'auth', 'storage', 'realtime', 'extensions', 'graphql',
           'graphql_public', 'vault', 'net', 'cron', 'supabase_migrations', 'pgbouncer',
           'pgsodium', 'pgsodium_masks', 'supabase_functions', '_realtime', '_analytics',
           'pgtle', 'topology', 'tiger', 'tiger_data')
),
objs AS (
    SELECT 1 AS ord, 'ROUTINE' AS kind, p.oid::regprocedure::text AS name,
           coalesce(p.proacl, acldefault('f', p.proowner)) AS acl, p.proowner AS owner
      FROM pg_proc p JOIN app_ns n ON n.oid = p.pronamespace
     WHERE p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    UNION ALL
    SELECT CASE WHEN c.relkind = 'S' THEN 3 ELSE 2 END,
           CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
           c.oid::regclass::text,
           coalesce(c.relacl, acldefault((CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END)::"char", c.relowner)),
           c.relowner
      FROM pg_class c JOIN app_ns n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
),
grants AS (
    SELECT o.ord, o.kind, o.name, x.grantee, x.is_grantable,
           string_agg(x.privilege_type, ', ' ORDER BY x.privilege_type) AS privs
      FROM objs o, aclexplode(o.acl) x
     WHERE x.grantee <> o.owner
     GROUP BY o.ord, o.kind, o.name, x.grantee, x.is_grantable
)
SELECT line FROM (
    SELECT o.ord, o.name, 0 AS step,
           format('REVOKE ALL ON %s %s FROM PUBLIC, anon, authenticated, service_role;', o.kind, o.name) AS line
      FROM objs o
    UNION ALL
    SELECT g.ord, g.name, 1,
           format('GRANT %s ON %s %s TO %s%s;', g.privs, g.kind, g.name,
                  CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END,
                  CASE WHEN g.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
      FROM grants g
) s
ORDER BY ord, name, step, line;
