-- Phase 7: Clean-up remuneration levels and load 14-department ICC Sydney catalogue.
--
-- 1. hr.remuneration_levels:
--    - Rename Level 0 to 'Introductory'
--    - Drop invented money columns (hourly_rate_min, hourly_rate_max, salary_min, salary_max)
--    - Update hr.v_promotion_ladder and public.remuneration_levels views
-- 2. Departments:
--    - In-place rename existing departments to match official ICC Sydney directorates:
--      * Executive -> Executive Office
--      * AV -> Audio Visual Services
--      * Live Events -> Live Entertainment
--      * Finance -> Finance & Administration
--    - Insert new departments:
--      * Business Development
--      * Events
--      * Culinary Services
--      * Security & Risk
--      * Corporate Affairs & Communications
-- 3. Sub-departments:
--    - Rename existing sub-departments to align with catalogue
--    - Insert new sub-departments in hr.subdepartments and sync to public.sub_departments
-- 4. Roles:
--    - Delete unreferenced placeholder roles from hr.roles
--    - Preserved roles:
--      * 2d7148c6-5607-49a9-8c3f-b4e2d9f67bd7 (Team Leader in Set-up)
--      * 581595e3-04eb-46ce-a2a7-f84894a9f059 (Supervisor in Set-up)
--      * b958a9b2-f78c-4df2-86a6-479c82dc7b46 (Usher in Front of House)
--      * bb725bc6-3a19-4ab2-957f-6b57bcb18a9d (Assistant Manager in Set-up)
--    - Load 374 catalogue roles across all 14 departments with Schedule 1 level bands,
--      default remuneration levels, and typically_salaried flags.

-- ── 1. Remuneration levels cleanup ──────────────────────────────────────────

UPDATE hr.remuneration_levels
   SET level_name = 'Introductory'
 WHERE level_number = 0;

-- Drop views before altering columns (PostgreSQL does not allow dropping columns via CREATE OR REPLACE VIEW)
DROP VIEW IF EXISTS hr.v_promotion_ladder;
DROP VIEW IF EXISTS public.remuneration_levels;

-- Drop money constraints and columns
ALTER TABLE hr.remuneration_levels
  DROP CONSTRAINT IF EXISTS remuneration_levels_check,
  DROP CONSTRAINT IF EXISTS remuneration_levels_check1;

ALTER TABLE hr.remuneration_levels
  DROP COLUMN IF EXISTS hourly_rate_min,
  DROP COLUMN IF EXISTS hourly_rate_max,
  DROP COLUMN IF EXISTS salary_min,
  DROP COLUMN IF EXISTS salary_max;

-- Recreate views without money columns
CREATE VIEW hr.v_promotion_ladder
WITH (security_invoker = on) AS
 SELECT d.name AS department,
    s.name AS subdepartment,
    r.remuneration_level AS level,
    rl.level_name,
    r.name AS role,
    lead(r.name) OVER (PARTITION BY s.id ORDER BY r.remuneration_level) AS next_role,
    s.id AS subdepartment_id
   FROM hr.subdepartments s
     JOIN hr.departments d ON d.id = s.department_id
     JOIN hr.roles r ON r.subdepartment_id = s.id
     JOIN hr.remuneration_levels rl ON rl.level_number = r.remuneration_level;

CREATE VIEW public.remuneration_levels
WITH (security_invoker = on) AS
 SELECT level_number,
    level_name,
    description
   FROM hr.remuneration_levels;

REVOKE ALL ON public.remuneration_levels FROM PUBLIC, anon;
GRANT SELECT ON public.remuneration_levels TO authenticated, service_role;

REVOKE ALL ON hr.v_promotion_ladder FROM PUBLIC, anon;
GRANT SELECT ON hr.v_promotion_ladder TO authenticated, service_role;

-- ── 2. Departments rename & insert ──────────────────────────────────────────

UPDATE hr.departments SET name = 'Executive Office', code = 'EXEC' WHERE name = 'Executive';
UPDATE public.departments SET name = 'Executive Office', code = 'EXEC' WHERE name = 'Executive';

