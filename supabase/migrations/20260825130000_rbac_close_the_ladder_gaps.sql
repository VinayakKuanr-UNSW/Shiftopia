-- ============================================================================
-- The three gaps left open by 20260825120000, closed or written down.
--
-- ── 1. `role_ml_class_map` WAS WRITABLE BY NOBODY ───────────────────────────
--
-- Both write policies called:
--
--     user_has_action_in_scope('shift.edit', NULL::uuid, sd.department_id, r.subdepartment_id)
--                                            ^^^^^^^^^^ the organization
--
-- Every branch of that function tests `organization_id = p_org_id`. Against a
-- NULL that is NULL, never true, so both branches failed for every caller and
-- the only row that could ever pass was a Zeta certificate — of which there
-- were none, because until 20260825120000 they could not be created.
--
-- The table has been readable by every authenticated user (its SELECT policy is
-- literally `true`) and writable by no one at all. The organization was
-- available two joins away the whole time: hr.subdepartments.department_id →
-- hr.departments.organization_id.
--
-- ── 2. `user_has_action(text)` IS A LOADED FOOTGUN, AND DROPPED ─────────────
--
--     SELECT EXISTS (SELECT 1 FROM app_access_certificates ac
--                      JOIN rbac_permissions rp ON rp.access_level = ac.access_level
--                     WHERE ac.user_id = auth.uid() AND rp.action_code = p_action_code
--                    UNION ... same for contracts ...)
--
-- It joins the permission catalogue and NEVER LOOKS AT `rp.scope`. So it answers
-- "does any level you hold grant this action ANYWHERE" while being named as
-- though it answers "may you do this". A Gamma sub-department supervisor
-- returns true for `user.edit` and `contract.manage` org-wide.
--
-- It is SECURITY DEFINER, so it bypasses RLS to answer. It has ZERO callers —
-- no policy, no function, no application code, no edge function; checked all
-- four. A scope-blind permission oracle with no callers is not dead weight, it
-- is a trap primed for whoever reaches for the shorter name. Dropped.
-- `user_has_action_in_scope` is the one to use, and it takes the scope.
--
-- ── 3. TWO THINGS THAT ARE CORRECT AS THEY STAND, AND WHY ───────────────────
--
-- SELF-SCOPED ROWS. Nine rows (alpha's seven, beta's two) carry scope 'SELF'
-- and `user_has_action_in_scope` has no SELF branch, so it can never grant
-- them. That reads like a bug and is not one: self-access is enforced by OWNER
-- predicates written directly into the per-table policies —
-- `shifts_select_rbac` ends with `assigned_employee_id = auth.uid() OR
-- last_rejected_by = auth.uid()`, which is what actually lets an employee see
-- their own shift. The SELF rows document the employee capability set; they do
-- not drive it. Answering them here would need the target row's owner, which
-- this signature cannot take, and adding it would mean dropping and recreating
-- the eighteen policies that depend on the function — a large change for a
-- capability every one of those tables already enforces directly. Written down
-- rather than "fixed" into a second, rival mechanism.
--
-- CONTRACTS DO NOT GET THE CERTIFICATE CONSTRAINT. `app_access_certificates`
-- now carries `chk_scope_nullability`, and the obvious next move is to mirror
-- it onto `hr.user_contracts`, which also holds access_level plus the same
-- three scope columns. That would be wrong. On a certificate those columns ARE
-- the access scope. On a contract they are the EMPLOYMENT scope — which job
-- this engagement is for — and a contract with a NULL sub_department_id is a
-- legitimate DEPARTMENT-WIDE engagement that `contractsInScope`
-- (availability/domain/contract-basis.ts) and `sm_holds_active_contract_in`
-- (migration 20260821090000) both deliberately admit. Mirroring the constraint
-- would forbid a shape the rest of the system is built to support. The columns
-- share names and mean different things; the constraint belongs to only one of
-- them.
-- ============================================================================

-- ── 1. Give the role/ML map its organization back ───────────────────────────
DROP POLICY IF EXISTS authenticated_update_role_ml_class_map ON public.role_ml_class_map;
CREATE POLICY authenticated_update_role_ml_class_map
    ON public.role_ml_class_map
    AS PERMISSIVE FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM hr.roles r
              JOIN hr.subdepartments sd ON sd.id = r.subdepartment_id
              JOIN hr.departments     d  ON d.id  = sd.department_id
             WHERE r.id = role_ml_class_map.role_id
               AND public.user_has_action_in_scope(
                       'shift.edit', d.organization_id, sd.department_id, r.subdepartment_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
              FROM hr.roles r
              JOIN hr.subdepartments sd ON sd.id = r.subdepartment_id
              JOIN hr.departments     d  ON d.id  = sd.department_id
             WHERE r.id = role_ml_class_map.role_id
               AND public.user_has_action_in_scope(
                       'shift.edit', d.organization_id, sd.department_id, r.subdepartment_id)
        )
    );

