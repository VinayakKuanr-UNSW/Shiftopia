-- ─────────────────────────────────────────────────────────────────────────────
-- APPLIED TO PROD 2026-10-05 via the Supabase MCP (ledger version
-- 20261005073424). Do not re-run against production. Rollback-only dry-runs
-- beforehand as employee / org manager: employee add-holiday 42501, org edit 0
-- rows, add-subgroup 42501, delete-group 0 rows, forge valid shift_event 42501;
-- reads unchanged (205 holidays, 2025 roster groups); manager add-subgroup OK,
-- branding update 1 row, shift edit OK. Afterwards: 0 open write policies left.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- Close every `USING true` / `WITH CHECK true` WRITE policy left in public.
--
-- A 2026-10-05 sweep found ~50 such policies on 30 tables. Each one let ANY
-- signed-in user (two let anon) write rows that pay, eligibility, audit or the
-- roster structure depend on — e.g. add a public holiday (every engine then
-- prices that day at 250–275%), rename an organisation or change its
-- jurisdiction, delete roster groups, forge shift_events audit history (which
-- feeds nine metric functions), raise their own reliability/suitability score,
-- or strip a shift's required licences. Read policies are untouched.
--
-- Write paths were mapped first (client, Python services, SQL):
--   * Most tables have NO client writer — only SECURITY DEFINER functions
--     (which bypass RLS) or nothing at all. Their write policies are dropped.
--   * shift_events is written by three SECURITY INVOKER capture triggers
--     running as the signed-in user, so they become SECURITY DEFINER first
--     (none reads current_user/session_user; search_path is already pinned).
--   * roster_groups / roster_subgroups have real client inserts (Roster
--     Planner, shift synthesiser, Office): writes now need `roster.edit` over
--     the owning roster (every roster carries org/dept/sub-dept).
--   * organizations: the Settings page updates `branding`; now only an
--     organisation admin (active epsilon/zeta contract or certificate) may.
--   * broadcast_acknowledgements / broadcast_read_status were readable ONLY via
--     their open ALL policy; that read access is re-stated as SELECT.
--   * demand_forecasts / predicted_labor_demand lose their anon INSERT: the ML
--     service writes with the service-role key (its anon-key fallback is a
--     misconfiguration and will now fail loudly instead of writing).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Capture triggers write shift_events with the owner's rights ───────────
ALTER FUNCTION public.fn_capture_shift_event() SECURITY DEFINER;
ALTER FUNCTION public.fn_capture_offer_event() SECURITY DEFINER;
ALTER FUNCTION public.fn_capture_swap_event()  SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.fn_capture_shift_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_capture_offer_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_capture_swap_event()  FROM PUBLIC, anon, authenticated;

-- ── 2. Authorisation helpers ─────────────────────────────────────────────────
CREATE FUNCTION public.can_edit_roster(p_roster_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.rosters r
     WHERE r.id = p_roster_id
       AND public.user_has_action_in_scope('roster.edit', r.organization_id, r.department_id, r.sub_department_id));
$$;

CREATE FUNCTION public.can_edit_roster_group(p_roster_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.roster_groups g
                  WHERE g.id = p_roster_group_id AND public.can_edit_roster(g.roster_id));
$$;

CREATE FUNCTION public.is_org_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.app_access_certificates ac
                WHERE ac.user_id = auth.uid() AND ac.is_active
                  AND (ac.access_level = 'zeta'
                       OR (ac.access_level = 'epsilon' AND ac.organization_id = p_org_id)))
    OR EXISTS (SELECT 1 FROM public.user_contracts uc
                WHERE uc.user_id = auth.uid() AND uc.status = 'Active'
                  AND uc.organization_id = p_org_id AND uc.access_level IN ('epsilon', 'zeta')));
$$;

-- ── 3. Drop the open write policies ─────────────────────────────────────────
DROP POLICY "System can delete assignment snapshots" ON public.assignment_snapshots;
DROP POLICY "System can insert assignment snapshots" ON public.assignment_snapshots;
DROP POLICY "System can update assignment snapshots" ON public.assignment_snapshots;

DROP POLICY "Enable all access for authenticated users on acks" ON public.broadcast_acknowledgements;
CREATE POLICY broadcast_acknowledgements_select ON public.broadcast_acknowledgements
  FOR SELECT TO authenticated USING (true);   -- unchanged read access; writes go through acknowledge_broadcast()

DROP POLICY "Enable all access for authenticated users on read status" ON public.broadcast_read_status;
CREATE POLICY broadcast_read_status_select ON public.broadcast_read_status
  FOR SELECT TO authenticated USING (true);   -- unchanged read access; writes go through mark_broadcast_read()

DROP POLICY "Authenticated users can remove group members" ON public.broadcast_group_members;
DROP POLICY "Authenticated users can add group members"    ON public.broadcast_group_members;
DROP POLICY "Authenticated users can update group members" ON public.broadcast_group_members;

DROP POLICY "Allow authenticated users to manage certifications" ON public.certifications;
DROP POLICY "Authenticated users can create certifications"     ON public.certifications;