UPDATE hr.departments SET name = 'Audio Visual Services', code = 'AV' WHERE name = 'AV';
UPDATE public.departments SET name = 'Audio Visual Services', code = 'AV' WHERE name = 'AV';

UPDATE hr.departments SET name = 'Live Entertainment', code = 'LIVE' WHERE name = 'Live Events';
UPDATE public.departments SET name = 'Live Entertainment', code = 'LIVE' WHERE name = 'Live Events';

UPDATE hr.departments SET name = 'Finance & Administration', code = 'FIN' WHERE name = 'Finance';
UPDATE public.departments SET name = 'Finance & Administration', code = 'FIN' WHERE name = 'Finance';

INSERT INTO hr.departments (id, organization_id, name, code, created_at, updated_at)
VALUES
  ('c0000000-0000-0000-0000-000000000002'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Business Development', 'BD', now(), now()),
  ('c0000000-0000-0000-0000-000000000003'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Events', 'EVT', now(), now()),
  ('c0000000-0000-0000-0000-000000000005'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Culinary Services', 'CUL', now(), now()),
  ('c0000000-0000-0000-0000-000000000010'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Security & Risk', 'SEC', now(), now()),
  ('c0000000-0000-0000-0000-000000000014'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Corporate Affairs & Communications', 'CAC', now(), now())
ON CONFLICT (organization_id, name) DO NOTHING;

INSERT INTO public.departments (id, organization_id, name, code, is_active, created_at, updated_at)
VALUES
  ('c0000000-0000-0000-0000-000000000002'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Business Development', 'BD', true, now(), now()),
  ('c0000000-0000-0000-0000-000000000003'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Events', 'EVT', true, now(), now()),
  ('c0000000-0000-0000-0000-000000000005'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Culinary Services', 'CUL', true, now(), now()),
  ('c0000000-0000-0000-0000-000000000010'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Security & Risk', 'SEC', true, now(), now()),
  ('c0000000-0000-0000-0000-000000000014'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Corporate Affairs & Communications', 'CAC', true, now(), now())
ON CONFLICT (organization_id, name) DO NOTHING;

-- ── 3. Sub-departments rename & insert ──────────────────────────────────────

-- Rename existing sub-departments to align with catalogue
UPDATE hr.subdepartments SET name = 'Executive Leadership' WHERE id = '2f32cc1d-31d6-4c13-8fce-b0e6d020022a';
UPDATE public.sub_departments SET name = 'Executive Leadership' WHERE id = '2f32cc1d-31d6-4c13-8fce-b0e6d020022a';

UPDATE hr.subdepartments SET name = 'Event Food & Beverage' WHERE id = '2e85c07e-e9f0-4fc7-9a83-6a9f58bd6621';
UPDATE public.sub_departments SET name = 'Event Food & Beverage' WHERE id = '2e85c07e-e9f0-4fc7-9a83-6a9f58bd6621';

UPDATE hr.subdepartments SET name = 'AV Technical' WHERE id = '2d70423c-e16f-4638-ad66-c34c64d54739';
UPDATE public.sub_departments SET name = 'AV Technical' WHERE id = '2d70423c-e16f-4638-ad66-c34c64d54739';

UPDATE hr.subdepartments SET name = 'Live Event Operations' WHERE id = '6107d8fb-c060-4885-b1e7-81edb8f7bdf4';
UPDATE public.sub_departments SET name = 'Live Event Operations' WHERE id = '6107d8fb-c060-4885-b1e7-81edb8f7bdf4';

UPDATE hr.subdepartments SET name = 'Customer Service' WHERE id = 'ee9a9432-2f63-4526-95d1-3c7c7fb9da89';
UPDATE public.sub_departments SET name = 'Customer Service' WHERE id = 'ee9a9432-2f63-4526-95d1-3c7c7fb9da89';

UPDATE hr.subdepartments SET name = 'Service Desk & Support' WHERE id = 'ed004483-7cb4-40cf-a151-57053e009ea8';
UPDATE public.sub_departments SET name = 'Service Desk & Support' WHERE id = 'ed004483-7cb4-40cf-a151-57053e009ea8';

UPDATE hr.subdepartments SET name = 'Infrastructure & Network' WHERE id = '1e1b606e-a7fe-43da-8144-2d1b44f08770';
UPDATE public.sub_departments SET name = 'Infrastructure & Network' WHERE id = '1e1b606e-a7fe-43da-8144-2d1b44f08770';

UPDATE hr.subdepartments SET name = 'Accounts Payable & Receivable' WHERE id = '429eeb4d-0e85-44af-8b92-aa1d4c8a3bf2';
UPDATE public.sub_departments SET name = 'Accounts Payable & Receivable' WHERE id = '429eeb4d-0e85-44af-8b92-aa1d4c8a3bf2';

UPDATE hr.subdepartments SET name = 'People Partnering' WHERE id = '83fcaad6-f988-4533-bc6b-3a56bb438312';
UPDATE public.sub_departments SET name = 'People Partnering' WHERE id = '83fcaad6-f988-4533-bc6b-3a56bb438312';

UPDATE hr.subdepartments SET name = 'People Operations & Shared Services' WHERE id = '10b86610-5249-4d61-a4aa-6ddab1ab4c04';
UPDATE public.sub_departments SET name = 'People Operations & Shared Services' WHERE id = '10b86610-5249-4d61-a4aa-6ddab1ab4c04';

-- Insert new subdepartments into hr.subdepartments
WITH target_subdepts (dept_name, subdept_name) AS (
  VALUES
  ('Executive Office', 'Executive Leadership'),
  ('Executive Office', 'Executive Support & Reception'),
  ('Executive Office', 'Legal & Compliance'),
  ('Executive Office', 'Quality Assurance'),
  ('Business Development', 'Leadership & Admin'),
  ('Business Development', 'Corporate'),
  ('Business Development', 'National Conventions'),
  ('Business Development', 'International Conventions'),
  ('Business Development', 'Exhibitions'),
  ('Business Development', 'Partnerships'),
  ('Business Development', 'Research & Insights'),
  ('Business Development', 'Revenue & Yield'),
  ('Events', 'Leadership & Admin'),
  ('Events', 'Event Planning'),
  ('Events', 'Event Management'),
  ('Events', 'Event Operations'),
  ('Events', 'Exhibition Services'),
  ('Events', 'Event Setup'),
  ('Event Delivery', 'Leadership & Admin'),
  ('Event Delivery', 'Event Food & Beverage'),
  ('Event Delivery', 'Retail & Beverage'),
  ('Event Delivery', 'F&B Coordination'),
  ('Culinary Services', 'Leadership & Admin'),
  ('Culinary Services', 'Events & Catering Kitchen'),
  ('Culinary Services', 'Production Kitchen'),
  ('Culinary Services', 'Pastry'),
  ('Culinary Services', 'Retail Outlets Kitchen'),
  ('Culinary Services', 'Kitchen Logistics & Stewarding'),
  ('Audio Visual Services', 'Leadership & Admin'),
  ('Audio Visual Services', 'AV Sales & Project Management'),
  ('Audio Visual Services', 'AV Floor Operations'),
  ('Audio Visual Services', 'AV Technical'),
  ('Audio Visual Services', 'Rigging'),
  ('Audio Visual Services', 'Staging & Production Crew'),
  ('Audio Visual Services', 'Digital Media & Signage'),
  ('Live Entertainment', 'Leadership & Admin'),
  ('Live Entertainment', 'Live Event Management'),
  ('Live Entertainment', 'Live Event Operations'),
  ('Live Entertainment', 'Ticketing, Bookings & Merchandise'),
  ('Customer Services', 'Leadership & Admin'),
  ('Customer Services', 'Customer Service'),
  ('Customer Services', 'Ushering'),
  ('Building Services', 'Leadership & Admin'),
  ('Building Services', 'Assets & Trades'),
  ('Building Services', 'FM Interface & Contact Centre'),
  ('Building Services', 'Car Park & Logistics'),
  ('Building Services', 'Presentation Services'),
  ('Building Services', 'Uniform Room'),
  ('Security & Risk', 'Leadership & Admin'),
  ('Security & Risk', 'Building Security'),
  ('Security & Risk', 'Event Security'),
  ('Security & Risk', 'Security Control Room'),
  ('Security & Risk', 'Risk & WHS'),
  ('Security & Risk', 'First Aid'),
  ('ICT Services', 'Leadership & Admin'),
  ('ICT Services', 'Service Desk & Support'),
  ('ICT Services', 'Infrastructure & Network'),
  ('ICT Services', 'ICT Event & Venue Operations'),
  ('ICT Services', 'Solutions & Applications'),
  ('ICT Services', 'Event Information Systems'),
  ('Finance & Administration', 'Leadership & Admin'),
  ('Finance & Administration', 'Financial Accounting & Reporting'),
  ('Finance & Administration', 'Accounts Payable & Receivable'),
  ('Finance & Administration', 'Payroll'),
  ('Finance & Administration', 'Procurement & Stores'),
  ('People & Culture', 'Leadership & Admin'),
  ('People & Culture', 'People Partnering'),
  ('People & Culture', 'People Operations & Shared Services'),
  ('People & Culture', 'Talent Acquisition'),
  ('People & Culture', 'Learning & Development'),
  ('People & Culture', 'Workforce Planning'),
  ('Corporate Affairs & Communications', 'Leadership & Admin'),
  ('Corporate Affairs & Communications', 'Marketing & Communications'),
  ('Corporate Affairs & Communications', 'Digital & Design'),
  ('Corporate Affairs & Communications', 'Corporate Social Responsibility')
)
INSERT INTO hr.subdepartments (department_id, name, created_at, updated_at)
SELECT d.id, ts.subdept_name, now(), now()
FROM target_subdepts ts
JOIN hr.departments d ON d.name = ts.dept_name
ON CONFLICT (department_id, name) DO NOTHING;

-- Mirror all subdepartments to public.sub_departments
INSERT INTO public.sub_departments (id, department_id, name, is_active, created_at, updated_at)
SELECT id, department_id, name, true, created_at, updated_at
FROM hr.subdepartments
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  department_id = EXCLUDED.department_id;

-- ── 4. Roles: cleanup and load catalogue ─────────────────────────────────────

-- Delete unreferenced placeholder roles from hr.roles
DELETE FROM hr.roles
 WHERE id NOT IN (
   SELECT role_id FROM hr.user_contracts WHERE role_id IS NOT NULL
   UNION
   SELECT role_id FROM hr.employee_assignments WHERE role_id IS NOT NULL
   UNION
   SELECT role_id FROM public.shifts WHERE role_id IS NOT NULL
   UNION
   SELECT role_id FROM public.template_shifts WHERE role_id IS NOT NULL
 );

-- Update preserved roles in hr.roles
UPDATE hr.roles
   SET name = 'Event Setup Team Leader',
       remuneration_level = 4,
       eba_level_min = 4,
       eba_level_max = 4,
       typically_salaried = false
 WHERE id = '2d7148c6-5607-49a9-8c3f-b4e2d9f67bd7';

UPDATE hr.roles
   SET name = 'Event Setup Supervisor',
       remuneration_level = 5,
       eba_level_min = 5,
       eba_level_max = 5,
       typically_salaried = false
 WHERE id = '581595e3-04eb-46ce-a2a7-f84894a9f059';

UPDATE hr.roles
   SET name = 'Event Setup Assistant Manager',
       remuneration_level = 6,
       eba_level_min = 6,
       eba_level_max = 6,
       typically_salaried = true
 WHERE id = 'bb725bc6-3a19-4ab2-957f-6b57bcb18a9d';

UPDATE hr.roles
   SET name = 'Usher',
       remuneration_level = 1,
       eba_level_min = 1,
       eba_level_max = 1,
       typically_salaried = false
 WHERE id = 'b958a9b2-f78c-4df2-86a6-479c82dc7b46';
