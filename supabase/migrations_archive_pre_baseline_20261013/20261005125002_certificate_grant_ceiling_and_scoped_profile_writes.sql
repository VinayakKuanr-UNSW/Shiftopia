-- ─────────────────────────────────────────────────────────────────────────────
-- APPLIED TO PROD 2026-10-05 via the Supabase MCP (ledger version
-- 20261005125002). Do not re-run against production. Rollback-only dry-runs
-- with synthetic certificates: epsilon grants gamma and epsilon, grant zeta
-- 42501, raise a gamma cert to zeta 42501, own cert → zeta 0 rows, revoke OK;
-- delta grants a cert 42501, edits a profile in its department (1 row) but not
-- in another department (0), deletes a profile 0 rows, role change 42501 (the
-- existing trigger); employee self-certificate 42501, sees only own cert, edits
-- another profile 0 rows, own profile 1 row, still reads all profiles.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- Put a ceiling on certificate grants, and scope manager writes to profiles.
--
-- Certificates are the main privilege source (user_has_action_in_scope reads
-- them first). "Admins can manage certificates" was FOR ALL, gated only by
-- auth_can_manage_certificates() — "is the caller a certificate manager at
-- all" (legacy admin, or an active epsilon+ Y certificate). Nothing bounded
-- WHAT they grant: an epsilon could issue a zeta certificate (zeta is a global
-- bypass in user_has_action_in_scope) to themselves or anyone, or rewrite a
-- superior's certificate. Writes now also pass can_grant_certificate(): the
-- level must not exceed the caller's own ceiling in that organisation
-- (caller_access_ceiling, 20261005122256), and only zeta may touch their own
-- certificates. Read access for certificate managers is unchanged.
--
-- profiles_manage_delta was FOR ALL with a row-blind USING
-- (user_has_delta_access): any manager could insert, update or DELETE any
-- profile in any organisation. The client never writes another user's profile
-- (the only writes are useSettings' own-profile updates, covered by
-- profiles_update_own), and reads come from profiles_select_all. Replaced by a
-- scoped UPDATE — user.edit over the employee's active contract, never self —
-- via can_manage_employee_record (20261005070333). No client INSERT/DELETE:
-- profiles are created by the auth trigger. legacy_system_role changes remain
-- guarded by trg_enforce_role_change_authority.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Certificates ─────────────────────────────────────────────────────────
CREATE FUNCTION public.can_grant_certificate(p_user_id uuid, p_org_id uuid, p_level public.access_level)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.auth_can_manage_certificates()
     AND COALESCE(public.caller_access_ceiling(p_org_id) >= p_level, false)
     AND (p_user_id IS DISTINCT FROM auth.uid()
          OR public.caller_access_ceiling(p_org_id) = 'zeta');
$$;

DROP POLICY "Admins can manage certificates" ON public.app_access_certificates;

CREATE POLICY certificates_select_manager ON public.app_access_certificates
  FOR SELECT TO authenticated
  USING (public.auth_can_manage_certificates());

CREATE POLICY certificates_insert_manager ON public.app_access_certificates
  FOR INSERT TO authenticated
  WITH CHECK (public.can_grant_certificate(user_id, organization_id, access_level));

CREATE POLICY certificates_update_manager ON public.app_access_certificates
  FOR UPDATE TO authenticated
  USING      (public.can_grant_certificate(user_id, organization_id, access_level))
  WITH CHECK (public.can_grant_certificate(user_id, organization_id, access_level));

CREATE POLICY certificates_delete_manager ON public.app_access_certificates
  FOR DELETE TO authenticated
  USING (public.can_grant_certificate(user_id, organization_id, access_level));

-- ── 2. Profiles ─────────────────────────────────────────────────────────────
DROP POLICY profiles_manage_delta ON public.profiles;

CREATE POLICY profiles_update_manager ON public.profiles
  FOR UPDATE TO authenticated
  USING      (public.can_manage_employee_record(id))
  WITH CHECK (public.can_manage_employee_record(id));

-- ── Grants (revoke last: CREATE re-applies default grants) ──────────────────
REVOKE ALL ON FUNCTION public.can_grant_certificate(uuid, uuid, public.access_level) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_grant_certificate(uuid, uuid, public.access_level) TO authenticated, service_role;
