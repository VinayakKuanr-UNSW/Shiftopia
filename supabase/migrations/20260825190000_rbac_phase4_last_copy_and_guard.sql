-- ============================================================================
-- Phase 4 — make the next copy impossible, and remove the one the guard found.
--
-- THE GUARD REFUSED TO INSTALL, AND IT WAS RIGHT. The rule it enforces is "a
-- policy may not decide access from a level unless it calls
-- user_has_action_in_scope". On first run it reported one violation:
-- `shifts_select_rbac` — the policy every other phase pointed at as the model.
--
-- It was catalogue-driven, which is why the earlier audit filed it under "the
-- one that gets it right". But it did not CALL the gate; it inlined the gate's
-- own predicate — the zeta bypass, the ORG/DEPT/SUB_DEPT branch on rp.scope,
-- the certificate arm and the contract arm, all of it, spelled out again. So it
-- was still a copy. Not a copy of the ladder this time, a copy of the thing
-- that was supposed to have replaced the copies.
--
-- That is why the rule is written as "calls the gate" rather than "joins
-- rbac_permissions": the looser rule would have accepted this policy forever.
--
-- Rewritten to call the gate, with the self-access disjunct kept verbatim so an
-- employee still sees the shift they are on or one they rejected. Verified
-- identical for all 107 profiles BEFORE applying, because a SELECT policy on
-- `shifts` is not somewhere to find out afterwards; the access diff then came
-- back empty independently.
--
-- ── THE GUARD ITSELF, IN TWO HALVES ────────────────────────────────────────
--
-- Neither half is sufficient alone.
--
--   `diag.rbac_ladder_violations` (here) reads the LIVE catalogue, which is what
--   actually enforces access. It sees a policy created by hand, or one whose
--   applied form differs from how its migration reads.
--
--   `src/platform/auth/__tests__/rbac-ladder-consolidation.test.ts` reads the
--   MIGRATIONS, because vitest has no database and CI does have the repo. Since
--   a migration is the only way a policy should reach production, that is where
--   a new copy gets caught before it exists.
--
-- The test strips SQL comments before matching — load-bearing, since the Phase
-- 1-3 migrations quote the old IN-lists at length while explaining them, and a
-- matcher that read comments would flag every fix as the defect. It also proves
-- itself against a synthetic violation, because it inspects only migrations at
-- or after its cutoff and there are none yet; without that it would pass no
-- matter what it did.
--
-- ── THE TWO ACCEPTED EXCEPTIONS ────────────────────────────────────────────
--
-- `demand_templates` (3 policies) has no tenant column at all, and
-- `timesheet_audit_log` (1) has both foreign keys orphaned with no route to a
-- scope. Both are documented in 20260825150000 and in COMMENT ON TABLE. The
-- self-test asserts the exceptions still MATCH the view — if they ever stop, a
-- clean report would mean the view had stopped matching anything rather than
-- that the rule holds.
-- ============================================================================

DROP POLICY IF EXISTS shifts_select_rbac ON public.shifts;
CREATE POLICY shifts_select_rbac
    ON public.shifts AS PERMISSIVE FOR SELECT TO public
    USING (
        public.user_has_action_in_scope('shift.view', shifts.organization_id,
                                        shifts.department_id, shifts.sub_department_id)
        OR (
            (shifts.assigned_employee_id = (SELECT auth.uid())
             OR shifts.last_rejected_by = (SELECT auth.uid()))
            AND EXISTS (SELECT 1 FROM public.user_contracts uc
                         WHERE uc.user_id = (SELECT auth.uid()) AND uc.status = 'Active')
        )
    );

CREATE OR REPLACE VIEW diag.rbac_ladder_violations AS
SELECT p.polrelid::regclass::text AS tbl,
       p.polname                  AS policy_name,
       CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                     WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                     ELSE 'ALL' END AS cmd,
       CASE
         WHEN p.polrelid = 'public.demand_templates'::regclass
           THEN 'accepted: table has no tenant column (COMMENT ON TABLE)'
         WHEN p.polrelid = 'public.timesheet_audit_log'::regclass
           THEN 'accepted: both foreign keys orphaned, no route to a scope'
         ELSE 'VIOLATION'
       END AS verdict
  FROM pg_policy p
 WHERE (COALESCE(pg_get_expr(p.polqual, p.polrelid), '')
     || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'access_level'
   AND (COALESCE(pg_get_expr(p.polqual, p.polrelid), '')
     || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ '''(gamma|delta|epsilon|zeta)'''
   AND (COALESCE(pg_get_expr(p.polqual, p.polrelid), '')
     || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')) !~ 'user_has_action_in_scope';

COMMENT ON VIEW diag.rbac_ladder_violations IS
    'Live policies that decide access from a level without asking the gate. VIOLATION rows are new '
    'inline ladders. The two accepted tables are documented in migration 20260825150000: neither '
    'can reach an organization, and both say so in a COMMENT ON TABLE. Paired with the vitest '
    'guard, which reads migrations rather than the live catalogue.';

DO $selftest$
DECLARE v_violations int; v_accepted int; v_admin uuid; v_n bigint; v_expr text;
BEGIN
    SELECT count(*) FILTER (WHERE verdict = 'VIOLATION'),
           count(*) FILTER (WHERE verdict <> 'VIOLATION')
      INTO v_violations, v_accepted FROM diag.rbac_ladder_violations;

    IF v_violations > 0 THEN
        RAISE EXCEPTION 'phase4: % live policies still inline the ladder', v_violations;
    END IF;
    IF v_accepted = 0 THEN
        RAISE EXCEPTION 'phase4: the accepted exceptions vanished — the view matches nothing, so a green result proves nothing';
    END IF;

    SELECT id INTO v_admin FROM public.profiles WHERE email='kurryosity@gmail.com';
    IF v_admin IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims',
                           json_build_object('sub', v_admin,'role','authenticated')::text, true);
        SELECT pg_get_expr(polqual,polrelid) INTO v_expr FROM pg_policy
         WHERE polrelid='public.shifts'::regclass AND polname='shifts_select_rbac';
        EXECUTE format('SELECT count(*) FROM public.shifts WHERE %s', v_expr) INTO v_n;
        PERFORM set_config('request.jwt.claims','',true);
        IF v_n <> (SELECT count(*) FROM public.shifts) THEN
            RAISE EXCEPTION 'phase4: org admin lost shifts after the rewrite: % of %',
                            v_n, (SELECT count(*) FROM public.shifts);
        END IF;
    END IF;

    RAISE NOTICE 'phase4 selftest PASSED — 0 violations, % accepted exceptions', v_accepted;
END
$selftest$;
