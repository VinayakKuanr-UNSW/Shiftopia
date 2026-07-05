-- ===== hr cutover PHASE 4a (part 2): migrate remaining DB readers to hr.roles =====
-- Applied to prod (srfozdlphoempdattvtx) 2026-07-01 via MCP apply_migration.

-- RLS policy on role_ml_class_map referenced public.roles (+ sub_department_id).
-- Move to hr.roles (uses subdepartment_id). This also removes the hard dependency
-- that would otherwise block DROP TABLE public.roles.
DROP POLICY IF EXISTS authenticated_update_role_ml_class_map ON public.role_ml_class_map;
CREATE POLICY authenticated_update_role_ml_class_map ON public.role_ml_class_map
  FOR UPDATE TO authenticated
  USING (EXISTS ( SELECT 1 FROM hr.roles r
                  WHERE r.id = role_ml_class_map.role_id
                    AND user_has_action_in_scope('shift.edit'::text, NULL::uuid, r.department_id, r.subdepartment_id)))
  WITH CHECK (EXISTS ( SELECT 1 FROM hr.roles r
                       WHERE r.id = role_ml_class_map.role_id
                         AND user_has_action_in_scope('shift.edit'::text, NULL::uuid, r.department_id, r.subdepartment_id)));

-- capture_roster_as_template (auth.uid overload) joins roles for role_name -> hr.roles.
CREATE OR REPLACE FUNCTION public.capture_roster_as_template(p_start_date date, p_end_date date, p_sub_department_id uuid, p_template_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
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
  v_group_idx      int := 0;
  v_subgroup_idx   int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app_access_certificates aac
    JOIN sub_departments sd ON sd.id = p_sub_department_id
    JOIN departments     d  ON d.id  = sd.department_id
    WHERE aac.user_id         = v_user_id
      AND aac.is_active       = true
      AND (aac.organization_id = d.organization_id OR aac.organization_id IS NULL)
      AND (
        aac.sub_department_id = p_sub_department_id
        OR (aac.sub_department_id IS NULL AND aac.department_id = sd.department_id)
        OR (aac.sub_department_id IS NULL AND aac.department_id IS NULL)
      )
  ) THEN
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

  IF p_end_date < p_start_date THEN RAISE EXCEPTION 'INVALID_DATE_RANGE'; END IF;
  IF (p_end_date - p_start_date) > 35 THEN RAISE EXCEPTION 'DATE_RANGE_TOO_LARGE'; END IF;

  v_name_len := char_length(trim(p_template_name));
  IF v_name_len < 3 OR v_name_len > 100 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;

  SELECT COUNT(*) INTO v_dupe_count
  FROM roster_templates
  WHERE sub_department_id = p_sub_department_id
    AND name = trim(p_template_name)
    AND status != 'archived'
    AND (is_active IS NULL OR is_active = true);
  IF v_dupe_count > 0 THEN RAISE EXCEPTION 'DUPLICATE_TEMPLATE_NAME'; END IF;

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
    s.required_skills, s.required_licenses, s.tags, s.event_tags, s.notes,
    s.group_type::text AS group_type
  FROM shifts s
  LEFT JOIN hr.roles r ON r.id = s.role_id
  WHERE s.sub_department_id = p_sub_department_id
    AND s.shift_date BETWEEN p_start_date AND p_end_date
    AND s.deleted_at IS NULL
    AND (s.lifecycle_status IS NULL OR s.lifecycle_status != 'Cancelled')
  ORDER BY s.shift_date, s.start_time;

  SELECT COUNT(*) INTO v_shift_count FROM _capture_shifts;
  IF v_shift_count = 0 THEN RAISE EXCEPTION 'NO_SHIFTS_IN_RANGE'; END IF;

  SELECT organization_id, department_id INTO v_org_id, v_dept_id FROM _capture_shifts LIMIT 1;
  IF v_org_id IS NULL OR v_dept_id IS NULL THEN
    RAISE EXCEPTION 'ORG_DEPT_MISSING_IN_SHIFTS: Shift % has org: %, dept: %',
      (SELECT id FROM _capture_shifts LIMIT 1), v_org_id, v_dept_id;
  END IF;

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

  SELECT ARRAY_AGG(DISTINCT COALESCE(group_type, 'default') ORDER BY COALESCE(group_type, 'default'))
  INTO v_group_types FROM _capture_shifts;

  v_group_idx := 0;
  FOREACH v_group_type IN ARRAY v_group_types LOOP
    v_group_color := '#64748b';
    INSERT INTO template_groups (template_id, name, color, sort_order)
    VALUES (v_template_id, v_group_type, v_group_color, v_group_idx)
    RETURNING id INTO v_group_id;
    v_group_idx := v_group_idx + 1;

    SELECT ARRAY_AGG(DISTINCT COALESCE(roster_subgroup_id::text, 'default_' || v_group_type)
                     ORDER BY COALESCE(roster_subgroup_id::text, 'default_' || v_group_type))
    INTO v_subgroup_keys FROM _capture_shifts WHERE COALESCE(group_type, 'default') = v_group_type;

    v_subgroup_idx := 0;
    FOREACH v_subgroup_key IN ARRAY v_subgroup_keys LOOP
      v_rsg_id := NULL; v_subgroup_name := 'Default';
      IF v_subgroup_key NOT LIKE 'default_%' THEN
        BEGIN v_rsg_id := v_subgroup_key::uuid; EXCEPTION WHEN others THEN v_rsg_id := NULL; END;
      END IF;
      IF v_rsg_id IS NOT NULL THEN
        SELECT name INTO v_subgroup_name FROM roster_subgroups WHERE id = v_rsg_id LIMIT 1;
        IF NOT FOUND THEN v_subgroup_name := 'Default'; END IF;
      END IF;

      INSERT INTO template_subgroups (group_id, name, sort_order)
      VALUES (v_group_id, v_subgroup_name, v_subgroup_idx)
      RETURNING id INTO v_subgroup_id;
      v_subgroup_idx := v_subgroup_idx + 1;

      INSERT INTO template_shifts (
        subgroup_id, name, role_id, role_name, start_time, end_time,
        paid_break_minutes, unpaid_break_minutes, net_length_hours,
        required_skills, required_licenses, site_tags, event_tags,
        notes, day_of_week, assigned_employee_id, assigned_employee_name, sort_order
      )
      SELECT
        v_subgroup_id, NULL, cs.role_id, cs.role_name, cs.start_time, cs.end_time,
        COALESCE(cs.paid_break_minutes, 0), COALESCE(cs.unpaid_break_minutes, 0),
        ROUND(COALESCE(cs.net_length_minutes, 0)::numeric / 60.0, 2),
        (SELECT ARRAY(SELECT jsonb_array_elements_text(COALESCE(cs.required_skills, '[]'::jsonb)))),
        (SELECT ARRAY(SELECT jsonb_array_elements_text(COALESCE(cs.required_licenses, '[]'::jsonb)))),
        (SELECT ARRAY(SELECT jsonb_array_elements_text(COALESCE(cs.tags, '[]'::jsonb)))),
        (SELECT ARRAY(SELECT jsonb_array_elements_text(COALESCE(cs.event_tags, '[]'::jsonb)))),
        cs.notes, EXTRACT(DOW FROM cs.shift_date)::int, NULL, NULL,
        ROW_NUMBER() OVER (ORDER BY cs.shift_date, cs.start_time) - 1
      FROM _capture_shifts cs
      WHERE COALESCE(cs.group_type, 'default') = v_group_type
        AND COALESCE(cs.roster_subgroup_id::text, 'default_' || v_group_type) = v_subgroup_key;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('template_id', v_template_id, 'shifts_captured', v_shift_count);
END;
$function$;
