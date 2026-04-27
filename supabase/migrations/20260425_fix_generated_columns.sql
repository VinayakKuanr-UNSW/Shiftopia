-- Fix State Machine functions to remove explicit updates/inserts to generated columns (is_draft, is_published)

-- 1. Fix apply_template_to_date_range
CREATE OR REPLACE FUNCTION public.apply_template_to_date_range(p_template_id uuid, p_start_date date, p_end_date date, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_curr_date DATE;
  v_template RECORD;
  v_roster_id UUID;
  v_groups_json JSONB;
  v_group JSONB;
  v_subgroup JSONB;
  v_shift JSONB;
  v_days_processed INTEGER := 0;
  v_shifts_created INTEGER := 0;
BEGIN
  -- 1. Validation
  IF p_start_date > p_end_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'Start date must be before end date');
  END IF;

  -- 2. Get Template
  SELECT * INTO v_template FROM v_template_full WHERE id = p_template_id;
  IF v_template IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Template not found');
  END IF;

  -- 3. Get the groups JSON from template
  v_groups_json := COALESCE(v_template.groups::jsonb, '[]'::jsonb);

  -- 4. Loop through each day
  v_curr_date := p_start_date;
  WHILE v_curr_date <= p_end_date LOOP
      IF v_curr_date < CURRENT_DATE THEN
          v_curr_date := v_curr_date + 1;
          CONTINUE;
      END IF;

      BEGIN
          INSERT INTO rosters (start_date, end_date, template_id, organization_id, department_id, sub_department_id, description, status, is_locked, created_by)
          VALUES (v_curr_date, v_curr_date, p_template_id, v_template.organization_id, v_template.department_id, v_template.sub_department_id, v_template.description, 'draft', false, p_user_id)
          RETURNING id INTO v_roster_id;
      EXCEPTION WHEN unique_violation THEN
          SELECT id INTO v_roster_id FROM rosters WHERE start_date = v_curr_date AND department_id = v_template.department_id AND (sub_department_id IS NULL OR sub_department_id = v_template.sub_department_id);
      END;

      FOR v_group IN SELECT * FROM jsonb_array_elements(v_groups_json) LOOP
          IF v_group->'subGroups' IS NOT NULL AND jsonb_typeof(v_group->'subGroups') = 'array' THEN
              FOR v_subgroup IN SELECT * FROM jsonb_array_elements(v_group->'subGroups') LOOP
                  IF v_subgroup->'shifts' IS NOT NULL AND jsonb_typeof(v_subgroup->'shifts') = 'array' THEN
                      FOR v_shift IN SELECT * FROM jsonb_array_elements(v_subgroup->'shifts') LOOP
                          IF NOT EXISTS (SELECT 1 FROM shifts WHERE roster_id = v_roster_id AND template_id = p_template_id AND template_instance_id = (v_shift->>'id')::uuid AND shift_date = v_curr_date AND deleted_at IS NULL) THEN
                              INSERT INTO shifts (
                                  roster_id, organization_id, department_id, sub_department_id, role_id, shift_date, start_time, end_time, 
                                  paid_break_minutes, unpaid_break_minutes, template_id, template_instance_id, is_from_template, 
                                  group_type, sub_group_name, template_group, template_sub_group, lifecycle_status, notes, assigned_employee_id
                              )
                              VALUES (
                                  v_roster_id, v_template.organization_id, v_template.department_id, v_template.sub_department_id, (v_shift->>'roleId')::uuid, v_curr_date, (v_shift->>'startTime')::time, (v_shift->>'endTime')::time,
                                  COALESCE((v_shift->>'paidBreakDuration')::integer, 0), COALESCE((v_shift->>'unpaidBreakDuration')::integer, 0), p_template_id, (v_shift->>'id')::uuid, true,
                                  CASE LOWER(REPLACE(v_group->>'name', ' ', '_'))
                                      WHEN 'convention_centre' THEN 'convention_centre'::template_group_type
                                      WHEN 'exhibition_centre' THEN 'exhibition_centre'::template_group_type
                                      WHEN 'theatre' THEN 'theatre'::template_group_type
                                      ELSE NULL
                                  END,
                                  v_subgroup->>'name',
                                  CASE LOWER(REPLACE(v_group->>'name', ' ', '_'))
                                      WHEN 'convention_centre' THEN 'convention_centre'::template_group_type
                                      WHEN 'exhibition_centre' THEN 'exhibition_centre'::template_group_type
                                      WHEN 'theatre' THEN 'theatre'::template_group_type
                                      ELSE NULL
                                  END,
                                  v_subgroup->>'name',
                                  'Draft', -- is_draft is generated from this
                                  v_shift->>'notes',
                                  CASE WHEN v_shift->>'assignedEmployeeId' IS NOT NULL AND v_shift->>'assignedEmployeeId' != '' AND v_shift->>'assignedEmployeeId' != 'null' THEN (v_shift->>'assignedEmployeeId')::uuid ELSE NULL END
                              );
                              v_shifts_created := v_shifts_created + 1;
                          END IF;
                      END LOOP;
                  END IF;
              END LOOP;
          END IF;
      END LOOP;
      v_days_processed := v_days_processed + 1;
      v_curr_date := v_curr_date + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'days_processed', v_days_processed, 'shifts_created', v_shifts_created);
