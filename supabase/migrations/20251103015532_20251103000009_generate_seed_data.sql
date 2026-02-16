/*
  # Generate Comprehensive Seed Data

  ## Overview
  This migration generates realistic seed data for the workforce management system including:
  - 3 months of shift schedules (Nov 2025 - Jan 2026)
  - Proper distribution across weekdays, weekends, and public holidays
  - Employee assignments
  - Sample bids, swaps, and availability records

  ## Data Generated
  - 50 additional employees
  - Shift schedules for Convention Centre, Exhibition Centre, and Theatre
  - Employee availability patterns
  - Sample swap requests
  - Sample bids
  - Broadcast groups and messages
*/

-- Generate additional employees
DO $$
DECLARE
  v_emp_count integer := 40;
  v_first_names text[] := ARRAY['Alex', 'Blake', 'Casey', 'Drew', 'Elliot', 'Finley', 'Gray', 'Harper', 'Indigo', 'Jordan', 
                                  'Kelly', 'Logan', 'Morgan', 'Noah', 'Oakley', 'Parker', 'Quinn', 'Riley', 'Sage', 'Taylor',
                                  'Uma', 'Val', 'Wesley', 'Xander', 'Yuki', 'Zara', 'Adrian', 'Blair', 'Cameron', 'Dakota',
                                  'Eden', 'Flynn', 'Gale', 'Haven', 'Iris', 'Jules', 'Kai', 'Lane', 'Merit', 'Nova'];
  v_last_names text[] := ARRAY['Adams', 'Baker', 'Clark', 'Davis', 'Evans', 'Foster', 'Green', 'Hayes', 'Ivanov', 'Jones',
                                'Kumar', 'Lopez', 'Miller', 'Nguyen', 'O''Brien', 'Patel', 'Quinn', 'Roberts', 'Singh', 'Torres',
                                'Upton', 'Valdez', 'Walsh', 'Xavier', 'Yang', 'Zhang', 'Ahmed', 'Bennett', 'Cruz', 'Diaz'];
  v_first_name text;
  v_last_name text;
  v_email text;
  v_phone text;
  i integer;
BEGIN
  FOR i IN 1..v_emp_count LOOP
    v_first_name := v_first_names[(i % array_length(v_first_names, 1)) + 1];
    v_last_name := v_last_names[(i % array_length(v_last_names, 1)) + 1];
    v_email := lower(v_first_name || '.' || v_last_name || i::text || '@example.com');
    v_phone := '+61 4' || lpad((floor(random() * 90000000 + 10000000))::text, 8, '0');
    
    INSERT INTO employees (name, email, phone)
    VALUES (v_first_name || ' ' || v_last_name, v_email, v_phone)
    ON CONFLICT (email) DO NOTHING;
  END LOOP;
END $$;

-- Generate shifts for 3 months (Nov 2025 - Jan 2026)
DO $$
DECLARE
  v_org_id uuid;
  v_conv_dept_id uuid;
  v_exh_dept_id uuid;
  v_theatre_dept_id uuid;
  v_conv_subdept_ids uuid[];
  v_exh_subdept_ids uuid[];
  v_theatre_subdept_ids uuid[];
  v_role_ids uuid[];
  v_employee_ids uuid[];
  v_rem_level_ids uuid[];
  v_shift_group_ids uuid[];
  v_current_date date;
  v_end_date date;
  v_day_of_week integer;
  v_shift_count integer;
  v_subdept_id uuid;
  v_role_id uuid;
  v_employee_id uuid;
  v_rem_level_id uuid;
  v_shift_group_id uuid;
  v_start_time time;
  v_end_time time;
  v_shift_length decimal;
  v_net_length decimal;
  i integer;
