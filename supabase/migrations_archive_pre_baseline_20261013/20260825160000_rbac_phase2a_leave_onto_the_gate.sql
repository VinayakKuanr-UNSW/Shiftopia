-- ============================================================================
-- Phase 2a — the four leave policies, onto the gate.
--
-- Unlike Phase 1 these are not defects. They spell the ladder out correctly:
--
--     zeta OR (epsilon AND org) OR (delta AND org+dept)
--          OR (gamma AND org+dept+subdept)
--
-- word for word, four times, differing only in which column names the subject
-- employee. They are four places that must each be remembered and edited the
-- next time a level changes — which is exactly how Delta came to be wrong in
-- one copy while three others had it right.
--
-- SO THE PASS CONDITION IS THE OPPOSITE OF PHASE 1's. Phase 1 intended to
-- narrow and proved it by the diff showing narrowing. This must change nothing
-- at all: diag.rbac_access_diff('post-phase-1') must come back EMPTY. Any row
-- that appears means the inline copy and the catalogue disagreed, and the
-- disagreement has to be adjudicated before the copy is erased.
--
-- ── THE CATALOGUE COULD NOT EXPRESS THESE, SO IT IS EXTENDED ────────────────
--
-- There is no leave action in `rbac_permissions`. The nearest proxies both
-- change behaviour: `user.view` grants gamma DEPT scope where the inline ladder
-- grants SUB_DEPT (a widening — a supervisor would start seeing leave for the
-- whole department), and `user.edit` grants gamma nothing at all (a narrowing —
-- a supervisor would lose leave entirely). Shoehorning onto either would have
-- produced a non-empty diff that looked like a bug in the translation rather
-- than what it was: a catalogue that does not carry the actions the system
-- actually gates.
--
-- So `leave.view` and `leave.approve` are added, scoped to reproduce the
-- existing ladder EXACTLY — gamma SUB_DEPT, delta DEPT, epsilon ORG, zeta ORG.
-- The pair follows the timesheet.view / timesheet.approve convention already in
-- the table. Their scopes are identical today because the four policies they
-- replace draw no distinction between reading a leave request and approving
-- one; splitting the codes now means that distinction can be made later by
-- editing one row instead of four policies.
--
-- Purely additive: no existing row changes, so no existing grant moves.
--
-- ── ONE DELIBERATE SEMANTIC CHANGE, WHICH THE DIFF WILL NOT SHOW ────────────
--
-- The inline policies consult CERTIFICATES ONLY. `user_has_action_in_scope`
-- consults certificates UNION contracts, so after this a manager-level CONTRACT
-- would also grant leave access where before only a certificate would. Today
-- every one of the 125 active contracts is alpha, and alpha holds no leave.*
-- row, so nothing changes and the diff stays empty. It is still a real change
-- in the rule, made deliberately: every other gate-driven policy already treats
-- a manager-level contract as equivalent to a certificate, and leaving leave as
-- the sole exception would be a fifth special case rather than one fewer.
--
-- ── AND ONE ODDITY PRESERVED ON PURPOSE ─────────────────────────────────────
--
-- The join to hr.user_contracts carries NO status filter, so a manager reaches
-- an employee through any contract, active or terminated. That is why the
-- baseline reads 185 of 191 leave_balances for the org admin rather than
-- 191/191 — six employees have no contract row to be reached through at all.
-- Reproduced exactly, filter absent and all, because Phase 2's job is to move
-- the rule, not to improve it. Tightening it to Active is a separate change
-- with its own diff.
--
-- fairness_ledger and shifts_select_managers are NOT in this migration. Both
-- carry disjuncts the gate does not model — a legacy_system_role branch, and in
-- shifts_select_managers a pair of contract catch-alls that grant org- or
-- department-wide read to any gamma+ holder whose contract has null scope
-- columns. Neither is a mechanical translation; both need a decision about what
-- the rule should be, not just where it lives. They are Phase 2b.
-- ============================================================================

-- ── 1. Teach the catalogue about leave ──────────────────────────────────────
-- `rbac_permissions.action_code` is a foreign key to `rbac_actions.code`, so
-- the action has to be declared before it can be granted. That constraint is
-- the reason this migration failed on its first attempt, and it is doing its
-- job: an action code that exists only in a grant would be a permission nobody
-- could look up.
INSERT INTO public.rbac_actions (code, description) VALUES
    ('leave.view',    'View leave requests, balances and history for others'),
    ('leave.approve', 'Approve or reject leave requests')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.rbac_permissions (access_level, action_code, scope) VALUES
    ('gamma'::public.access_level,   'leave.view',    'SUB_DEPT'::public.rbac_scope),
    ('delta'::public.access_level,   'leave.view',    'DEPT'::public.rbac_scope),
    ('epsilon'::public.access_level, 'leave.view',    'ORG'::public.rbac_scope),
    ('zeta'::public.access_level,    'leave.view',    'ORG'::public.rbac_scope),
    ('gamma'::public.access_level,   'leave.approve', 'SUB_DEPT'::public.rbac_scope),
    ('delta'::public.access_level,   'leave.approve', 'DEPT'::public.rbac_scope),
    ('epsilon'::public.access_level, 'leave.approve', 'ORG'::public.rbac_scope),
    ('zeta'::public.access_level,    'leave.approve', 'ORG'::public.rbac_scope)
