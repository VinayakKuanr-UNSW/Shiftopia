-- ============================================================================
-- WS-E (part 2) · Init-plan: evaluate auth.*() once per query, not per row
-- ============================================================================
-- Advisor (performance): 37 x auth_rls_initplan. Policies that call auth.uid()
-- / auth.role() / auth.jwt() directly cause Postgres to re-run the function for
-- every scanned row. Wrapping the call in a scalar sub-select — (select auth.uid())
-- — makes the planner evaluate it once as an init-plan. On large tables (shifts,
-- shift_events, leave_requests) at scale this is a real throughput win.
--
-- This migration is PERFORMANCE-ONLY and SEMANTICS-PRESERVING: it rewrites the
-- auth.*() call sites and nothing else, driven mechanically from the live policy
-- definitions. Idempotent — already-wrapped occurrences (`( SELECT auth.uid() AS
-- uid)`) are protected by the @K@ sentinel and left untouched, so re-running is a
-- no-op. Any policy that fails to re-parse is skipped with a WARNING rather than
-- aborting the batch.
-- ----------------------------------------------------------------------------
SET search_path = public, hr;

DO $initplan$
DECLARE
  r          record;
  v_new_qual text;
  v_new_chk  text;
  v_sql      text;
  v_changed  int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname IN ('public', 'hr')
      AND ( (qual       IS NOT NULL AND qual       ~* 'auth\.(uid|jwt|role)\(\)')
         OR (with_check IS NOT NULL AND with_check ~* 'auth\.(uid|jwt|role)\(\)') )
  LOOP
    v_new_qual := CASE WHEN r.qual IS NULL THEN NULL ELSE
      regexp_replace(regexp_replace(regexp_replace(
        r.qual,       'SELECT auth\.(uid|jwt|role)\(\)', 'SELECT auth.\1@K@', 'gi'),
                      'auth\.(uid|jwt|role)\(\)',        '(select auth.\1())', 'g'),
                      'auth\.(uid|jwt|role)@K@',         'auth.\1()',          'g') END;
    v_new_chk := CASE WHEN r.with_check IS NULL THEN NULL ELSE
      regexp_replace(regexp_replace(regexp_replace(
        r.with_check, 'SELECT auth\.(uid|jwt|role)\(\)', 'SELECT auth.\1@K@', 'gi'),
                      'auth\.(uid|jwt|role)\(\)',        '(select auth.\1())', 'g'),
                      'auth\.(uid|jwt|role)@K@',         'auth.\1()',          'g') END;

    IF v_new_qual IS DISTINCT FROM r.qual OR v_new_chk IS DISTINCT FROM r.with_check THEN
      -- NOTE: build clauses with CASE (not format), because format('%s', NULL)
      -- renders an empty string, which would emit an invalid `USING ()` /
      -- `WITH CHECK ()` for single-clause (SELECT/DELETE vs INSERT) policies.
      v_sql := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename)
        || CASE WHEN v_new_qual IS NOT NULL THEN ' USING (' || v_new_qual || ')' ELSE '' END
        || CASE WHEN v_new_chk  IS NOT NULL THEN ' WITH CHECK (' || v_new_chk || ')' ELSE '' END;
      BEGIN
        EXECUTE v_sql;
        v_changed := v_changed + 1;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'initplan wrap skipped for %.% / %: %',
          r.schemaname, r.tablename, r.policyname, SQLERRM;
      END;
    END IF;
  END LOOP;

  RAISE NOTICE 'init-plan wrap: % policy(ies) rewritten', v_changed;
END
$initplan$;
