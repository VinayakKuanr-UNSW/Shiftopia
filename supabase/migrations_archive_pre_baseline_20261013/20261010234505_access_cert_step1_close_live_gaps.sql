-- ============================================================================
-- Access-certificate audit (2026-10-11), step 1: close the live gaps.
--
-- ── 1. A CONTRACT NO LONGER CARRIES AN ACCESS LEVEL ─────────────────────────
--
-- hr.user_contracts.access_level was a second, unvalidated way to grant
-- authority. has_permission, is_org_admin, caller_access_ceiling,
-- user_has_action_in_scope and get_employees_shift_window_bulk all honour it,
-- yet nothing constrains it, the contract wizard never sets it and no screen
-- shows it. can_write_contract checks only the writer's ORG-level ceiling, so a
-- delta of one department could write a colleague a contract with
-- access_level = 'delta' and no department — which has_permission reads as
-- "unscoped, allow the whole organization".
--
-- 20260825130000 already established that a contract's organization /
-- department / sub-department columns are the EMPLOYMENT scope (which job),
-- not an access scope. An access level read against an employment scope is
-- the category error; authority belongs to app_access_certificates alone.
-- Every row is NULL today (2 of 2), so the constraint changes no behaviour —
-- it stops anyone starting. The column stays because the client still
-- selects it; drop it once the frontend stops reading it.
--
-- ── 2. ZETA COULD NOT RECOMPUTE THE FAIRNESS LEDGER ─────────────────────────
--
-- request_fairness_ledger_recompute matched `c.organization_id = p_org_id`.
-- A zeta certificate is global and, by chk_scope_nullability, has NO
-- organization, so it never matched; only a legacy_system_role = 'admin'
-- profile got through. Body otherwise byte-identical to pg_get_functiondef.
--
-- ── 3. get_user_access_levels(uuid) ─────────────────────────────────────────
--
-- SECURITY DEFINER, executable by every signed-in user, returns ANY user's
-- access levels including revoked certificates, and has no callers (no
-- policy, function, client or edge function). Revoked from clients, kept for
-- service_role.
--
-- ── 4. anon ON app_access_certificates ──────────────────────────────────────
--
-- anon held every table privilege, TRUNCATE included. RLS denies it every row
-- through PostgREST, but nothing pre-auth reads certificates, so the grant is
-- pure exposure.
-- ============================================================================

-- ── 1 ───────────────────────────────────────────────────────────────────────
ALTER TABLE hr.user_contracts
    ADD CONSTRAINT user_contracts_no_access_level CHECK (access_level IS NULL);

COMMENT ON COLUMN hr.user_contracts.access_level IS
    'DEPRECATED — always NULL (user_contracts_no_access_level, 20261011). Authority is granted by app_access_certificates only; a contract is employment, not an appointment. The organization/department/sub_department columns on this table are the EMPLOYMENT scope — which job this contract is for — not an access scope, and a NULL sub_department_id is a legitimate department-wide engagement (see 20260825130000).';

-- ── 2 ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_fairness_ledger_recompute(p_org_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rows integer;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;

    IF NOT (
        EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = auth.uid()
                   AND p.legacy_system_role = 'admin'::public.system_role)
        OR EXISTS (SELECT 1 FROM public.app_access_certificates c
                    WHERE c.user_id = auth.uid()
                      AND c.is_active = true
                      AND (c.access_level = 'zeta' OR c.organization_id = p_org_id)
                      AND c.access_level = ANY (
                            ARRAY['gamma','delta','epsilon','zeta']::public.access_level[]))
    ) THEN
        RAISE EXCEPTION 'not authorised to recompute the fairness ledger for this organization'
            USING ERRCODE = '42501';
    END IF;

    SELECT public.recompute_fairness_ledger(p_org_id, p_as_of) INTO v_rows;
    RETURN v_rows;
END $function$;

-- Restate the ACL it had: authenticated + service_role, never anon/PUBLIC.
REVOKE ALL ON FUNCTION public.request_fairness_ledger_recompute(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_fairness_ledger_recompute(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_fairness_ledger_recompute(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_fairness_ledger_recompute(uuid, date) TO service_role;

-- ── 3 ───────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.get_user_access_levels(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_access_levels(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_user_access_levels(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_access_levels(uuid) TO service_role;

-- ── 4 ───────────────────────────────────────────────────────────────────────
REVOKE ALL ON TABLE public.app_access_certificates FROM anon;

-- ── Verify ──────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
    v_failures text := '';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'hr.user_contracts'::regclass
                      AND conname = 'user_contracts_no_access_level') THEN
        v_failures := v_failures || '(1) contract access_level constraint missing ; ';
    END IF;

    IF pg_get_functiondef('public.request_fairness_ledger_recompute(uuid,date)'::regprocedure)
       NOT LIKE '%c.access_level = ''zeta'' OR c.organization_id = p_org_id%' THEN
        v_failures := v_failures || '(2) fairness recompute still org-only ; ';
    END IF;
    IF has_function_privilege('anon', 'public.request_fairness_ledger_recompute(uuid,date)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.request_fairness_ledger_recompute(uuid,date)', 'EXECUTE') THEN
        v_failures := v_failures || '(2) fairness recompute ACL drifted ; ';
    END IF;

    IF has_function_privilege('authenticated', 'public.get_user_access_levels(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_user_access_levels(uuid)', 'EXECUTE') THEN
        v_failures := v_failures || '(3) get_user_access_levels(uuid) still client-callable ; ';
    END IF;

    IF has_table_privilege('anon', 'public.app_access_certificates', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
        v_failures := v_failures || '(4) anon still holds privileges on app_access_certificates ; ';
    END IF;

    IF v_failures <> '' THEN
        RAISE EXCEPTION 'access-certificate step 1 verification failed: %', v_failures;
    END IF;
END
$verify$;
