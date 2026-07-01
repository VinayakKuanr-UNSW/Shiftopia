-- ===== hr cutover PHASE 4b: retire legacy public.roles =====
-- Applied to prod (srfozdlphoempdattvtx) 2026-07-01 via MCP apply_migration.
-- All readers migrated to hr.roles + verified (frontend, DB fns, RLS policies,
-- 6 operational FKs, get-roster-view edge fn). Recovery copy in hr._backup_public_roles.

-- Last external dependent: INSERT policy on role_ml_class_map -> hr.roles.
DROP POLICY IF EXISTS authenticated_write_role_ml_class_map ON public.role_ml_class_map;
CREATE POLICY authenticated_write_role_ml_class_map ON public.role_ml_class_map
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS ( SELECT 1 FROM hr.roles r
    WHERE r.id = role_ml_class_map.role_id
      AND user_has_action_in_scope('shift.edit'::text, NULL::uuid, r.department_id, r.subdepartment_id)));

-- Recovery copy, then drop the legacy table (owned pkey/checks/policies/indexes drop with it).
create table hr._backup_public_roles as select * from public.roles;
drop table public.roles;
