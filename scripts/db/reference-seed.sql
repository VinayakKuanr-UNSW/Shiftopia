-- Prints supabase/seeds/reference.sql: the reference data a local or CI
-- database needs and a schema-only dump leaves out. Read-only.
--
--   psql "$PROD_URL" -X -At -v ON_ERROR_STOP=1 -f scripts/db/reference-seed.sql > supabase/seeds/reference.sql
--
-- Normally run by scripts/db/rebaseline-from-prod.sh.
--
-- Only catalogue / configuration tables belong here — nothing that describes
-- a person. Columns that point at a person are blanked (`blank`). Tables are
-- listed parents-first so the plain INSERTs satisfy every foreign key.
-- Each row is one `INSERT … jsonb_populate_record(…) ON CONFLICT DO NOTHING`,
-- so types round-trip exactly and re-running the seed is a no-op.

\set QUIET on
\pset footer off

SELECT '-- Reference data for local and CI databases (no personal data).';
SELECT '-- GENERATED from production by scripts/db/rebaseline-from-prod.sh on '
       || to_char(now() AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD') || ' — do not edit by hand.';

WITH spec(ord, sch, rel, blank) AS (VALUES
    -- first: CHECK organizations_jurisdiction_known calls jurisdiction_is_known(),
    -- which looks the jurisdiction up in public_holidays
    ( 0, 'public', 'public_holidays',          '{}'::text[]),
    -- org structure (hr.* is canonical; the public.* copies are still read)
    ( 1, 'hr',     'organizations',            '{}'),
    ( 2, 'public', 'organizations',            '{email,phone}'),
    ( 3, 'hr',     'departments',              '{}'),
    ( 4, 'public', 'departments',              '{}'),
    ( 5, 'hr',     'subdepartments',           '{}'),
    ( 6, 'public', 'sub_departments',          '{}'),
    ( 7, 'hr',     'remuneration_levels',      '{}'),
    ( 8, 'hr',     'roles',                    '{}'),
    -- access matrix (these rows exist nowhere but production)
    ( 9, 'public', 'rbac_actions',             '{}'),
    (10, 'public', 'rbac_permissions',         '{}'),
    -- pay and calendar
    (11, 'public', 'eba_rate',                 '{}'),
    (12, 'public', 'eba_allowance',            '{}'),
    (13, 'public', 'eba_trainee_schedule',     '{}'),
    -- catalogues and configuration
    (15, 'public', 'cancellation_reasons',     '{}'),
    (16, 'public', 'skills',                   '{}'),
    (17, 'public', 'licenses',                 '{}'),
    (18, 'public', 'function_map',             '{}'),
    (19, 'public', 'labor_correction_factors', '{}'),
    (20, 'public', 'work_rules',               '{}'),
    (21, 'public', 'system_config',            '{last_modified_by}')
),
resolved AS (
    SELECT s.ord, s.blank,
           quote_ident(s.sch) || '.' || quote_ident(s.rel) AS qname,
           (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
              FROM pg_attribute a
             WHERE a.attrelid = (quote_ident(s.sch) || '.' || quote_ident(s.rel))::regclass
               AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '') AS cols
      FROM spec s
)
SELECT format(
    $q$SELECT %4$L UNION ALL (SELECT format('INSERT INTO %1$s (%2$s) SELECT %2$s FROM jsonb_populate_record(NULL::%1$s, %%L) ON CONFLICT DO NOTHING;', (to_jsonb(t) - %3$L::text[])::text) FROM %1$s t ORDER BY 1)$q$,
    qname, cols, blank, E'\n-- ' || qname)
  FROM resolved
 ORDER BY ord
\gexec
