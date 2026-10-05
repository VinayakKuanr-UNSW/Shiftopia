-- ============================================================================
-- The access-level ladder, as specified:
--
--     LEVEL      ORGANIZATION   DEPARTMENT   SUB-DEPARTMENT
--     Zeta       all            all          all
--     Epsilon    one            all          all
--     Delta      one            one          all
--     Gamma      one            one          one
--
-- Three of those four rows were already true. This migration fixes the one that
-- was not, and reconciles two rules that disagreed about whether Zeta exists.
--
-- ── 1. DELTA WAS ORG-WIDE, NOT DEPARTMENT-WIDE ──────────────────────────────
--
-- `chk_scope_nullability` forces every Delta certificate to name exactly one
-- department. All twenty of Delta's rows in `rbac_permissions` nevertheless
-- carried `scope = 'ORG'`, and `user_has_action_in_scope` branches on that
-- scope:
--
--     ac.organization_id = p_org_id AND (
--         rp.scope = 'ORG'                                            ← Delta
--      OR (rp.scope = 'DEPT'     AND ac.department_id     = p_dept_id)
--      OR (rp.scope = 'SUB_DEPT' AND ac.sub_department_id = p_sub_dept_id))
--
-- So `ac.department_id` was never consulted for Delta, and the department the
-- constraint insisted on was decorative. Measured against production, a Delta
-- certificate scoped to department #1 was granted shift.delete, roster.publish,
-- user.edit and contract.manage in department #2 — every action, every
-- department, org-wide.
--
-- That function backs EIGHTEEN RLS policies, including INSERT/UPDATE/DELETE on
-- `shifts` and `rosters`, so this is the live write gate, not an advisory
-- helper. It is not currently exploitable — production holds zero Delta
-- certificates (100 alpha, 1 epsilon) — but it fires on the first one issued,
-- which is precisely what the tier is for.
--
-- FIXED IN THE DATA, NOT THE FUNCTION. Re-scoping Delta's rows to 'DEPT' makes
-- the existing predicate do the right thing: org must match AND department must
-- match, sub-department untested, which is "one / one / all" exactly. Gamma
-- already proves that branch works (it holds five DEPT-scoped actions today).
-- Editing the function instead would mean touching something eighteen policies
-- depend on in order to work around data that is simply wrong.
--
-- WHY THIS CANNOT LOCK DELTA OUT. Every one of the eighteen policies passes a
-- real `department_id`, and shifts (180), rosters (193), planning_periods (5)
-- and synthesis_runs (50) all hold ZERO nulls in `department_id` — checked, not
-- assumed, because a null there would turn `ac.department_id = p_dept_id` into
-- NULL and deny Delta rather than scope it.
--
-- `user_has_action(p_action_code)` — the other reader of this table — ignores
-- `scope` entirely, so it is unaffected.
--
-- ── 2. TWO RULES DISAGREED ABOUT WHETHER ZETA EXISTS ────────────────────────
--
-- `chk_level_matches_type` admitted Type Y ∈ (gamma, delta, epsilon). A zeta
-- row satisfied neither its Type X nor its Type Y branch, so ZETA
-- CERTIFICATES WERE IMPOSSIBLE TO CREATE — which is the real reason the top
-- tier is vacant, and it would have defeated the UI restoration on its own.
--
-- Meanwhile `chk_scope_nullability` carries a `WHEN 'zeta'` branch and the
-- `validate_certificate_on_change` trigger lists zeta as a valid Type Y. Three
-- rules on one table; two anticipated zeta, one forbade it. The trigger and the
-- nullability constraint are the majority and match the specification, so the
-- odd one out is corrected rather than the other two.
--
-- ── 3. THE ORGANIZATION COLUMN WAS NEVER CONSTRAINED ────────────────────────
--
-- `chk_scope_nullability` governed `department_id` and `sub_department_id` and
-- said nothing about `organization_id`, so the leftmost column of the table
-- above — the one that distinguishes Zeta's "all" from everyone else's "one" —
-- was unenforced. A zeta certificate pinned to a single organization, or an
-- epsilon with no organization at all, were both accepted. Added here, in the
-- same CASE, so the whole row of the specification lives in one place.
--
-- Both existing shapes already conform (100 alpha with all three set, 1 epsilon
-- with organization only), so this validates without a rewrite.
-- ============================================================================

