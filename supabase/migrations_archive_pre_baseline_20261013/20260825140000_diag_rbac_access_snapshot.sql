-- ============================================================================
-- Phase 0 of the access-ladder consolidation: the evidence that every later
-- phase is measured against.
--
-- The ladder is currently restated by hand in 16 RLS policies and 19 functions.
-- Consolidating those onto `user_has_action_in_scope` means editing the live
-- write gate for `shifts`, `rosters`, `leave_requests` and more — and RLS fails
-- dangerously in BOTH directions. Too loose leaks another tenant's data; too
-- tight locks an employee out of their own roster and looks like an outage.
-- "The tests still pass" is not evidence either way, because none of this is
-- reachable from vitest.
--
-- So: capture who can do what, as a table, before touching anything. Re-run
-- after each phase. Diff. A phase is done when the diff is exactly the set of
-- changes it intended and nothing else.
--
-- TWO FUNCTIONS, BECAUSE THERE ARE TWO QUESTIONS.
--
--   diag.rbac_access_snapshot() — what can the people who actually exist do
--   today? This is the regression net. It protects the 101 real certificate
--   holders from a consolidation that quietly narrows their access.
--
--   diag.rbac_ladder_probe() — what WOULD each level be able to do? Production
--   holds only alpha and one epsilon, so the snapshot alone can say nothing
--   about Gamma, Delta or Zeta — exactly the levels that were wrong. The probe
--   evaluates the gate for synthetic (level, scope) pairs against real
--   organizations and departments, so a ladder regression is caught before
--   anyone holds the certificate that would suffer it.
--
-- HOW IT EVALUATES, AND WHY IT IS READ-ONLY. Each policy's USING (or WITH
-- CHECK) expression is pulled from the catalogue and run against the real rows
-- of its table with `auth.uid()` impersonated via the `request.jwt.claims` GUC —
-- which is what `auth.uid()` reads, and what the SECURITY DEFINER helpers the
-- policies call read in turn. So this measures the same predicate the database
-- applies, without inserting, updating or deleting anything. Probing writes by
-- actually writing was rejected: MCP commits per statement and BEGIN/ROLLBACK
-- is not reliable through it, so a failed probe would leave debris in `shifts`.
--
-- NOT SECURITY DEFINER, and no grants. It impersonates arbitrary users by
-- design, so it must never be reachable from a request. It runs as the caller,
-- which means postgres or service_role and nobody else.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS diag;
COMMENT ON SCHEMA diag IS
    'Read-only diagnostics. Nothing here is called by the application; nothing here is granted '
    'to anon or authenticated. See migration 20260825140000.';

REVOKE ALL ON SCHEMA diag FROM PUBLIC;
REVOKE ALL ON SCHEMA diag FROM anon;
REVOKE ALL ON SCHEMA diag FROM authenticated;

-- ── Which policies form the RBAC surface ────────────────────────────────────
-- Anything that reasons about a level, whether through the catalogue, the gate,
-- or a hand-rolled list. Defined once so the snapshot and any later assertion
-- agree on what "the surface" means.
CREATE OR REPLACE VIEW diag.rbac_policy_surface AS
SELECT p.polrelid::regclass::text                       AS tbl,
       p.polname                                        AS policy_name,
       CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                     WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                     ELSE 'ALL' END                     AS cmd,
       COALESCE(pg_get_expr(p.polqual, p.polrelid),
                pg_get_expr(p.polwithcheck, p.polrelid)) AS expr,
       (COALESCE(pg_get_expr(p.polqual, p.polrelid),'')
        || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid),'')) LIKE '%user_has_action_in_scope%'
                                                        AS uses_gate,
       (COALESCE(pg_get_expr(p.polqual, p.polrelid),'')
        || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid),'')) LIKE '%rbac_permissions%'
                                                        AS uses_catalogue,
       (COALESCE(pg_get_expr(p.polqual, p.polrelid),'')
        || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid),'')) LIKE '%is_active%'
                                                        AS checks_is_active,
       (COALESCE(pg_get_expr(p.polqual, p.polrelid),'')
        || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid),'')) LIKE '%organization_id%'
                                                        AS tests_org_scope
  FROM pg_policy p
 WHERE (COALESCE(pg_get_expr(p.polqual, p.polrelid),'')
        || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid),''))
       ~ '(access_level|user_has_action_in_scope|is_manager_or_above|is_admin\(\))';

