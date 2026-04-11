-- Migration: capture_roster_as_template
-- Feature: "Capture Template from Date Range"
-- Adds created_from column and the capture RPC function.

ALTER TABLE roster_templates
  ADD COLUMN IF NOT EXISTS created_from text,
  ADD COLUMN IF NOT EXISTS applied_count int DEFAULT 0;

CREATE OR REPLACE FUNCTION capture_roster_as_template(
  p_start_date        date,
  p_end_date          date,
  p_sub_department_id uuid,
  p_template_name     text,
  p_user_id           uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
BEGIN
  -- 1. Validate date range
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE';
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
  CREATE TEMP TABLE _capture_shifts ON COMMIT DROP AS
  SELECT *
  FROM shifts
  WHERE sub_department_id = p_sub_department_id
    AND shift_date BETWEEN p_start_date AND p_end_date
    AND (is_cancelled IS NULL OR is_cancelled = false)
    AND deleted_at IS NULL
    AND lifecycle_status != 'Cancelled'
  ORDER BY shift_date, start_time;

  SELECT COUNT(*) INTO v_shift_count FROM _capture_shifts;

  IF v_shift_count = 0 THEN
    RAISE EXCEPTION 'NO_SHIFTS_IN_RANGE';
  END IF;

  -- 5. Derive org/dept from first shift
  SELECT organization_id, department_id
  INTO v_org_id, v_dept_id
  FROM _capture_shifts LIMIT 1;

  -- 6. Insert template record (draft)
  INSERT INTO roster_templates (
    name, status, organization_id, department_id, sub_department_id,
    start_date, end_date, created_by, last_edited_by, created_from,
    version, applied_count, is_active, is_base_template
  ) VALUES (
    trim(p_template_name), 'draft', v_org_id, v_dept_id, p_sub_department_id,
    p_start_date, p_end_date, p_user_id, p_user_id, 'capture',
    1, 0, true, false
  )
  RETURNING id INTO v_template_id;

  -- 7. Collect distinct group_types
  SELECT ARRAY_AGG(DISTINCT COALESCE(group_type, 'default')
                   ORDER BY COALESCE(group_type, 'default'))
  INTO v_group_types
  FROM _capture_shifts;

  -- 8. Build groups → subgroups → shifts
  FOREACH v_group_type IN ARRAY v_group_types LOOP
    v_group_color := CASE v_group_type
      WHEN 'convention_centre' THEN '#6366f1'
      WHEN 'exhibition_centre' THEN '#f59e0b'
      WHEN 'theatre'           THEN '#10b981'
      ELSE                          '#64748b'
    END;

    INSERT INTO template_groups (template_id, name, color, sort_order)
    VALUES (v_template_id, v_group_type, v_group_color, 0)
    RETURNING id INTO v_group_id;

    -- Distinct subgroups within this group_type
    SELECT ARRAY_AGG(DISTINCT COALESCE(roster_subgroup_id::text, 'default_' || v_group_type)
                     ORDER BY COALESCE(roster_subgroup_id::text, 'default_' || v_group_type))
    INTO v_subgroup_keys
    FROM _capture_shifts
    WHERE COALESCE(group_type, 'default') = v_group_type;

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

      INSERT INTO template_subgroups (group_id, name, sort_order)
      VALUES (v_group_id, v_subgroup_name, 0)
      RETURNING id INTO v_subgroup_id;

      -- Insert template_shifts (strip employee assignment)
      INSERT INTO template_shifts (
        subgroup_id, name, role_id, role_name,
        start_time, end_time,
        paid_break_minutes, unpaid_break_minutes,
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
        COALESCE(cs.required_skills, '{}'),
        cs.notes,
        EXTRACT(DOW FROM cs.shift_date)::int,
        NULL,
        NULL,
        0
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

GRANT EXECUTE ON FUNCTION capture_roster_as_template(date, date, uuid, text, uuid) TO authenticated;
