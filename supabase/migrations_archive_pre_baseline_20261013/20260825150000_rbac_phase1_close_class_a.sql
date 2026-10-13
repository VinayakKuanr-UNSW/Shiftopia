-- ============================================================================
-- Phase 1 — the nine policies that reason about a level and then never ask
-- WHERE. Six become catalogue-driven, two are narrowed as far as their table
-- allows, one cannot be fixed here and says so.
--
-- Measured against the `pre-phase-1` baseline (migration 20260825140100). Every
-- change below must show as `narrowed` in diag.rbac_access_diff() and nothing
-- may show as WIDENED.
--
-- ── THE ONE THAT WAS LIVE ───────────────────────────────────────────────────
--
-- `shift_events."Managers can view all shift events"` tested
--
--     access_level = ANY (ARRAY['alpha','beta','gamma','delta','epsilon','zeta'])
--
-- which is every member of the enum — a no-op in the shape of a check. The
-- baseline measured it at 720 of 720 rows for an ordinary alpha employee, so
-- all 100 of them could read the entire shift-event history: who dropped which
-- shift, when, and why. The audit that preceded the baseline classified this
-- policy as merely "unscoped" and missed that its list was vacuous, because it
-- read the expression instead of evaluating it.
--
-- `"Users can view their own shift events"` (employee_id = auth.uid()) already
-- covers the legitimate case and is untouched, so no employee loses sight of
-- their own history.
--
-- ── WHY THESE GO STRAIGHT ONTO THE GATE ─────────────────────────────────────
--
-- Phase 2 exists to move correct-but-inline ladders onto
-- `user_has_action_in_scope`. Writing a correct scoped test BY HAND here would
-- manufacture six new Class B copies for Phase 2 to remove again, so where a
-- table can reach an organization these skip straight to the catalogue. Class A
-- becomes Class C in one step.
--
-- ── EACH TABLE'S ROUTE TO A SCOPE, AND HOW IT WAS CHECKED ───────────────────
--
--   shift_events        → shifts.{organization,department,sub_department}_id via
--                         shift_id. All 720 rows resolve; zero orphans.
--   compliance_rejections → the SUBJECT employee's active contract, the same
--                         shape `leave_requests_manager_select` already uses.
--                         All 37 rows resolve to an active contract.
--   demand_tensor       → synthesis_runs.{organization,department,sub_department}_id
--                         via synthesis_run_id, matching the action code its
--                         parent synthesis_runs policies already use.
--
-- ── TWO THAT CANNOT BE FULLY FIXED, AND ARE NOT PRETENDED OTHERWISE ─────────
--
-- `demand_templates` has NO tenant column of any kind — id, template_code,
-- cluster_key, shifts, source_event_ids, is_seeded, is_active, superseded_by,
-- created_by, timestamps. It is a global catalogue. It gets the `is_active`
-- test it was missing and keeps a manager-level requirement, which is a real
-- narrowing, but it cannot be scoped to an organization until the table carries
-- one. Flagged rather than papered over.
--
-- `timesheet_audit_log` is left ENTIRELY ALONE. It already tests `is_active`
-- and already requires gamma+, so its only defect is the missing row scope —
-- and it has no route to one: all 30 rows carry a `shift_id` that matches no
-- row in `shifts` and none in `deleted_shifts`, 8 carry a NULL `timesheet_id`
-- and all 30 of the rest match no row in `timesheets`, and `timesheets` has no
-- scope columns regardless. Scoping it through either key would hide all 30
-- rows from everyone including the org admin. Narrowing WHO may read it
-- (epsilon+ rather than gamma+) is a product decision, not a defect fix, so it
-- is not smuggled in here.
--
-- ROLE GRANTS ARE PRESERVED EXACTLY, not normalised. shift_events, demand_tensor
-- and demand_templates were TO authenticated; compliance_rejections was TO
-- PUBLIC and stays that way. Recreating any of them TO public would have added
-- anon to the grant — a widening, in the migration whose entire purpose is to
-- narrow. Whether compliance_rejections should be PUBLIC at all is a separate
-- question from whether its level test is scoped, and is not answered here.
-- ============================================================================

