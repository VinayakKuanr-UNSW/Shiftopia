-- Migration to seed the organizational hierarchy from CSV

DO $$
DECLARE
  v_org_id UUID;
  v_rem_id UUID;
  v_dept_id UUID;
  v_sub_dept_id UUID;
BEGIN
  -- Get the first organization or create one if none exists
  SELECT id INTO v_org_id FROM public.organizations ORDER BY created_at LIMIT 1;
  IF v_org_id IS NULL THEN
    v_org_id := gen_random_uuid();
    INSERT INTO public.organizations (id, name, is_active) VALUES (v_org_id, 'Default Organization', true);
  END IF;

  -- Level 0
  IF NOT EXISTS (SELECT 1 FROM public.remuneration_levels WHERE level_number = 0) THEN
    INSERT INTO public.remuneration_levels (id, level_number, level_name, hourly_rate_min)
    VALUES (gen_random_uuid(), 0, 'Level 0', 20);
  END IF;
  -- Level 1
  IF NOT EXISTS (SELECT 1 FROM public.remuneration_levels WHERE level_number = 1) THEN
    INSERT INTO public.remuneration_levels (id, level_number, level_name, hourly_rate_min)
    VALUES (gen_random_uuid(), 1, 'Level 1', 25);
  END IF;
  -- Level 2
  IF NOT EXISTS (SELECT 1 FROM public.remuneration_levels WHERE level_number = 2) THEN
    INSERT INTO public.remuneration_levels (id, level_number, level_name, hourly_rate_min)
    VALUES (gen_random_uuid(), 2, 'Level 2', 30);
  END IF;
  -- Level 3
  IF NOT EXISTS (SELECT 1 FROM public.remuneration_levels WHERE level_number = 3) THEN
    INSERT INTO public.remuneration_levels (id, level_number, level_name, hourly_rate_min)
    VALUES (gen_random_uuid(), 3, 'Level 3', 35);
  END IF;
  -- Level 4
  IF NOT EXISTS (SELECT 1 FROM public.remuneration_levels WHERE level_number = 4) THEN
    INSERT INTO public.remuneration_levels (id, level_number, level_name, hourly_rate_min)
    VALUES (gen_random_uuid(), 4, 'Level 4', 40);
  END IF;
  -- Level 5
  IF NOT EXISTS (SELECT 1 FROM public.remuneration_levels WHERE level_number = 5) THEN
    INSERT INTO public.remuneration_levels (id, level_number, level_name, hourly_rate_min)
    VALUES (gen_random_uuid(), 5, 'Level 5', 45);
  END IF;
  -- Level 6
  IF NOT EXISTS (SELECT 1 FROM public.remuneration_levels WHERE level_number = 6) THEN
    INSERT INTO public.remuneration_levels (id, level_number, level_name, hourly_rate_min)
    VALUES (gen_random_uuid(), 6, 'Level 6', 50);
  END IF;
  -- Level 7
  IF NOT EXISTS (SELECT 1 FROM public.remuneration_levels WHERE level_number = 7) THEN
    INSERT INTO public.remuneration_levels (id, level_number, level_name, hourly_rate_min)
    VALUES (gen_random_uuid(), 7, 'Level 7', 55);
  END IF;

  -- Department: Executive
  SELECT id INTO v_dept_id FROM public.departments WHERE name = 'Executive' AND organization_id = v_org_id LIMIT 1;
  IF v_dept_id IS NULL THEN
    v_dept_id := gen_random_uuid();
    INSERT INTO public.departments (id, name, organization_id, is_active) VALUES (v_dept_id, 'Executive', v_org_id, true);
  END IF;

    -- SubDepartment: Leadership
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Leadership' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Leadership', v_dept_id, true);
    END IF;

      -- Role: Executive Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Executive Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Executive Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Executive Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Executive Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Executive Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Executive Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Executive Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Executive Support Officer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Executive Support Officer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Executive Support Officer', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Executive Support Officer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Executive Officer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Executive Officer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Executive Officer', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Executive Officer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Executive Coordinator
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Executive Coordinator' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Executive Coordinator', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Executive Coordinator' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Executive Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Executive Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Executive Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Executive Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: General Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'General Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'General Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'General Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Chief Executive Officer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Chief Executive Officer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Chief Executive Officer', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Chief Executive Officer' AND sub_department_id = v_sub_dept_id;
      END IF;

  -- Department: Finance
  SELECT id INTO v_dept_id FROM public.departments WHERE name = 'Finance' AND organization_id = v_org_id LIMIT 1;
  IF v_dept_id IS NULL THEN
    v_dept_id := gen_random_uuid();
    INSERT INTO public.departments (id, name, organization_id, is_active) VALUES (v_dept_id, 'Finance', v_org_id, true);
  END IF;

    -- SubDepartment: Accounts
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Accounts' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Accounts', v_dept_id, true);
    END IF;

      -- Role: Finance Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Finance Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Finance Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Finance Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Accounts Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Accounts Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Accounts Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Accounts Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Accounts Officer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Accounts Officer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Accounts Officer', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Accounts Officer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Accounts Officer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Accounts Officer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Accounts Officer', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Accounts Officer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Finance Coordinator
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Finance Coordinator' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Finance Coordinator', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Finance Coordinator' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Finance Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Finance Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Finance Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Finance Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Finance Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Finance Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Finance Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior Finance Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director Finance
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director Finance' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director Finance', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director Finance' AND sub_department_id = v_sub_dept_id;
      END IF;

    -- SubDepartment: Payroll
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Payroll' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Payroll', v_dept_id, true);
    END IF;

      -- Role: Payroll Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Payroll Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Payroll Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Payroll Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Payroll Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Payroll Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Payroll Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Payroll Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Payroll Officer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Payroll Officer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Payroll Officer', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Payroll Officer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Payroll Officer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Payroll Officer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Payroll Officer', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Payroll Officer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Payroll Coordinator
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Payroll Coordinator' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Payroll Coordinator', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Payroll Coordinator' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Payroll Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Payroll Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Payroll Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Payroll Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Payroll Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Payroll Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Payroll Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior Payroll Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Head of Payroll
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Head of Payroll' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Head of Payroll', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Head of Payroll' AND sub_department_id = v_sub_dept_id;
      END IF;

  -- Department: People & Culture
  SELECT id INTO v_dept_id FROM public.departments WHERE name = 'People & Culture' AND organization_id = v_org_id LIMIT 1;
  IF v_dept_id IS NULL THEN
    v_dept_id := gen_random_uuid();
    INSERT INTO public.departments (id, name, organization_id, is_active) VALUES (v_dept_id, 'People & Culture', v_org_id, true);
  END IF;

    -- SubDepartment: HR Operations
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'HR Operations' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'HR Operations', v_dept_id, true);
    END IF;

      -- Role: HR Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'HR Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'HR Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'HR Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: HR Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'HR Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'HR Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'HR Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: HR Officer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'HR Officer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'HR Officer', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'HR Officer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior HR Officer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior HR Officer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior HR Officer', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior HR Officer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: HR Coordinator
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'HR Coordinator' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'HR Coordinator', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'HR Coordinator' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: HR Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'HR Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'HR Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'HR Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior HR Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior HR Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior HR Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior HR Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Head of HR
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Head of HR' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Head of HR', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Head of HR' AND sub_department_id = v_sub_dept_id;
      END IF;

    -- SubDepartment: Partnering
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Partnering' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Partnering', v_dept_id, true);
    END IF;

      -- Role: People Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'People Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'People Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'People Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: People Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'People Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'People Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'People Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: People Officer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'People Officer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'People Officer', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'People Officer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior People Officer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior People Officer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior People Officer', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior People Officer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: People Partner
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'People Partner' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'People Partner', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'People Partner' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: People Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'People Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'People Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'People Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior People Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior People Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior People Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior People Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director People & Culture
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director People & Culture' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director People & Culture', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director People & Culture' AND sub_department_id = v_sub_dept_id;
      END IF;

  -- Department: ICT Services
  SELECT id INTO v_dept_id FROM public.departments WHERE name = 'ICT Services' AND organization_id = v_org_id LIMIT 1;
  IF v_dept_id IS NULL THEN
    v_dept_id := gen_random_uuid();
    INSERT INTO public.departments (id, name, organization_id, is_active) VALUES (v_dept_id, 'ICT Services', v_org_id, true);
  END IF;

    -- SubDepartment: Support
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Support' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Support', v_dept_id, true);
    END IF;

      -- Role: ICT Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'ICT Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'ICT Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'ICT Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: ICT Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'ICT Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'ICT Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'ICT Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: ICT Technician
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'ICT Technician' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'ICT Technician', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'ICT Technician' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior ICT Technician
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior ICT Technician' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior ICT Technician', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior ICT Technician' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: ICT Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'ICT Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'ICT Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'ICT Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: ICT Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'ICT Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'ICT Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'ICT Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior ICT Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior ICT Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior ICT Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior ICT Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director ICT
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director ICT' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director ICT', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director ICT' AND sub_department_id = v_sub_dept_id;
      END IF;

    -- SubDepartment: Infrastructure
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Infrastructure' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Infrastructure', v_dept_id, true);
    END IF;

      -- Role: Infrastructure Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Infrastructure Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Infrastructure Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Infrastructure Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Infrastructure Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Infrastructure Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Infrastructure Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Infrastructure Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Infrastructure Engineer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Infrastructure Engineer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Infrastructure Engineer', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Infrastructure Engineer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Infrastructure Engineer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Infrastructure Engineer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Infrastructure Engineer', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Infrastructure Engineer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Infrastructure Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Infrastructure Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Infrastructure Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Infrastructure Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Infrastructure Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Infrastructure Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Infrastructure Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Infrastructure Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Infrastructure Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Infrastructure Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Infrastructure Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior Infrastructure Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Head of Infrastructure
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Head of Infrastructure' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Head of Infrastructure', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Head of Infrastructure' AND sub_department_id = v_sub_dept_id;
      END IF;

  -- Department: AV
  SELECT id INTO v_dept_id FROM public.departments WHERE name = 'AV' AND organization_id = v_org_id LIMIT 1;
  IF v_dept_id IS NULL THEN
    v_dept_id := gen_random_uuid();
    INSERT INTO public.departments (id, name, organization_id, is_active) VALUES (v_dept_id, 'AV', v_org_id, true);
  END IF;

    -- SubDepartment: Technical
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Technical' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Technical', v_dept_id, true);
    END IF;

      -- Role: AV Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'AV Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'AV Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'AV Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: AV Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'AV Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'AV Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'AV Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: AV Technician
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'AV Technician' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'AV Technician', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'AV Technician' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior AV Technician
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior AV Technician' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior AV Technician', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior AV Technician' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: AV Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'AV Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'AV Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'AV Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: AV Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'AV Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'AV Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'AV Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior AV Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior AV Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior AV Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior AV Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director AV
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director AV' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director AV', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director AV' AND sub_department_id = v_sub_dept_id;
      END IF;

  -- Department: Event Delivery
  SELECT id INTO v_dept_id FROM public.departments WHERE name = 'Event Delivery' AND organization_id = v_org_id LIMIT 1;
  IF v_dept_id IS NULL THEN
    v_dept_id := gen_random_uuid();
    INSERT INTO public.departments (id, name, organization_id, is_active) VALUES (v_dept_id, 'Event Delivery', v_org_id, true);
  END IF;

    -- SubDepartment: Operations
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Operations' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Operations', v_dept_id, true);
    END IF;

      -- Role: Event Ops Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Event Ops Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Event Ops Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Event Ops Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Event Ops Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Event Ops Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Event Ops Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Event Ops Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Event Crew
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Event Crew' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Event Crew', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Event Crew' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Event Crew
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Event Crew' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Event Crew', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Event Crew' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Event Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Event Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Event Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Event Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Event Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Event Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Event Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Event Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Event Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Event Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Event Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior Event Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director Event Delivery
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director Event Delivery' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director Event Delivery', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director Event Delivery' AND sub_department_id = v_sub_dept_id;
      END IF;

    -- SubDepartment: F&B
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'F&B' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'F&B', v_dept_id, true);
    END IF;

      -- Role: F&B Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'F&B Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'F&B Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'F&B Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: F&B Attendant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'F&B Attendant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'F&B Attendant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'F&B Attendant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: F&B Team Member
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'F&B Team Member' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'F&B Team Member', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'F&B Team Member' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior F&B Attendant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior F&B Attendant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior F&B Attendant', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior F&B Attendant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: F&B Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'F&B Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'F&B Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'F&B Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: F&B Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'F&B Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'F&B Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'F&B Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior F&B Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior F&B Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior F&B Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior F&B Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director F&B
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director F&B' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director F&B', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director F&B' AND sub_department_id = v_sub_dept_id;
      END IF;

    -- SubDepartment: Kitchen
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Kitchen' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Kitchen', v_dept_id, true);
    END IF;

      -- Role: Kitchen Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Kitchen Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Kitchen Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Kitchen Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Kitchen Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Kitchen Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Kitchen Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Kitchen Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Cook
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Cook' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Cook', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Cook' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Cook
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Cook' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Cook', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Cook' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Chef de Partie
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Chef de Partie' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Chef de Partie', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Chef de Partie' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Sous Chef
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Sous Chef' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Sous Chef', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Sous Chef' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Executive Chef
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Executive Chef' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Executive Chef', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Executive Chef' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director Culinary
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director Culinary' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director Culinary', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director Culinary' AND sub_department_id = v_sub_dept_id;
      END IF;

    -- SubDepartment: Logistics
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Logistics' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Logistics', v_dept_id, true);
    END IF;

      -- Role: Logistics Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Logistics Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Logistics Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Logistics Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Logistics Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Logistics Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Logistics Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Logistics Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Logistics Crew
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Logistics Crew' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Logistics Crew', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Logistics Crew' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Logistics Crew
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Logistics Crew' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Logistics Crew', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Logistics Crew' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Logistics Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Logistics Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Logistics Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Logistics Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Logistics Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Logistics Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Logistics Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Logistics Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Logistics Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Logistics Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Logistics Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior Logistics Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director Logistics
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director Logistics' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director Logistics', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director Logistics' AND sub_department_id = v_sub_dept_id;
      END IF;

    -- SubDepartment: Set-up
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Set-up' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Set-up', v_dept_id, true);
    END IF;

      -- Role: Setup Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Setup Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Setup Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Setup Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Setup Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Setup Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Setup Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Setup Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Setup Crew
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Setup Crew' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Setup Crew', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Setup Crew' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Setup Crew
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Setup Crew' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Setup Crew', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Setup Crew' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Setup Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Setup Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Setup Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Setup Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Setup Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Setup Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Setup Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Setup Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Setup Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Setup Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Setup Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior Setup Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director Setup
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director Setup' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director Setup', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director Setup' AND sub_department_id = v_sub_dept_id;
      END IF;

    -- SubDepartment: Security
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Security' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Security', v_dept_id, true);
    END IF;

      -- Role: Security Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Security Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Security Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Security Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Security Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Security Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Security Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Security Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Security Officer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Security Officer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Security Officer', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Security Officer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Security Officer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Security Officer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Security Officer', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Security Officer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Security Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Security Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Security Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Security Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Security Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Security Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Security Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Security Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Security Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Security Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Security Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior Security Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director Security
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director Security' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director Security', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director Security' AND sub_department_id = v_sub_dept_id;
      END IF;

  -- Department: Customer Services
  SELECT id INTO v_dept_id FROM public.departments WHERE name = 'Customer Services' AND organization_id = v_org_id LIMIT 1;
  IF v_dept_id IS NULL THEN
    v_dept_id := gen_random_uuid();
    INSERT INTO public.departments (id, name, organization_id, is_active) VALUES (v_dept_id, 'Customer Services', v_org_id, true);
  END IF;

    -- SubDepartment: Frontline
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Frontline' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Frontline', v_dept_id, true);
    END IF;

      -- Role: Customer Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Customer Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Customer Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Customer Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Customer Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Customer Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Customer Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Customer Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Customer Agent
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Customer Agent' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Customer Agent', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Customer Agent' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Customer Agent
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Customer Agent' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Customer Agent', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Customer Agent' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Customer Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Customer Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Customer Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Customer Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Customer Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Customer Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Customer Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Customer Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Customer Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Customer Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Customer Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior Customer Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director Customer Experience
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director Customer Experience' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director Customer Experience', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director Customer Experience' AND sub_department_id = v_sub_dept_id;
      END IF;

  -- Department: Security
  SELECT id INTO v_dept_id FROM public.departments WHERE name = 'Security' AND organization_id = v_org_id LIMIT 1;
  IF v_dept_id IS NULL THEN
    v_dept_id := gen_random_uuid();
    INSERT INTO public.departments (id, name, organization_id, is_active) VALUES (v_dept_id, 'Security', v_org_id, true);
  END IF;

    -- SubDepartment: Operations
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Operations' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Operations', v_dept_id, true);
    END IF;

      -- Role: Security Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Security Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Security Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Security Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Security Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Security Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Security Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Security Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Security Officer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Security Officer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Security Officer', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Security Officer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Security Officer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Security Officer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Security Officer', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Security Officer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Security Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Security Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Security Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Security Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Security Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Security Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Security Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Security Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Security Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Security Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Security Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior Security Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director Security
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director Security' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director Security', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director Security' AND sub_department_id = v_sub_dept_id;
      END IF;

  -- Department: Logistics
  SELECT id INTO v_dept_id FROM public.departments WHERE name = 'Logistics' AND organization_id = v_org_id LIMIT 1;
  IF v_dept_id IS NULL THEN
    v_dept_id := gen_random_uuid();
    INSERT INTO public.departments (id, name, organization_id, is_active) VALUES (v_dept_id, 'Logistics', v_org_id, true);
  END IF;

    -- SubDepartment: Operations
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Operations' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Operations', v_dept_id, true);
    END IF;

      -- Role: Logistics Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Logistics Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Logistics Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Logistics Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Logistics Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Logistics Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Logistics Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Logistics Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Storeperson
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Storeperson' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Storeperson', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Storeperson' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Storeperson
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Storeperson' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Storeperson', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Storeperson' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Logistics Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Logistics Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Logistics Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Logistics Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Logistics Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Logistics Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Logistics Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Logistics Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Logistics Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Logistics Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Logistics Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior Logistics Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director Logistics
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director Logistics' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director Logistics', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director Logistics' AND sub_department_id = v_sub_dept_id;
      END IF;

  -- Department: Live Events
  SELECT id INTO v_dept_id FROM public.departments WHERE name = 'Live Events' AND organization_id = v_org_id LIMIT 1;
  IF v_dept_id IS NULL THEN
    v_dept_id := gen_random_uuid();
    INSERT INTO public.departments (id, name, organization_id, is_active) VALUES (v_dept_id, 'Live Events', v_org_id, true);
  END IF;

    -- SubDepartment: Operations
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Operations' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Operations', v_dept_id, true);
    END IF;

      -- Role: Live Events Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Live Events Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Live Events Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Live Events Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Live Events Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Live Events Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Live Events Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Live Events Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Live Events Crew
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Live Events Crew' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Live Events Crew', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Live Events Crew' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Live Events Crew
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Live Events Crew' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Live Events Crew', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Live Events Crew' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Live Events Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Live Events Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Live Events Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Live Events Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Live Events Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Live Events Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Live Events Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Live Events Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Live Events Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Live Events Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Live Events Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior Live Events Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director Live Events
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director Live Events' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director Live Events', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director Live Events' AND sub_department_id = v_sub_dept_id;
      END IF;

    -- SubDepartment: Front of House
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Front of House' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Front of House', v_dept_id, true);
    END IF;

      -- Role: FOH Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'FOH Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'FOH Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'FOH Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Usher
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Usher' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Usher', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Usher' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Usher
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Usher' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Usher', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Senior Usher' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: FOH Specialist
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'FOH Specialist' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'FOH Specialist', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'FOH Specialist' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: FOH Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'FOH Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'FOH Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'FOH Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: FOH Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'FOH Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'FOH Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'FOH Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior FOH Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior FOH Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior FOH Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior FOH Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director Front of House
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director Front of House' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director Front of House', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director Front of House' AND sub_department_id = v_sub_dept_id;
      END IF;

    -- SubDepartment: Technical
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Technical' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Technical', v_dept_id, true);
    END IF;

      -- Role: Technical Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Technical Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Technical Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Technical Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Stage Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Stage Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Stage Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Stage Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Stage Technician
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Stage Technician' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Stage Technician', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Stage Technician' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Stage Technician
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Stage Technician' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Stage Technician', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Stage Technician' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Technical Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Technical Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Technical Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Technical Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Technical Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Technical Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Technical Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Technical Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Technical Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Technical Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Technical Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior Technical Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director Technical Production
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director Technical Production' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director Technical Production', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director Technical Production' AND sub_department_id = v_sub_dept_id;
      END IF;

  -- Department: Assets and Trades
  SELECT id INTO v_dept_id FROM public.departments WHERE name = 'Assets and Trades' AND organization_id = v_org_id LIMIT 1;
  IF v_dept_id IS NULL THEN
    v_dept_id := gen_random_uuid();
    INSERT INTO public.departments (id, name, organization_id, is_active) VALUES (v_dept_id, 'Assets and Trades', v_org_id, true);
  END IF;

    -- SubDepartment: Maintenance
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Maintenance' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Maintenance', v_dept_id, true);
    END IF;

      -- Role: Maintenance Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Maintenance Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Maintenance Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Maintenance Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Maintenance Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Maintenance Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Maintenance Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Maintenance Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Handyperson
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Handyperson' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Handyperson', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Handyperson' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Handyperson
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Handyperson' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Handyperson', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Handyperson' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Maintenance Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Maintenance Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Maintenance Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Maintenance Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Maintenance Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Maintenance Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Maintenance Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Maintenance Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Maintenance Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Maintenance Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Maintenance Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior Maintenance Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director Maintenance
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director Maintenance' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director Maintenance', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director Maintenance' AND sub_department_id = v_sub_dept_id;
      END IF;

    -- SubDepartment: Electrical
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Electrical' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Electrical', v_dept_id, true);
    END IF;

      -- Role: Electrical Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Electrical Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Electrical Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Electrical Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Electrical Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Electrical Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Electrical Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Electrical Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Electrician
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Electrician' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Electrician', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Electrician' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Electrician
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Electrician' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Electrician', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Electrician' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Electrical Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Electrical Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Electrical Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Electrical Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Electrical Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Electrical Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Electrical Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Electrical Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Electrical Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Electrical Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Electrical Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior Electrical Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director Electrical Services
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director Electrical Services' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director Electrical Services', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director Electrical Services' AND sub_department_id = v_sub_dept_id;
      END IF;

    -- SubDepartment: Mechanical
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Mechanical' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Mechanical', v_dept_id, true);
    END IF;

      -- Role: Mechanical Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Mechanical Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Mechanical Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Mechanical Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Mechanical Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Mechanical Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Mechanical Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Mechanical Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Mechanical Technician
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Mechanical Technician' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Mechanical Technician', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Mechanical Technician' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Mechanical Technician
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Mechanical Technician' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Mechanical Technician', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Mechanical Technician' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Mechanical Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Mechanical Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Mechanical Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Mechanical Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Mechanical Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Mechanical Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Mechanical Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Mechanical Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Mechanical Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Mechanical Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Mechanical Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior Mechanical Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director Mechanical Services
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director Mechanical Services' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director Mechanical Services', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director Mechanical Services' AND sub_department_id = v_sub_dept_id;
      END IF;

    -- SubDepartment: Facilities
    SELECT id INTO v_sub_dept_id FROM public.sub_departments WHERE name = 'Facilities' AND department_id = v_dept_id LIMIT 1;
    IF v_sub_dept_id IS NULL THEN
      v_sub_dept_id := gen_random_uuid();
      INSERT INTO public.sub_departments (id, name, department_id, is_active) VALUES (v_sub_dept_id, 'Facilities', v_dept_id, true);
    END IF;

      -- Role: Facilities Trainee
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 0 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Facilities Trainee' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Facilities Trainee', 0, v_dept_id, v_sub_dept_id, v_rem_id, 'Part Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Part Time', remuneration_level_id = v_rem_id, level = 0
        WHERE name = 'Facilities Trainee' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Facilities Assistant
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 1 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Facilities Assistant' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Facilities Assistant', 1, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 1
        WHERE name = 'Facilities Assistant' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Facilities Officer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 2 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Facilities Officer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Facilities Officer', 2, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 2
        WHERE name = 'Facilities Officer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Facilities Officer
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 3 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Facilities Officer' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Facilities Officer', 3, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 3
        WHERE name = 'Senior Facilities Officer' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Facilities Supervisor
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 4 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Facilities Supervisor' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Facilities Supervisor', 4, v_dept_id, v_sub_dept_id, v_rem_id, 'Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Casual', remuneration_level_id = v_rem_id, level = 4
        WHERE name = 'Facilities Supervisor' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Facilities Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 5 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Facilities Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Facilities Manager', 5, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time / Casual', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time / Casual', remuneration_level_id = v_rem_id, level = 5
        WHERE name = 'Facilities Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Senior Facilities Manager
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 6 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Senior Facilities Manager' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Senior Facilities Manager', 6, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 6
        WHERE name = 'Senior Facilities Manager' AND sub_department_id = v_sub_dept_id;
      END IF;

      -- Role: Director Facilities
      SELECT id INTO v_rem_id FROM public.remuneration_levels WHERE level_number = 7 LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Director Facilities' AND sub_department_id = v_sub_dept_id) THEN
        INSERT INTO public.roles (id, name, level, department_id, sub_department_id, remuneration_level_id, employment_type, is_active)
        VALUES (gen_random_uuid(), 'Director Facilities', 7, v_dept_id, v_sub_dept_id, v_rem_id, 'Full Time', true);
      ELSE
        UPDATE public.roles SET employment_type = 'Full Time', remuneration_level_id = v_rem_id, level = 7
        WHERE name = 'Director Facilities' AND sub_department_id = v_sub_dept_id;
      END IF;

END $$;
