-- ============================================================================
-- Migration: role_name_is_security_single_owner
-- Purpose:
--   "Is this a Security role (EBA Schedule 3)?" was answered by ten copies of
--   `name ILIKE '%security%'` across six functions. The app already has one
--   owner (src/modules/compliance/security-role.ts, isSecurityRoleName); this is
--   its SQL twin, and every copy now calls it.
--
--   Rule change (user, 2026-11-04): "Executive Assistant to the Directors of
--   Building Services & Security" is not Schedule 3 staff, so a name starting
--   "executive assistant" is excluded. "Security Assistant" and "Assistant
--   Building Security Manager" still match. Keep this and isSecurityRoleName in
--   step.
--
--   Each function body below is its live pg_get_functiondef with only that
--   expression replaced.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.role_name_is_security(p_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT p_name IS NOT NULL
     AND pg_catalog.lower(p_name) LIKE '%security%'
     AND pg_catalog.lower(p_name) NOT LIKE 'executive assistant%';
$function$;

CREATE OR REPLACE FUNCTION public.shift_is_security_role(p_role_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.roles r
        WHERE r.id = p_role_id AND public.role_name_is_security(r.name)
    );
$function$;

CREATE OR REPLACE FUNCTION public.fn_billable_defaults_and_lengths()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr', 'internal'
AS $function$
DECLARE
  v_shift            public.shifts%ROWTYPE;
  v_ts_id            uuid;
  v_clock_in         timestamptz;
  v_clock_out        timestamptz;
  v_meal_is_paid     boolean := false;
  v_completed_breaks integer := 0;
  v_actual_break_sum integer := NULL;
  v_gross            integer;
  v_net              integer;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = NEW.shift_id;
  IF FOUND THEN
    NEW.organization_id := COALESCE(NEW.organization_id, v_shift.organization_id);
    NEW.employee_id     := COALESCE(NEW.employee_id, v_shift.assigned_employee_id);
    IF TG_OP = 'INSERT' THEN
      NEW.paid_break_minutes := COALESCE(NEW.paid_break_minutes, v_shift.paid_break_minutes, 0);
    END IF;
    v_meal_is_paid := EXISTS (
      SELECT 1 FROM hr.roles r
      WHERE r.id = v_shift.role_id
        AND public.role_name_is_security(r.name)
    );
  END IF;

  SELECT t.id, t.clock_in, t.clock_out
    INTO v_ts_id, v_clock_in, v_clock_out
    FROM public.timesheets t
   WHERE t.shift_id = NEW.shift_id;

  IF NEW.timesheet_id IS NULL AND v_ts_id IS NOT NULL THEN
    NEW.timesheet_id := v_ts_id;
  END IF;

  IF v_ts_id IS NOT NULL THEN
    SELECT COUNT(*)::integer, SUM(tb.duration_minutes)::integer
      INTO v_completed_breaks, v_actual_break_sum
      FROM public.timesheet_breaks tb
     WHERE tb.timesheet_id = v_ts_id
       AND tb.break_end IS NOT NULL;
  END IF;

  IF NEW.break_start IS NOT NULL AND NEW.break_end IS NOT NULL THEN
    NEW.unpaid_break_is_manual := true;
    NEW.unpaid_break_minutes := CASE
      WHEN v_meal_is_paid THEN 0
      ELSE public.shift_minutes_after_start(NEW.break_start, NEW.break_end)
    END;

    IF NEW.billable_start IS NOT NULL AND NEW.billable_end IS NOT NULL THEN
      IF public.shift_minutes_after_start(NEW.billable_start, NEW.break_start)
           + public.shift_minutes_after_start(NEW.break_start, NEW.break_end)
           <> public.shift_minutes_after_start(NEW.billable_start, NEW.break_end)
         OR public.shift_minutes_after_start(NEW.billable_start, NEW.break_end)
           > public.shift_net_minutes(NEW.billable_start, NEW.billable_end, 0) THEN
        RAISE EXCEPTION 'Meal break must fall within the billable window (% to %)', NEW.billable_start, NEW.billable_end
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSIF TG_OP = 'INSERT' AND NEW.unpaid_break_minutes IS NOT NULL THEN
    NEW.unpaid_break_is_manual := true;
  ELSIF TG_OP = 'UPDATE'
        AND NEW.unpaid_break_minutes IS DISTINCT FROM OLD.unpaid_break_minutes
        AND NEW.unpaid_break_minutes IS NOT NULL
        AND NOT (OLD.unpaid_break_is_manual = true AND NEW.unpaid_break_is_manual = false) THEN
    NEW.unpaid_break_is_manual := true;
  ELSIF NOT COALESCE(NEW.unpaid_break_is_manual, false) THEN
    IF v_completed_breaks > 0 THEN
      NEW.unpaid_break_minutes := CASE WHEN v_meal_is_paid THEN 0 ELSE v_actual_break_sum END;
    ELSE
      NEW.unpaid_break_minutes := NULL;
    END IF;
  END IF;

  IF NEW.status = 'no_show'::public.timesheet_status
     AND NEW.billable_start IS NULL
     AND NEW.billable_end IS NULL THEN
    NEW.gross_length_minutes := 0;
    NEW.net_length_minutes   := 0;
    NEW.hours_source         := 'no_show';
  ELSIF v_shift.id IS NOT NULL THEN
    v_gross := internal.toil_billable_net_minutes(
      NEW.billable_start, NEW.billable_end,
      v_clock_in, v_clock_out,
      v_shift.shift_date, v_shift.start_time, v_shift.end_time,
      0, 0
    );
    v_net := internal.toil_billable_net_minutes(
      NEW.billable_start, NEW.billable_end,
      v_clock_in, v_clock_out,
      v_shift.shift_date, v_shift.start_time, v_shift.end_time,
      COALESCE(NEW.unpaid_break_minutes, 0), 0
    );
    NEW.gross_length_minutes := v_gross;
    NEW.net_length_minutes   := v_net;
    IF v_net IS NOT NULL THEN
      NEW.hours_source := CASE
        WHEN NEW.billable_start IS NOT NULL OR NEW.billable_end IS NOT NULL THEN 'adjusted'
        ELSE 'actual'
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_clock_out_shift(p_shift_id uuid, p_user_id uuid, p_lat double precision DEFAULT NULL::double precision, p_lon double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
DECLARE
  v_shift           public.shifts%ROWTYPE;
  v_ts              public.timesheets%ROWTYPE;
  v_org             public.organizations%ROWTYPE;
  v_now             timestamptz := clock_timestamp();
  v_effective_end   timestamptz;
  v_departure_track public.attendance_departure_track;
  v_distance_m      double precision := 0;
  v_min_distance_m  double precision;
  v_loc             RECORD;
  v_any_location    boolean := false;
  v_inside          boolean := false;
  v_gross_minutes   numeric;
  v_break_minutes   integer;
  v_meal_is_paid    boolean := false;
  v_net_minutes     numeric;
  v_early_out       boolean;
  v_earth_radius    CONSTANT double precision := 6371000;
  v_lat1_rad        double precision;
  v_lat2_rad        double precision;
  v_dlat            double precision;
  v_dlon            double precision;
  v_a               double precision;
  v_dist            double precision;
  v_from_state      text;
  v_to_state        text;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
  END IF;

  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT public.can_act_on_shift('timesheet.approve', p_shift_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to clock out on behalf of this employee');
  END IF;
  IF v_shift.assigned_employee_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift is not assigned to this employee');
  END IF;

  SELECT * INTO v_ts FROM public.timesheets WHERE shift_id = p_shift_id FOR UPDATE;
  IF NOT FOUND OR v_ts.clock_in IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Must clock in before clocking out');
  END IF;

  IF v_ts.clock_out IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already clocked out');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.timesheet_breaks tb
    WHERE tb.timesheet_id = v_ts.id
      AND tb.break_end IS NULL
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'You must end your active unpaid break before clocking out'
    );
  END IF;

  IF p_lat IS NULL OR p_lon IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Location required to clock out');
  END IF;

  v_min_distance_m := NULL;
  v_inside := false;
  FOR v_loc IN
    SELECT lat, lng, radius_m
    FROM public.allowed_locations
    WHERE org_id = v_shift.organization_id AND is_active = true
  LOOP
    v_any_location := true;
    v_lat1_rad := radians(v_loc.lat);
    v_lat2_rad := radians(p_lat);
    v_dlat     := radians(p_lat - v_loc.lat);
    v_dlon     := radians(p_lon - v_loc.lng);
    v_a        := sin(v_dlat / 2)^2 + cos(v_lat1_rad) * cos(v_lat2_rad) * sin(v_dlon / 2)^2;
    v_dist     := v_earth_radius * 2 * atan2(sqrt(v_a), sqrt(1 - v_a));

    IF v_min_distance_m IS NULL OR v_dist < v_min_distance_m THEN
      v_min_distance_m := v_dist;
    END IF;
    IF v_dist <= v_loc.radius_m THEN
      v_inside     := true;
      v_distance_m := v_dist;
    END IF;
  END LOOP;

  IF v_any_location AND NOT v_inside THEN
    RETURN jsonb_build_object(
      'success',    false,
      'error',      'You are too far from any allowed location to clock out',
      'distance_m', round(COALESCE(v_min_distance_m, 0)::numeric, 1)
    );
  END IF;

  IF NOT v_any_location THEN
    SELECT * INTO v_org FROM public.organizations WHERE id = v_shift.organization_id;
    IF FOUND AND v_org.venue_lat IS NOT NULL AND v_org.venue_lon IS NOT NULL THEN
      v_lat1_rad := radians(v_org.venue_lat);
      v_lat2_rad := radians(p_lat);
      v_dlat     := radians(p_lat - v_org.venue_lat);
      v_dlon     := radians(p_lon - v_org.venue_lon);
      v_a        := sin(v_dlat / 2)^2 + cos(v_lat1_rad) * cos(v_lat2_rad) * sin(v_dlon / 2)^2;
      v_distance_m := v_earth_radius * 2 * atan2(sqrt(v_a), sqrt(1 - v_a));
      IF v_distance_m > 100 THEN
        RETURN jsonb_build_object(
          'success',    false,
          'error',      'You are too far from the venue to clock out',
          'distance_m', round(v_distance_m::numeric, 1)
        );
      END IF;
    END IF;
  END IF;

  IF v_shift.end_at IS NOT NULL THEN
    v_effective_end := v_shift.end_at;
  ELSE
    v_effective_end := (
      (v_shift.shift_date + v_shift.end_time)
      + CASE WHEN v_shift.end_time <= v_shift.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END
    ) AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney');
  END IF;

  IF v_now < v_effective_end - INTERVAL '7 minutes 30 seconds' THEN
    v_departure_track := 'early_out';
  ELSIF v_now <= v_effective_end + INTERVAL '7 minutes 30 seconds' THEN
    v_departure_track := 'on_time';
  ELSE
    v_departure_track := 'late_out';
  END IF;

  v_early_out := (v_departure_track = 'early_out');

  SELECT SUM(tb.duration_minutes)::integer
    INTO v_break_minutes
    FROM public.timesheet_breaks tb
   WHERE tb.timesheet_id = v_ts.id
     AND tb.break_end IS NOT NULL;

  v_meal_is_paid := EXISTS (
    SELECT 1 FROM hr.roles r
    WHERE r.id = v_shift.role_id
      AND public.role_name_is_security(r.name)
  );

  v_gross_minutes := EXTRACT(EPOCH FROM (v_now - v_ts.clock_in)) / 60.0;
  v_net_minutes   := GREATEST(
    0,
    v_gross_minutes - CASE WHEN v_meal_is_paid THEN 0 ELSE COALESCE(v_break_minutes, 0) END
  );

  UPDATE public.timesheets SET
    clock_out       = v_now,
    departure_track = v_departure_track,
    updated_at      = v_now
  WHERE id = v_ts.id
    AND clock_out IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already clocked out');
  END IF;

  v_from_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status, v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status,
    v_shift.is_cancelled, v_shift.bidding_status
  );

  UPDATE public.shifts SET
    lifecycle_status = 'Completed'::public.shift_lifecycle,
    updated_at       = v_now
  WHERE id = p_shift_id;

  UPDATE public.billables SET
    timesheet_id = v_ts.id,
    updated_at   = v_now
  WHERE shift_id = p_shift_id
    AND payroll_exported = false;

  v_to_state := public.get_shift_fsm_state(
    'Completed'::public.shift_lifecycle, v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status,
    v_shift.is_cancelled, v_shift.bidding_status
  );

  INSERT INTO public.shift_events (
    shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain
  ) VALUES (
    p_shift_id,
    v_shift.assigned_employee_id,
    p_user_id,
    CASE WHEN v_early_out THEN 'EARLY_OUT' ELSE 'OP_APPLIED' END::public.shift_event_type,
    v_now,
    jsonb_build_object(
      'op', 'clock_out',
      'domain', 'attendance',
      'departure', CASE
                     WHEN v_departure_track = 'early_out' THEN 'early'
                     WHEN v_departure_track = 'late_out' THEN 'late'
                     ELSE 'on_time'
                   END,
      'departure_track', v_departure_track::text,
      'net_minutes', round(v_net_minutes::numeric, 0),
      'actual_unpaid_break_minutes', v_break_minutes,
      'from_state', v_from_state,
      'to_state',   v_to_state,
      'source', 'sm_clock_out_shift'
    ),
    'employee',
    'attendance'
  )
  ON CONFLICT (shift_id, employee_id, event_type, event_time) DO NOTHING;

  RETURN jsonb_build_object(
    'success',                     true,
    'departure_track',             v_departure_track::text,
    'clock_out',                   v_now,
    'actual_end',                  v_now,
    'actual_net_minutes',          round(v_net_minutes::numeric, 0),
    'actual_unpaid_break_minutes', v_break_minutes,
    'early_out',                   v_early_out,
    'distance_m',                  round(v_distance_m::numeric, 1)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION internal.eba_check_assignment(p_shift_id uuid, p_employee_id uuid, p_shift_date date DEFAULT NULL::date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_unpaid_break_mins integer DEFAULT NULL::integer, p_role_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(is_compliant boolean, rule_id text, rule_name text, tier text, summary text, details text, payload jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift        public.shifts%ROWTYPE;
    v_contract     hr.user_contracts%ROWTYPE;
    v_date         date;
    v_start        time;
    v_end          time;
    v_unpaid       integer;
    v_role         uuid;
    v_status       text;
    v_type         text;
    v_security     boolean;
    v_all_salaried boolean;
    v_facts        jsonb;
    v_shifts       jsonb;
    v_rows         integer := 0;
    v_n            integer;
    v_other        record;
    v_role_status  text;
    v_target_ok    boolean;
    v_held         text;
BEGIN
    IF p_employee_id IS NULL THEN
        RETURN QUERY SELECT true, NULL::text, NULL::text, NULL::text, 'No employee assigned'::text, 'Shift has no assigned employee.'::text, '{}'::jsonb;
        RETURN;
    END IF;

    IF p_shift_id IS NOT NULL THEN
        SELECT * INTO v_shift FROM public.shifts s WHERE s.id = p_shift_id;
    END IF;

    v_date   := COALESCE(p_shift_date, v_shift.shift_date);
    v_start  := COALESCE(p_start_time, v_shift.start_time);
    v_end    := COALESCE(p_end_time, v_shift.end_time);
    v_unpaid := COALESCE(p_unpaid_break_mins, v_shift.unpaid_break_minutes, 0);
    v_role   := COALESCE(p_role_id, v_shift.role_id);

    IF v_date IS NULL OR v_start IS NULL OR v_end IS NULL THEN
        RETURN QUERY SELECT true, NULL::text, NULL::text, NULL::text, 'Incomplete shift details'::text, 'Shift missing date or start/end time.'::text, '{}'::jsonb;
        RETURN;
    END IF;

    SELECT uc.* INTO v_contract
      FROM hr.user_contracts uc
     WHERE uc.user_id = p_employee_id
       AND (uc.id = v_shift.user_contract_id
            OR (uc.start_date <= v_date
                AND (uc.end_date IS NULL OR uc.end_date >= v_date)
                AND (v_shift.sub_department_id IS NULL
                     OR uc.sub_department_id = v_shift.sub_department_id
                     OR uc.sub_department_id IS NULL)))
     ORDER BY (uc.id = v_shift.user_contract_id) IS TRUE DESC,
              (public.fn_normalize_employment_type(uc.employment_status::text)
                   IS NOT DISTINCT FROM v_shift.target_employment_type) DESC,
              (uc.role_id IS NOT DISTINCT FROM v_role) DESC,
              (uc.sub_department_id IS NOT DISTINCT FROM v_shift.sub_department_id) DESC,
              uc.remuneration_level DESC NULLS LAST,
              uc.id
     LIMIT 1;

    v_status := COALESCE(v_contract.employment_status::text,
                         (SELECT p.employment_type::text FROM public.profiles p WHERE p.id = p_employee_id));
    v_type := CASE WHEN lower(COALESCE(v_status, '')) LIKE 'flexible%' THEN 'FLEXI_PART_TIME'
                   WHEN lower(COALESCE(v_status, '')) LIKE 'full%'     THEN 'FULL_TIME'
                   WHEN lower(COALESCE(v_status, '')) LIKE 'part%'     THEN 'PART_TIME'
                   ELSE 'CASUAL' END;

    v_security := EXISTS (SELECT 1 FROM public.roles r WHERE r.id = v_role AND public.role_name_is_security(r.name))
               OR EXISTS (SELECT 1 FROM hr.user_contracts uc JOIN public.roles r ON r.id = uc.role_id
                           WHERE uc.user_id = p_employee_id AND uc.status = 'Active' AND public.role_name_is_security(r.name));

    SELECT COUNT(*) > 0 AND bool_and(COALESCE(uc.pay_basis = 'salary', false)) INTO v_all_salaried
      FROM hr.user_contracts uc WHERE uc.user_id = p_employee_id AND uc.status = 'Active';
    v_all_salaried := COALESCE(v_all_salaried, false);

    v_facts := jsonb_build_object(
        'contract_type', v_type,
        'is_security',   v_security,
        'rest_gap_8h',   COALESCE((SELECT p.rest_gap_agreement_8h FROM public.profiles p WHERE p.id = p_employee_id), false),
        'student_visa',  EXISTS (SELECT 1 FROM public.employee_licenses el
                                  WHERE el.employee_id = p_employee_id
                                    AND el.license_type = 'WorkRights'
                                    AND el.has_restricted_work_limit
                                    AND (el.expiration_date IS NULL OR el.expiration_date >= v_date)),
        'cycle_weeks',   v_contract.ordinary_hours_cycle_weeks,
        'cycle_anchor',  v_contract.ordinary_hours_cycle_anchor);

    SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_shifts FROM (
        SELECT s.id, s.shift_date, s.start_time, s.end_time,
               s.unpaid_break_minutes, s.paid_break_minutes,
               public.shift_breaks_total_minutes(s.unpaid_breaks, s.break_start, s.break_end, s.unpaid_break_minutes) AS meal_break_minutes,
               COALESCE(s.is_training, false) AS is_training,
               COALESCE(uc.engagement_kind = 'multi_hire', false) AS is_multi_hire,
               COALESCE(uc.pay_basis = 'salary', v_all_salaried) AS is_salaried,
               false AS is_candidate
          FROM public.shifts s
          LEFT JOIN hr.user_contracts uc ON uc.id = s.user_contract_id AND uc.user_id = p_employee_id
         WHERE s.assigned_employee_id = p_employee_id
           AND s.id IS DISTINCT FROM p_shift_id
           AND NOT COALESCE(s.is_cancelled, false)
           AND s.lifecycle_status <> 'Cancelled'
           AND s.shift_date BETWEEN v_date - 56 AND v_date + 56
        UNION ALL
        SELECT p_shift_id, v_date, v_start, v_end, v_unpaid, COALESCE(v_shift.paid_break_minutes, 0),
               CASE
                 WHEN p_unpaid_break_mins IS NOT NULL AND p_unpaid_break_mins > 0 THEN p_unpaid_break_mins
                 ELSE public.shift_breaks_total_minutes(v_shift.unpaid_breaks, v_shift.break_start, v_shift.break_end, v_unpaid)
               END,
               COALESCE(v_shift.is_training, false),
               COALESCE(v_contract.engagement_kind = 'multi_hire', false),
               COALESCE(v_contract.pay_basis = 'salary', v_all_salaried),
               true
    ) x;

    RETURN QUERY
    SELECT false, 'V8_LEAVE_CONFLICT'::text, 'Approved Leave'::text, 'BLOCKING'::text,
           'Employee is on approved leave'::text,
           format('This shift falls on %s, a day the employee has approved %s leave. Approved leave is a hard unavailability — unassign the leave or pick another employee.',
                  to_char(v_date, 'YYYY-MM-DD'), replace(lr.leave_type, '_', ' ')),
           jsonb_build_object('leave_type', lr.leave_type, 'date', v_date)
      FROM public.leave_requests lr
     WHERE lr.employee_id = p_employee_id
       AND lr.status = 'approved'
       AND v_date BETWEEN (lr.start_date AT TIME ZONE 'UTC')::date AND (lr.end_date AT TIME ZONE 'UTC')::date;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_rows := v_rows + v_n;

    IF p_shift_id IS NOT NULL THEN
        FOR v_other IN
            WITH req AS (
                SELECT ss.skill_id FROM public.shift_skills ss WHERE ss.shift_id = p_shift_id
                UNION
                SELECT (jsonb_array_elements_text(v_shift.required_skills))::uuid
                 WHERE jsonb_typeof(v_shift.required_skills) = 'array'
            )
            SELECT req.skill_id, sk.name AS skill_name,
                   EXISTS (SELECT 1 FROM public.employee_skills es WHERE es.employee_id = p_employee_id AND es.skill_id = req.skill_id) AS is_held,
                   (SELECT MAX(es.expiration_date) FROM public.employee_skills es WHERE es.employee_id = p_employee_id AND es.skill_id = req.skill_id) AS expires
              FROM req JOIN public.skills sk ON sk.id = req.skill_id
        LOOP
            IF NOT v_other.is_held THEN
                v_rows := v_rows + 1;
                RETURN QUERY SELECT false, 'V8_QUALIFICATIONS'::text, 'Qualifications'::text, 'BLOCKING'::text,
                    'Missing required skill'::text,
                    format('Required skill "%s" not held by employee.', v_other.skill_name),
                    jsonb_build_object('skill_id', v_other.skill_id, 'skill_name', v_other.skill_name);
            ELSIF v_other.expires IS NOT NULL AND v_other.expires < v_date THEN
                v_rows := v_rows + 1;
                RETURN QUERY SELECT false, 'V8_QUALIFICATION_EXPIRED'::text, 'Expired Qualification'::text, 'BLOCKING'::text,
                    'Required skill expired before shift date'::text,
                    format('Skill "%s" expired on %s before shift date %s.', v_other.skill_name, to_char(v_other.expires, 'YYYY-MM-DD'), to_char(v_date, 'YYYY-MM-DD')),
                    jsonb_build_object('skill_id', v_other.skill_id, 'skill_name', v_other.skill_name, 'expiration_date', v_other.expires);
            END IF;
        END LOOP;

        FOR v_other IN
            WITH req AS (
                SELECT sl.license_id FROM public.shift_licenses sl WHERE sl.shift_id = p_shift_id AND COALESCE(sl.is_required, true)
                UNION
                SELECT (jsonb_array_elements_text(v_shift.required_licenses))::uuid
                 WHERE jsonb_typeof(v_shift.required_licenses) = 'array'
            )
            SELECT req.license_id, l.name AS license_name,
                   EXISTS (SELECT 1 FROM public.employee_licenses el WHERE el.employee_id = p_employee_id AND el.license_id = req.license_id) AS is_held,
                   (SELECT MAX(el.expiration_date) FROM public.employee_licenses el WHERE el.employee_id = p_employee_id AND el.license_id = req.license_id) AS expires
              FROM req JOIN public.licenses l ON l.id = req.license_id
        LOOP
            IF NOT v_other.is_held THEN
                v_rows := v_rows + 1;
                RETURN QUERY SELECT false, 'V8_QUALIFICATIONS'::text, 'Qualifications'::text, 'BLOCKING'::text,
                    'Missing required license'::text,
                    format('Required license "%s" not held by employee.', v_other.license_name),
                    jsonb_build_object('license_id', v_other.license_id, 'license_name', v_other.license_name);
            ELSIF v_other.expires IS NOT NULL AND v_other.expires < v_date THEN
                v_rows := v_rows + 1;
                RETURN QUERY SELECT false, 'V8_QUALIFICATION_EXPIRED'::text, 'Expired Qualification'::text, 'BLOCKING'::text,
                    'Required license expired before shift date'::text,
                    format('License "%s" expired on %s before shift date %s.', v_other.license_name, to_char(v_other.expires, 'YYYY-MM-DD'), to_char(v_date, 'YYYY-MM-DD')),
                    jsonb_build_object('license_id', v_other.license_id, 'license_name', v_other.license_name, 'expiration_date', v_other.expires);
            END IF;
        END LOOP;
    END IF;

    IF NULLIF(v_shift.target_employment_type, '') IS NOT NULL THEN
        SELECT uc.employment_status::text INTO v_role_status
          FROM hr.user_contracts uc
         WHERE uc.user_id = p_employee_id
           AND uc.status = 'Active'
           AND uc.role_id = v_role
           AND (v_shift.sub_department_id IS NULL OR uc.sub_department_id = v_shift.sub_department_id OR uc.sub_department_id IS NULL)
         ORDER BY (uc.sub_department_id IS NOT DISTINCT FROM v_shift.sub_department_id) DESC,
                  (uc.sub_department_id IS NOT NULL) DESC,
                  uc.id
         LIMIT 1;

        IF v_role_status IS NOT NULL THEN
            v_held := v_role_status;
            v_target_ok := public.fn_normalize_employment_type(v_role_status) = v_shift.target_employment_type
                       AND (NOT COALESCE(v_shift.target_requires_flexible, false) OR lower(btrim(v_role_status)) LIKE 'flexible%');
        ELSE
            SELECT string_agg(DISTINCT uc.employment_status::text, ', '),
                   COALESCE(bool_or(public.fn_normalize_employment_type(uc.employment_status::text) = v_shift.target_employment_type
                                    AND (NOT COALESCE(v_shift.target_requires_flexible, false)
                                         OR lower(btrim(uc.employment_status::text)) LIKE 'flexible%')), false)
              INTO v_held, v_target_ok
              FROM hr.user_contracts uc
             WHERE uc.user_id = p_employee_id
               AND uc.status = 'Active'
               AND (v_shift.sub_department_id IS NULL OR uc.sub_department_id = v_shift.sub_department_id OR uc.sub_department_id IS NULL);
        END IF;

        IF NOT v_target_ok THEN
            v_rows := v_rows + 1;
            RETURN QUERY SELECT false, 'V8_EMPLOYMENT_TARGET'::text, 'Employment Target'::text, 'BLOCKING'::text,
                CASE WHEN COALESCE(v_shift.target_requires_flexible, false) THEN 'Requires Flexible Part-Time' ELSE 'Employment target mismatch' END,
                format('This shift is for %s staff, but the employee holds %s for this %s.',
                       CASE WHEN COALESCE(v_shift.target_requires_flexible, false) THEN 'Flexible Part-Time' ELSE v_shift.target_employment_type END,
                       COALESCE(v_held, 'no active contract'),
                       CASE WHEN v_role_status IS NOT NULL THEN 'role' ELSE 'sub-department' END),
                jsonb_build_object('target_employment_type', v_shift.target_employment_type, 'employee_status', v_held);
        END IF;
    END IF;

    RETURN QUERY SELECT * FROM internal.eba_evaluate(v_facts, v_shifts);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_rows := v_rows + v_n;

    IF v_rows = 0 THEN
        RETURN QUERY SELECT true, NULL::text, NULL::text, NULL::text, 'Passed'::text, 'All EBA compliance checks passed.'::text, '{}'::jsonb;
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.accrue_leave_balances()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
BEGIN
  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 4.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 4.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'annual'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%casual%'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%flex%'
    AND NOT (
      LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
      AND (
        uc.pay_basis = 'eba_security_annualised'
        OR (uc.pay_basis IS NULL AND EXISTS (
          SELECT 1 FROM hr.roles r WHERE r.id = uc.role_id AND public.role_name_is_security(r.name)
        ))
      )
    )
    AND lb.as_of_date < CURRENT_DATE;

  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 2.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((COALESCE(uc.contracted_weekly_hours, 38.0) * 2.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'personal'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%casual%'
    AND LOWER(COALESCE(uc.employment_status::text, '')) NOT LIKE '%flex%'
    AND NOT (
      LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
      AND (
        uc.pay_basis = 'eba_security_annualised'
        OR (uc.pay_basis IS NULL AND EXISTS (
          SELECT 1 FROM hr.roles r WHERE r.id = uc.role_id AND public.role_name_is_security(r.name)
        ))
      )
    )
    AND lb.as_of_date < CURRENT_DATE;

  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((wk.weekly_hours * 4.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((wk.weekly_hours * 4.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  LEFT JOIN LATERAL (
    SELECT CASE
             WHEN COUNT(s.id) > 0
               THEN SUM(COALESCE(s.net_length_minutes, s.scheduled_length_minutes, 0)) / 60.0 / 12.0
             ELSE COALESCE(uc.contracted_weekly_hours, 0.0)
           END AS weekly_hours
    FROM shifts s
    WHERE s.assigned_employee_id = uc.user_id
      AND s.shift_date >= CURRENT_DATE - 84
      AND s.shift_date < CURRENT_DATE
      AND s.lifecycle_status <> 'Cancelled'
  ) wk ON true
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'annual'
    AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%flex%'
    AND lb.as_of_date < CURRENT_DATE;

  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((wk.weekly_hours * 2.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((wk.weekly_hours * 2.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  LEFT JOIN LATERAL (
    SELECT CASE
             WHEN COUNT(s.id) > 0
               THEN SUM(COALESCE(s.net_length_minutes, s.scheduled_length_minutes, 0)) / 60.0 / 12.0
             ELSE COALESCE(uc.contracted_weekly_hours, 0.0)
           END AS weekly_hours
    FROM shifts s
    WHERE s.assigned_employee_id = uc.user_id
      AND s.shift_date >= CURRENT_DATE - 84
      AND s.shift_date < CURRENT_DATE
      AND s.lifecycle_status <> 'Cancelled'
  ) wk ON true
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'personal'
    AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%flex%'
    AND lb.as_of_date < CURRENT_DATE;

  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((210.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((210.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  JOIN hr.roles r ON r.id = uc.role_id
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'annual'
    AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
    AND (
      uc.pay_basis = 'eba_security_annualised'
      OR (uc.pay_basis IS NULL AND public.role_name_is_security(r.name))
    )
    AND lb.as_of_date < CURRENT_DATE;

  UPDATE leave_balances lb
  SET
    balance_hours = balance_hours + ((84.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    accrued_hours = accrued_hours + ((84.0 / 365.0) * public.leave_accrual_days(lb.employee_id, lb.as_of_date)),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  JOIN hr.roles r ON r.id = uc.role_id
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'personal'
    AND LOWER(COALESCE(uc.employment_status::text, '')) LIKE '%full%'
    AND (
      uc.pay_basis = 'eba_security_annualised'
      OR (uc.pay_basis IS NULL AND public.role_name_is_security(r.name))
    )
    AND lb.as_of_date < CURRENT_DATE;

  UPDATE leave_balances lb
  SET
    balance_hours = 76.0,
    accrued_hours = accrued_hours + GREATEST(0, 76.0 - balance_hours),
    as_of_date = CURRENT_DATE,
    updated_at = now()
  FROM hr.user_contracts uc
  LEFT JOIN public.profiles p ON p.id = uc.user_id
  WHERE lb.employee_id = uc.user_id
    AND uc.status = 'Active'
    AND lb.leave_type = 'fdv'
    AND COALESCE(p.continuous_service_start, uc.start_date) <= CURRENT_DATE
    AND lb.as_of_date < (
      COALESCE(p.continuous_service_start, uc.start_date)
      + (EXTRACT(year FROM age(CURRENT_DATE, COALESCE(p.continuous_service_start, uc.start_date)))::int * interval '1 year')
    )::date;

END;
$function$;

CREATE OR REPLACE FUNCTION public.seed_leave_balances_for_new_contract()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'hr'
AS $function$
DECLARE
  v_is_casual boolean;
  v_is_ft_security boolean;
BEGIN
  IF NEW.status IS DISTINCT FROM 'Active' THEN
    RETURN NEW;
  END IF;

  v_is_casual := LOWER(COALESCE(NEW.employment_status::text, '')) LIKE '%casual%';
  v_is_ft_security := LOWER(COALESCE(NEW.employment_status::text, '')) LIKE '%full%'
    AND (
      NEW.pay_basis = 'eba_security_annualised'
      OR (NEW.pay_basis IS NULL AND EXISTS (
        SELECT 1 FROM hr.roles r WHERE r.id = NEW.role_id AND public.role_name_is_security(r.name)
      ))
    );

  INSERT INTO public.leave_balances (employee_id, leave_type, balance_hours, as_of_date)
  VALUES (NEW.user_id, 'fdv', 76.0, CURRENT_DATE)
  ON CONFLICT (employee_id, leave_type) DO NOTHING;

  IF v_is_casual THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.leave_balances (employee_id, leave_type, balance_hours, as_of_date)
  VALUES (NEW.user_id, 'annual', CASE WHEN v_is_ft_security THEN 210.0 ELSE 152.0 END, CURRENT_DATE)
  ON CONFLICT (employee_id, leave_type) DO NOTHING;

  INSERT INTO public.leave_balances (employee_id, leave_type, balance_hours, as_of_date)
  VALUES (NEW.user_id, 'personal', CASE WHEN v_is_ft_security THEN 84.0 ELSE 76.0 END, CURRENT_DATE)
  ON CONFLICT (employee_id, leave_type) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'seed_leave_balances_for_new_contract swallowed (contract=%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;
