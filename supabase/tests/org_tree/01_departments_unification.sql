-- LOCAL TEST DB ONLY. Run after access_matrix/01_fixtures.sql; everything rolls back.
-- Wave 2 org-tree unification (migration *_org_tree_departments_unification;
-- docs/architecture/multi-organization.md §14): hr.departments & hr.subdepartments
-- are dropped, public.departments & public.sub_departments are hardened (no anon,
-- NOT NULL audit/status/sort_order, domain CHECKs, partial unique code indexes,
-- redundant idx_departments_organization_id dropped), hr.roles FK targets
-- public.sub_departments, and public.role_ml_class_map RLS policies resolve
-- through public.sub_departments / public.departments. One line per case.
\set QUIET on
BEGIN;

DO $t$
DECLARE
    o   constant uuid := '00000000-0000-0000-0000-000000000001';  -- ICC Sydney
    o2  constant uuid := '00000000-0000-0000-0000-0000000000f2';  -- Other Org
    g   constant uuid := 'a0000000-0000-4000-8000-000000000002';  -- gamma @ S1 (shift.edit)
    f   constant uuid := 'a0000000-0000-4000-8000-000000000008';  -- epsilon @ Other Org
    fr  constant uuid := 'e0000000-0000-4000-8000-000000000001';  -- fixture role @ S1
    d1  constant uuid := 'dd100000-0000-4000-8000-000000000001';
    d2  constant uuid := 'dd100000-0000-4000-8000-000000000002';
    s1  constant uuid := '5d100000-0000-4000-8000-000000000001';
    s2  constant uuid := '5d100000-0000-4000-8000-000000000002';
    r1  constant uuid := 'ee100000-0000-4000-8000-000000000001';
    n   int;
