-- ─────────────────────────────────────────────────────────────────────────────
-- APPLIED TO PROD 2026-10-05 via the Supabase MCP (ledger version
-- 20261005123709). Do not re-run against production. Rollback-only dry-run
-- beforehand: an employee (alpha) could UPDATE all 6 template groups before the
-- change; after it, employee update groups/subgroups 0 rows, delete
-- template_shifts / roster_templates 0 rows, insert group 42501, reads unchanged
-- (1 subgroup / 5 shifts / 0 templates); legacy admin updates 6 groups and
-- inserts one; a synthetic gamma template manager updates the 5 shift rows.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- Close the template write policies that any signed-in user satisfied.
--
-- The 2026-10-05 open-write sweep (20261005073424) looked for USING/WITH CHECK
-- `true`. Four more policies were the same hole spelled differently:
--   * roster_templates  "Authenticated users can delete templates"
--       FOR DELETE USING (auth.uid() IS NOT NULL)
--   * template_groups / template_subgroups / template_shifts
--       "Enable read/write for authenticated users"
--       FOR ALL USING (auth.role() = 'authenticated')
-- so any employee could delete any roster template, or rewrite / delete the
-- groups, sub-groups and shift rows that apply_template stamps onto rosters.
--
-- Write paths: save_template_full, delete_template_shifts_cascade,
-- publish_template_range and apply_monthly_template are SECURITY DEFINER (RLS
-- does not apply). The only direct client writes to the child tables are the
-- template duplicate in templates/state/useTemplates.ts, run by a manager after
-- inserting the parent (roster_templates_insert → auth_can_create_template).
-- Child writes now need the same authority over the PARENT template: the
-- manager gate roster_templates_update already uses (auth_can_manage_templates)
-- or the scoped gate its insert uses (auth_can_create_template). Template
-- deletion follows the same rule instead of "anyone signed in". Reads are
-- unchanged: signed-in users keep SELECT on the three child tables.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Authority over a template, resolved from any of its children ─────────
CREATE FUNCTION public.can_edit_template(p_template_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.roster_templates t
     WHERE t.id = p_template_id
       AND (public.auth_can_manage_templates()
            OR public.auth_can_create_template(t.organization_id, t.department_id, t.sub_department_id)));
$$;

CREATE FUNCTION public.can_edit_template_group(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.template_groups g
                  WHERE g.id = p_group_id AND public.can_edit_template(g.template_id));
$$;

CREATE FUNCTION public.can_edit_template_subgroup(p_subgroup_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.template_subgroups sg
                  WHERE sg.id = p_subgroup_id AND public.can_edit_template_group(sg.group_id));
$$;

-- ── 2. roster_templates: deletion by template managers only ─────────────────
DROP POLICY "Authenticated users can delete templates" ON public.roster_templates;
CREATE POLICY roster_templates_delete_manager ON public.roster_templates
  FOR DELETE TO authenticated
  USING (public.auth_can_manage_templates()
         OR public.auth_can_create_template(organization_id, department_id, sub_department_id));

-- ── 3. template_groups ──────────────────────────────────────────────────────
DROP POLICY "Enable read/write for authenticated users" ON public.template_groups;
CREATE POLICY template_groups_select ON public.template_groups
  FOR SELECT TO authenticated USING (true);   -- unchanged read access
CREATE POLICY template_groups_insert ON public.template_groups
  FOR INSERT TO authenticated WITH CHECK (public.can_edit_template(template_id));
CREATE POLICY template_groups_update ON public.template_groups
  FOR UPDATE TO authenticated
  USING (public.can_edit_template(template_id)) WITH CHECK (public.can_edit_template(template_id));
CREATE POLICY template_groups_delete ON public.template_groups
  FOR DELETE TO authenticated USING (public.can_edit_template(template_id));

-- ── 4. template_subgroups ───────────────────────────────────────────────────
DROP POLICY "Enable read/write for authenticated users" ON public.template_subgroups;
CREATE POLICY template_subgroups_select ON public.template_subgroups
  FOR SELECT TO authenticated USING (true);   -- unchanged read access
CREATE POLICY template_subgroups_insert ON public.template_subgroups
  FOR INSERT TO authenticated WITH CHECK (public.can_edit_template_group(group_id));
CREATE POLICY template_subgroups_update ON public.template_subgroups
  FOR UPDATE TO authenticated
  USING (public.can_edit_template_group(group_id)) WITH CHECK (public.can_edit_template_group(group_id));
CREATE POLICY template_subgroups_delete ON public.template_subgroups
  FOR DELETE TO authenticated USING (public.can_edit_template_group(group_id));

-- ── 5. template_shifts ──────────────────────────────────────────────────────
DROP POLICY "Enable read/write for authenticated users" ON public.template_shifts;
CREATE POLICY template_shifts_select ON public.template_shifts
  FOR SELECT TO authenticated USING (true);   -- unchanged read access
CREATE POLICY template_shifts_insert ON public.template_shifts
  FOR INSERT TO authenticated WITH CHECK (public.can_edit_template_subgroup(subgroup_id));
CREATE POLICY template_shifts_update ON public.template_shifts
  FOR UPDATE TO authenticated
  USING (public.can_edit_template_subgroup(subgroup_id)) WITH CHECK (public.can_edit_template_subgroup(subgroup_id));
CREATE POLICY template_shifts_delete ON public.template_shifts
  FOR DELETE TO authenticated USING (public.can_edit_template_subgroup(subgroup_id));

-- ── Grants (revoke last: CREATE re-applies default grants) ──────────────────
REVOKE ALL ON FUNCTION public.can_edit_template(uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_edit_template_group(uuid)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_edit_template_subgroup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_template(uuid)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_edit_template_group(uuid)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_edit_template_subgroup(uuid) TO authenticated, service_role;
