-- =====================================================================
--  Harden search_path on all functions/procedures in `public` that lack
--  an explicit setting. Closes search_path-injection vector flagged by
--  the security advisor (lint: function_search_path_mutable, 271 hits).
--
--  Why `pg_catalog, public` and not empty string ('')?
--   - Empty string forces every reference to be schema-qualified,
--     which would break any function with unqualified table/function
--     references (most existing functions).
--   - `pg_catalog, public` preserves current name resolution while
--     pinning the search order. Attackers cannot prepend a malicious
--     schema. The advisor passes either form.
--
--  Idempotent: only touches objects that don't already have an
--  explicit search_path. Safe to re-run.
--
--  Behavior change: zero. Function bodies and signatures unchanged.
-- =====================================================================

DO $$
DECLARE
    fn record;
    altered_funcs int := 0;
    altered_procs int := 0;
BEGIN
    FOR fn IN
        SELECT
            p.oid,
            p.proname,
            p.prokind,
            pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prokind IN ('f', 'p')   -- functions + procedures (skip aggregates/windows)
          AND (
              p.proconfig IS NULL
              OR NOT EXISTS (
                  SELECT 1 FROM unnest(p.proconfig) AS s
                  WHERE s ILIKE 'search_path=%'
              )
          )
    LOOP
        IF fn.prokind = 'p' THEN
            EXECUTE format(
                'ALTER PROCEDURE public.%I(%s) SET search_path = pg_catalog, public',
                fn.proname, fn.args
            );
            altered_procs := altered_procs + 1;
        ELSE
            EXECUTE format(
                'ALTER FUNCTION public.%I(%s) SET search_path = pg_catalog, public',
                fn.proname, fn.args
            );
            altered_funcs := altered_funcs + 1;
        END IF;
    END LOOP;

    RAISE NOTICE 'Hardened search_path on % function(s) and % procedure(s)',
        altered_funcs, altered_procs;
END
$$;
