-- Bulk User Onboarding: test1 to test100 + Kurry Admin
-- Target: Event Delivery -> Event Setups

DO $$
DECLARE
    v_user_id UUID;
    v_kurry_id UUID;
    v_email TEXT;
    v_password TEXT;
    v_dept_id UUID := '42cf1feb-cf01-4e22-8833-43367e6da1cd';
    v_sub_dept_id UUID := '6fefad95-9cf9-468c-8724-424cc2f7b640';
    v_role_mgr UUID;
    v_role_am  UUID;
    v_role_sup UUID;
    v_role_tl  UUID;
    v_role_tm3 UUID;
    v_role_tm2 UUID;
    v_org_id UUID;
    v_skill_id UUID;
    v_pos_ft UUID;
    v_pos_cas UUID;
BEGIN
    -- 1. Get role IDs dynamically (by name + sub_dept)
    SELECT id INTO v_role_mgr FROM hr.roles WHERE name = 'Manager' AND subdepartment_id = v_sub_dept_id;
    SELECT id INTO v_role_am  FROM hr.roles WHERE name = 'Assistant Manager' AND subdepartment_id = v_sub_dept_id;
    SELECT id INTO v_role_sup FROM hr.roles WHERE name = 'Supervisor' AND subdepartment_id = v_sub_dept_id;
    SELECT id INTO v_role_tl  FROM hr.roles WHERE name = 'Team Leader' AND subdepartment_id = v_sub_dept_id;
    SELECT id INTO v_role_tm3 FROM hr.roles WHERE name = 'TM3' AND subdepartment_id = v_sub_dept_id;
    SELECT id INTO v_role_tm2 FROM hr.roles WHERE name = 'Team Member' AND subdepartment_id = v_sub_dept_id;

    -- 2. Get the first organization
    SELECT id INTO v_org_id FROM public.organizations LIMIT 1;
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'No organization found.';
    END IF;

    -- 3. Create the ES-GOLD skill if it doesn't exist
    INSERT INTO public.skills (id, name, description, category, is_active, requires_expiration, default_validity_months)
    VALUES (gen_random_uuid(), 'ES-GOLD', 'Gold level Event Security skill', 'Safety', true, false, null)
    ON CONFLICT (name) DO NOTHING;
    SELECT id INTO v_skill_id FROM public.skills WHERE name = 'ES-GOLD';

    -- 4. Setup Kurry Admin (Supervisor 1: FT + 1TL Casual)
    SELECT id INTO v_kurry_id FROM public.profiles WHERE email = 'kurryosity@gmail.com';
    IF v_kurry_id IS NOT NULL THEN
        DELETE FROM hr.user_contracts WHERE user_id = v_kurry_id;
        DELETE FROM public.availability_rules WHERE profile_id = v_kurry_id;
        UPDATE public.profiles SET employment_type = 'Full-Time' WHERE id = v_kurry_id;
        v_pos_ft := gen_random_uuid();
        v_pos_cas := gen_random_uuid();
        INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
        VALUES
            (gen_random_uuid(), v_kurry_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_sup, 'Active', '2026-08-24', 'alpha', 'Full-Time', 38, 5, v_pos_ft),
            (gen_random_uuid(), v_kurry_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tl,  'Active', '2026-08-24', 'alpha', 'Casual', 0, 4, v_pos_cas);
        -- The Casual Team Leader contract above is OPT_IN: silence means
        -- UNAVAILABLE, so without this row Kurry is hard-filtered off every
        -- casual shift in Set-up and reads "Not declared" on Team Availability
        -- while test3 — given the identical contract pair — reads Available.
        -- This block was the only one of the 99 missing it.
        --
        -- The write is legal because the sub-department is MIXED:
        -- `sm_all_active_contracts_ft_in` (migration 20260824130200) blocks only
        -- a WHOLLY Full-Time scope, so it must run AFTER the Casual contract
        -- exists. `trg_generate_availability_slots` materialises the slots.
        INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
        VALUES (v_kurry_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');
    END IF;

    -- 5. Delete existing contracts and availability rules for test users before inserting
    DELETE FROM hr.user_contracts WHERE user_id IN (SELECT id FROM public.profiles WHERE email LIKE 'test%@test.com');
    DELETE FROM public.availability_rules WHERE profile_id IN (SELECT id FROM public.profiles WHERE email LIKE 'test%@test.com');
    DELETE FROM public.employee_skills WHERE skill_id = v_skill_id AND employee_id IN (SELECT id FROM public.profiles WHERE email LIKE 'test%@test.com');

    -- User 1: test1@test.com
    v_email := 'test1@test.com';
    v_password := 'test1';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '1', v_email, 'Full-Time')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_mgr, 'Active', '2026-08-24', 'alpha', 'Full-Time', 38, 7, v_pos_ft);

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 2: test2@test.com
    v_email := 'test2@test.com';
    v_password := 'test2';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '2', v_email, 'Full-Time')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_am, 'Active', '2026-08-24', 'alpha', 'Full-Time', 38, 6, v_pos_ft);

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 3: test3@test.com
    v_email := 'test3@test.com';
    v_password := 'test3';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '3', v_email, 'Full-Time')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_sup, 'Active', '2026-08-24', 'alpha', 'Full-Time', 38, 5, v_pos_ft),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tl,  'Active', '2026-08-24', 'alpha', 'Casual', 0, 4, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 4: test4@test.com
    v_email := 'test4@test.com';
    v_password := 'test4';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '4', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tl,  'Active', '2026-08-24', 'alpha', 'Casual', 0, 4, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm3, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 3, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 5: test5@test.com
    v_email := 'test5@test.com';
    v_password := 'test5';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '5', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tl,  'Active', '2026-08-24', 'alpha', 'Casual', 0, 4, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm3, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 3, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 6: test6@test.com
    v_email := 'test6@test.com';
    v_password := 'test6';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '6', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tl,  'Active', '2026-08-24', 'alpha', 'Casual', 0, 4, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm3, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 3, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 7: test7@test.com
    v_email := 'test7@test.com';
    v_password := 'test7';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '7', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tl,  'Active', '2026-08-24', 'alpha', 'Casual', 0, 4, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm3, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 3, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 8: test8@test.com
    v_email := 'test8@test.com';
    v_password := 'test8';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '8', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tl,  'Active', '2026-08-24', 'alpha', 'Casual', 0, 4, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm3, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 3, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 9: test9@test.com
    v_email := 'test9@test.com';
    v_password := 'test9';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '9', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tl,  'Active', '2026-08-24', 'alpha', 'Casual', 0, 4, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm3, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 3, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 10: test10@test.com
    v_email := 'test10@test.com';
    v_password := 'test10';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '10', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tl,  'Active', '2026-08-24', 'alpha', 'Casual', 0, 4, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm3, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 3, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 11: test11@test.com
    v_email := 'test11@test.com';
    v_password := 'test11';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '11', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tl,  'Active', '2026-08-24', 'alpha', 'Casual', 0, 4, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm3, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 3, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 12: test12@test.com
    v_email := 'test12@test.com';
    v_password := 'test12';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '12', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tl,  'Active', '2026-08-24', 'alpha', 'Casual', 0, 4, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm3, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 3, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 13: test13@test.com
    v_email := 'test13@test.com';
    v_password := 'test13';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '13', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tl,  'Active', '2026-08-24', 'alpha', 'Casual', 0, 4, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm3, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 3, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 14: test14@test.com
    v_email := 'test14@test.com';
    v_password := 'test14';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '14', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm3, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 3, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 15: test15@test.com
    v_email := 'test15@test.com';
    v_password := 'test15';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '15', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm3, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 3, v_pos_cas),
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 16: test16@test.com
    v_email := 'test16@test.com';
    v_password := 'test16';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '16', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 17: test17@test.com
    v_email := 'test17@test.com';
    v_password := 'test17';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '17', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 18: test18@test.com
    v_email := 'test18@test.com';
    v_password := 'test18';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '18', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 19: test19@test.com
    v_email := 'test19@test.com';
    v_password := 'test19';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '19', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 20: test20@test.com
    v_email := 'test20@test.com';
    v_password := 'test20';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '20', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 21: test21@test.com
    v_email := 'test21@test.com';
    v_password := 'test21';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '21', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 22: test22@test.com
    v_email := 'test22@test.com';
    v_password := 'test22';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '22', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 23: test23@test.com
    v_email := 'test23@test.com';
    v_password := 'test23';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '23', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 24: test24@test.com
    v_email := 'test24@test.com';
    v_password := 'test24';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '24', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 25: test25@test.com
    v_email := 'test25@test.com';
    v_password := 'test25';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '25', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 26: test26@test.com
    v_email := 'test26@test.com';
    v_password := 'test26';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '26', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 27: test27@test.com
    v_email := 'test27@test.com';
    v_password := 'test27';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '27', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 28: test28@test.com
    v_email := 'test28@test.com';
    v_password := 'test28';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '28', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 29: test29@test.com
    v_email := 'test29@test.com';
    v_password := 'test29';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '29', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 30: test30@test.com
    v_email := 'test30@test.com';
    v_password := 'test30';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '30', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 31: test31@test.com
    v_email := 'test31@test.com';
    v_password := 'test31';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '31', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 32: test32@test.com
    v_email := 'test32@test.com';
    v_password := 'test32';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '32', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 33: test33@test.com
    v_email := 'test33@test.com';
    v_password := 'test33';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '33', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 34: test34@test.com
    v_email := 'test34@test.com';
    v_password := 'test34';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '34', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 35: test35@test.com
    v_email := 'test35@test.com';
    v_password := 'test35';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '35', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 36: test36@test.com
    v_email := 'test36@test.com';
    v_password := 'test36';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '36', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 37: test37@test.com
    v_email := 'test37@test.com';
    v_password := 'test37';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '37', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 38: test38@test.com
    v_email := 'test38@test.com';
    v_password := 'test38';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '38', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 39: test39@test.com
    v_email := 'test39@test.com';
    v_password := 'test39';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '39', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 40: test40@test.com
    v_email := 'test40@test.com';
    v_password := 'test40';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '40', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 41: test41@test.com
    v_email := 'test41@test.com';
    v_password := 'test41';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '41', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 42: test42@test.com
    v_email := 'test42@test.com';
    v_password := 'test42';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '42', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 43: test43@test.com
    v_email := 'test43@test.com';
    v_password := 'test43';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '43', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 44: test44@test.com
    v_email := 'test44@test.com';
    v_password := 'test44';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '44', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 45: test45@test.com
    v_email := 'test45@test.com';
    v_password := 'test45';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '45', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 46: test46@test.com
    v_email := 'test46@test.com';
    v_password := 'test46';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '46', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 47: test47@test.com
    v_email := 'test47@test.com';
    v_password := 'test47';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '47', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 48: test48@test.com
    v_email := 'test48@test.com';
    v_password := 'test48';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '48', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 49: test49@test.com
    v_email := 'test49@test.com';
    v_password := 'test49';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '49', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 50: test50@test.com
    v_email := 'test50@test.com';
    v_password := 'test50';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '50', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 51: test51@test.com
    v_email := 'test51@test.com';
    v_password := 'test51';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '51', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 52: test52@test.com
    v_email := 'test52@test.com';
    v_password := 'test52';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '52', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 53: test53@test.com
    v_email := 'test53@test.com';
    v_password := 'test53';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '53', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 54: test54@test.com
    v_email := 'test54@test.com';
    v_password := 'test54';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '54', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 55: test55@test.com
    v_email := 'test55@test.com';
    v_password := 'test55';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '55', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 56: test56@test.com
    v_email := 'test56@test.com';
    v_password := 'test56';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '56', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 57: test57@test.com
    v_email := 'test57@test.com';
    v_password := 'test57';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '57', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 58: test58@test.com
    v_email := 'test58@test.com';
    v_password := 'test58';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '58', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 59: test59@test.com
    v_email := 'test59@test.com';
    v_password := 'test59';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '59', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 60: test60@test.com
    v_email := 'test60@test.com';
    v_password := 'test60';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '60', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 61: test61@test.com
    v_email := 'test61@test.com';
    v_password := 'test61';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '61', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 62: test62@test.com
    v_email := 'test62@test.com';
    v_password := 'test62';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '62', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 63: test63@test.com
    v_email := 'test63@test.com';
    v_password := 'test63';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '63', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 64: test64@test.com
    v_email := 'test64@test.com';
    v_password := 'test64';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '64', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 65: test65@test.com
    v_email := 'test65@test.com';
    v_password := 'test65';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '65', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 66: test66@test.com
    v_email := 'test66@test.com';
    v_password := 'test66';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '66', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 67: test67@test.com
    v_email := 'test67@test.com';
    v_password := 'test67';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '67', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 68: test68@test.com
    v_email := 'test68@test.com';
    v_password := 'test68';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '68', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 69: test69@test.com
    v_email := 'test69@test.com';
    v_password := 'test69';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '69', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 70: test70@test.com
    v_email := 'test70@test.com';
    v_password := 'test70';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '70', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 71: test71@test.com
    v_email := 'test71@test.com';
    v_password := 'test71';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '71', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 72: test72@test.com
    v_email := 'test72@test.com';
    v_password := 'test72';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '72', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 73: test73@test.com
    v_email := 'test73@test.com';
    v_password := 'test73';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '73', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 74: test74@test.com
    v_email := 'test74@test.com';
    v_password := 'test74';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '74', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 75: test75@test.com
    v_email := 'test75@test.com';
    v_password := 'test75';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '75', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 76: test76@test.com
    v_email := 'test76@test.com';
    v_password := 'test76';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '76', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 77: test77@test.com
    v_email := 'test77@test.com';
    v_password := 'test77';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '77', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 78: test78@test.com
    v_email := 'test78@test.com';
    v_password := 'test78';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '78', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 79: test79@test.com
    v_email := 'test79@test.com';
    v_password := 'test79';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '79', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 80: test80@test.com
    v_email := 'test80@test.com';
    v_password := 'test80';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '80', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 81: test81@test.com
    v_email := 'test81@test.com';
    v_password := 'test81';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '81', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 82: test82@test.com
    v_email := 'test82@test.com';
    v_password := 'test82';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '82', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 83: test83@test.com
    v_email := 'test83@test.com';
    v_password := 'test83';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '83', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 84: test84@test.com
    v_email := 'test84@test.com';
    v_password := 'test84';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '84', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 85: test85@test.com
    v_email := 'test85@test.com';
    v_password := 'test85';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '85', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 86: test86@test.com
    v_email := 'test86@test.com';
    v_password := 'test86';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '86', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 87: test87@test.com
    v_email := 'test87@test.com';
    v_password := 'test87';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '87', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 88: test88@test.com
    v_email := 'test88@test.com';
    v_password := 'test88';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '88', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 89: test89@test.com
    v_email := 'test89@test.com';
    v_password := 'test89';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '89', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 90: test90@test.com
    v_email := 'test90@test.com';
    v_password := 'test90';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '90', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 91: test91@test.com
    v_email := 'test91@test.com';
    v_password := 'test91';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '91', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 92: test92@test.com
    v_email := 'test92@test.com';
    v_password := 'test92';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '92', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 93: test93@test.com
    v_email := 'test93@test.com';
    v_password := 'test93';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '93', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 94: test94@test.com
    v_email := 'test94@test.com';
    v_password := 'test94';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '94', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 95: test95@test.com
    v_email := 'test95@test.com';
    v_password := 'test95';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '95', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 96: test96@test.com
    v_email := 'test96@test.com';
    v_password := 'test96';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '96', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 97: test97@test.com
    v_email := 'test97@test.com';
    v_password := 'test97';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '97', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 98: test98@test.com
    v_email := 'test98@test.com';
    v_password := 'test98';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '98', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)
    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 99: test99@test.com
    v_email := 'test99@test.com';
    v_password := 'test99';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '99', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

    -- User 100: test100@test.com
    v_email := 'test100@test.com';
    v_password := 'test100';
    v_pos_ft := gen_random_uuid();
    v_pos_cas := gen_random_uuid();

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    ELSE
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)
    VALUES (v_user_id, 'Test', '100', v_email, 'Casual')
    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;

    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)
    VALUES
        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);
    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');

    -- Assign Access Certificate (Alpha Type X)
    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN
        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)
        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);
    ELSE
        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true
        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';
    END IF;

END $$;