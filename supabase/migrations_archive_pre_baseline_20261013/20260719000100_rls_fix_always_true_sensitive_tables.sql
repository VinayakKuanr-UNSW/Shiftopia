-- ============================================================================
-- WS-A · Close broken access-control on money/compliance-affecting tables
-- ============================================================================
-- Advisor: 73 x rls_policy_always_true. This migration removes the always-true
-- WRITE policies on the highest-sensitivity tables and replaces them with
-- role/ownership-scoped policies built on the existing, verified RBAC helpers:
--   is_admin()             -> legacy admin/manager OR zeta/epsilon cert
--   is_manager_or_above()  -> legacy admin/manager OR gamma/delta/epsilon/zeta cert
--
-- Why this is safe:
--  * Permissive RLS policies are OR-combined. On `timesheets` the correct
--    granular policies (timesheets_member_*, timesheets_admin_all) ALREADY
--    exist — the stray USING(true) duplicates simply negated them. Dropping
--    the duplicates restores the intended scoping.
--  * service_role BYPASSES RLS entirely, so cron/edge-function "system" writes
--    (auto-approve, metric calculators) continue to work unchanged.
--  * SELECT visibility is only tightened where the data is clearly sensitive
--    (budgets, per-employee performance). work_rules/system_config reads stay
--    open (the app + compliance engine read them); swap read stays open (the
--    open-swap marketplace) — those were WRITE holes, not read holes.
--
-- Idempotent: every CREATE is preceded by DROP ... IF EXISTS.
-- ----------------------------------------------------------------------------
SET search_path = public;

-- ---------------------------------------------------------------------------
-- timesheets  — drop legacy always-true duplicates; correct policies remain.
--               Add a manager read path (non-admin gamma/delta reviewers).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Employees can create timesheets"     ON public.timesheets; -- INSERT true
DROP POLICY IF EXISTS "Employees can update their timesheets" ON public.timesheets; -- UPDATE true/true
DROP POLICY IF EXISTS "Authenticated users can view timesheets" ON public.timesheets; -- SELECT true

-- Owner always sees their own timesheet, regardless of system_role. The
-- pre-existing timesheets_member_select only covers 'team_member'; system_role
-- also has 'team_lead', who would otherwise lose sight of their own rows once
-- the always-true SELECT is dropped.
DROP POLICY IF EXISTS timesheets_self_select ON public.timesheets;
CREATE POLICY timesheets_self_select ON public.timesheets
  FOR SELECT TO authenticated
  USING ( profile_id = (select auth.uid()) );

DROP POLICY IF EXISTS timesheets_manager_select ON public.timesheets;
CREATE POLICY timesheets_manager_select ON public.timesheets
  FOR SELECT TO authenticated
  USING ( is_manager_or_above() );

-- ---------------------------------------------------------------------------
-- department_budgets — financial data. Managers only (read + write).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can manage budgets"          ON public.department_budgets; -- ALL true/true
DROP POLICY IF EXISTS "Authenticated users can view budgets" ON public.department_budgets; -- SELECT true

DROP POLICY IF EXISTS dept_budgets_manager_all ON public.department_budgets;
CREATE POLICY dept_budgets_manager_all ON public.department_budgets
  FOR ALL TO authenticated
  USING ( is_manager_or_above() )
  WITH CHECK ( is_manager_or_above() );

-- ---------------------------------------------------------------------------
-- work_rules — compliance thresholds the scheduler trusts. Admin write only.
--              Read stays open (engine + UI need to read the active rules).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage work rules" ON public.work_rules; -- INSERT true
DROP POLICY IF EXISTS "Admins can update work rules" ON public.work_rules; -- UPDATE true/true

DROP POLICY IF EXISTS work_rules_admin_write ON public.work_rules;
CREATE POLICY work_rules_admin_write ON public.work_rules
  FOR ALL TO authenticated
  USING ( is_admin() )
  WITH CHECK ( is_admin() );

-- ---------------------------------------------------------------------------
-- system_config — global configuration. Admin write only. Read stays open.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage system config" ON public.system_config; -- INSERT true
DROP POLICY IF EXISTS "Admins can update system config" ON public.system_config; -- UPDATE true/true

DROP POLICY IF EXISTS system_config_admin_write ON public.system_config;
CREATE POLICY system_config_admin_write ON public.system_config
  FOR ALL TO authenticated
  USING ( is_admin() )
  WITH CHECK ( is_admin() );

-- ---------------------------------------------------------------------------
-- employee_performance_metrics — per-employee reliability/attendance data.
--   Read: own or manager.  Write: manager (unlocked); service_role bypasses.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "System can manage performance metrics"           ON public.employee_performance_metrics; -- INSERT true
DROP POLICY IF EXISTS "System can update unlocked performance metrics"  ON public.employee_performance_metrics; -- UPDATE true/true
DROP POLICY IF EXISTS "Authenticated users can view performance metrics" ON public.employee_performance_metrics; -- SELECT true

DROP POLICY IF EXISTS perf_metrics_self_or_manager_read ON public.employee_performance_metrics;
CREATE POLICY perf_metrics_self_or_manager_read ON public.employee_performance_metrics
  FOR SELECT TO authenticated
  USING ( employee_id = (select auth.uid()) OR is_manager_or_above() );

DROP POLICY IF EXISTS perf_metrics_manager_insert ON public.employee_performance_metrics;
CREATE POLICY perf_metrics_manager_insert ON public.employee_performance_metrics
  FOR INSERT TO authenticated
  WITH CHECK ( is_manager_or_above() );

DROP POLICY IF EXISTS perf_metrics_manager_update ON public.employee_performance_metrics;
CREATE POLICY perf_metrics_manager_update ON public.employee_performance_metrics
  FOR UPDATE TO authenticated
  USING ( is_manager_or_above() AND is_locked = false )
  WITH CHECK ( is_manager_or_above() );

-- ---------------------------------------------------------------------------
-- swap_requests — legacy swap table. Read stays open (marketplace). Write:
--   requester (own) or manager on create; involved parties or manager on update.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can create swap requests" ON public.swap_requests; -- INSERT true
DROP POLICY IF EXISTS "Authenticated users can update swap requests" ON public.swap_requests; -- UPDATE true/true

DROP POLICY IF EXISTS swap_requests_insert_own ON public.swap_requests;
CREATE POLICY swap_requests_insert_own ON public.swap_requests
  FOR INSERT TO authenticated
  WITH CHECK ( requested_by_employee_id = (select auth.uid()) OR is_manager_or_above() );

DROP POLICY IF EXISTS swap_requests_update_involved ON public.swap_requests;
CREATE POLICY swap_requests_update_involved ON public.swap_requests
  FOR UPDATE TO authenticated
  USING (
    requested_by_employee_id = (select auth.uid())
    OR swap_with_employee_id = (select auth.uid())
    OR is_manager_or_above()
  )
  WITH CHECK (
    requested_by_employee_id = (select auth.uid())
    OR swap_with_employee_id = (select auth.uid())
    OR is_manager_or_above()
  );