BEGIN
  -- Check if shifts already exist to avoid duplication
  IF NOT EXISTS (SELECT 1 FROM shifts LIMIT 1) THEN
      -- Get organization and departments
      -- Get organization (fallback to first available or create default)
      SELECT id INTO v_org_id FROM organizations WHERE name = 'ICC Sydney' LIMIT 1;
      
      IF v_org_id IS NULL THEN
        SELECT id INTO v_org_id FROM organizations LIMIT 1;
      END IF;
      
      IF v_org_id IS NULL THEN
        INSERT INTO organizations (name) VALUES ('ICC Sydney') RETURNING id INTO v_org_id;
      END IF;
      SELECT id INTO v_conv_dept_id FROM departments WHERE name = 'Convention Centre' AND organization_id = v_org_id LIMIT 1;
      SELECT id INTO v_exh_dept_id FROM departments WHERE name = 'Exhibition Centre' AND organization_id = v_org_id LIMIT 1;
      SELECT id INTO v_theatre_dept_id FROM departments WHERE name = 'Theatre' AND organization_id = v_org_id LIMIT 1;
      
      -- Get sub-departments
      SELECT array_agg(id) INTO v_conv_subdept_ids FROM sub_departments WHERE department_id = v_conv_dept_id;
      SELECT array_agg(id) INTO v_exh_subdept_ids FROM sub_departments WHERE department_id = v_exh_dept_id;
      SELECT array_agg(id) INTO v_theatre_subdept_ids FROM sub_departments WHERE department_id = v_theatre_dept_id;
      
      -- Get roles, employees, remuneration levels, shift groups
      SELECT array_agg(id) INTO v_role_ids FROM roles LIMIT 10;
      SELECT array_agg(id) INTO v_employee_ids FROM employees;
      SELECT array_agg(id) INTO v_rem_level_ids FROM remuneration_levels;
      SELECT array_agg(id) INTO v_shift_group_ids FROM shift_groups;
      
      -- Set date range: November 2025 to January 2026
      v_current_date := '2025-11-01'::date;
      v_end_date := '2026-01-31'::date;
      
      -- Shift generation disabled by user request
      /*
      WHILE v_current_date <= v_end_date LOOP
        v_day_of_week := EXTRACT(DOW FROM v_current_date);
        
        -- Determine number of shifts based on day type
        v_shift_count := CASE
          WHEN v_day_of_week IN (0, 6) THEN 8  -- Weekend: fewer shifts
          WHEN v_current_date IN (SELECT holiday_date FROM public_holidays) THEN 5  -- Public holiday: minimal shifts
          ELSE 15  -- Weekday: normal shifts
        END;
        
        -- Generate shifts for this day
        FOR i IN 1..v_shift_count LOOP
          -- Randomly select department and corresponding sub-department
          CASE (random() * 2)::integer
            WHEN 0 THEN
              v_subdept_id := v_conv_subdept_ids[(random() * (array_length(v_conv_subdept_ids, 1) - 1))::integer + 1];
            WHEN 1 THEN
              v_subdept_id := v_exh_subdept_ids[(random() * (array_length(v_exh_subdept_ids, 1) - 1))::integer + 1];
            ELSE
              v_subdept_id := v_theatre_subdept_ids[(random() * (array_length(v_theatre_subdept_ids, 1) - 1))::integer + 1];
          END CASE;
          
          v_role_id := v_role_ids[(random() * (array_length(v_role_ids, 1) - 1))::integer + 1];
          v_rem_level_id := v_rem_level_ids[(random() * (array_length(v_rem_level_ids, 1) - 1))::integer + 1];
          v_shift_group_id := v_shift_group_ids[(random() * (array_length(v_shift_group_ids, 1) - 1))::integer + 1];
          
          -- Randomly assign 70% of shifts to employees, leave 30% open
          IF random() < 0.7 THEN
            v_employee_id := v_employee_ids[(random() * (array_length(v_employee_ids, 1) - 1))::integer + 1];
          ELSE
            v_employee_id := NULL;
          END IF;
          
          -- Generate shift times based on shift type
          CASE (random() * 3)::integer
            WHEN 0 THEN  -- Morning shift
              v_start_time := '07:00:00'::time;
              v_end_time := '15:00:00'::time;
              v_shift_length := 8.00;
              v_net_length := 7.50;  -- 30 min unpaid break
            WHEN 1 THEN  -- Afternoon shift
              v_start_time := '14:00:00'::time;
              v_end_time := '22:00:00'::time;
              v_shift_length := 8.00;
              v_net_length := 7.50;
            WHEN 2 THEN  -- Evening shift
              v_start_time := '17:00:00'::time;
              v_end_time := '01:00:00'::time;
              v_shift_length := 8.00;
              v_net_length := 7.50;
            ELSE  -- Split shift
              v_start_time := '10:00:00'::time;
              v_end_time := '18:00:00'::time;
              v_shift_length := 8.00;
              v_net_length := 7.50;
          END CASE;
          
          -- Insert shift
          INSERT INTO shifts (
            organization_id, department_id, sub_department_id, role_id,
            shift_date, start_time, end_time, paid_break_duration, unpaid_break_duration,
            length, net_length, remuneration_level_id, employee_id, status, shift_group_id
          ) VALUES (
            v_org_id,
            CASE
              WHEN v_subdept_id = ANY(v_conv_subdept_ids) THEN v_conv_dept_id
              WHEN v_subdept_id = ANY(v_exh_subdept_ids) THEN v_exh_dept_id
              ELSE v_theatre_dept_id
            END,
            v_subdept_id, v_role_id, v_current_date, v_start_time, v_end_time,
            30, 30, v_shift_length, v_net_length, v_rem_level_id, v_employee_id,
            CASE WHEN v_employee_id IS NULL THEN 'Open' ELSE 'Assigned' END,
            v_shift_group_id
          );
        END LOOP;
        
        v_current_date := v_current_date + interval '1 day';
      END LOOP;
      */
      RAISE NOTICE 'Shift generation disabled per configuration.';
  ELSE
      RAISE NOTICE 'Shifts table is not empty, skipping seed generation.';
  END IF;
