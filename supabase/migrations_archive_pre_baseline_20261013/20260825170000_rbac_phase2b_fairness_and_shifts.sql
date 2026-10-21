-- ============================================================================
-- Phase 2b — the last two inline ladders in the policy layer.
--
-- Both were held back from 2a because neither was a mechanical translation:
-- each carried disjuncts the gate does not model. Measuring them first turned
-- one into a deletion and the other into an adjudication.
--
-- ── shifts_select_managers IS REDUNDANT, AND IS DROPPED ────────────────────
--
-- `shifts` carries two permissive SELECT policies, so they OR together and
-- shifts_select_managers can only ADD to shifts_select_rbac, which is already
-- catalogue-driven. What it adds is:
--
--   * two contract catch-alls granting org- or department-wide read to any
--     gamma+ holder whose contract has NULL scope columns, bypassing the ladder;
--   * `profiles.legacy_system_role IN ('admin','manager')` with no scope test of
--     any kind — every shift in every organization.
--
-- That last one is the same column behind the escalation closed in the July
-- remediation, and it is the only place left where holding a legacy role beats
-- holding a certificate.
--
-- MEASURED, NOT ASSUMED. Rows granted by shifts_select_managers and NOT by
-- shifts_select_rbac: zero, for every principal tested including the legacy
-- admin. And the population cannot produce a counter-example — its three
-- branches need a gamma+ contract (0 exist), a gamma+ certificate (1 exists,
-- and that holder passes shifts_select_rbac org-wide anyway), or a legacy
-- admin/manager (1 exists, and 0 of them lack a gamma+ certificate). So the
-- policy grants nothing to anyone, and dropping it is behaviour-preserving for
-- the whole population rather than just the sample.
--
-- ── fairness_ledger: THE ADJUDICATION ──────────────────────────────────────
--
-- Its rule was "any active gamma+ certificate in the SAME ORGANIZATION", plus a
-- legacy_system_role='admin' branch. That gives Gamma org-wide reach over every
-- employee's fairness record — wider than the ladder allows, and the table has
-- no department column to narrow it with.
--
-- It does have `employee_id`, so the ladder CAN be applied through the subject
-- employee's contract, exactly as the leave policies now do. But 270 of the
-- 14,553 rows reference an employee with NO contract at all, and scoping naively
-- through the join would have hidden all 270 from everyone including the org
-- admin — a real narrowing, smuggled into a phase whose contract is to move the
-- rule and not change it.
--
-- So the orphans keep an explicit route: a row whose employee cannot be
-- attributed to any department is visible to whoever has ORG-wide reach, and to
-- nobody below. Passing NULL department and sub-department makes the gate admit
-- only ORG-scoped levels, which is exactly that rule and not a special case
-- bolted on beside it. Gamma and Delta do not get them, correctly — an
-- unattributable row cannot belong to a department.
--
-- The 270 are data-quality debris and deserve their own cleanup. Until then
-- they stay visible to the people who could already see them.
--
-- `roster.view` is the action: fairness is a rostering fairness measure, and
-- roster.view is the read verb over rostering data. The policy stays FOR ALL
-- rather than being split into read and write, because splitting it would
-- change who may WRITE the ledger — a product decision, and not one that
-- belongs in a migration about where a rule lives. Writes today come from
-- `recompute_fairness_ledger`, which is SECURITY DEFINER and bypasses RLS
-- entirely.
--
-- `fairness_ledger_self_read` is untouched, so an employee keeps sight of their
-- own record regardless.
-- ============================================================================

-- ── 1. Drop the redundant shifts policy ─────────────────────────────────────
DROP POLICY IF EXISTS shifts_select_managers ON public.shifts;

