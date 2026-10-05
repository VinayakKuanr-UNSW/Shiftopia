
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const DEPT_ID = '42cf1feb-cf01-4e22-8833-43367e6da1cd'; // Event Delivery
const SUB_DEPT_ID = '6fefad95-9cf9-468c-8724-424cc2f7b640'; // Set-up
const ROLE_ID = '2309d285-116e-4478-904d-44f627bdf82a'; // Team Member (L2)

async function onboard() {
  console.log('Generating bulk user onboarding SQL (test1 to test100)...');

  const sqlLines: string[] = [
    '-- Bulk User Onboarding: test1 to test100 + Kurry Admin',
    '-- Target: Event Delivery -> Event Setups',
    '',
    'DO $$',
    'DECLARE',
    '    v_user_id UUID;',
    '    v_kurry_id UUID;',
    '    v_email TEXT;',
    '    v_password TEXT;',
    '    v_dept_id UUID := \'42cf1feb-cf01-4e22-8833-43367e6da1cd\';',
    '    v_sub_dept_id UUID := \'6fefad95-9cf9-468c-8724-424cc2f7b640\';',
    '    v_role_mgr UUID;',
    '    v_role_am  UUID;',
    '    v_role_sup UUID;',
    '    v_role_tl  UUID;',
    '    v_role_tm3 UUID;',
    '    v_role_tm2 UUID;',
    '    v_org_id UUID;',
    '    v_skill_id UUID;',
    '    v_pos_ft UUID;',
    '    v_pos_cas UUID;',
    'BEGIN',
    '    -- 1. Get role IDs dynamically (by name + sub_dept)',
    '    SELECT id INTO v_role_mgr FROM hr.roles WHERE name = \'Manager\' AND subdepartment_id = v_sub_dept_id;',
    '    SELECT id INTO v_role_am  FROM hr.roles WHERE name = \'Assistant Manager\' AND subdepartment_id = v_sub_dept_id;',
    '    SELECT id INTO v_role_sup FROM hr.roles WHERE name = \'Supervisor\' AND subdepartment_id = v_sub_dept_id;',
    '    SELECT id INTO v_role_tl  FROM hr.roles WHERE name = \'Team Leader\' AND subdepartment_id = v_sub_dept_id;',
    '    SELECT id INTO v_role_tm3 FROM hr.roles WHERE name = \'TM3\' AND subdepartment_id = v_sub_dept_id;',
    '    SELECT id INTO v_role_tm2 FROM hr.roles WHERE name = \'Team Member\' AND subdepartment_id = v_sub_dept_id;',
    '',
    '    -- 2. Get the first organization',
    '    SELECT id INTO v_org_id FROM public.organizations LIMIT 1;',
    '    IF v_org_id IS NULL THEN',
    '        RAISE EXCEPTION \'No organization found.\';',
    '    END IF;',
    '',
    '    -- 3. Create the ES-GOLD skill if it doesn\'t exist',
    '    INSERT INTO public.skills (id, name, description, category, is_active, requires_expiration, default_validity_months)',
    '    VALUES (gen_random_uuid(), \'ES-GOLD\', \'Gold level Event Security skill\', \'Safety\', true, false, null)',
    '    ON CONFLICT (name) DO NOTHING;',
    '    SELECT id INTO v_skill_id FROM public.skills WHERE name = \'ES-GOLD\';',
    '',
    '    -- 4. Setup Kurry Admin (Supervisor 1: FT + 1TL Casual)',
    '    SELECT id INTO v_kurry_id FROM public.profiles WHERE email = \'kurryosity@gmail.com\';',
    '    IF v_kurry_id IS NOT NULL THEN',
    '        DELETE FROM hr.user_contracts WHERE user_id = v_kurry_id;',
    '        DELETE FROM public.availability_rules WHERE profile_id = v_kurry_id;',
    '        UPDATE public.profiles SET employment_type = \'Full-Time\' WHERE id = v_kurry_id;',
    '        v_pos_ft := gen_random_uuid();',
    '        v_pos_cas := gen_random_uuid();',
    '        INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)',
    '        VALUES',
    '            (gen_random_uuid(), v_kurry_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_sup, \'Active\', \'2026-08-24\', \'alpha\', \'Full-Time\', 38, 5, v_pos_ft),',
    '            (gen_random_uuid(), v_kurry_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tl,  \'Active\', \'2026-08-24\', \'alpha\', \'Casual\', 0, 4, v_pos_cas);',
    '    END IF;',
    '',
    '    -- 5. Delete existing contracts and availability rules for test users before inserting',
    '    DELETE FROM hr.user_contracts WHERE user_id IN (SELECT id FROM public.profiles WHERE email LIKE \'test%@test.com\');',
    '    DELETE FROM public.availability_rules WHERE profile_id IN (SELECT id FROM public.profiles WHERE email LIKE \'test%@test.com\');',
    '    DELETE FROM public.employee_skills WHERE skill_id = v_skill_id AND employee_id IN (SELECT id FROM public.profiles WHERE email LIKE \'test%@test.com\');',
    ''
  ];

  // Randomly select 25 indices between 1 and 100 to receive the ES-GOLD skill
  const randomIndices = new Set<number>();
  while (randomIndices.size < 25) {
    randomIndices.add(Math.floor(Math.random() * 100) + 1);
  }

  for (let i = 1; i <= 100; i++) {
    const email = `test${i}@test.com`;
    const password = `test${i}`;
    const firstName = `Test`;
    const lastName = `${i}`;
    const isFt = i <= 3;

    sqlLines.push(`    -- User ${i}: ${email}`);
    sqlLines.push(`    v_email := '${email}';`);
    sqlLines.push(`    v_password := '${password}';`);
    sqlLines.push(`    v_pos_ft := gen_random_uuid();`);
    sqlLines.push(`    v_pos_cas := gen_random_uuid();`);
    sqlLines.push(``);

    sqlLines.push(`    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN`);
    sqlLines.push(`        v_user_id := gen_random_uuid();`);
    sqlLines.push(`        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)`);
    sqlLines.push(`        VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');`);
    sqlLines.push(`    ELSE`);
    sqlLines.push(`        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;`);
    sqlLines.push(`    END IF;`);
    sqlLines.push(``);
    sqlLines.push(`    INSERT INTO public.profiles (id, first_name, last_name, email, employment_type)`);
    sqlLines.push(`    VALUES (v_user_id, '${firstName}', '${lastName}', v_email, '${isFt ? 'Full-Time' : 'Casual'}')`);
    sqlLines.push(`    ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, employment_type = EXCLUDED.employment_type;`);
    sqlLines.push(``);

    // Positions allocation:
    // User 1: 1 Manager (FT only)
    // User 2: 1 Assistant Manager (FT only)
    // User 3: 1 Supervisor (FT + 1TL Casual) [Supervisor 2 alongside Kurry Admin]
    // Users 4-13 (10 employees): 10 TLs + TM3 + TM2 (all casual)
    // Users 14-15 (2 employees): 2 TM3s + TM2 (all casual)
    // Users 16-100 (85 employees): 80+ TM2 (all casual)
    if (i === 1) {
      sqlLines.push(`    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)`);
      sqlLines.push(`    VALUES`);
      sqlLines.push(`        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_mgr, 'Active', '2026-08-24', 'alpha', 'Full-Time', 38, 7, v_pos_ft);`);
    } else if (i === 2) {
      sqlLines.push(`    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)`);
      sqlLines.push(`    VALUES`);
      sqlLines.push(`        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_am, 'Active', '2026-08-24', 'alpha', 'Full-Time', 38, 6, v_pos_ft);`);
    } else if (i === 3) {
      sqlLines.push(`    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)`);
      sqlLines.push(`    VALUES`);
      sqlLines.push(`        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_sup, 'Active', '2026-08-24', 'alpha', 'Full-Time', 38, 5, v_pos_ft),`);
      sqlLines.push(`        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tl,  'Active', '2026-08-24', 'alpha', 'Casual', 0, 4, v_pos_cas);`);
      sqlLines.push(`    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)`);
      sqlLines.push(`    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');`);
    } else if (i <= 13) {
      sqlLines.push(`    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)`);
      sqlLines.push(`    VALUES`);
      sqlLines.push(`        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tl,  'Active', '2026-08-24', 'alpha', 'Casual', 0, 4, v_pos_cas),`);
      sqlLines.push(`        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm3, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 3, v_pos_cas),`);
      sqlLines.push(`        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);`);
      sqlLines.push(`    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)`);
      sqlLines.push(`    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');`);
    } else if (i <= 15) {
      sqlLines.push(`    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)`);
      sqlLines.push(`    VALUES`);
      sqlLines.push(`        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm3, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 3, v_pos_cas),`);
      sqlLines.push(`        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);`);
      sqlLines.push(`    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)`);
      sqlLines.push(`    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');`);
    } else {
      sqlLines.push(`    INSERT INTO hr.user_contracts (id, user_id, organization_id, department_id, sub_department_id, role_id, status, start_date, access_level, employment_status, contracted_weekly_hours, remuneration_level, position_id)`);
      sqlLines.push(`    VALUES`);
      sqlLines.push(`        (gen_random_uuid(), v_user_id, v_org_id, v_dept_id, v_sub_dept_id, v_role_tm2, 'Active', '2026-08-24', 'alpha', 'Casual', 0, 2, v_pos_cas);`);
      sqlLines.push(`    INSERT INTO public.availability_rules (profile_id, sub_department_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)`);
      sqlLines.push(`    VALUES (v_user_id, v_sub_dept_id, '2026-08-01', '00:00:00', '23:59:59', 'weekly', ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[], '2027-03-01');`);
    }
    sqlLines.push(``);

    // Give 25 random members ES-GOLD skill
    if (randomIndices.has(i)) {
      sqlLines.push(`    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level)`);
      sqlLines.push(`    VALUES (v_user_id, v_skill_id, 'Active', 'Competent');`);
      sqlLines.push(``);
    }

    sqlLines.push(`    -- Assign Access Certificate (Alpha Type X)`);
    sqlLines.push(`    IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X') THEN`);
    sqlLines.push(`        INSERT INTO public.app_access_certificates (user_id, organization_id, department_id, sub_department_id, access_level, certificate_type, is_active)`);
    sqlLines.push(`        VALUES (v_user_id, v_org_id, v_dept_id, v_sub_dept_id, 'alpha', 'X', true);`);
    sqlLines.push(`    ELSE`);
    sqlLines.push(`        UPDATE public.app_access_certificates SET access_level = 'alpha', is_active = true`);
    sqlLines.push(`        WHERE user_id = v_user_id AND organization_id = v_org_id AND department_id = v_dept_id AND sub_department_id = v_sub_dept_id AND certificate_type = 'X';`);
    sqlLines.push(`    END IF;`);
    sqlLines.push(``);
  }

  sqlLines.push('END $$;');

  const sqlFile = '1/onboard_users.sql';
  fs.writeFileSync(sqlFile, sqlLines.join('\n'));
  console.log(`Generated SQL script: ${sqlFile}`);
}

onboard().catch(console.error);
