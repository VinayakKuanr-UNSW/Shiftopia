-- One line per database object: kind <TAB> name <TAB> md5 of its definition.
-- Run it against two databases and diff the output to find every object whose
-- definition differs — columns, constraints, indexes, functions (body + grants),
-- views, RLS policies, triggers, table / sequence / schema grants, default
-- privileges, enums, RLS flags. Read-only.
--
--   psql "$URL" -X -At -v ON_ERROR_STOP=1 -f scripts/db/schema-fingerprint.sql > prod.txt
--
-- Covers every schema the app owns (everything Supabase does not manage), plus
-- the storage policies / bucket and auth.users trigger that live outside them.
-- Grants are compared by grantee + privilege only; grantors and owners differ
-- legitimately between a restored dump and the live project.

\set QUIET on
\pset footer off
\pset fieldsep '\t'

WITH app_ns AS (
    SELECT oid, nspname FROM pg_namespace
     WHERE nspname NOT LIKE 'pg\_%' AND nspname NOT IN (
           'information_schema', 'auth', 'storage', 'realtime', 'extensions', 'graphql',
           'graphql_public', 'vault', 'net', 'cron', 'supabase_migrations', 'pgbouncer',
           'pgsodium', 'pgsodium_masks', 'supabase_functions', '_realtime', '_analytics',
           'pgtle', 'topology', 'tiger', 'tiger_data')
),
rels AS (
    SELECT c.oid, c.relkind, n.nspname || '.' || c.relname AS name, c.relacl, c.relowner,
           c.relrowsecurity, c.relforcerowsecurity, c.reloptions
      FROM pg_class c JOIN app_ns n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
),
acl AS (  -- normalised grants: grantee:privilege, sorted; owner and grantor ignored
    SELECT r.oid,
           string_agg(coalesce(g.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(g.rolname, 'PUBLIC') || ':' || x.privilege_type) AS grants
      FROM rels r, aclexplode(coalesce(r.relacl, acldefault((CASE WHEN r.relkind = 'S' THEN 's' ELSE 'r' END)::"char", r.relowner))) x
      LEFT JOIN pg_roles g ON g.oid = x.grantee
     WHERE x.grantee <> r.relowner
     GROUP BY r.oid
),
fns AS (
    SELECT p.oid, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name,
           p.proacl, p.proowner
      FROM pg_proc p JOIN app_ns n ON n.oid = p.pronamespace
     WHERE p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')  -- skip extension members
),
fn_acl AS (
    SELECT f.oid,
           string_agg(coalesce(g.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(g.rolname, 'PUBLIC') || ':' || x.privilege_type) AS grants
      FROM fns f, aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) x
      LEFT JOIN pg_roles g ON g.oid = x.grantee
     WHERE x.grantee <> f.proowner
     GROUP BY f.oid
),
lines(kind, name, def) AS (
    -- tables: columns (by name, so column order does not matter)
    SELECT 'columns', r.name,
           string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                      || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
                      || coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')
                      || CASE WHEN a.attgenerated <> '' THEN ' GENERATED' ELSE '' END,
                      ', ' ORDER BY a.attname)
      FROM rels r JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE r.relkind IN ('r', 'p', 'f')
     GROUP BY r.name
    UNION ALL
    SELECT 'rls', r.name, r.relrowsecurity::text || '/' || r.relforcerowsecurity::text
      FROM rels r WHERE r.relkind IN ('r', 'p')
    UNION ALL
    SELECT 'table_grants', r.name, coalesce(a.grants, '')
      FROM rels r LEFT JOIN acl a ON a.oid = r.oid
    UNION ALL
    SELECT 'view', r.name, pg_get_viewdef(r.oid) || coalesce(array_to_string(r.reloptions, ','), '')
      FROM rels r WHERE r.relkind IN ('v', 'm')
    UNION ALL
    SELECT 'constraint', r.name || '.' || con.conname, pg_get_constraintdef(con.oid)
      FROM rels r JOIN pg_constraint con ON con.conrelid = r.oid
    UNION ALL
    SELECT 'index', n.nspname || '.' || ic.relname, pg_get_indexdef(i.indexrelid)
      FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN app_ns n ON n.oid = ic.relnamespace
    UNION ALL
    SELECT 'function', f.name, pg_get_functiondef(f.oid)
      FROM fns f
    UNION ALL
    SELECT 'function_grants', f.name, coalesce(a.grants, '')
      FROM fns f LEFT JOIN fn_acl a ON a.oid = f.oid
    UNION ALL
    SELECT 'trigger', r.name || '.' || t.tgname, pg_get_triggerdef(t.oid)
      FROM rels r JOIN pg_trigger t ON t.tgrelid = r.oid AND NOT t.tgisinternal
    UNION ALL
    SELECT 'policy', p.schemaname || '.' || p.tablename || '.' || p.policyname,
           p.cmd || '|' || p.permissive || '|' || array_to_string(p.roles, ',') || '|'
           || coalesce(p.qual, '') || '|' || coalesce(p.with_check, '')
      FROM pg_policies p
     WHERE p.schemaname IN (SELECT nspname FROM app_ns) OR p.schemaname = 'storage'
    UNION ALL
    SELECT 'enum', n.nspname || '.' || t.typname,
           string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
      FROM pg_type t JOIN app_ns n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
     GROUP BY n.nspname, t.typname
    UNION ALL
    SELECT 'bucket', b.id, b.public::text || '|' || coalesce(b.file_size_limit::text, '') || '|'
           || coalesce(array_to_string(b.allowed_mime_types, ','), '')
      FROM storage.buckets b
    UNION ALL
    SELECT 'auth_trigger', t.tgname, pg_get_triggerdef(t.oid)
      FROM pg_trigger t WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal
    UNION ALL
    SELECT 'schema_grants', n.nspname,
           coalesce(string_agg(coalesce(g.rolname, 'PUBLIC') || ':' || x.privilege_type, ','
                               ORDER BY coalesce(g.rolname, 'PUBLIC') || ':' || x.privilege_type), '')
      FROM pg_namespace n
      LEFT JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) x ON x.grantee <> n.nspowner
      LEFT JOIN pg_roles g ON g.oid = x.grantee
     WHERE n.oid IN (SELECT oid FROM app_ns)
     GROUP BY n.nspname
    UNION ALL
    SELECT 'default_privileges',
           pg_get_userbyid(d.defaclrole) || ' ' || coalesce(n.nspname, '*') || ' ' || d.defaclobjtype::text,
           string_agg(coalesce(g.rolname, 'PUBLIC') || ':' || x.privilege_type, ','
                      ORDER BY coalesce(g.rolname, 'PUBLIC') || ':' || x.privilege_type)
      FROM pg_default_acl d
      LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) x
      LEFT JOIN pg_roles g ON g.oid = x.grantee
     WHERE d.defaclnamespace = 0 OR d.defaclnamespace IN (SELECT oid FROM app_ns)
     GROUP BY d.defaclrole, n.nspname, d.defaclobjtype
)
SELECT kind, name, md5(def) FROM lines ORDER BY kind, name;