DROP POLICY IF EXISTS authenticated_write_role_ml_class_map ON public.role_ml_class_map;
CREATE POLICY authenticated_write_role_ml_class_map
    ON public.role_ml_class_map
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1
              FROM hr.roles r
              JOIN hr.subdepartments sd ON sd.id = r.subdepartment_id
              JOIN hr.departments     d  ON d.id  = sd.department_id
             WHERE r.id = role_ml_class_map.role_id
               AND public.user_has_action_in_scope(
                       'shift.edit', d.organization_id, sd.department_id, r.subdepartment_id)
        )
    );

-- ── 2. Remove the scope-blind oracle ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.user_has_action(text);

-- ── 3. Write down what the catalogue does and does not decide ───────────────
COMMENT ON TABLE public.rbac_permissions IS
    'Which actions each access level may perform, and HOW FAR — `scope` is the reach, and it is '
    'read by user_has_action_in_scope and by the policies that inline the same predicate. It must '
    'agree with app_access_certificates.chk_scope_nullability: a level whose certificate names one '
    'department but whose rows say ORG is granted a breadth its certificate shape denies, which is '
    'exactly what Delta was doing before 20260825120000. '
    'SELF-scoped rows (alpha, beta) are DESCRIPTIVE: user_has_action_in_scope has no SELF branch '
    'and cannot grant them, because self-access is enforced by owner predicates inside each '
    'table''s own policy (see shifts_select_rbac). Do not read a SELF row as a live grant.';

COMMENT ON COLUMN hr.user_contracts.access_level IS
    'Access level carried by this engagement. NOTE: unlike app_access_certificates, the '
    'organization/department/sub_department columns on this table are the EMPLOYMENT scope — which '
    'job this contract is for — not the access scope, and a NULL sub_department_id is a legitimate '
    'department-wide engagement. chk_scope_nullability is deliberately NOT mirrored here; see '
    'migration 20260825130000.';

-- ── 4. Self-test ────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
    v_role       uuid;
    v_org        uuid;
    v_dept       uuid;
    v_subdept    uuid;
    v_failures   text := '';
BEGIN
    -- (a) The oracle is gone.
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'user_has_action'
                  AND p.pronargs = 1) THEN
        v_failures := v_failures || '(a) user_has_action(text) still exists ; ';
    END IF;

    -- (b) ...and the scoped one is untouched.
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = 'user_has_action_in_scope') THEN
        v_failures := v_failures || '(b) user_has_action_in_scope went missing ; ';
    END IF;

    -- (c) Both write policies exist and no longer pass a NULL organization.
    IF (SELECT count(*) FROM pg_policy
         WHERE polrelid = 'public.role_ml_class_map'::regclass) <> 3 THEN
        v_failures := v_failures || '(c) role_ml_class_map lost a policy ; ';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policy
         WHERE polrelid = 'public.role_ml_class_map'::regclass
           AND coalesce(pg_get_expr(polqual, polrelid), '')
             || coalesce(pg_get_expr(polwithcheck, polrelid), '') LIKE '%NULL::uuid, sd.department_id%'
    ) THEN
        v_failures := v_failures || '(d) a role_ml_class_map policy still passes a NULL org ; ';
    END IF;

    -- (e) The join the new policies rely on actually resolves to an organization.
    SELECT r.id, d.organization_id, sd.department_id, r.subdepartment_id
      INTO v_role, v_org, v_dept, v_subdept
      FROM hr.roles r
      JOIN hr.subdepartments sd ON sd.id = r.subdepartment_id
      JOIN hr.departments     d  ON d.id  = sd.department_id
     ORDER BY r.id
     LIMIT 1;

    IF v_role IS NULL THEN
        RAISE NOTICE 'rbac_close_the_ladder_gaps: no role fixture, join assertion skipped';
    ELSIF v_org IS NULL THEN
        v_failures := v_failures || '(e) the role -> organization join yields NULL ; ';
    END IF;

    IF v_failures <> '' THEN
        RAISE EXCEPTION 'rbac_close_the_ladder_gaps selftest FAILED: %', v_failures;
    END IF;

    RAISE NOTICE 'rbac_close_the_ladder_gaps selftest PASSED';
END
$selftest$;
