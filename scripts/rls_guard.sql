-- ============================================================================
-- RLS regression guard  (WS-F)
-- ============================================================================
-- Fails (raises) if the access-control fixes regress. Run in CI against the
-- target database:
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/rls_guard.sql
--
-- Checks:
--   1. No always-true WRITE policy on a sensitive (money/compliance) table.
--   2. EVERY public view is security_invoker (was: a list of 7, which missed
--      public.user_contracts — the view whose CREATE OR REPLACE silently dropped
--      the option and let the anon key rewrite every contract, 2026-10-05).
--   3. No sensitive table has RLS disabled.
--   4. No WRITE policy on any public/hr table that any signed-in user satisfies
--      — `true`, `auth.uid() IS NOT NULL` or `auth.role() = 'authenticated'`
--      (the last two are the same hole spelled differently; a check for the
--      literal `true` missed four of them, 2026-10-05).
--   5. No SECURITY DEFINER function in public is EXECUTE-able by anon.
-- Keep the sensitive-table lists in sync as new tables are added.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_bad text;
BEGIN
  -- 1) always-true writes on sensitive tables --------------------------------
  SELECT string_agg(format('%s.%s/%s[%s]', schemaname, tablename, policyname, cmd), '; ')
  INTO v_bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'timesheets','department_budgets','work_rules','system_config',
      'employee_performance_metrics','employee_performance_snapshots',
      'swap_requests','attendance_records','deleted_shifts',
      'gross_pay_records','shift_payroll_records'
    )
    AND cmd <> 'SELECT'
    AND ( COALESCE(qual, '') = 'true' OR COALESCE(with_check, '') = 'true' );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS guard FAILED — always-true write policy on sensitive table(s): %', v_bad;
  END IF;

  -- 2) every public view must be security_invoker ----------------------------
  --    A view without it runs as its owner and bypasses the RLS of what it
  --    reads. CREATE OR REPLACE VIEW without WITH (security_invoker = on)
  --    silently drops the option, so this checks all views, not a list.
  SELECT string_agg(c.relname, '; ')
  INTO v_bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
    AND NOT COALESCE(array_to_string(c.reloptions, ',') ~ 'security_invoker=(on|true)', false);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS guard FAILED — view(s) not security_invoker: %', v_bad;
  END IF;

  -- 3) sensitive tables must keep RLS enabled --------------------------------
  SELECT string_agg(c.relname, '; ')
  INTO v_bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND c.relname IN (
      'timesheets','department_budgets','work_rules','system_config',
      'employee_performance_metrics','employee_performance_snapshots',
      'swap_requests','attendance_records','deleted_shifts','swap_review_queue'
    )
    AND c.relrowsecurity = false;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS guard FAILED — RLS disabled on sensitive table(s): %', v_bad;
  END IF;

  -- 4) no write policy any signed-in user satisfies ---------------------------
  --    An absent USING / WITH CHECK counts as true. Policies granted only to
  --    service_role are exempt.
  SELECT string_agg(format('%s.%s/%s[%s]', schemaname, tablename, policyname, cmd), '; ')
  INTO v_bad
  FROM pg_policies
  WHERE schemaname IN ('public', 'hr')
    AND cmd <> 'SELECT'
    AND NOT (roles <@ ARRAY['service_role']::name[])
    AND COALESCE(NULLIF(regexp_replace(COALESCE(qual, ''), '\s+', ' ', 'g'), ''), 'true')
        ~* '^\(*\s*(true|\(*\s*select auth\.uid\(\) as uid\)*\s*is not null|auth\.uid\(\) is not null|\(*\s*select auth\.role\(\) as role\)*\s*=\s*''authenticated''::text|auth\.role\(\) = ''authenticated''::text)\s*\)*$'
    AND COALESCE(NULLIF(regexp_replace(COALESCE(with_check, ''), '\s+', ' ', 'g'), ''), 'true')
        ~* '^\(*\s*(true|\(*\s*select auth\.uid\(\) as uid\)*\s*is not null|auth\.uid\(\) is not null|\(*\s*select auth\.role\(\) as role\)*\s*=\s*''authenticated''::text|auth\.role\(\) = ''authenticated''::text)\s*\)*$';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS guard FAILED — write policy any signed-in user satisfies: %', v_bad;
  END IF;

  -- 5) no SECURITY DEFINER function executable by anon -------------------------
  --    REVOKE FROM anon and REVOKE FROM PUBLIC are separate holes; CREATE OR
  --    REPLACE re-grants. has_function_privilege sees both.
  SELECT string_agg(p.oid::regprocedure::text, '; ')
  INTO v_bad
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.prosecdef
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS guard FAILED — SECURITY DEFINER function(s) executable by anon: %', v_bad;
  END IF;

  RAISE NOTICE 'RLS guard PASSED.';
END $$;
