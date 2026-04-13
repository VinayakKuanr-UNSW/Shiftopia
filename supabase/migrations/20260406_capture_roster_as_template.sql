-- Migration: capture_roster_as_template
-- Feature: "Capture Template from Date Range"
-- Adds created_from column and the capture RPC function.

ALTER TABLE roster_templates
  ADD COLUMN IF NOT EXISTS created_from text,
  ADD COLUMN IF NOT EXISTS applied_count int DEFAULT 0;

-- Align template_shifts schema with codebase types
ALTER TABLE template_shifts
  ADD COLUMN IF NOT EXISTS role_name text,
  ADD COLUMN IF NOT EXISTS net_length_hours numeric(10,2);

-- Issue 8: constrain created_from to known values
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_created_from'
      AND conrelid = 'roster_templates'::regclass
  ) THEN
    ALTER TABLE roster_templates
      ADD CONSTRAINT chk_created_from
      CHECK (created_from IN ('capture', 'manual', 'import'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION capture_roster_as_template(
  p_start_date        date,
  p_end_date          date,
  p_sub_department_id uuid,
  p_template_name     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Issue 2: use auth.uid() instead of p_user_id parameter
  v_user_id        uuid;
  v_name_len       int;
  v_dupe_count     int;
  v_shift_count    int := 0;
  v_org_id         uuid;
  v_dept_id        uuid;
  v_template_id    uuid;
  v_group_type     text;
  v_group_id       uuid;
  v_group_color    text;
  v_subgroup_key   text;
  v_subgroup_id    uuid;
  v_subgroup_name  text;
  v_rsg_id         uuid;
  v_group_types    text[];
  v_subgroup_keys  text[];
  -- Issue 5: sort_order counters
  v_group_idx      int := 0;
  v_subgroup_idx   int;
BEGIN
  -- Issue 2: resolve caller identity
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  -- Issue 1: authorization check
  IF NOT EXISTS (
    SELECT 1
    FROM app_access_certificates aac
    JOIN sub_departments sd ON sd.id = p_sub_department_id
    JOIN departments     d  ON d.id  = sd.department_id
    WHERE aac.user_id         = v_user_id
      AND aac.is_active       = true
      AND aac.organization_id = d.organization_id
      AND (
        aac.sub_department_id = p_sub_department_id          -- gamma: direct subdept
        OR (aac.sub_department_id IS NULL
            AND aac.department_id = sd.department_id)        -- delta: dept-level
        OR (aac.sub_department_id IS NULL
            AND aac.department_id IS NULL)                   -- epsilon/zeta: org-level
      )
  ) THEN
    -- Provide diagnostic info to identify why auth is failing
    DECLARE
      v_diag_org_id uuid;
      v_diag_dept_id uuid;
      v_cert_count int;
    BEGIN
      SELECT organization_id, id INTO v_diag_org_id, v_diag_dept_id
      FROM departments
      WHERE id = (SELECT department_id FROM sub_departments WHERE id = p_sub_department_id);

      SELECT COUNT(*) INTO v_cert_count FROM app_access_certificates WHERE user_id = v_user_id AND is_active = true;

      RAISE EXCEPTION 'UNAUTHORIZED: User % lacks required cert. sd: %, d_org: %, certs_found: %',
        v_user_id, p_sub_department_id, v_diag_org_id, v_cert_count;
    END;
  END IF;

  -- 1. Validate date range
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE';
  END IF;

  -- Issue 4: enforce maximum date range
  IF (p_end_date - p_start_date) > 35 THEN
    RAISE EXCEPTION 'DATE_RANGE_TOO_LARGE';
  END IF;

  -- 2. Validate name length
  v_name_len := char_length(trim(p_template_name));
  IF v_name_len < 3 OR v_name_len > 100 THEN
    RAISE EXCEPTION 'INVALID_NAME';
  END IF;

  -- 3. Check for duplicate name in same subdepartment
  SELECT COUNT(*) INTO v_dupe_count
  FROM roster_templates
  WHERE sub_department_id = p_sub_department_id
    AND name = trim(p_template_name)
    AND status != 'archived'
    AND (is_active IS NULL OR is_active = true);

  IF v_dupe_count > 0 THEN
    RAISE EXCEPTION 'DUPLICATE_TEMPLATE_NAME';
  END IF;

  -- 4. Collect candidate shifts into a temp table
  DROP TABLE IF EXISTS _capture_shifts;
  CREATE TEMP TABLE _capture_shifts ON COMMIT DROP AS
  SELECT
    s.id, s.organization_id, s.department_id, s.sub_department_id,
    s.shift_date, s.start_time, s.end_time,
    s.role_id, r.name AS role_name,
    s.paid_break_minutes, s.unpaid_break_minutes,
    s.net_length_minutes,
    s.assigned_employee_id,
    s.lifecycle_status,
    s.roster_subgroup_id,
    s.required_skills, s.notes,
    s.group_type::text AS group_type
  FROM shifts s
  LEFT JOIN roles r ON r.id = s.role_id
  WHERE s.sub_department_id = p_sub_department_id
    AND s.shift_date BETWEEN p_start_date AND p_end_date
    AND s.deleted_at IS NULL
    AND (s.lifecycle_status IS NULL OR s.lifecycle_status != 'Cancelled')
  ORDER BY s.shift_date, s.start_time;

  SELECT COUNT(*) INTO v_shift_count FROM _capture_shifts;

  IF v_shift_count = 0 THEN
    RAISE EXCEPTION 'NO_SHIFTS_IN_RANGE';
  END IF;

  -- 5. Derive org/dept from first shift
  SELECT organization_id, department_id
  INTO v_org_id, v_dept_id
  FROM _capture_shifts
  LIMIT 1;

  IF v_org_id IS NULL OR v_dept_id IS NULL THEN
    RAISE EXCEPTION 'ORG_DEPT_MISSING_IN_SHIFTS: Shift % has org: %, dept: %',
      (SELECT id FROM _capture_shifts LIMIT 1), v_org_id, v_dept_id;
  END IF;

  -- 6. Insert template record (draft)
  INSERT INTO roster_templates (
    name, status, organization_id, department_id, sub_department_id,
    start_date, end_date, created_by, last_edited_by, created_from,
    version, applied_count, is_active, is_base_template
  ) VALUES (
    trim(p_template_name), 'draft', v_org_id, v_dept_id, p_sub_department_id,
    p_start_date, p_end_date, v_user_id, v_user_id, 'capture',
    1, 0, true, false
  )
  RETURNING id INTO v_template_id;

  -- 7. Collect distinct group_types
  SELECT ARRAY_AGG(DISTINCT COALESCE(group_type, 'default')
                   ORDER BY COALESCE(group_type, 'default'))
  INTO v_group_types
  FROM _capture_shifts;

  -- 8. Build groups → subgroups → shifts
  v_group_idx := 0;
  FOREACH v_group_type IN ARRAY v_group_types LOOP
    -- Issue 6: single neutral default color for all group types
    v_group_color := '#64748b';

    -- Issue 5: use v_group_idx as sort_order for the group
    INSERT INTO template_groups (template_id, name, color, sort_order)
    VALUES (v_template_id, v_group_type, v_group_color, v_group_idx)
    RETURNING id INTO v_group_id;

    v_group_idx := v_group_idx + 1;

    -- Distinct subgroups within this group_type
    SELECT ARRAY_AGG(DISTINCT COALESCE(roster_subgroup_id::text, 'default_' || v_group_type)
                     ORDER BY COALESCE(roster_subgroup_id::text, 'default_' || v_group_type))
    INTO v_subgroup_keys
    FROM _capture_shifts
    WHERE COALESCE(group_type, 'default') = v_group_type;

    -- Issue 5: reset subgroup counter per group
    v_subgroup_idx := 0;
    FOREACH v_subgroup_key IN ARRAY v_subgroup_keys LOOP
      -- Resolve subgroup name from roster_subgroups if possible
      v_rsg_id := NULL;
      v_subgroup_name := 'Default';

      IF v_subgroup_key NOT LIKE 'default_%' THEN
        BEGIN
          v_rsg_id := v_subgroup_key::uuid;
        EXCEPTION WHEN others THEN
          v_rsg_id := NULL;
        END;
      END IF;

      IF v_rsg_id IS NOT NULL THEN
        SELECT name INTO v_subgroup_name
        FROM roster_subgroups WHERE id = v_rsg_id LIMIT 1;
        IF NOT FOUND THEN v_subgroup_name := 'Default'; END IF;
      END IF;

      -- Issue 5: use v_subgroup_idx as sort_order for the subgroup
      INSERT INTO template_subgroups (group_id, name, sort_order)
      VALUES (v_group_id, v_subgroup_name, v_subgroup_idx)
      RETURNING id INTO v_subgroup_id;

      v_subgroup_idx := v_subgroup_idx + 1;

      -- Insert template_shifts (strip employee assignment)
      -- Issue 5: use ROW_NUMBER() for shift sort_order
      INSERT INTO template_shifts (
        subgroup_id, name, role_id, role_name,
        start_time, end_time,
        paid_break_minutes, unpaid_break_minutes,
        net_length_hours,
        required_skills, notes, day_of_week,
        assigned_employee_id, assigned_employee_name, sort_order
      )
      SELECT
        v_subgroup_id,
        NULL,
        cs.role_id,
        cs.role_name,
        cs.start_time,
        cs.end_time,
        COALESCE(cs.paid_break_minutes, 0),
        COALESCE(cs.unpaid_break_minutes, 0),
        ROUND(COALESCE(cs.net_length_minutes, 0)::numeric / 60.0, 2),
        COALESCE(cs.required_skills, '{}'),
        cs.notes,
        EXTRACT(DOW FROM cs.shift_date)::int,
        NULL,
        NULL,
        ROW_NUMBER() OVER (ORDER BY cs.shift_date, cs.start_time) - 1
      FROM _capture_shifts cs
      WHERE COALESCE(cs.group_type, 'default') = v_group_type
        AND COALESCE(cs.roster_subgroup_id::text, 'default_' || v_group_type) = v_subgroup_key;

    END LOOP; -- subgroups
  END LOOP; -- group_types

  RETURN jsonb_build_object(
    'template_id', v_template_id,
    'shifts_captured', v_shift_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION capture_roster_as_template(date, date, uuid, text) TO authenticated;