-- ── 1. Delta is a DEPARTMENT manager ────────────────────────────────────────
UPDATE public.rbac_permissions
   SET scope = 'DEPT'::public.rbac_scope
 WHERE access_level = 'delta'::public.access_level
   AND scope IS DISTINCT FROM 'DEPT'::public.rbac_scope;

-- ── 2. Zeta is a legal Type Y level ─────────────────────────────────────────
ALTER TABLE public.app_access_certificates
    DROP CONSTRAINT IF EXISTS chk_level_matches_type;

ALTER TABLE public.app_access_certificates
    ADD CONSTRAINT chk_level_matches_type CHECK (
        (certificate_type::text = 'X'
         AND access_level = ANY (ARRAY['alpha','beta']::public.access_level[]))
        OR
        (certificate_type::text = 'Y'
         AND access_level = ANY (ARRAY['gamma','delta','epsilon','zeta']::public.access_level[]))
    );

-- ── 3. The organization column joins the ladder ─────────────────────────────
ALTER TABLE public.app_access_certificates
    DROP CONSTRAINT IF EXISTS chk_scope_nullability;

ALTER TABLE public.app_access_certificates
    ADD CONSTRAINT chk_scope_nullability CHECK (
        CASE access_level
            -- all / all / all
            WHEN 'zeta'::public.access_level THEN
                organization_id IS NULL
                AND department_id IS NULL
                AND sub_department_id IS NULL
            -- one / all / all
            WHEN 'epsilon'::public.access_level THEN
                organization_id IS NOT NULL
                AND department_id IS NULL
                AND sub_department_id IS NULL
            -- one / one / all
            WHEN 'delta'::public.access_level THEN
                organization_id IS NOT NULL
                AND department_id IS NOT NULL
                AND sub_department_id IS NULL
            -- one / one / one
            WHEN 'gamma'::public.access_level THEN
                organization_id IS NOT NULL
                AND department_id IS NOT NULL
                AND sub_department_id IS NOT NULL
            -- Type X personal certificates are always fully scoped.
            WHEN 'alpha'::public.access_level THEN
                organization_id IS NOT NULL
                AND department_id IS NOT NULL
                AND sub_department_id IS NOT NULL
            WHEN 'beta'::public.access_level THEN
                organization_id IS NOT NULL
                AND department_id IS NOT NULL
                AND sub_department_id IS NOT NULL
            ELSE false
        END
    );

COMMENT ON CONSTRAINT chk_scope_nullability ON public.app_access_certificates IS
    'The access-level scope ladder: Zeta all/all/all, Epsilon one/all/all, Delta one/one/all, '
    'Gamma one/one/one, Type X fully scoped. "all" is encoded as NULL. Paired with '
    'rbac_permissions.scope, which decides how far a level''s actions reach — the two must agree '
    'or a level is granted a breadth its certificate shape denies. See migration 20260825120000.';

-- ── 4. Self-test ────────────────────────────────────────────────────────────
-- Two things need proving. First, that the DATA now drives
-- `user_has_action_in_scope` correctly — the function is deliberately untouched
-- here, and it cannot be called directly because it reads auth.uid(), which is
-- NULL outside a request, so its predicate is inlined below against concrete
-- department ids. Second, that the two constraints say what they should.
DO $selftest$
DECLARE
    v_cert_org   uuid;   -- organization the simulated certificate is scoped to
    v_cert_dept  uuid;   -- department  the simulated certificate is scoped to
    v_other_dept uuid;   -- a DIFFERENT department in the same organization
    v_granted    boolean;
    v_failures   text := '';
