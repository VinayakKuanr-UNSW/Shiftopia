-- =====================================================================
--  Wrap auth.uid() / auth.role() / auth.jwt() in (SELECT ...) inside
--  every public RLS policy that calls them unwrapped.
--
--  Why: when a policy says `auth.uid() = user_id`, PostgreSQL re-evaluates
--  the function for every row scanned. With (SELECT auth.uid()) the
--  planner treats the value as a constant subquery, evaluates it ONCE
--  per query, and applies the result row-by-row. At list-query scale
--  (10k+ rows) this is a multi-order-of-magnitude difference.
--
--  Performance advisor lint: auth_rls_initplan (73 hits).
--
--  Behavior change: zero. Same auth lookup, same result, dramatically
--  fewer function calls per query.
--
--  Implementation
--   - For each affected policy, pull permissive/cmd/roles/qual/with_check
--     from pg_policies, rewrite expressions, DROP + CREATE in one
--     transaction. The DO block is atomic — no policy is missing for
--     any meaningful interval.
--   - Placeholder dance (__PRE_*__ markers) avoids double-wrapping
--     existing (SELECT auth.uid()) occurrences.
--
--  Idempotent: only touches policies with at least one unwrapped match.
-- =====================================================================

DO $$
DECLARE
    p record;
    new_qual text;
    new_check text;
    role_list text;
    sql_cmd text;
    rebuilt int := 0;
BEGIN
    FOR p IN
        SELECT
            schemaname, tablename, policyname,
            permissive, cmd, roles, qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public'
          AND (
            (qual       IS NOT NULL AND qual       ~ 'auth\.(uid|jwt|role)\(\)')
         OR (with_check IS NOT NULL AND with_check ~ 'auth\.(uid|jwt|role)\(\)')
          )
    LOOP
        -- ── Wrap qual ────────────────────────────────────────────────
        new_qual := p.qual;
        IF new_qual IS NOT NULL THEN
            new_qual := regexp_replace(new_qual, '\(\s*select\s+auth\.uid\(\)\s*\)',  '__PRE_UID__',  'gi');
            new_qual := regexp_replace(new_qual, 'auth\.uid\(\)',                     '(SELECT auth.uid())',  'gi');
            new_qual := replace(new_qual, '__PRE_UID__', '(SELECT auth.uid())');
            new_qual := regexp_replace(new_qual, '\(\s*select\s+auth\.role\(\)\s*\)', '__PRE_ROLE__', 'gi');
            new_qual := regexp_replace(new_qual, 'auth\.role\(\)',                    '(SELECT auth.role())', 'gi');
            new_qual := replace(new_qual, '__PRE_ROLE__', '(SELECT auth.role())');
            new_qual := regexp_replace(new_qual, '\(\s*select\s+auth\.jwt\(\)\s*\)',  '__PRE_JWT__',  'gi');
            new_qual := regexp_replace(new_qual, 'auth\.jwt\(\)',                     '(SELECT auth.jwt())',  'gi');
            new_qual := replace(new_qual, '__PRE_JWT__', '(SELECT auth.jwt())');
        END IF;

        -- ── Wrap with_check ─────────────────────────────────────────
        new_check := p.with_check;
        IF new_check IS NOT NULL THEN
            new_check := regexp_replace(new_check, '\(\s*select\s+auth\.uid\(\)\s*\)',  '__PRE_UID__',  'gi');
            new_check := regexp_replace(new_check, 'auth\.uid\(\)',                     '(SELECT auth.uid())',  'gi');
            new_check := replace(new_check, '__PRE_UID__', '(SELECT auth.uid())');
            new_check := regexp_replace(new_check, '\(\s*select\s+auth\.role\(\)\s*\)', '__PRE_ROLE__', 'gi');
            new_check := regexp_replace(new_check, 'auth\.role\(\)',                    '(SELECT auth.role())', 'gi');
            new_check := replace(new_check, '__PRE_ROLE__', '(SELECT auth.role())');
            new_check := regexp_replace(new_check, '\(\s*select\s+auth\.jwt\(\)\s*\)',  '__PRE_JWT__',  'gi');
            new_check := regexp_replace(new_check, 'auth\.jwt\(\)',                     '(SELECT auth.jwt())',  'gi');
            new_check := replace(new_check, '__PRE_JWT__', '(SELECT auth.jwt())');
        END IF;

        IF (new_qual  IS NOT DISTINCT FROM p.qual)
       AND (new_check IS NOT DISTINCT FROM p.with_check) THEN
            CONTINUE;
        END IF;

        -- ── Build role list ─────────────────────────────────────────
        IF p.roles IS NOT NULL AND array_length(p.roles, 1) > 0 THEN
            SELECT string_agg(quote_ident(r), ', ')
              INTO role_list
              FROM unnest(p.roles) AS r;
        ELSE
            role_list := NULL;
        END IF;

        -- ── DROP + CREATE the policy ────────────────────────────────
        EXECUTE format(
            'DROP POLICY IF EXISTS %I ON %I.%I',
            p.policyname, p.schemaname, p.tablename
        );

        sql_cmd := format(
            'CREATE POLICY %I ON %I.%I AS %s FOR %s',
            p.policyname, p.schemaname, p.tablename,
            p.permissive, p.cmd
        );

        IF role_list IS NOT NULL THEN
            sql_cmd := sql_cmd || ' TO ' || role_list;
        END IF;
        IF new_qual IS NOT NULL THEN
            sql_cmd := sql_cmd || ' USING (' || new_qual || ')';
        END IF;
        IF new_check IS NOT NULL THEN
            sql_cmd := sql_cmd || ' WITH CHECK (' || new_check || ')';
        END IF;

        EXECUTE sql_cmd;
        rebuilt := rebuilt + 1;
    END LOOP;

    RAISE NOTICE 'Rebuilt % RLS policy/policies with wrapped auth.* calls', rebuilt;
END
$$;