END;
$function$;

-- 2. Fix unpublish_roster_shift
CREATE OR REPLACE FUNCTION public.unpublish_roster_shift(p_roster_shift_id uuid, p_unpublished_by_user_id uuid, p_reason text)
 RETURNS public.publish_shift_result
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_result publish_shift_result;
    v_live_shift RECORD;
    v_can_unpublish BOOLEAN;
BEGIN
    v_result.roster_shift_id := p_roster_shift_id;
    SELECT s.*, rs.lifecycle as roster_lifecycle FROM shifts s JOIN roster_shifts rs ON rs.id = s.roster_shift_id WHERE s.roster_shift_id = p_roster_shift_id AND s.deleted_at IS NULL INTO v_live_shift;
    
    IF v_live_shift IS NULL THEN
        v_result.success := FALSE; v_result.error_code := 'NO_PUBLISHED_SHIFT'; v_result.error_message := 'No published shift found'; v_result.action := 'skipped'; RETURN v_result;
    END IF;
    
    v_can_unpublish := v_live_shift.lifecycle_status IN ('Published') AND (v_live_shift.assignment_outcome IS NULL OR v_live_shift.assignment_outcome NOT IN ('confirmed', 'emergency_assigned'));
    IF NOT v_can_unpublish THEN
        v_result.success := FALSE; v_result.error_code := 'UNPUBLISH_NOT_ALLOWED'; v_result.error_message := format('Cannot unpublish shift in state: lifecycle=%s, outcome=%s', v_live_shift.lifecycle_status, v_live_shift.assignment_outcome); v_result.action := 'skipped'; RETURN v_result;
    END IF;
    
    v_result.from_state := CASE WHEN v_live_shift.bidding_status IN ('on_bidding_normal', 'on_bidding_urgent') THEN 'S5/S6' WHEN v_live_shift.assignment_outcome = 'offered' THEN 'S3' WHEN v_live_shift.bidding_status = 'bidding_closed_no_winner' THEN 'S8' ELSE 'UNKNOWN' END;
    
    UPDATE shifts SET
        lifecycle_status = 'Draft'::shift_lifecycle, -- is_draft and is_published are generated
        is_on_bidding = FALSE,
        bidding_status = 'not_on_bidding'::public.shift_bidding_status,
        assigned_employee_id = CASE WHEN v_live_shift.bidding_status IN ('on_bidding_normal', 'on_bidding_urgent', 'bidding_closed_no_winner') THEN NULL ELSE assigned_employee_id END,
        assignment_status = CASE WHEN v_live_shift.bidding_status IN ('on_bidding_normal', 'on_bidding_urgent', 'bidding_closed_no_winner') THEN 'unassigned'::shift_assignment_status ELSE 'assigned'::shift_assignment_status END,
        assignment_outcome = NULL, dropped_by_id = NULL, updated_at = NOW(), last_modified_by = p_unpublished_by_user_id, last_modified_reason = p_reason
    WHERE id = v_live_shift.id;
    
    UPDATE roster_shifts SET lifecycle = 'draft'::shift_lifecycle_status, published_at = NULL, published_by = NULL WHERE id = p_roster_shift_id;
    
    v_result.success := TRUE; v_result.shift_id := v_live_shift.id; v_result.action := 'unpublished'; v_result.to_state := CASE WHEN v_live_shift.bidding_status IN ('on_bidding_normal', 'on_bidding_urgent', 'bidding_closed_no_winner') THEN 'S1' ELSE 'S2' END;
    RETURN v_result;