BEGIN
    SELECT o.id INTO v_cert_org FROM public.organizations o ORDER BY o.id LIMIT 1;
    SELECT d.id INTO v_cert_dept FROM public.departments d
     WHERE d.organization_id = v_cert_org ORDER BY d.id LIMIT 1;
    SELECT d.id INTO v_other_dept FROM public.departments d
     WHERE d.organization_id = v_cert_org AND d.id <> v_cert_dept ORDER BY d.id LIMIT 1;

    IF v_cert_org IS NULL OR v_cert_dept IS NULL OR v_other_dept IS NULL THEN
        RAISE NOTICE 'rbac_scope_ladder_conformance selftest SKIPPED — needs two departments';
        RETURN;
    END IF;

    -- (a) THE REGRESSION. Delta scoped to v_cert_dept, asked about
    --     v_other_dept. This is the exact certificate-branch predicate, with
    --     the certificate's own ids substituted for the ac.* columns.
    SELECT EXISTS (
        SELECT 1 FROM public.rbac_permissions rp
         WHERE rp.access_level = 'delta'::public.access_level
           AND rp.action_code IN ('shift.delete','roster.publish','user.edit','contract.manage')
           AND v_cert_org = v_cert_org                              -- org matches
           AND (    rp.scope = 'ORG'
                 OR (rp.scope = 'DEPT'     AND v_cert_dept = v_other_dept)
                 OR (rp.scope = 'SUB_DEPT' AND NULL::uuid = NULL::uuid))
    ) INTO v_granted;

    IF v_granted THEN
        v_failures := v_failures || '(a) Delta still reaches a foreign department ; ';
    END IF;

    -- (b) The other half: Delta must still reach its OWN department, or the fix
    --     has locked out the tier instead of scoping it.
    SELECT bool_and(
                    rp.scope = 'ORG'
                 OR (rp.scope = 'DEPT'     AND v_cert_dept = v_cert_dept)
                 OR (rp.scope = 'SUB_DEPT' AND NULL::uuid = NULL::uuid))
      INTO v_granted
      FROM public.rbac_permissions rp
     WHERE rp.access_level = 'delta'::public.access_level;

    IF NOT COALESCE(v_granted, false) THEN
        v_failures := v_failures || '(b) Delta lost access to its own department ; ';
    END IF;

    -- (c) Every Delta action moved, none left behind on ORG.
    IF EXISTS (SELECT 1 FROM public.rbac_permissions
                WHERE access_level = 'delta'::public.access_level
                  AND scope <> 'DEPT'::public.rbac_scope) THEN
        v_failures := v_failures || '(c) some Delta actions are not DEPT-scoped ; ';
    END IF;

    -- (d) Epsilon untouched — one org, all departments.
    IF EXISTS (SELECT 1 FROM public.rbac_permissions
                WHERE access_level = 'epsilon'::public.access_level
                  AND scope <> 'ORG'::public.rbac_scope) THEN
        v_failures := v_failures || '(d) Epsilon is no longer org-wide ; ';
    END IF;

    -- (e) Gamma untouched — never org-wide.
    IF EXISTS (SELECT 1 FROM public.rbac_permissions
                WHERE access_level = 'gamma'::public.access_level
                  AND scope = 'ORG'::public.rbac_scope) THEN
        v_failures := v_failures || '(e) Gamma acquired an org-wide action ; ';
    END IF;

    -- (f) Zeta is now a legal Type Y level, per the constraint text itself.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.app_access_certificates'::regclass
           AND conname  = 'chk_level_matches_type'
           AND pg_get_constraintdef(oid) LIKE '%zeta%'
    ) THEN
        v_failures := v_failures || '(f) chk_level_matches_type still excludes zeta ; ';
    END IF;

    -- (g) organization_id is now part of the ladder.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.app_access_certificates'::regclass
           AND conname  = 'chk_scope_nullability'
           AND pg_get_constraintdef(oid) LIKE '%organization_id%'
    ) THEN
        v_failures := v_failures || '(g) chk_scope_nullability ignores organization_id ; ';
    END IF;

    -- (h) Nothing already on file was invalidated. ADD CONSTRAINT would have
    --     thrown, but assert the population is intact rather than trusting that.
    IF (SELECT count(*) FROM public.app_access_certificates) = 0 THEN
        v_failures := v_failures || '(h) certificates table is unexpectedly empty ; ';
    END IF;

    IF v_failures <> '' THEN
        RAISE EXCEPTION 'rbac_scope_ladder_conformance selftest FAILED: %', v_failures;
    END IF;

    RAISE NOTICE 'rbac_scope_ladder_conformance selftest PASSED';
END
$selftest$;
