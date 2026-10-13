-- ─────────────────────────────────────────────────────────────────────────────
-- APPLIED TO PROD 2026-10-05 via the Supabase MCP (ledger version
-- 20261005122256). Do not re-run against production. Rollback-only dry-runs
-- beforehand: anon read/update 42501; employee sees 1 (own) contract, self →
-- zeta 0 rows, edit others 0 rows, profile → admin 42501; employee's shifts /
-- events / first-aid / broadcast-group visibility unchanged (20/3/0/0). With
-- synthetic certificates: delta edits an employee (1 row), grants delta, grant
-- epsilon 42501, edit own 0 rows, edit/delete an epsilon superior 0 rows;
-- epsilon grants epsilon, grant zeta 42501, edit own 0 rows. Live afterwards:
-- REST anon GET 401/42501, James reads 1 contract and his self-promotion
-- changes 0 rows.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- Close the public.user_contracts privilege escalation.
--
-- public.user_contracts is a view over hr.user_contracts. The baseline created
-- it WITH (security_invoker = true). Migration 20260817000000 re-created it with
-- CREATE OR REPLACE VIEW and no WITH clause — and REPLACE *replaces* a view's
-- reloptions, so security_invoker was silently dropped. From then on the view
-- ran as its owner (postgres), which bypasses hr.user_contracts' RLS (not
-- FORCEd), and anon/authenticated held ALL privileges on it. A single-table
-- view is auto-updatable, so on 2026-10-05 a rollback-only probe showed:
--   * anon (publishable key, no sign-in) could read, UPDATE and DELETE all
--     125 contracts — pay rate, remuneration level, access level;
--   * an alpha employee could set their own contract to access_level 'zeta',
--     and user_has_action_in_scope() trusts contract access levels.
--
-- Turning security_invoker back on puts hr.user_contracts' policies back in
-- charge. Its write policy, contracts_manage_delta, was FOR ALL with no WITH
-- CHECK and a row-blind USING (user_has_delta_access), so ANY delta could write
-- ANY contract to ANY level — including making themselves zeta. It is replaced
-- by per-command policies through can_write_contract():
--   * the caller has manager access (unchanged population: user_has_delta_access);
--   * never their own contract (a contract is a privilege source), except zeta;
--   * never at a level above the caller's own (closes delta → zeta, and stops a
--     manager editing a superior's contract).
--
-- Reads: own contracts (contracts_select_own) and managers (contracts_select_delta)
-- are unchanged. Every policy on another table that reads public.user_contracts
-- reads only the caller's own rows, so they keep working; the ones that read
-- other employees' contracts already query hr.user_contracts directly. Employee
-- browsers can no longer see colleagues' contracts — the pre-2026-08-17 state;
-- the only client path that tried (swap acceptance's counterparty context) then
-- falls back to defaults, and the manager re-verifies at approval with full data.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. The view runs with the caller's rights again ─────────────────────────
ALTER VIEW public.user_contracts SET (security_invoker = on);

-- ── 2. anon has no business with contracts ──────────────────────────────────
REVOKE ALL ON public.user_contracts FROM anon;
REVOKE ALL ON hr.user_contracts     FROM anon;

-- ── 3. The caller's own ceiling, and who may write a contract ───────────────
CREATE FUNCTION public.caller_access_ceiling(p_org_id uuid)
RETURNS public.access_level
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT max(lvl) FROM (
    SELECT ac.access_level AS lvl
      FROM public.app_access_certificates ac
     WHERE ac.user_id = auth.uid() AND ac.is_active
       AND (ac.access_level = 'zeta' OR ac.organization_id IS NULL OR ac.organization_id = p_org_id)
    UNION ALL
    SELECT uc.access_level
      FROM hr.user_contracts uc
     WHERE uc.user_id = auth.uid() AND uc.status = 'Active' AND uc.organization_id = p_org_id
    UNION ALL
    SELECT CASE p.legacy_system_role WHEN 'admin' THEN 'zeta'::public.access_level
                                     WHEN 'manager' THEN 'delta'::public.access_level END
      FROM public.profiles p
     WHERE p.id = auth.uid() AND p.legacy_system_role IN ('admin', 'manager')
  ) levels;
$$;

CREATE FUNCTION public.can_write_contract(p_user_id uuid, p_org_id uuid, p_level public.access_level)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.user_has_delta_access(auth.uid())
     AND COALESCE(public.caller_access_ceiling(p_org_id) >= COALESCE(p_level, 'alpha'), false)
     AND (p_user_id IS DISTINCT FROM auth.uid()
          OR public.caller_access_ceiling(p_org_id) = 'zeta');
$$;

-- ── 4. Replace the row-blind manager write policy ───────────────────────────
DROP POLICY contracts_manage_delta ON hr.user_contracts;

CREATE POLICY contracts_insert_manager ON hr.user_contracts
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_contract(user_id, organization_id, access_level));

CREATE POLICY contracts_update_manager ON hr.user_contracts
  FOR UPDATE TO authenticated
  USING      (public.can_write_contract(user_id, organization_id, access_level))
  WITH CHECK (public.can_write_contract(user_id, organization_id, access_level));

CREATE POLICY contracts_delete_manager ON hr.user_contracts
  FOR DELETE TO authenticated
  USING (public.can_write_contract(user_id, organization_id, access_level));

-- ── Grants (revoke last: CREATE re-applies default grants) ──────────────────
REVOKE ALL ON FUNCTION public.caller_access_ceiling(uuid)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_contract(uuid, uuid, public.access_level) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_access_ceiling(uuid)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_contract(uuid, uuid, public.access_level) TO authenticated, service_role;