BEGIN
    -- 1. Mirror tables and redundant prefix index are gone; anon has no access.
    RAISE NOTICE 'mirrors dropped: hr.departments=% hr.subdepartments=%',
        to_regclass('hr.departments') IS NULL,
        to_regclass('hr.subdepartments') IS NULL;
    RAISE NOTICE 'redundant idx_departments_organization_id dropped: %',
        to_regclass('public.idx_departments_organization_id') IS NULL;
    RAISE NOTICE 'anon table select: departments=% sub_departments=%',
        has_table_privilege('anon', 'public.departments', 'SELECT'),
        has_table_privilege('anon', 'public.sub_departments', 'SELECT');

    -- 2. hr.roles FK targets public.sub_departments directly (no mirror required).
    RAISE NOTICE 'hr.roles FK targets public.sub_departments: %', (
        SELECT confrelid = 'public.sub_departments'::regclass
          FROM pg_constraint
         WHERE conrelid = 'hr.roles'::regclass AND conname = 'roles_subdepartment_id_fkey');

    INSERT INTO public.departments (id, organization_id, name, code, color, icon, sort_order, is_active)
    VALUES (d1, o, 'Probe Canonical Dept', 'PRB', '#112233', 'shield', 1, true);
    INSERT INTO public.sub_departments (id, department_id, name, code, sort_order, is_active)
    VALUES (s1, d1, 'Probe Canonical Sub', 'PS1', 1, true);
    INSERT INTO hr.roles (id, subdepartment_id, name)
    VALUES (r1, s1, 'Probe Canonical Role');
    RAISE NOTICE 'new public dept -> sub_dept -> hr.roles inserted: %',
        EXISTS (SELECT 1 FROM hr.roles WHERE id = r1 AND subdepartment_id = s1);

    -- 3. public.departments NOT NULL, domain CHECKs, and partial unique code index.
    BEGIN
        UPDATE public.departments SET is_active = NULL WHERE id = d1;
        RAISE NOTICE 'dept null is_active: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'dept null is_active: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.departments SET sort_order = NULL WHERE id = d1;
        RAISE NOTICE 'dept null sort_order: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'dept null sort_order: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.departments SET created_at = NULL WHERE id = d1;
        RAISE NOTICE 'dept null created_at: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'dept null created_at: refused (%)', SQLSTATE;
    END;
    BEGIN
        INSERT INTO public.departments (id, organization_id, name, updated_at)
        VALUES (d2, o, 'Probe Null UpdatedAt', NULL);
        RAISE NOTICE 'dept null updated_at: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'dept null updated_at: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.departments SET name = '   ' WHERE id = d1;
        RAISE NOTICE 'dept blank name: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'dept blank name: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.departments SET code = '  ' WHERE id = d1;
        RAISE NOTICE 'dept blank code: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'dept blank code: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.departments SET sort_order = -1 WHERE id = d1;
        RAISE NOTICE 'dept negative sort_order: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'dept negative sort_order: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.departments SET color = 'not-hex' WHERE id = d1;
        RAISE NOTICE 'dept bad color: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'dept bad color: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.departments SET icon = '  ' WHERE id = d1;
        RAISE NOTICE 'dept blank icon: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'dept blank icon: refused (%)', SQLSTATE;
    END;
    BEGIN
        INSERT INTO public.departments (id, organization_id, name, code)
        VALUES (d2, o, 'Probe Dup Code Dept', 'PRB');
        RAISE NOTICE 'dept duplicate code in org: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'dept duplicate code in org: refused (%)', SQLSTATE;
    END;
    -- Multiple NULL codes within the same org are allowed.
    INSERT INTO public.departments (id, organization_id, name, code)
    VALUES (d2, o, 'Probe Null Code Dept', NULL);
    RAISE NOTICE 'dept null code coexists: %', EXISTS (SELECT 1 FROM public.departments WHERE id = d2 AND code IS NULL);

    -- 4. public.sub_departments NOT NULL, domain CHECKs, and partial unique code index.
    BEGIN
        UPDATE public.sub_departments SET is_active = NULL WHERE id = s1;
        RAISE NOTICE 'sub_dept null is_active: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'sub_dept null is_active: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.sub_departments SET sort_order = NULL WHERE id = s1;
        RAISE NOTICE 'sub_dept null sort_order: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'sub_dept null sort_order: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.sub_departments SET name = '   ' WHERE id = s1;
        RAISE NOTICE 'sub_dept blank name: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'sub_dept blank name: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.sub_departments SET code = '  ' WHERE id = s1;
        RAISE NOTICE 'sub_dept blank code: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'sub_dept blank code: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.sub_departments SET sort_order = -1 WHERE id = s1;
        RAISE NOTICE 'sub_dept negative sort_order: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'sub_dept negative sort_order: refused (%)', SQLSTATE;
    END;
    BEGIN
        INSERT INTO public.sub_departments (id, department_id, name, code)
        VALUES (s2, d1, 'Probe Dup Code Sub', 'PS1');
        RAISE NOTICE 'sub_dept duplicate code in dept: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'sub_dept duplicate code in dept: refused (%)', SQLSTATE;
    END;
    INSERT INTO public.sub_departments (id, department_id, name, code)
    VALUES (s2, d1, 'Probe Null Code Sub', NULL);
    RAISE NOTICE 'sub_dept null code coexists: %', EXISTS (SELECT 1 FROM public.sub_departments WHERE id = s2 AND code IS NULL);

    -- 5. public.role_ml_class_map RLS policies resolve via public.sub_departments & public.departments.
    --    Persona G (gamma @ S1) can write; Persona F (Other Org) is refused.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
        INSERT INTO public.role_ml_class_map (role_id, ml_class, source) VALUES (fr, 'Usher', 'manual');
        RAISE NOTICE 'role_ml_class_map cross-org insert: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'role_ml_class_map cross-org insert: refused (%)', SQLSTATE;
    END;
    -- Also verify cross-org tenant isolation on canonical public.departments & public.sub_departments.
    RAISE NOTICE 'other-org persona sees depts=% (icc=%) sub_depts=%',
        (SELECT count(*) FROM public.departments),
        (SELECT count(*) FROM public.departments WHERE organization_id = o),
        (SELECT count(*) FROM public.sub_departments);
    RESET ROLE;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.role_ml_class_map (role_id, ml_class, source) VALUES (fr, 'Usher', 'manual');
    UPDATE public.role_ml_class_map SET ml_class = 'Supervisor' WHERE role_id = fr;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'role_ml_class_map in-scope insert+update: updated=%', n;
    RESET ROLE;

    -- Cross-org update on existing row affects 0 rows under RLS.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.role_ml_class_map SET ml_class = 'Security' WHERE role_id = fr;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'role_ml_class_map cross-org update rows: %', n;
    RESET ROLE;
END
$t$;

ROLLBACK;
