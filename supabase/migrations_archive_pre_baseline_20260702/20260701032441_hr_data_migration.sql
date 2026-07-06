-- Migration: 20260702010000_hr_data_migration.sql
-- Description: Migrates legacy organizational data from public schema to hr schema

-- 1. Organizations
INSERT INTO hr.organizations (id, name, slug, created_at, updated_at)
SELECT id, name, lower(replace(name, ' ', '-')), created_at, updated_at
FROM public.organizations
ON CONFLICT (id) DO NOTHING;

-- 2. Departments
INSERT INTO hr.departments (id, organization_id, name, created_at, updated_at)
SELECT id, organization_id, name, created_at, updated_at
FROM public.departments
ON CONFLICT (id) DO NOTHING;

-- 3. Subdepartments
INSERT INTO hr.subdepartments (id, department_id, name, created_at, updated_at)
SELECT id, department_id, name, created_at, updated_at
FROM public.sub_departments
ON CONFLICT (id) DO NOTHING;

-- 4. Roles
INSERT INTO hr.roles (id, subdepartment_id, remuneration_level, name, created_at, updated_at)
SELECT id, sub_department_id, COALESCE(level, 0), name, created_at, updated_at
FROM public.roles
ON CONFLICT (subdepartment_id, remuneration_level) DO NOTHING;

-- 5. Employees
-- Need to get organization_id for employees. Since user_contracts has organization_id, we can join it, or just use a default/first one if missing.
INSERT INTO hr.employees (id, organization_id, full_name, email, hire_date, created_at)
SELECT p.id, COALESCE(uc.organization_id, (SELECT id FROM hr.organizations LIMIT 1)), COALESCE(p.full_name, p.first_name || ' ' || COALESCE(p.last_name, '')), p.email, COALESCE(p.hire_date::date, CURRENT_DATE), p.created_at
FROM public.profiles p
LEFT JOIN (SELECT user_id, MIN(organization_id::text)::uuid as organization_id FROM public.user_contracts GROUP BY user_id) uc ON uc.user_id = p.id
ON CONFLICT (id) DO NOTHING;

-- 6. Employee Assignments
INSERT INTO hr.employee_assignments (id, employee_id, role_id, effective_from, effective_to, created_at)
SELECT 
    uc.id, 
    uc.user_id, 
    uc.role_id, 
    COALESCE(uc.start_date::date, CURRENT_DATE), 
    uc.end_date::date, 
    uc.created_at
FROM public.user_contracts uc
JOIN hr.employees e ON e.id = uc.user_id
JOIN hr.roles r ON r.id = uc.role_id
ON CONFLICT (id) DO NOTHING;