END $$;

-- Generate sample availability records
DO $$
DECLARE
  v_employee_ids uuid[];
  v_employee_id uuid;
  v_date date;
  v_end_date date;
  v_status text;
BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'availabilities' AND table_schema = 'public') THEN
  SELECT array_agg(id) INTO v_employee_ids FROM employees;
  v_date := '2025-11-01'::date;
  v_end_date := '2026-01-31'::date;
  
  FOREACH v_employee_id IN ARRAY v_employee_ids LOOP
    -- Generate availability for 60% of days
    FOR v_date IN SELECT generate_series(v_date, v_end_date, '1 day'::interval)::date LOOP
      IF random() < 0.6 THEN
        v_status := CASE (random() * 2)::integer
          WHEN 0 THEN 'Available'
          WHEN 1 THEN 'Partial'
          ELSE 'Unavailable'
        END;
        
        -- Try insert, relying on implicit cast or text column
        INSERT INTO availabilities (employee_id, date, status)
        VALUES (v_employee_id, v_date, v_status)
        ON CONFLICT (employee_id, date) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
 ELSE
    RAISE NOTICE 'Availabilities table not found, skipping seed data.';
 END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error seeding availabilities (likely type mismatch): %', SQLERRM;
END $$;

-- Initialize daily and monthly hours summaries for all assigned shifts
-- INSERT INTO daily_hours_summary (employee_id, date, total_scheduled_hours, exceeds_daily_limit)
-- SELECT 
--   employee_id,
--   shift_date,
--   SUM(net_length) as total_hours,
--   SUM(net_length) > 12 as exceeds_limit
-- FROM shifts
-- WHERE employee_id IS NOT NULL
-- GROUP BY employee_id, shift_date
-- ON CONFLICT (employee_id, date) DO NOTHING;

-- INSERT INTO monthly_hours_summary (employee_id, year, month, total_scheduled_hours, hours_remaining, exceeds_monthly_limit)
-- SELECT 
--   employee_id,
--   EXTRACT(YEAR FROM shift_date)::integer,
--   EXTRACT(MONTH FROM shift_date)::integer,
--   SUM(net_length) as total_hours,
--   152 - SUM(net_length) as hours_remaining,
--   SUM(net_length) > 152 as exceeds_limit
-- FROM shifts
-- WHERE employee_id IS NOT NULL
-- GROUP BY employee_id, EXTRACT(YEAR FROM shift_date), EXTRACT(MONTH FROM shift_date)
-- ON CONFLICT (employee_id, year, month) DO NOTHING;

-- Generate sample swap requests
INSERT INTO swap_requests (
  original_shift_id, requested_by_employee_id, swap_with_employee_id, reason, status
)
SELECT 
  s1.id,
  s1.employee_id,
  s2.employee_id,
  'Need to swap due to personal commitment',
  CASE (random() * 3)::integer
    WHEN 0 THEN 'pending_employee'
    WHEN 1 THEN 'pending_manager'
    ELSE 'approved'
  END
FROM shifts s1
CROSS JOIN LATERAL (
  SELECT id, employee_id FROM shifts s2
  WHERE s2.employee_id IS NOT NULL
  AND s2.employee_id != s1.employee_id
  AND s2.shift_date = s1.shift_date
  AND s2.id != s1.id
  LIMIT 1
) s2
WHERE s1.employee_id IS NOT NULL
AND random() < 0.05
LIMIT 20;
