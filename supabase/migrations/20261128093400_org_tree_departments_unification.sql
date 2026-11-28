-- Wave 2: Unify the org tree on canonical public.departments &
-- public.sub_departments, harden both tables, repoint remaining DB dependencies
-- off hr.departments / hr.subdepartments, and drop both mirror tables.
--
-- public.* is the canonical org tree (docs/architecture/multi-organization.md T2).
-- hr.organizations was dropped in 20261125200241_drop_hr_organizations; this
-- finishes the org-tree unification by retiring the remaining two mirrors,
-- closing their cross-tenant SELECT USING (true) read leak, revoking anon on
-- public.departments / public.sub_departments, enforcing NOT NULL audit/status
-- columns and domain CHECK constraints, repointing hr.roles and
-- public.role_ml_class_map RLS policies, and dropping hr.subdepartments and
-- hr.departments without CASCADE.
--
-- Every statement is re-runnable (IF EXISTS / IF NOT EXISTS).

-- ── 1. Least-privilege grants on canonical tables ────────────────────────────
REVOKE ALL ON public.departments, public.sub_departments FROM anon;

-- ── 2. NOT NULL audit, status & ordering columns ─────────────────────────────
-- NULL is_active would break boolean invariants and slip past
-- trg_*_keep_access_scope (which checks OLD.is_active AND NOT NEW.is_active).
ALTER TABLE public.departments
    ALTER COLUMN is_active  SET NOT NULL,
    ALTER COLUMN sort_order SET NOT NULL,
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.sub_departments
    ALTER COLUMN is_active  SET NOT NULL,
    ALTER COLUMN sort_order SET NOT NULL,
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN updated_at SET NOT NULL;

-- ── 3. Domain CHECK constraints & partial unique code indexes ────────────────
ALTER TABLE public.departments
    DROP CONSTRAINT IF EXISTS departments_name_not_blank,
    ADD  CONSTRAINT departments_name_not_blank CHECK (length(btrim(name)) > 0),
    DROP CONSTRAINT IF EXISTS departments_code_not_blank,
    ADD  CONSTRAINT departments_code_not_blank CHECK (code IS NULL OR length(btrim(code)) > 0),
    DROP CONSTRAINT IF EXISTS departments_sort_order_non_negative,
    ADD  CONSTRAINT departments_sort_order_non_negative CHECK (sort_order >= 0),
    DROP CONSTRAINT IF EXISTS departments_color_hex,
    ADD  CONSTRAINT departments_color_hex CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
    DROP CONSTRAINT IF EXISTS departments_icon_not_blank,
    ADD  CONSTRAINT departments_icon_not_blank CHECK (icon IS NULL OR length(btrim(icon)) > 0);

ALTER TABLE public.sub_departments
    DROP CONSTRAINT IF EXISTS sub_departments_name_not_blank,
    ADD  CONSTRAINT sub_departments_name_not_blank CHECK (length(btrim(name)) > 0),
    DROP CONSTRAINT IF EXISTS sub_departments_code_not_blank,
    ADD  CONSTRAINT sub_departments_code_not_blank CHECK (code IS NULL OR length(btrim(code)) > 0),
    DROP CONSTRAINT IF EXISTS sub_departments_sort_order_non_negative,
    ADD  CONSTRAINT sub_departments_sort_order_non_negative CHECK (sort_order >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS departments_organization_id_code_key
    ON public.departments (organization_id, code)
    WHERE code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sub_departments_department_id_code_key
    ON public.sub_departments (department_id, code)
    WHERE code IS NOT NULL;

-- ── 4. Drop redundant prefix index on public.departments ─────────────────────
-- Covered by departments_organization_id_name_key (organization_id, name).
DROP INDEX IF EXISTS public.idx_departments_organization_id;

-- ── 5. Repoint hr.roles FK → public.sub_departments ──────────────────────────
ALTER TABLE hr.roles
    DROP CONSTRAINT IF EXISTS roles_subdepartment_id_fkey,
    ADD  CONSTRAINT roles_subdepartment_id_fkey
         FOREIGN KEY (subdepartment_id) REFERENCES public.sub_departments(id) ON DELETE CASCADE;

-- ── 6. Repoint public.role_ml_class_map RLS policies → public.* ──────────────
DROP POLICY IF EXISTS authenticated_update_role_ml_class_map ON public.role_ml_class_map;
CREATE POLICY authenticated_update_role_ml_class_map
    ON public.role_ml_class_map
    FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1
          FROM hr.roles r
          JOIN public.sub_departments sd ON sd.id = r.subdepartment_id
          JOIN public.departments d ON d.id = sd.department_id
         WHERE r.id = role_ml_class_map.role_id
           AND public.user_has_action_in_scope('shift.edit'::text, d.organization_id, sd.department_id, r.subdepartment_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1
          FROM hr.roles r
          JOIN public.sub_departments sd ON sd.id = r.subdepartment_id
          JOIN public.departments d ON d.id = sd.department_id
         WHERE r.id = role_ml_class_map.role_id
           AND public.user_has_action_in_scope('shift.edit'::text, d.organization_id, sd.department_id, r.subdepartment_id)
    ));

DROP POLICY IF EXISTS authenticated_write_role_ml_class_map ON public.role_ml_class_map;
CREATE POLICY authenticated_write_role_ml_class_map
    ON public.role_ml_class_map
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1
          FROM hr.roles r
          JOIN public.sub_departments sd ON sd.id = r.subdepartment_id
          JOIN public.departments d ON d.id = sd.department_id
         WHERE r.id = role_ml_class_map.role_id
           AND public.user_has_action_in_scope('shift.edit'::text, d.organization_id, sd.department_id, r.subdepartment_id)
    ));

-- ── 7. Retire the duplicate hr.subdepartments & hr.departments mirrors ───────
-- No CASCADE: fails loudly if any FK, view, or policy still references them.
DROP TABLE IF EXISTS hr.subdepartments;
DROP TABLE IF EXISTS hr.departments;