END;
$function$;

-- 3. Fix push_shift_to_bidding_on_cancel
CREATE OR REPLACE FUNCTION public.push_shift_to_bidding_on_cancel(p_shift_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_shift RECORD;
    v_shift_start TIMESTAMPTZ;
    v_bidding_close_at TIMESTAMPTZ;
    v_is_urgent BOOLEAN;
BEGIN
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
    IF v_shift IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found'); END IF;
    v_shift_start := (v_shift.shift_date::TEXT || ' ' || v_shift.start_time::TEXT)::TIMESTAMP AT TIME ZONE 'Australia/Sydney';
    IF v_shift_start < NOW() THEN RETURN jsonb_build_object('success', false, 'error', 'Shift is in the past'); END IF;
    v_bidding_close_at := v_shift_start - INTERVAL '4 hours';
    IF v_bidding_close_at <= NOW() THEN RETURN jsonb_build_object('success', false, 'error', 'WINDOW_EXPIRED', 'message', 'Too late to open bidding (less than 4h). Emergency cover required.'); END IF;
    v_is_urgent := (v_shift_start - NOW()) < INTERVAL '24 hours';
    
    UPDATE shifts SET
        lifecycle_status = 'Published', -- is_published generated from this
        assigned_employee_id = NULL,
        assignment_status = 'unassigned',
        fulfillment_status = 'bidding',
        is_on_bidding = TRUE,
        bidding_enabled = TRUE,
        bidding_open_at = NOW(),
        bidding_close_at = v_bidding_close_at,
        is_urgent = v_is_urgent,
        cancellation_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_shift_id;
    
    RETURN jsonb_build_object('success', true, 'shift_id', p_shift_id, 'bidding_close_at', v_bidding_close_at, 'is_urgent', v_is_urgent);
END;
$function$;

-- 4. Fix cancel_shift
CREATE OR REPLACE FUNCTION public.cancel_shift(p_shift_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_shift RECORD;
    v_diff_hours NUMERIC;
    v_cancelled_at TIMESTAMPTZ;
    v_cancel_type TEXT;
    v_prev_status TEXT;
    v_new_status TEXT;
    v_closes_at TIMESTAMPTZ;
    v_window_id UUID;
    v_shift_start TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found'; END IF;
    v_shift_start := (v_shift.shift_date || ' ' || v_shift.start_time)::TIMESTAMPTZ;
    IF v_shift_start < NOW() THEN RAISE EXCEPTION 'Cannot cancel a shift that has already started'; END IF;
    v_cancelled_at := NOW();
    v_diff_hours := EXTRACT(EPOCH FROM (v_shift_start - v_cancelled_at)) / 3600;
    v_prev_status := v_shift.status;
    
    UPDATE public.shifts SET 
        is_cancelled = FALSE, assigned_employee_id = NULL, updated_at = NOW(),
        assignment_status_text = 'unassigned', assignment_method_text = NULL,
        assigned_at = NULL, cancellation_reason_text = p_reason, cancelled_at = v_cancelled_at, cancelled_by = auth.uid()
    WHERE id = p_shift_id;

    IF v_diff_hours > 24 THEN
        v_cancel_type := 'EARLY'; v_new_status := 'draft';
        UPDATE public.shifts SET status = 'draft', lifecycle_status = 'Draft', cancellation_type_text = 'standard' WHERE id = p_shift_id;
        PERFORM log_shift_event(p_shift_id, 'SHIFT_CANCELLED_EARLY', v_prev_status, 'draft', jsonb_build_object('reason', p_reason, 'diff_hours', v_diff_hours));
    ELSIF v_diff_hours > 4 THEN
        v_cancel_type := 'LATE_AUTO_BID'; v_new_status := 'open';
        v_closes_at := v_shift_start - INTERVAL '4 hours';
        INSERT INTO public.shift_bid_windows (shift_id, opens_at, closes_at, status) VALUES (p_shift_id, NOW(), v_closes_at, 'open') RETURNING id INTO v_window_id;
        UPDATE public.shifts SET bidding_enabled = TRUE, status = 'open', cancellation_type_text = 'late', bidding_priority_text = 'urgent' WHERE id = p_shift_id;
        PERFORM log_shift_event(p_shift_id, 'SHIFT_CANCELLED_LATE', v_prev_status, 'open', jsonb_build_object('reason', p_reason, 'diff_hours', v_diff_hours, 'urgency', 'URGENT'));
        PERFORM log_shift_event(p_shift_id, 'SHIFT_PUSHED_TO_BIDDING_URGENT', v_prev_status, 'open', NULL);
    ELSE
        v_cancel_type := 'MANAGER_REVIEW'; v_new_status := 'pending';
        UPDATE public.shifts SET status = 'pending', cancellation_type_text = 'critical' WHERE id = p_shift_id;
        PERFORM log_shift_event(p_shift_id, 'SHIFT_CANCELLED_CRITICAL', v_prev_status, 'pending', jsonb_build_object('reason', p_reason, 'diff_hours', v_diff_hours));
        PERFORM log_shift_event(p_shift_id, 'SHIFT_REQUIRES_MANAGER_REVIEW', v_prev_status, 'pending', NULL);
    END IF;
    
    RETURN jsonb_build_object('success', true, 'cancellation_type', v_cancel_type, 'new_status', v_new_status, 'window_id', v_window_id, 'final_shift_state', (SELECT to_jsonb(s) FROM public.shifts s WHERE id = p_shift_id));
END;
$function$;

-- 5. Fix publish_roster_shift
CREATE OR REPLACE FUNCTION public.publish_roster_shift(p_roster_shift_id uuid, p_published_by_user_id uuid, p_skip_compliance boolean DEFAULT false)
 RETURNS public.publish_shift_result
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_result publish_shift_result;
    v_validation shift_validation_result;
    v_compliance RECORD;
    v_context RECORD;
    v_target_state RECORD;
    v_existing_shift_id UUID;
    v_new_shift_id UUID;
    v_is_overnight BOOLEAN;
    v_scheduled_start TIMESTAMPTZ;
    v_scheduled_end TIMESTAMPTZ;
    v_hours_until_start NUMERIC;
    v_action TEXT;
    v_has_assignment BOOLEAN;
    v_is_confirmed BOOLEAN;
    v_from_state TEXT;
BEGIN
    v_result.roster_shift_id := p_roster_shift_id; v_result.success := FALSE;
    v_validation := validate_roster_shift_for_publish(p_roster_shift_id);
    IF NOT v_validation.is_valid THEN v_result.error_code := v_validation.error_code; v_result.error_message := v_validation.error_message; v_result.action := 'skipped'; RETURN v_result; END IF;
    
    SELECT rs.id as shift_id, rs.template_shift_id, rs.name, rs.role_id, rs.role_name, rs.remuneration_level_id, rs.remuneration_level, rs.start_time, rs.end_time, COALESCE(rs.paid_break_minutes, 0) as paid_break_minutes, COALESCE(rs.unpaid_break_minutes, 0) as unpaid_break_minutes, rs.net_hours, COALESCE(rs.required_skills, '{}'::TEXT[]) as required_skills, COALESCE(rs.required_licenses, '{}'::TEXT[]) as required_licenses, COALESCE(rs.site_tags, '{}'::TEXT[]) as site_tags, COALESCE(rs.event_tags, '{}'::TEXT[]) as event_tags, rs.notes, rs.sort_order, rs.lifecycle::TEXT as lifecycle, rsg.id as subgroup_id, rsg.name as subgroup_name, rg.id as group_id, rg.name as group_name, rd.id as roster_day_id, rd.date as roster_date, rd.organization_id, COALESCE(rd.department_id, rt.department_id) as department_id, COALESCE(rd.sub_department_id, rt.sub_department_id) as sub_department_id, rsa.employee_id as assigned_employee_id, rsa.status::TEXT as rsa_status, rsa.assigned_at, rsa.confirmed_at, rsa.assigned_by
    INTO v_context FROM roster_shifts rs JOIN roster_subgroups rsg ON rsg.id = rs.roster_subgroup_id JOIN roster_groups rg ON rg.id = rsg.roster_group_id JOIN roster_days rd ON rd.id = rg.roster_day_id LEFT JOIN roster_template_applications rta ON rta.roster_day_id = rd.id LEFT JOIN roster_templates rt ON rt.id = rta.template_id LEFT JOIN roster_shift_assignments rsa ON rsa.roster_shift_id = rs.id WHERE rs.id = p_roster_shift_id;
    IF v_context IS NULL THEN v_result.error_code := 'CONTEXT_RESOLVE_FAILED'; v_result.error_message := 'Failed to resolve shift context'; v_result.action := 'skipped'; RETURN v_result; END IF;
    
    v_has_assignment := v_context.assigned_employee_id IS NOT NULL; v_is_confirmed := v_context.confirmed_at IS NOT NULL;
    v_from_state := get_roster_shift_state(v_context.lifecycle, v_has_assignment, v_is_confirmed); v_result.from_state := v_from_state;
    
    IF v_has_assignment AND NOT p_skip_compliance THEN
        SELECT * INTO v_compliance FROM check_shift_compliance(p_roster_shift_id, v_context.assigned_employee_id);
        IF v_compliance.compliance_status = 'blocked' THEN v_result.error_code := 'COMPLIANCE_BLOCKED'; v_result.error_message := 'Compliance check failed: ' || v_compliance.violations::TEXT; v_result.action := 'skipped'; RETURN v_result; END IF;
    END IF;
    
    v_is_overnight := v_context.end_time < v_context.start_time; v_scheduled_start := (v_context.roster_date + v_context.start_time)::TIMESTAMPTZ;
    IF v_is_overnight THEN v_scheduled_end := (v_context.roster_date + INTERVAL '1 day' + v_context.end_time)::TIMESTAMPTZ; ELSE v_scheduled_end := (v_context.roster_date + v_context.end_time)::TIMESTAMPTZ; END IF;
    v_hours_until_start := EXTRACT(EPOCH FROM (v_scheduled_start - NOW())) / 3600;
    
    SELECT * INTO v_target_state FROM get_publish_target_state(v_has_assignment, v_is_confirmed, v_hours_until_start);
    v_result.to_state := v_target_state.state_id;
    
    SELECT id INTO v_existing_shift_id FROM shifts WHERE roster_shift_id = p_roster_shift_id AND deleted_at IS NULL;
    
    IF v_existing_shift_id IS NOT NULL THEN
        UPDATE shifts SET
            shift_date = v_context.roster_date, roster_date = v_context.roster_date, start_time = v_context.start_time, end_time = v_context.end_time,
            scheduled_start = v_scheduled_start, scheduled_end = v_scheduled_end, is_overnight = v_is_overnight, paid_break_minutes = v_context.paid_break_minutes, unpaid_break_minutes = v_context.unpaid_break_minutes,
            role_id = v_context.role_id, remuneration_level_id = v_context.remuneration_level_id, sub_group_name = v_context.subgroup_name, shift_group_id = v_context.group_id, shift_subgroup_id = v_context.subgroup_id, display_order = v_context.sort_order,
            required_skills = to_jsonb(v_context.required_skills), required_licenses = to_jsonb(v_context.required_licenses), event_tags = to_jsonb(v_context.event_tags), tags = to_jsonb(v_context.site_tags), notes = v_context.notes,
            assigned_employee_id = v_context.assigned_employee_id, assigned_at = v_context.assigned_at, assignment_status = v_target_state.assignment_status, assignment_outcome = v_target_state.assignment_outcome, fulfillment_status = v_target_state.fulfillment_status,
            is_on_bidding = v_target_state.bidding_status IN ('on_bidding_normal', 'on_bidding_urgent'), bidding_status = v_target_state.bidding_status,
            bidding_open_at = CASE WHEN v_target_state.bidding_status IN ('on_bidding_normal', 'on_bidding_urgent') AND bidding_open_at IS NULL THEN NOW() WHEN v_target_state.bidding_status = 'not_on_bidding' THEN NULL ELSE bidding_open_at END,
            eligibility_snapshot = CASE WHEN v_has_assignment THEN v_compliance.eligibility_snapshot ELSE NULL END, compliance_checked_at = CASE WHEN v_has_assignment THEN NOW() ELSE NULL END,
            published_at = NOW(), published_by_user_id = p_published_by_user_id, lifecycle_status = v_target_state.lifecycle_status,
            is_from_template = v_context.template_shift_id IS NOT NULL, template_id = v_context.template_shift_id,
            updated_at = NOW(), last_modified_by = p_published_by_user_id, last_modified_reason = format('Published: %s → %s', v_from_state, v_target_state.state_id), version = version + 1
        WHERE id = v_existing_shift_id;
        v_new_shift_id := v_existing_shift_id; v_action := 'updated';
    ELSE
        INSERT INTO shifts (
            roster_shift_id, organization_id, department_id, sub_department_id, roster_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, is_overnight, paid_break_minutes, unpaid_break_minutes, timezone, role_id, remuneration_level_id, sub_group_name, shift_group_id, shift_subgroup_id, display_order, required_skills, required_licenses, event_tags, tags, notes, assigned_employee_id, assigned_at, assignment_status, assignment_outcome, fulfillment_status, is_on_bidding, bidding_status, bidding_open_at, trading_status, attendance_status, eligibility_snapshot, compliance_checked_at, published_at, published_by_user_id, lifecycle_status, is_from_template, template_id, created_by_user_id, created_at
        )
        VALUES (
            p_roster_shift_id, v_context.organization_id, v_context.department_id, v_context.sub_department_id, v_context.roster_day_id, v_context.roster_date, v_context.roster_date, v_context.start_time, v_context.end_time, v_scheduled_start, v_scheduled_end, v_is_overnight, v_context.paid_break_minutes, v_context.unpaid_break_minutes, 'Australia/Sydney', v_context.role_id, v_context.remuneration_level_id, v_context.subgroup_name, v_context.group_id, v_context.subgroup_id, v_context.sort_order, to_jsonb(v_context.required_skills), to_jsonb(v_context.required_licenses), to_jsonb(v_context.event_tags), to_jsonb(v_context.site_tags), v_context.notes, v_context.assigned_employee_id, v_context.assigned_at, v_target_state.assignment_status, v_target_state.assignment_outcome, v_target_state.fulfillment_status, v_target_state.bidding_status IN ('on_bidding_normal', 'on_bidding_urgent'), v_target_state.bidding_status, CASE WHEN v_target_state.bidding_status IN ('on_bidding_normal', 'on_bidding_urgent') THEN NOW() ELSE NULL END, 'NoTrade'::shift_trading, 'unknown'::shift_attendance_status, CASE WHEN v_has_assignment THEN v_compliance.eligibility_snapshot ELSE NULL END, CASE WHEN v_has_assignment THEN NOW() ELSE NULL END, NOW(), p_published_by_user_id, v_target_state.lifecycle_status, v_context.template_shift_id IS NOT NULL, v_context.template_shift_id, p_published_by_user_id, NOW()
        ) RETURNING id INTO v_new_shift_id;
        v_action := 'created';
    END IF;
    
    UPDATE roster_shifts SET lifecycle = 'published'::shift_lifecycle_status, published_to_shift_id = v_new_shift_id, published_at = NOW(), published_by = p_published_by_user_id WHERE id = p_roster_shift_id;
    v_result.success := TRUE; v_result.shift_id := v_new_shift_id; v_result.action := v_action; RETURN v_result;
EXCEPTION WHEN OTHERS THEN
    v_result.success := FALSE; v_result.error_code := 'UNEXPECTED_ERROR'; v_result.error_message := SQLERRM; v_result.action := 'skipped'; RETURN v_result;
END;
$function$;

-- 6. Fix sm_expire_offer_now
CREATE OR REPLACE FUNCTION public.sm_expire_offer_now(p_shift_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_shift shifts%ROWTYPE;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Shift not found'); END IF;
  IF v_shift.assignment_outcome IS DISTINCT FROM 'offered' THEN RETURN json_build_object('success', false, 'error', 'Shift is not in offered state'); END IF;

  UPDATE shifts SET
    lifecycle_status      = 'Draft', -- is_draft is generated
    assignment_outcome    = NULL,
    assignment_status     = 'unassigned',
    assigned_employee_id  = NULL,
    assigned_at           = NULL,
    bidding_status        = 'not_on_bidding',
    updated_at            = now()
  WHERE id = p_shift_id;

  RETURN json_build_object('success', true, 'from_state', 'S3', 'to_state', 'S1');
END;
$function$;

-- 7. Fix create_test_shift
CREATE OR REPLACE FUNCTION public.create_test_shift(p_state text, p_days_ahead integer, p_employee_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_shift_id UUID := gen_random_uuid();
    v_org_id UUID;
    v_dept_id UUID;
    v_roster_id UUID;
    v_scheduled_start TIMESTAMPTZ;
    v_scheduled_end TIMESTAMPTZ;
    v_emp_id UUID;
BEGIN
    SELECT id INTO v_roster_id FROM rosters WHERE name = '__TEST_STATE_MACHINE__' LIMIT 1;
    SELECT organization_id, department_id INTO v_org_id, v_dept_id FROM rosters WHERE id = v_roster_id;
    IF p_employee_id IS NULL THEN SELECT id INTO v_emp_id FROM profiles LIMIT 1; ELSE v_emp_id := p_employee_id; END IF;
    v_scheduled_start := (CURRENT_DATE + p_days_ahead + TIME '09:00')::TIMESTAMPTZ;
    v_scheduled_end := (CURRENT_DATE + p_days_ahead + TIME '17:00')::TIMESTAMPTZ;
    
    CASE p_state
        WHEN 'S1' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, bidding_status, trading_status, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Draft', 'unassigned', 'not_on_bidding', 'NoTrade', NOW(), NOW());
        WHEN 'S2' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, assignment_outcome, bidding_status, trading_status, assigned_employee_id, assigned_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Draft', 'assigned', 'pending', 'not_on_bidding', 'NoTrade', v_emp_id, NOW(), NOW(), NOW());
        WHEN 'S3' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, assignment_outcome, bidding_status, trading_status, assigned_employee_id, assigned_at, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Published', 'assigned', 'offered', 'not_on_bidding', 'NoTrade', v_emp_id, NOW(), NOW(), NOW(), NOW());
        WHEN 'S4' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, assignment_outcome, bidding_status, trading_status, assigned_employee_id, assigned_at, confirmed_at, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Published', 'assigned', 'confirmed', 'not_on_bidding', 'NoTrade', v_emp_id, NOW(), NOW(), NOW(), NOW(), NOW());
        WHEN 'S5' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, bidding_status, trading_status, is_on_bidding, bidding_open_at, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Published', 'unassigned', 'on_bidding_normal', 'NoTrade', TRUE, NOW(), NOW(), NOW(), NOW());
        WHEN 'S6' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, bidding_status, trading_status, is_on_bidding, bidding_open_at, is_urgent, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Published', 'unassigned', 'on_bidding_urgent', 'NoTrade', TRUE, NOW(), TRUE, NOW(), NOW(), NOW());
        WHEN 'S7' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, assignment_outcome, bidding_status, trading_status, assigned_employee_id, assigned_at, confirmed_at, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Published', 'assigned', 'emergency_assigned', 'not_on_bidding', 'NoTrade', v_emp_id, NOW(), NOW(), NOW(), NOW(), NOW());
        WHEN 'S8' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, bidding_status, trading_status, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Published', 'unassigned', 'bidding_closed_no_winner', 'NoTrade', NOW(), NOW(), NOW());
        WHEN 'S9' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, assignment_outcome, bidding_status, trading_status, assigned_employee_id, assigned_at, confirmed_at, trade_requested_at, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Published', 'assigned', 'confirmed', 'not_on_bidding', 'TradeRequested', v_emp_id, NOW(), NOW(), NOW(), NOW(), NOW(), NOW());
        WHEN 'S10' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, assignment_outcome, bidding_status, trading_status, assigned_employee_id, assigned_at, confirmed_at, trade_requested_at, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Published', 'assigned', 'confirmed', 'not_on_bidding', 'TradeAccepted', v_emp_id, NOW(), NOW(), NOW(), NOW(), NOW(), NOW());
        WHEN 'S15' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, roster_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, bidding_status, trading_status, is_cancelled, cancelled_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, CURRENT_DATE + p_days_ahead, CURRENT_DATE + p_days_ahead, '09:00', '17:00', v_scheduled_start, v_scheduled_end, 'Cancelled', 'unassigned', 'not_on_bidding', 'NoTrade', TRUE, NOW(), NOW(), NOW());
        ELSE RAISE EXCEPTION 'Unknown state: %', p_state;
    END CASE;
    RETURN v_shift_id;
END;
$function$;

-- 8. Fix create_test_shift_v3
CREATE OR REPLACE FUNCTION public.create_test_shift_v3(p_state text, p_start_offset interval, p_employee_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_shift_id UUID := gen_random_uuid();
    v_roster_id UUID;
    v_org_id UUID;
    v_dept_id UUID;
    v_roster_date DATE;
    v_employee UUID;
    v_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
BEGIN
    SELECT r.id, r.organization_id, r.department_id, r.date INTO v_roster_id, v_org_id, v_dept_id, v_roster_date FROM rosters r WHERE r.name = '__TEST_STATE_MACHINE_V3__' LIMIT 1;
    IF v_roster_id IS NULL THEN RAISE EXCEPTION 'Test roster not found'; END IF;
    IF p_employee_id IS NULL THEN SELECT id INTO v_employee FROM profiles LIMIT 1; ELSE v_employee := p_employee_id; END IF;
    IF v_employee IS NULL THEN RAISE EXCEPTION 'No employee available'; END IF;
    v_start := (NOW() + p_start_offset); v_start := v_roster_date + (v_start::time); v_end := v_start + INTERVAL '8 hours';
    IF v_start IS NULL THEN RAISE EXCEPTION 'scheduled_start resolved to NULL'; END IF;

    CASE p_state
        WHEN 'S1' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, bidding_status, trading_status, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, v_roster_date, v_start::time, v_end::time, v_start, v_end, 'Draft', 'unassigned', 'not_on_bidding', 'NoTrade', NOW(), NOW());
        WHEN 'S3' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, assignment_outcome, assigned_employee_id, assigned_at, bidding_status, trading_status, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, v_roster_date, v_start::time, v_end::time, v_start, v_end, 'Published', 'assigned', 'offered', v_employee, NOW(), 'not_on_bidding', 'NoTrade', NOW(), NOW(), NOW());
        WHEN 'S4' THEN
            INSERT INTO shifts (id, roster_id, organization_id, department_id, shift_date, start_time, end_time, scheduled_start, scheduled_end, lifecycle_status, assignment_status, assignment_outcome, assigned_employee_id, assigned_at, confirmed_at, bidding_status, trading_status, published_at, created_at, updated_at)
            VALUES (v_shift_id, v_roster_id, v_org_id, v_dept_id, v_roster_date, v_start::time, v_end::time, v_start, v_end, 'Published', 'assigned', 'confirmed', v_employee, NOW(), NOW(), 'not_on_bidding', 'NoTrade', NOW(), NOW(), NOW());
        ELSE RAISE EXCEPTION 'Unsupported state %', p_state;
    END CASE;
    RETURN v_shift_id;
END;
$function$;
