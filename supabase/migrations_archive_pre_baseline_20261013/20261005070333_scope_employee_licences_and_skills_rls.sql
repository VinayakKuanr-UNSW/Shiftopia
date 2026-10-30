-- ─────────────────────────────────────────────────────────────────────────────
-- APPLIED TO PROD 2026-10-05 via the Supabase MCP (ledger version
-- 20261005070333). Do not re-run against production. Rollback-only dry-run
-- beforehand as employee / org manager / anon: employee self-grant of a
-- licence or skill refused (42501), employee update/delete of others' rows
-- touched 0; manager insert passed RLS, update 1, delete 1; manager self-grant
-- refused; anon has no table privilege.
--
-- Visible effect: 6 profiles with NO contract and NO certificate in any
-- organisation (27 licences, 66 skills — the dev team's own accounts) are now
-- readable only by their owner and zeta admins.
-- ─────────────────────────────────────────────────────────────────────────────

-- employee_licenses and employee_skills had `USING true` / `WITH CHECK true`
-- policies for every command: any signed-in user could read every
-- organisation's records, grant THEMSELVES any licence or skill (both feed
-- shift eligibility and compliance), or delete anyone's. All app writes come
-- from the managers' Users page, and swap compliance reads a partner's
-- licences client-side, so:
--   read  — your own records, or those of anyone you share an organisation with
--           (active contract or access certificate; zeta sees all);
--   write — `user.edit` over one of the employee's active contracts, never your
--           own record (a self-granted licence would change your eligibility).

CREATE FUNCTION public.can_manage_employee_record(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND p_employee_id IS DISTINCT FROM auth.uid()
     AND EXISTS (
       SELECT 1 FROM public.user_contracts uc
        WHERE uc.user_id = p_employee_id
          AND uc.status = 'Active'
          AND public.user_has_action_in_scope('user.edit', uc.organization_id, uc.department_id, uc.sub_department_id)
     );
$$;

CREATE FUNCTION public.shares_organisation_with(p_other uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
       p_other = auth.uid()
    OR EXISTS (
         SELECT 1 FROM public.user_contracts mine
         JOIN public.user_contracts theirs ON theirs.organization_id = mine.organization_id
          WHERE mine.user_id = auth.uid() AND mine.status = 'Active'
            AND theirs.user_id = p_other AND theirs.status = 'Active')
    OR EXISTS (
         SELECT 1 FROM public.app_access_certificates ac
         JOIN public.user_contracts theirs ON theirs.organization_id = ac.organization_id
          WHERE ac.user_id = auth.uid() AND ac.is_active
            AND theirs.user_id = p_other AND theirs.status = 'Active')
    OR EXISTS (
         SELECT 1 FROM public.app_access_certificates ac
          WHERE ac.user_id = auth.uid() AND ac.is_active AND ac.access_level = 'zeta')
  );
$$;

DROP POLICY "Authenticated users can view employee licenses"   ON public.employee_licenses;
DROP POLICY "Authenticated users can manage employee licenses" ON public.employee_licenses;
DROP POLICY "Authenticated users can update employee licenses" ON public.employee_licenses;
DROP POLICY "Authenticated users can delete employee licenses" ON public.employee_licenses;

CREATE POLICY employee_licenses_select ON public.employee_licenses FOR SELECT TO authenticated
  USING (public.shares_organisation_with(employee_id));
CREATE POLICY employee_licenses_insert ON public.employee_licenses FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_employee_record(employee_id));
CREATE POLICY employee_licenses_update ON public.employee_licenses FOR UPDATE TO authenticated
  USING (public.can_manage_employee_record(employee_id))
  WITH CHECK (public.can_manage_employee_record(employee_id));
CREATE POLICY employee_licenses_delete ON public.employee_licenses FOR DELETE TO authenticated
  USING (public.can_manage_employee_record(employee_id));

DROP POLICY "Authenticated users can view employee skills"   ON public.employee_skills;
DROP POLICY "Authenticated users can manage employee skills" ON public.employee_skills;
DROP POLICY "Authenticated users can update employee skills" ON public.employee_skills;
DROP POLICY "Authenticated users can delete employee skills" ON public.employee_skills;

CREATE POLICY employee_skills_select ON public.employee_skills FOR SELECT TO authenticated
  USING (public.shares_organisation_with(employee_id));
CREATE POLICY employee_skills_insert ON public.employee_skills FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_employee_record(employee_id));
CREATE POLICY employee_skills_update ON public.employee_skills FOR UPDATE TO authenticated
  USING (public.can_manage_employee_record(employee_id))
  WITH CHECK (public.can_manage_employee_record(employee_id));
CREATE POLICY employee_skills_delete ON public.employee_skills FOR DELETE TO authenticated
  USING (public.can_manage_employee_record(employee_id));

-- Revoke last: CREATE re-applies Supabase's default grants (PUBLIC, anon AND authenticated).
REVOKE ALL ON public.employee_licenses, public.employee_skills FROM anon;
REVOKE ALL ON FUNCTION public.can_manage_employee_record(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shares_organisation_with(uuid)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_employee_record(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shares_organisation_with(uuid)   TO authenticated, service_role;
