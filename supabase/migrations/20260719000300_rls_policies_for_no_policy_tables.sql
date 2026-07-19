-- ============================================================================
-- WS-D · Add explicit policies to RLS-enabled tables that have NONE
-- ============================================================================
-- Advisor: 4 x rls_enabled_no_policy. RLS is ON with zero policies -> a hard
-- deny for authenticated. Any browser feature reading these returns 200 + []
-- (the exact empty-UI failure this project has hit before), OR the code is
-- (incorrectly) using a service-role path from the client. We make intent
-- explicit: self/manager read where there is an owner, manager-only otherwise.
-- service_role continues to bypass RLS for the backend processors that write
-- these tables (attendance ingestion, tombstone writes, swap-queue worker).
-- ----------------------------------------------------------------------------
SET search_path = public;

-- ---------------------------------------------------------------------------
-- attendance_records (employee_id, shift_id) — own or manager read; mgr write.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS attendance_self_or_manager_read ON public.attendance_records;
CREATE POLICY attendance_self_or_manager_read ON public.attendance_records
  FOR SELECT TO authenticated
  USING ( employee_id = (select auth.uid()) OR is_manager_or_above() );

DROP POLICY IF EXISTS attendance_manager_write ON public.attendance_records;
CREATE POLICY attendance_manager_write ON public.attendance_records
  FOR ALL TO authenticated
  USING ( is_manager_or_above() )
  WITH CHECK ( is_manager_or_above() );

-- ---------------------------------------------------------------------------
-- deleted_shifts (org/dept, deleted_by) — audit tombstones; managers only.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS deleted_shifts_manager_read ON public.deleted_shifts;
CREATE POLICY deleted_shifts_manager_read ON public.deleted_shifts
  FOR SELECT TO authenticated
  USING ( is_manager_or_above() );

DROP POLICY IF EXISTS deleted_shifts_manager_write ON public.deleted_shifts;
CREATE POLICY deleted_shifts_manager_write ON public.deleted_shifts
  FOR ALL TO authenticated
  USING ( is_manager_or_above() )
  WITH CHECK ( is_manager_or_above() );

-- ---------------------------------------------------------------------------
-- employee_performance_snapshots (employee_id) — own or manager read; mgr write.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS perf_snapshots_self_or_manager_read ON public.employee_performance_snapshots;
CREATE POLICY perf_snapshots_self_or_manager_read ON public.employee_performance_snapshots
  FOR SELECT TO authenticated
  USING ( employee_id = (select auth.uid()) OR is_manager_or_above() );

DROP POLICY IF EXISTS perf_snapshots_manager_write ON public.employee_performance_snapshots;
CREATE POLICY perf_snapshots_manager_write ON public.employee_performance_snapshots
  FOR ALL TO authenticated
  USING ( is_manager_or_above() )
  WITH CHECK ( is_manager_or_above() );

-- ---------------------------------------------------------------------------
-- swap_review_queue — internal worker queue. Managers may read for an ops UI;
--   writes remain service_role-only (no authenticated write policy = deny).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS swap_review_queue_manager_read ON public.swap_review_queue;
CREATE POLICY swap_review_queue_manager_read ON public.swap_review_queue
  FOR SELECT TO authenticated
  USING ( is_manager_or_above() );