DROP POLICY authenticated_all_demand_forecasts         ON public.demand_forecasts;
DROP POLICY "Allow anon insert on demand_forecasts"     ON public.demand_forecasts;

DROP POLICY "Authenticated users can manage departments" ON public.departments;
DROP POLICY "Authenticated users can update departments" ON public.departments;

DROP POLICY "System can manage reliability metrics" ON public.employee_reliability_metrics;
DROP POLICY "System can update reliability metrics" ON public.employee_reliability_metrics;
DROP POLICY "System can manage suitability scores"  ON public.employee_suitability_scores;
DROP POLICY "System can update suitability scores"  ON public.employee_suitability_scores;

DROP POLICY "Allow authenticated users to manage event tags" ON public.event_tags;
DROP POLICY "Authenticated users can create event tags"     ON public.event_tags;

DROP POLICY authenticated_update_labor_correction_factors ON public.labor_correction_factors;

DROP POLICY "Authenticated users can create licenses" ON public.licenses;

DROP POLICY "Authenticated users can create organizations" ON public.organizations;
DROP POLICY "Authenticated users can update organizations" ON public.organizations;
CREATE POLICY organizations_update_admin ON public.organizations
  FOR UPDATE TO authenticated
  USING (public.is_org_admin(id)) WITH CHECK (public.is_org_admin(id));

DROP POLICY authenticated_insert_predicted_labor_demand ON public.predicted_labor_demand;
DROP POLICY "Allow anon insert on predicted_labor_demand" ON public.predicted_labor_demand;

DROP POLICY "Admins can manage public holidays" ON public.public_holidays;

DROP POLICY "System can create rest violations" ON public.rest_period_violations;

DROP POLICY "Enable write access for authenticated users" ON public.roster_groups;
CREATE POLICY roster_groups_insert ON public.roster_groups FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_roster(roster_id));
CREATE POLICY roster_groups_update ON public.roster_groups FOR UPDATE TO authenticated
  USING (public.can_edit_roster(roster_id)) WITH CHECK (public.can_edit_roster(roster_id));
CREATE POLICY roster_groups_delete ON public.roster_groups FOR DELETE TO authenticated
  USING (public.can_edit_roster(roster_id));

DROP POLICY "Enable write access for authenticated users" ON public.roster_subgroups;
CREATE POLICY roster_subgroups_insert ON public.roster_subgroups FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_roster_group(roster_group_id));
CREATE POLICY roster_subgroups_update ON public.roster_subgroups FOR UPDATE TO authenticated
  USING (public.can_edit_roster_group(roster_group_id)) WITH CHECK (public.can_edit_roster_group(roster_group_id));
CREATE POLICY roster_subgroups_delete ON public.roster_subgroups FOR DELETE TO authenticated
  USING (public.can_edit_roster_group(roster_group_id));

DROP POLICY "Authenticated users can delete shift event tags" ON public.shift_event_tags;
DROP POLICY "Authenticated users can manage shift event tags" ON public.shift_event_tags;

DROP POLICY "Authenticated users can insert shift events" ON public.shift_events;

DROP POLICY "Authenticated users can manage shift flags" ON public.shift_flags;

DROP POLICY "Authenticated users can delete shift licenses" ON public.shift_licenses;
DROP POLICY "Authenticated users can manage shift licenses" ON public.shift_licenses;

DROP POLICY "Authenticated users can delete shift_skills" ON public.shift_skills;
DROP POLICY "Authenticated users can manage shift_skills" ON public.shift_skills;

DROP POLICY "Authenticated users can manage shift_subgroups" ON public.shift_subgroups;
DROP POLICY "Authenticated users can update shift_subgroups" ON public.shift_subgroups;

DROP POLICY "Authenticated users can create templates" ON public.shift_templates;

DROP POLICY "Authenticated users can create skills" ON public.skills;
DROP POLICY "Authenticated users can update skills" ON public.skills;

DROP POLICY "Authenticated users can manage sub_departments" ON public.sub_departments;
DROP POLICY "Authenticated users can update sub_departments" ON public.sub_departments;

DROP POLICY "Managers can create approvals"   ON public.swap_approvals;
DROP POLICY "System can create notifications" ON public.swap_notifications;
DROP POLICY "System can create validations"   ON public.swap_validations;

-- ── 4. Roster seeding is system behaviour, not the creator's ────────────────
-- seed_standard_roster_groups is the AFTER INSERT trigger on rosters that
-- creates the fixed groups/subgroups. It ran SECURITY INVOKER, so it relied on
-- the open roster_groups/roster_subgroups policies dropped above. It reads no
-- identity and its search_path is pinned. seed_fixed_roster_groups is attached
-- to nothing; both were EXECUTE-able by anon.
ALTER FUNCTION public.seed_standard_roster_groups() SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.seed_standard_roster_groups() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_fixed_roster_groups()    FROM PUBLIC, anon, authenticated;

-- ── Grants for the helpers (revoke last: CREATE re-applies default grants) ───
REVOKE ALL ON FUNCTION public.can_edit_roster(uuid)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_edit_roster_group(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_org_admin(uuid)          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_roster(uuid)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_edit_roster_group(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid)          TO authenticated, service_role;
