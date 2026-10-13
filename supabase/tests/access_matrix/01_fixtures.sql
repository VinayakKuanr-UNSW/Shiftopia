-- LOCAL TEST DB ONLY. Fixture rows are inserted with triggers and FK checks off
-- (session_replication_role = replica); RLS and CHECK constraints still apply.
SET session_replication_role = replica;

-- a second organization, for cross-org checks
INSERT INTO public.organizations (id, name, code, is_active) VALUES
 ('00000000-0000-0000-0000-0000000000f2','Other Org','OTH',true) ON CONFLICT DO NOTHING;
INSERT INTO public.departments (id, organization_id, name, is_active) VALUES
 ('d2000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-0000000000f2','Other Dept',true) ON CONFLICT DO NOTHING;
INSERT INTO public.sub_departments (id, department_id, name, is_active) VALUES
 ('52000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','Other Sub',true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public._t_persona (n text PRIMARY KEY, id uuid NOT NULL);
TRUNCATE public._t_persona;
INSERT INTO public._t_persona VALUES
 ('A',  'a0000000-0000-4000-8000-000000000001'),  -- alpha X @ S1
 ('G',  'a0000000-0000-4000-8000-000000000002'),  -- gamma  @ S1
 ('D',  'a0000000-0000-4000-8000-000000000003'),  -- delta  @ D1
 ('E',  'a0000000-0000-4000-8000-000000000004'),  -- epsilon @ O
 ('Z',  'a0000000-0000-4000-8000-000000000005'),  -- zeta
 ('X',  'a0000000-0000-4000-8000-000000000006'),  -- employee, contract @ S1
 ('E2', 'a0000000-0000-4000-8000-000000000007'),  -- second epsilon @ O
 ('F',  'a0000000-0000-4000-8000-000000000008'),  -- epsilon @ other org
 ('DD', 'a0000000-0000-4000-8000-000000000009');  -- delta  @ D2
GRANT SELECT ON public._t_persona TO authenticated;

-- Shaped so GoTrue can load them too (tests/integration calls edge functions,
-- which check the caller with auth.getUser()): GoTrue looks users up by the
-- default instance_id and cannot read NULL token columns.
INSERT INTO auth.users (instance_id, id, email, aud, role, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT '00000000-0000-0000-0000-000000000000', id, lower(n) || '.persona@test.invalid', 'authenticated', 'authenticated',
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now(), '', '', '', ''
  FROM public._t_persona
ON CONFLICT (id) DO UPDATE SET instance_id = EXCLUDED.instance_id,
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, now()),
    created_at = coalesce(auth.users.created_at, now()), updated_at = now(),
    confirmation_token = '', recovery_token = '', email_change_token_new = '', email_change = '';
INSERT INTO public.profiles (id, email, first_name, last_name)
SELECT id, lower(n) || '.persona@test.invalid', 'P-' || n, 'Test' FROM public._t_persona
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.app_access_certificates WHERE user_id IN (SELECT id FROM public._t_persona);
INSERT INTO public.app_access_certificates (id, user_id, certificate_type, access_level, organization_id, department_id, sub_department_id) VALUES
 ('ce000000-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-000000000001','X','alpha',  '00000000-0000-0000-0000-000000000001','54c4c466-8d56-41c1-bf36-98ee4d7364f3','707b57f8-77f5-4751-8bfd-5f652ef84fcd'),
 ('ce000000-0000-4000-8000-00000000000b','a0000000-0000-4000-8000-000000000002','Y','gamma',  '00000000-0000-0000-0000-000000000001','54c4c466-8d56-41c1-bf36-98ee4d7364f3','707b57f8-77f5-4751-8bfd-5f652ef84fcd'),
 ('ce000000-0000-4000-8000-00000000000c','a0000000-0000-4000-8000-000000000003','Y','delta',  '00000000-0000-0000-0000-000000000001','54c4c466-8d56-41c1-bf36-98ee4d7364f3',NULL),
 ('ce000000-0000-4000-8000-00000000000d','a0000000-0000-4000-8000-000000000004','Y','epsilon','00000000-0000-0000-0000-000000000001',NULL,NULL),
 ('ce000000-0000-4000-8000-00000000000e','a0000000-0000-4000-8000-000000000005','Y','zeta',   NULL,NULL,NULL),
 ('ce000000-0000-4000-8000-00000000000f','a0000000-0000-4000-8000-000000000007','Y','epsilon','00000000-0000-0000-0000-000000000001',NULL,NULL),
 ('ce000000-0000-4000-8000-000000000010','a0000000-0000-4000-8000-000000000008','Y','epsilon','00000000-0000-0000-0000-0000000000f2',NULL,NULL),
 ('ce000000-0000-4000-8000-000000000011','a0000000-0000-4000-8000-000000000009','Y','delta',  '00000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000003',NULL);

DELETE FROM hr.user_contracts WHERE user_id IN (SELECT id FROM public._t_persona);
INSERT INTO hr.user_contracts (id, user_id, role_id, organization_id, department_id, sub_department_id, status, employment_status, pay_basis, remuneration_level)
VALUES ('c0c00000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000006','e0000000-0000-4000-8000-000000000001',
        '00000000-0000-0000-0000-000000000001','54c4c466-8d56-41c1-bf36-98ee4d7364f3','707b57f8-77f5-4751-8bfd-5f652ef84fcd',
        'Active','Casual','eba_level',2);

DELETE FROM public.shifts WHERE id::text LIKE 'b1000000-%';
INSERT INTO public.shifts (id, roster_id, roster_subgroup_id, organization_id, department_id, sub_department_id, shift_date, start_time, end_time, target_employment_type, assigned_employee_id, assignment_status, version) VALUES
 ('b1000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','54c4c466-8d56-41c1-bf36-98ee4d7364f3','707b57f8-77f5-4751-8bfd-5f652ef84fcd','2026-12-01','09:00','12:00','Casual','a0000000-0000-4000-8000-000000000006','assigned',1),
 ('b1000000-0000-4000-8000-000000000002','f0000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','54c4c466-8d56-41c1-bf36-98ee4d7364f3','ed004483-7cb4-40cf-a151-57053e009ea8','2026-12-01','09:00','12:00','Casual',NULL,'unassigned',1),
 ('b1000000-0000-4000-8000-000000000003','f0000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000003','6fefad95-9cf9-468c-8724-424cc2f7b640','2026-12-02','09:00','12:00','Casual','a0000000-0000-4000-8000-000000000006','assigned',1),
 ('b1000000-0000-4000-8000-000000000004','f0000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-0000000000f2','d2000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','2026-12-03','09:00','12:00','Casual',NULL,'unassigned',1);

DELETE FROM public.timesheets WHERE profile_id IN (SELECT id FROM public._t_persona);
INSERT INTO public.timesheets (id, profile_id, shift_id, work_date, clock_in, version, edit_count) VALUES
 ('70000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000006','b1000000-0000-4000-8000-000000000001','2026-12-01','2026-12-01 09:00+11',1,0),
 ('70000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000006','b1000000-0000-4000-8000-000000000003','2026-12-02','2026-12-02 09:00+11',1,0);

DELETE FROM public.shift_bids WHERE employee_id IN (SELECT id FROM public._t_persona);
INSERT INTO public.shift_bids (id, shift_id, employee_id) VALUES
 ('b0b00000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000006'),
 ('b0b00000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000006');

DELETE FROM public.shift_swaps WHERE requester_id IN (SELECT id FROM public._t_persona);
INSERT INTO public.shift_swaps (id, requester_id, requester_shift_id, status) VALUES
 ('5a000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000006','b1000000-0000-4000-8000-000000000001','OPEN'),
 ('5a000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000006','b1000000-0000-4000-8000-000000000003','OPEN');

RESET session_replication_role;