-- ── 2. fairness_ledger onto the gate ────────────────────────────────────────
DROP POLICY IF EXISTS fairness_ledger_org_scoped ON public.fairness_ledger;
CREATE POLICY fairness_ledger_org_scoped
    ON public.fairness_ledger
    AS PERMISSIVE FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM hr.user_contracts uc
             WHERE uc.user_id = fairness_ledger.employee_id
               AND public.user_has_action_in_scope(
                       'roster.view', uc.organization_id,
                       uc.department_id, uc.sub_department_id)
        )
        OR (
            -- Unattributable: the subject holds no contract, so there is no
            -- department to test. Only ORG-wide reach admits it, which is what
            -- passing NULL department and sub-department means to the gate.
            NOT EXISTS (SELECT 1 FROM hr.user_contracts uc
                         WHERE uc.user_id = fairness_ledger.employee_id)
            AND public.user_has_action_in_scope(
                    'roster.view', fairness_ledger.organization_id, NULL, NULL)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM hr.user_contracts uc
             WHERE uc.user_id = fairness_ledger.employee_id
               AND public.user_has_action_in_scope(
                       'roster.view', uc.organization_id,
                       uc.department_id, uc.sub_department_id)
        )
        OR (
            NOT EXISTS (SELECT 1 FROM hr.user_contracts uc
                         WHERE uc.user_id = fairness_ledger.employee_id)
            AND public.user_has_action_in_scope(
                    'roster.view', fairness_ledger.organization_id, NULL, NULL)
        )
    );

-- ── 3. Self-test ────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
    v_failures text := '';
    v_admin    uuid;
    v_n        bigint;
    v_expr     text;
BEGIN
    SELECT id INTO v_admin FROM public.profiles WHERE email = 'kurryosity@gmail.com';
    IF v_admin IS NULL THEN
        RAISE NOTICE 'phase2b selftest SKIPPED — no admin fixture'; RETURN;
    END IF;

    -- (a) The redundant policy is gone and the catalogue-driven one remains.
    IF EXISTS (SELECT 1 FROM pg_policy
                WHERE polrelid='public.shifts'::regclass AND polname='shifts_select_managers') THEN
        v_failures := v_failures || '(a) shifts_select_managers still exists ; ';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy
                    WHERE polrelid='public.shifts'::regclass AND polname='shifts_select_rbac') THEN
        v_failures := v_failures || '(b) shifts_select_rbac went missing ; ';
    END IF;

    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_admin, 'role','authenticated')::text, true);

    -- (c) The org admin still reads every shift, through the remaining policy.
    SELECT pg_get_expr(polqual, polrelid) INTO v_expr FROM pg_policy
     WHERE polrelid='public.shifts'::regclass AND polname='shifts_select_rbac';
    EXECUTE format('SELECT count(*) FROM public.shifts WHERE %s', v_expr) INTO v_n;
    IF v_n <> (SELECT count(*) FROM public.shifts) THEN
        v_failures := v_failures
            || format('(c) org admin lost shifts: %s of %s ; ',
                      v_n, (SELECT count(*) FROM public.shifts));
    END IF;

    -- (d) ...and still reads the WHOLE fairness ledger, orphan rows included.
    --     This is the assertion the orphan branch exists for.
    SELECT pg_get_expr(polqual, polrelid) INTO v_expr FROM pg_policy
     WHERE polrelid='public.fairness_ledger'::regclass AND polname='fairness_ledger_org_scoped';
    EXECUTE format('SELECT count(*) FROM public.fairness_ledger WHERE %s', v_expr) INTO v_n;
    IF v_n <> (SELECT count(*) FROM public.fairness_ledger) THEN
        v_failures := v_failures
            || format('(d) org admin lost fairness rows: %s of %s ; ',
                      v_n, (SELECT count(*) FROM public.fairness_ledger));
    END IF;

    PERFORM set_config('request.jwt.claims', '', true);

    -- (e) Neither rewritten policy names a level any more.
    IF EXISTS (
        SELECT 1 FROM pg_policy
         WHERE polrelid = 'public.fairness_ledger'::regclass
           AND polname  = 'fairness_ledger_org_scoped'
           AND COALESCE(pg_get_expr(polqual,polrelid),'') LIKE '%access_level%'
    ) THEN
        v_failures := v_failures || '(e) fairness_ledger still spells the ladder out ; ';
    END IF;

    -- (f) The employee's own view of their record is untouched.
    IF NOT EXISTS (SELECT 1 FROM pg_policy
                    WHERE polrelid='public.fairness_ledger'::regclass
                      AND polname='fairness_ledger_self_read') THEN
        v_failures := v_failures || '(f) fairness_ledger_self_read went missing ; ';
    END IF;

    IF v_failures <> '' THEN
        RAISE EXCEPTION 'rbac_phase2b selftest FAILED: %', v_failures;
    END IF;
    RAISE NOTICE 'rbac_phase2b selftest PASSED';
END
$selftest$;
