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
--   2. The 7 formerly-SECURITY-DEFINER views are security_invoker.
--   3. No sensitive table has RLS disabled.
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

  -- 2) definer views must be security_invoker --------------------------------
  SELECT string_agg(c.relname, '; ')
  INTO v_bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
    AND c.relname IN (
      'roles','remuneration_levels','v_shift_assignment_episodes',
      'v_shifts_grouped','v_group_all_participants',
      'v_broadcast_groups_with_stats','v_unread_broadcasts_by_group'
    )
    AND NOT COALESCE(array_to_string(c.reloptions, ',') LIKE '%security_invoker=on%'
                  OR array_to_string(c.reloptions, ',') LIKE '%security_invoker=true%', false);
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

  RAISE NOTICE 'RLS guard PASSED.';
END $$;