-- ── 1. shift_events: the live one ───────────────────────────────────────────
DROP POLICY IF EXISTS "Managers can view all shift events" ON public.shift_events;
CREATE POLICY "Managers can view all shift events"
    ON public.shift_events
    AS PERMISSIVE FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM public.shifts s
             WHERE s.id = shift_events.shift_id
               AND public.user_has_action_in_scope(
                       'shift.view', s.organization_id, s.department_id, s.sub_department_id)
        )
    );

-- ── 2. compliance_rejections: scope to the subject employee's job ───────────
DROP POLICY IF EXISTS managers_read_compliance_rejections ON public.compliance_rejections;
CREATE POLICY managers_read_compliance_rejections
    ON public.compliance_rejections
    AS PERMISSIVE FOR SELECT TO public
    USING (
        EXISTS (
            SELECT 1
              FROM hr.user_contracts uc
             WHERE uc.user_id = compliance_rejections.employee_id
               AND uc.status = 'Active'
               AND public.user_has_action_in_scope(
                       'shift.view', uc.organization_id, uc.department_id, uc.sub_department_id)
        )
    );

-- ── 3. demand_tensor: scope through its synthesis run ───────────────────────
-- 'shift.create' rather than a roster action, because that is what the
-- synthesis_runs policies over the parent row already require; a tensor row
-- should not be reachable by anyone who cannot reach the run that produced it.
DROP POLICY IF EXISTS manager_insert_demand_tensor ON public.demand_tensor;
CREATE POLICY manager_insert_demand_tensor
    ON public.demand_tensor
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.synthesis_runs sr
             WHERE sr.id = demand_tensor.synthesis_run_id
               AND public.user_has_action_in_scope(
                       'shift.create', sr.organization_id, sr.department_id, sr.sub_department_id)
        )
    );

DROP POLICY IF EXISTS manager_update_demand_tensor ON public.demand_tensor;
CREATE POLICY manager_update_demand_tensor
    ON public.demand_tensor
    AS PERMISSIVE FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.synthesis_runs sr
             WHERE sr.id = demand_tensor.synthesis_run_id
               AND public.user_has_action_in_scope(
                       'shift.create', sr.organization_id, sr.department_id, sr.sub_department_id)
        )
    );

DROP POLICY IF EXISTS manager_delete_demand_tensor ON public.demand_tensor;
CREATE POLICY manager_delete_demand_tensor
    ON public.demand_tensor
    AS PERMISSIVE FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.synthesis_runs sr
             WHERE sr.id = demand_tensor.synthesis_run_id
               AND public.user_has_action_in_scope(
                       'shift.create', sr.organization_id, sr.department_id, sr.sub_department_id)
        )
    );

-- ── 4. demand_templates: as far as a table with no tenant can go ────────────
-- `is_active` was the missing half: without it a DEACTIVATED certificate still
-- passed, which is the offboarding hole. The level list stays gamma+ because
-- there is no organization to compare against.
DROP POLICY IF EXISTS manager_insert_demand_templates ON public.demand_templates;
CREATE POLICY manager_insert_demand_templates
    ON public.demand_templates
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.app_access_certificates ac
                 WHERE ac.user_id = (SELECT auth.uid())
                   AND ac.is_active = true
                   AND ac.access_level = ANY (ARRAY['gamma','delta','epsilon','zeta']::public.access_level[]))
    );

DROP POLICY IF EXISTS manager_update_demand_templates ON public.demand_templates;
CREATE POLICY manager_update_demand_templates
    ON public.demand_templates
    AS PERMISSIVE FOR UPDATE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.app_access_certificates ac
                 WHERE ac.user_id = (SELECT auth.uid())
                   AND ac.is_active = true
                   AND ac.access_level = ANY (ARRAY['gamma','delta','epsilon','zeta']::public.access_level[]))
    );