COMMENT ON VIEW diag.rbac_policy_surface IS
    'Every RLS policy that reasons about an access level, however it does so. `uses_gate` false '
    'means the policy restates the ladder itself — the population Phases 1 and 2 exist to empty.';

-- ── The snapshot: what the real population can do ───────────────────────────
CREATE OR REPLACE FUNCTION diag.rbac_access_snapshot(p_principals uuid[] DEFAULT NULL)
RETURNS TABLE (
    principal   text,
    level       text,
    tbl         text,
    cmd         text,
    policy_name text,
    matched     bigint,
    of_total    bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
    r_pr    record;
    r_pol   record;
    v_n     bigint;
    v_total bigint;
BEGIN
    FOR r_pr IN
        SELECT pr.id, COALESCE(pr.email, pr.id::text) AS email,
               COALESCE((SELECT string_agg(DISTINCT ac.access_level::text, '+' ORDER BY ac.access_level::text)
                           FROM public.app_access_certificates ac
                          WHERE ac.user_id = pr.id AND ac.is_active), 'none') AS lvl
          FROM public.profiles pr
         WHERE (p_principals IS NULL AND (
                    -- everyone holding something other than a plain alpha cert,
                    -- plus a few ordinary users so a narrowing is visible too
                    EXISTS (SELECT 1 FROM public.app_access_certificates ac
                             WHERE ac.user_id = pr.id AND ac.is_active
                               AND ac.access_level <> 'alpha'::public.access_level)
                    OR pr.email IN ('test1@test.com','test3@test.com','test50@test.com')))
            OR (p_principals IS NOT NULL AND pr.id = ANY (p_principals))
         ORDER BY 3, 2
    LOOP
        -- What auth.uid() reads, and what every SECURITY DEFINER helper the
        -- policies call reads in turn. Transaction-local: gone when this
        -- function's statement ends.
        PERFORM set_config('request.jwt.claims',
                           json_build_object('sub', r_pr.id, 'role', 'authenticated')::text, true);

        FOR r_pol IN SELECT * FROM diag.rbac_policy_surface ORDER BY tbl, policy_name
        LOOP
            BEGIN
                EXECUTE format('SELECT count(*) FROM %s', r_pol.tbl) INTO v_total;
                EXECUTE format('SELECT count(*) FROM %s WHERE %s', r_pol.tbl, r_pol.expr) INTO v_n;
            EXCEPTION WHEN OTHERS THEN
                -- An expression that cannot be evaluated standalone is reported,
                -- never silently counted as zero — a silent zero would read as
                -- "no access" and hide a policy from the diff entirely.
                v_n := -1; v_total := -1;
            END;

            principal   := r_pr.email;
            level       := r_pr.lvl;
            tbl         := r_pol.tbl;
            cmd         := r_pol.cmd;
            policy_name := r_pol.policy_name;
            matched     := v_n;
            of_total    := v_total;
            RETURN NEXT;
        END LOOP;
    END LOOP;

    PERFORM set_config('request.jwt.claims', '', true);
END
$function$;

COMMENT ON FUNCTION diag.rbac_access_snapshot(uuid[]) IS
    'Rows each principal''s policies match, per policy. Read-only: evaluates the policy expression '
    'rather than performing the write. matched = -1 means the expression could not be evaluated '
    'standalone, which is reported rather than counted as zero. Baseline captured before Phase 1 '
    'of the ladder consolidation; re-run and diff after each phase.';

REVOKE ALL ON FUNCTION diag.rbac_access_snapshot(uuid[]) FROM PUBLIC, anon, authenticated;

-- ── The probe: what each LEVEL would be able to do ──────────────────────────
-- The snapshot cannot see Gamma, Delta or Zeta because nobody holds one. This
-- evaluates the gate's own predicate for a synthetic certificate at each level,
-- scoped to one department, and asks whether it reaches its own scope, a
-- sibling department, and a foreign organization. It is the assertion that
-- would have caught the Delta defect the day it was introduced.
CREATE OR REPLACE FUNCTION diag.rbac_ladder_probe()
RETURNS TABLE (
    level            text,
    action_code      text,
    scope            text,
    own_subdept      boolean,
    sibling_subdept  boolean,
    sibling_dept     boolean,
    foreign_org      boolean
)
LANGUAGE plpgsql
AS $function$
DECLARE
    v_org      uuid; v_org2   uuid;
    v_dept_a   uuid; v_dept_b uuid;
    v_sub_a    uuid; v_sub_b  uuid;
BEGIN
    SELECT o.id INTO v_org FROM public.organizations o ORDER BY o.id LIMIT 1;
    SELECT o.id INTO v_org2 FROM public.organizations o WHERE o.id <> v_org ORDER BY o.id LIMIT 1;
    SELECT d.id INTO v_dept_a FROM public.departments d WHERE d.organization_id = v_org ORDER BY d.id LIMIT 1;
    SELECT d.id INTO v_dept_b FROM public.departments d WHERE d.organization_id = v_org AND d.id <> v_dept_a ORDER BY d.id LIMIT 1;
    SELECT sd.id INTO v_sub_a FROM public.sub_departments sd WHERE sd.department_id = v_dept_a ORDER BY sd.id LIMIT 1;
    SELECT sd.id INTO v_sub_b FROM public.sub_departments sd WHERE sd.department_id = v_dept_a AND sd.id <> v_sub_a ORDER BY sd.id LIMIT 1;

    -- A synthetic certificate at each level, shaped the way chk_scope_nullability
    -- requires, then the gate's certificate-branch predicate applied by hand.
    -- Kept literal rather than calling user_has_action_in_scope, because that
    -- function reads auth.uid() and there is no real holder to impersonate.
    RETURN QUERY
    WITH cert AS (
        SELECT lvl, org, dept, sub FROM (VALUES
            ('zeta'::public.access_level,    NULL::uuid, NULL::uuid, NULL::uuid),
            ('epsilon'::public.access_level, v_org,      NULL::uuid, NULL::uuid),
            ('delta'::public.access_level,   v_org,      v_dept_a,   NULL::uuid),
            ('gamma'::public.access_level,   v_org,      v_dept_a,   v_sub_a)
        ) AS t(lvl, org, dept, sub)
    ),
    ask AS (
        SELECT * FROM (VALUES
            ('own_subdept',     v_org,  v_dept_a, v_sub_a),
            ('sibling_subdept', v_org,  v_dept_a, v_sub_b),
            ('sibling_dept',    v_org,  v_dept_b, NULL::uuid),
            ('foreign_org',     v_org2, v_dept_a, v_sub_a)
        ) AS t(label, org, dept, sub)
    ),
    grid AS (
        SELECT c.lvl, rp.action_code, rp.scope, a.label,
               ( c.lvl = 'zeta'::public.access_level
                 OR ( c.org = a.org AND (
                          rp.scope = 'ORG'
                       OR (rp.scope = 'DEPT'     AND c.dept = a.dept)
                       OR (rp.scope = 'SUB_DEPT' AND c.sub  = a.sub))))
               AS granted
          FROM cert c
          JOIN public.rbac_permissions rp ON rp.access_level = c.lvl
          CROSS JOIN ask a
    )
    SELECT g.lvl::text, g.action_code, g.scope::text,
           bool_or(g.granted) FILTER (WHERE g.label='own_subdept'),
           bool_or(g.granted) FILTER (WHERE g.label='sibling_subdept'),
           bool_or(g.granted) FILTER (WHERE g.label='sibling_dept'),
           COALESCE(bool_or(g.granted) FILTER (WHERE g.label='foreign_org'), false)
      FROM grid g
     GROUP BY g.lvl, g.action_code, g.scope
     ORDER BY g.lvl, g.action_code;
END
$function$;

COMMENT ON FUNCTION diag.rbac_ladder_probe() IS
    'Would a certificate at each level reach its own scope, a sibling sub-department, a sibling '
    'department, and another organization? The expected shape is the specified ladder: Zeta true '
    'everywhere, Epsilon true within its org only, Delta true within its department only, Gamma '
    'within its sub-department only (plus its own department for DEPT-scoped actions). Any other '
    'shape is a ladder regression. foreign_org is false for every level except Zeta by definition; '
    'it returns false when only one organization exists.';

REVOKE ALL ON FUNCTION diag.rbac_ladder_probe() FROM PUBLIC, anon, authenticated;