ON CONFLICT (access_level, action_code) DO NOTHING;

-- ── 2. leave_requests ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS leave_requests_manager_select ON public.leave_requests;
CREATE POLICY leave_requests_manager_select
    ON public.leave_requests
    AS PERMISSIVE FOR SELECT TO public
    USING (
        EXISTS (
            SELECT 1
              FROM hr.user_contracts target_uc
             WHERE target_uc.user_id = leave_requests.employee_id
               AND public.user_has_action_in_scope(
                       'leave.view', target_uc.organization_id,
                       target_uc.department_id, target_uc.sub_department_id)
        )
    );

DROP POLICY IF EXISTS leave_requests_manager_update ON public.leave_requests;
CREATE POLICY leave_requests_manager_update
    ON public.leave_requests
    AS PERMISSIVE FOR UPDATE TO public
    USING (
        EXISTS (
            SELECT 1
              FROM hr.user_contracts target_uc
             WHERE target_uc.user_id = leave_requests.employee_id
               AND public.user_has_action_in_scope(
                       'leave.approve', target_uc.organization_id,
                       target_uc.department_id, target_uc.sub_department_id)
        )
    );

-- ── 3. leave_balances ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS leave_balances_manager_select ON public.leave_balances;
CREATE POLICY leave_balances_manager_select
    ON public.leave_balances
    AS PERMISSIVE FOR SELECT TO public
    USING (
        EXISTS (
            SELECT 1
              FROM hr.user_contracts target_uc
             WHERE target_uc.user_id = leave_balances.employee_id
               AND public.user_has_action_in_scope(
                       'leave.view', target_uc.organization_id,
                       target_uc.department_id, target_uc.sub_department_id)
        )
    );

-- ── 4. leave_request_events ─────────────────────────────────────────────────
DROP POLICY IF EXISTS leave_events_manager_select ON public.leave_request_events;
CREATE POLICY leave_events_manager_select
    ON public.leave_request_events
    AS PERMISSIVE FOR SELECT TO public
    USING (
        EXISTS (
            SELECT 1
              FROM hr.user_contracts target_uc
             WHERE target_uc.user_id = leave_request_events.employee_id
               AND public.user_has_action_in_scope(
                       'leave.view', target_uc.organization_id,
                       target_uc.department_id, target_uc.sub_department_id)
        )
    );

-- ── 5. Self-test ────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
    v_failures text := '';
    v_n        int;
BEGIN
    -- (a) The catalogue learned leave, at the scopes that reproduce the ladder.
    SELECT count(*) INTO v_n FROM public.rbac_permissions
     WHERE action_code IN ('leave.view','leave.approve');
    IF v_n <> 8 THEN
        v_failures := v_failures || format('(a) expected 8 leave.* rows, found %s ; ', v_n);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.rbac_permissions
                    WHERE action_code='leave.view' AND access_level='gamma'
                      AND scope='SUB_DEPT'::public.rbac_scope) THEN
        v_failures := v_failures
            || '(b) gamma leave.view is not SUB_DEPT — the ladder would widen ; ';
    END IF;

    -- (c) All four policies now go through the gate, and none names a level.
    SELECT count(*) INTO v_n FROM diag.rbac_policy_surface
     WHERE tbl IN ('leave_requests','leave_balances','leave_request_events')
       AND uses_gate;
    IF v_n <> 4 THEN
        v_failures := v_failures
            || format('(c) expected 4 gate-driven leave policies, found %s ; ', v_n);
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policy
         WHERE polrelid IN ('public.leave_requests'::regclass,
                            'public.leave_balances'::regclass,
                            'public.leave_request_events'::regclass)
           AND polname LIKE '%manager%'
           AND COALESCE(pg_get_expr(polqual,polrelid),'') LIKE '%''epsilon''::access_level%'
    ) THEN
        v_failures := v_failures || '(d) a leave policy still spells the ladder out ; ';
    END IF;

    -- (e) Existing grants were not disturbed by the INSERT.
    SELECT count(*) INTO v_n FROM public.rbac_permissions
     WHERE action_code NOT LIKE 'leave.%';
    IF v_n <> 89 THEN
        v_failures := v_failures
            || format('(e) the pre-existing catalogue changed size: %s, expected 89 ; ', v_n);
    END IF;

    IF v_failures <> '' THEN
        RAISE EXCEPTION 'rbac_phase2a_leave_onto_the_gate selftest FAILED: %', v_failures;
    END IF;

    RAISE NOTICE 'rbac_phase2a_leave_onto_the_gate selftest PASSED';
END
$selftest$;