DROP POLICY IF EXISTS manager_delete_demand_templates ON public.demand_templates;
CREATE POLICY manager_delete_demand_templates
    ON public.demand_templates
    AS PERMISSIVE FOR DELETE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.app_access_certificates ac
                 WHERE ac.user_id = (SELECT auth.uid())
                   AND ac.is_active = true
                   AND ac.access_level = ANY (ARRAY['gamma','delta','epsilon','zeta']::public.access_level[]))
    );

COMMENT ON TABLE public.demand_templates IS
    'Global demand template catalogue. NOTE: this table carries no organization/department column, '
    'so its RLS policies can require an active manager certificate but cannot scope to a tenant. '
    'Adding a tenant column is the prerequisite for closing that gap — see migration 20260825150000.';

-- ── 5. Self-test ────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
    v_failures text := '';
    v_alpha    uuid;
    v_n        bigint;
    v_expr     text;
BEGIN
    SELECT id INTO v_alpha FROM public.profiles WHERE email = 'test1@test.com';

    IF v_alpha IS NULL THEN
        RAISE NOTICE 'phase1 selftest SKIPPED — no alpha fixture';
        RETURN;
    END IF;

    -- (a) THE REGRESSION. An ordinary employee must no longer see every event.
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_alpha, 'role','authenticated')::text, true);

    SELECT pg_get_expr(polqual, polrelid) INTO v_expr
      FROM pg_policy
     WHERE polrelid = 'public.shift_events'::regclass
       AND polname  = 'Managers can view all shift events';

    EXECUTE format('SELECT count(*) FROM public.shift_events WHERE %s', v_expr) INTO v_n;
    IF v_n > 0 THEN
        v_failures := v_failures
            || format('(a) alpha still reaches %s shift_events via the manager policy ; ', v_n);
    END IF;

    -- (b) ...but must still see their OWN, through the untouched self policy.
    IF NOT EXISTS (SELECT 1 FROM pg_policy
                    WHERE polrelid = 'public.shift_events'::regclass
                      AND polname = 'Users can view their own shift events') THEN
        v_failures := v_failures || '(b) the self-access policy went missing ; ';
    END IF;

    PERFORM set_config('request.jwt.claims', '', true);

    -- (c) No policy touched here may still carry a vacuous level list.
    IF EXISTS (
        SELECT 1 FROM pg_policy
         WHERE polrelid IN ('public.shift_events'::regclass,
                            'public.compliance_rejections'::regclass,
                            'public.demand_tensor'::regclass)
           AND COALESCE(pg_get_expr(polqual,polrelid),'')
             || COALESCE(pg_get_expr(polwithcheck,polrelid),'') LIKE '%''alpha''::access_level%'
    ) THEN
        v_failures := v_failures || '(c) a rewritten policy still names alpha in a level list ; ';
    END IF;

    -- (d) The six scopeable policies now go through the gate.
    IF (SELECT count(*) FROM diag.rbac_policy_surface
         WHERE tbl IN ('shift_events','compliance_rejections','demand_tensor')
           AND uses_gate) <> 5 THEN
        v_failures := v_failures
            || format('(d) expected 5 gate-driven policies on the rewritten tables, found %s ; ',
                      (SELECT count(*) FROM diag.rbac_policy_surface
                        WHERE tbl IN ('shift_events','compliance_rejections','demand_tensor')
                          AND uses_gate));
    END IF;

    -- (e) demand_templates gained the is_active test it was missing.
    IF EXISTS (
        SELECT 1 FROM pg_policy
         WHERE polrelid = 'public.demand_templates'::regclass
           AND polname LIKE 'manager_%'
           AND COALESCE(pg_get_expr(polqual,polrelid),'')
             || COALESCE(pg_get_expr(polwithcheck,polrelid),'') NOT LIKE '%is_active%'
    ) THEN
        v_failures := v_failures || '(e) a demand_templates policy still ignores is_active ; ';
    END IF;

    IF v_failures <> '' THEN
        RAISE EXCEPTION 'rbac_phase1_close_class_a selftest FAILED: %', v_failures;
    END IF;

    RAISE NOTICE 'rbac_phase1_close_class_a selftest PASSED';
END
$selftest$;
