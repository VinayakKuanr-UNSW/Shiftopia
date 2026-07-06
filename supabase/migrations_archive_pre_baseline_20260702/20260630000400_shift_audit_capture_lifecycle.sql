-- =============================================================================
-- Shift Audit System — close the lifecycle capture gaps.
-- =============================================================================
-- The timeline could only show what reached public.shift_events, and four
-- lifecycle moments never emitted an event, so the timeline stopped at clock-in:
--   * CREATE      — sm_create_shift wrote no origin event.
--   * CLOCK-OUT   — sm_clock_out_shift only set actual_end (no EARLY_OUT/departure).
--   * COMPLETE    — completion (a cron) emitted nothing.
--   * TIMESHEET   — manager finalize/adjust on public.timesheets emitted nothing.
--
-- All captured as OP_APPLIED + metadata.{op,domain,...} (no enum churn), except
-- an early departure which also emits the real EARLY_OUT enum value so the
-- existing early-out metric is fed. Idempotent CREATE OR REPLACE.
--
-- sm_create_shift / sm_clock_out_shift bodies are the baseline (20251015000000)
-- verbatim PLUS the trailing event INSERT — verified against prod (neither had
-- been modified since baseline; neither wrote shift_events).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. sm_create_shift — emit a CREATED origin event.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."sm_create_shift"("p_shift_data" "jsonb", "p_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
    v_shift_id uuid;
    v_roster_id uuid;
    v_roster_subgroup_id uuid;
    v_shift_group_id uuid;
    v_sub_group_name text;
    v_creation_source text;
    v_assignment_source text;
BEGIN
    v_roster_id          := (p_shift_data->>'roster_id')::uuid;
    v_roster_subgroup_id := (p_shift_data->>'roster_subgroup_id')::uuid;
    v_shift_group_id     := (p_shift_data->>'shift_group_id')::uuid;
    v_sub_group_name     := p_shift_data->>'sub_group_name';

    v_creation_source := COALESCE(
        p_shift_data->>'creation_source',
        CASE WHEN COALESCE((p_shift_data->>'is_from_template')::boolean, false) THEN 'template' ELSE 'manual' END
    );

    v_assignment_source := CASE
        WHEN (p_shift_data->>'assigned_employee_id') IS NOT NULL
        THEN COALESCE(p_shift_data->>'assignment_source', 'direct')
        ELSE NULL
    END;

    IF v_roster_id IS NULL THEN
        RAISE EXCEPTION 'Roster ID is required';
    END IF;

    IF v_roster_subgroup_id IS NULL AND v_shift_group_id IS NOT NULL AND v_sub_group_name IS NOT NULL THEN
        SELECT id INTO v_roster_subgroup_id
        FROM roster_subgroups
        WHERE roster_group_id = v_shift_group_id
          AND (LOWER(name) = LOWER(v_sub_group_name)
               OR LOWER(name) = LOWER(REPLACE(v_sub_group_name, '_', ' ')))
        LIMIT 1;
    END IF;

    INSERT INTO shifts (
        roster_id, department_id, shift_date, roster_date, start_time, end_time,
        organization_id, sub_department_id, group_type, sub_group_name, display_order,
        shift_group_id, roster_subgroup_id, role_id, remuneration_level_id,
        paid_break_minutes, unpaid_break_minutes, break_minutes, timezone,
        assigned_employee_id, required_skills, required_licenses, event_ids, tags, notes,
        template_id, template_group, template_sub_group, is_from_template, template_instance_id,
        lifecycle_status, created_by_user_id, creation_source, assignment_source,
        created_at, updated_at
    ) VALUES (
        v_roster_id,
        (p_shift_data->>'department_id')::uuid,
        (p_shift_data->>'shift_date')::date,
        (p_shift_data->>'roster_date')::date,
        (p_shift_data->>'start_time')::time,
        (p_shift_data->>'end_time')::time,
        (p_shift_data->>'organization_id')::uuid,
        (p_shift_data->>'sub_department_id')::uuid,
        (p_shift_data->>'group_type')::template_group_type,
        (p_shift_data->>'sub_group_name'),
        COALESCE((p_shift_data->>'display_order')::integer, 0),
        v_shift_group_id,
        v_roster_subgroup_id,
        (p_shift_data->>'role_id')::uuid,
        (p_shift_data->>'remuneration_level_id')::uuid,
        COALESCE((p_shift_data->>'paid_break_minutes')::integer, 0),
        COALESCE((p_shift_data->>'unpaid_break_minutes')::integer, 0),
        COALESCE((p_shift_data->>'break_minutes')::integer, 0),
        COALESCE(p_shift_data->>'timezone', 'Australia/Sydney'),
        (p_shift_data->>'assigned_employee_id')::uuid,
        COALESCE(p_shift_data->'required_skills', '[]'::jsonb),
        COALESCE(p_shift_data->'required_licenses', '[]'::jsonb),
        COALESCE(p_shift_data->'event_ids', '[]'::jsonb),
        COALESCE(p_shift_data->'tags', '[]'::jsonb),
        p_shift_data->>'notes',
        (p_shift_data->>'template_id')::uuid,
        (p_shift_data->>'template_group')::template_group_type,
        p_shift_data->>'template_sub_group',
        COALESCE((p_shift_data->>'is_from_template')::boolean, false),
        (p_shift_data->>'template_instance_id')::uuid,
        'Draft'::shift_lifecycle,
        p_user_id,
        v_creation_source,
        v_assignment_source,
        NOW(), NOW()
    )
    RETURNING id INTO v_shift_id;

    -- AUDIT: record the shift's origin so the timeline has a CREATED anchor.
    -- A neutral OP_APPLIED (exempt from the employee_id-required validator) with
    -- the true verb in metadata.op. Draft at creation => S1 (or S2 if assigned).
    INSERT INTO public.shift_events (
        shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain
    ) VALUES (
        v_shift_id,
        (p_shift_data->>'assigned_employee_id')::uuid,
        p_user_id,
        'OP_APPLIED'::public.shift_event_type,
        jsonb_build_object(
            'op', 'create',
            'domain', 'lifecycle',
            'from_state', NULL,
            'to_state', CASE WHEN (p_shift_data->>'assigned_employee_id') IS NOT NULL THEN 'S2' ELSE 'S1' END,
            'source', 'sm_create_shift',
            'creation_source', v_creation_source
        ),
        CASE WHEN p_user_id IS NULL THEN 'system' ELSE 'manager' END,
        'lifecycle'
    );

    RETURN v_shift_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. sm_clock_out_shift — emit a departure event (EARLY_OUT / clock_out).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."sm_clock_out_shift"("p_shift_id" "uuid", "p_user_id" "uuid", "p_lat" double precision DEFAULT NULL::double precision, "p_lon" double precision DEFAULT NULL::double precision) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_shift         shifts%ROWTYPE;
  v_org           organizations%ROWTYPE;
  v_now           TIMESTAMPTZ := now();
  v_distance_m    DOUBLE PRECISION;
  v_net_minutes   NUMERIC;
  v_early_out     BOOLEAN;
  v_earth_radius  CONSTANT DOUBLE PRECISION := 6371000;
  v_lat1_rad      DOUBLE PRECISION;
  v_lat2_rad      DOUBLE PRECISION;
  v_dlat          DOUBLE PRECISION;
  v_dlon          DOUBLE PRECISION;
  v_a             DOUBLE PRECISION;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
  END IF;

  IF v_shift.attendance_status NOT IN ('checked_in', 'late') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Must clock in before clocking out');
  END IF;

  IF v_shift.actual_end IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already clocked out');
  END IF;

  IF p_lat IS NULL OR p_lon IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Location required to clock out');
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = v_shift.organization_id;
  IF FOUND AND v_org.venue_lat IS NOT NULL AND v_org.venue_lon IS NOT NULL THEN
    v_lat1_rad := radians(v_org.venue_lat);
    v_lat2_rad := radians(p_lat);
    v_dlat     := radians(p_lat - v_org.venue_lat);
    v_dlon     := radians(p_lon - v_org.venue_lon);
    v_a        := sin(v_dlat / 2)^2
                  + cos(v_lat1_rad) * cos(v_lat2_rad) * sin(v_dlon / 2)^2;
    v_distance_m := v_earth_radius * 2 * atan2(sqrt(v_a), sqrt(1 - v_a));
    IF v_distance_m > 100 THEN
      RETURN jsonb_build_object(
        'success',    false,
        'error',      'You are too far from the venue to clock out',
        'distance_m', round(v_distance_m::NUMERIC, 1)
      );
    END IF;
  ELSE
    v_distance_m := 0;
  END IF;

  v_net_minutes := EXTRACT(EPOCH FROM (v_now - v_shift.actual_start)) / 60.0;

  v_early_out := v_shift.end_at IS NOT NULL AND v_now < v_shift.end_at - INTERVAL '5 minutes';

  UPDATE shifts SET
    actual_end        = v_now,
    actual_net_minutes = round(v_net_minutes::NUMERIC, 0),
    updated_at        = v_now
  WHERE id = p_shift_id;

  -- AUDIT: record the clock-out (this RPC previously wrote no shift_events row,
  -- so departures never reached the timeline). EARLY_OUT also feeds the early-out
  -- metric; on-time/late departures use a neutral OP_APPLIED. lifecycle is not
  -- changed here (a later cron completes the shift), so from==to FSM state.
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
                     WHEN v_early_out THEN 'early'
                     WHEN v_shift.end_at IS NOT NULL AND v_now > v_shift.end_at + INTERVAL '5 minutes' THEN 'late'
                     ELSE 'on_time'
                   END,
      'net_minutes', round(v_net_minutes::NUMERIC, 0),
      'from_state', public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled, v_shift.bidding_status),
      'source', 'sm_clock_out_shift'
    ),
    'employee',
    'attendance'
  );

  RETURN jsonb_build_object(
    'success',          true,
    'actual_end',       v_now,
    'actual_net_minutes', round(v_net_minutes::NUMERIC, 0),
    'early_out',        v_early_out,
    'distance_m',       round(v_distance_m::NUMERIC, 1)
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. fn_capture_shift_event — add a COMPLETED branch (current body + guard kept
--    verbatim from 20260630000000_shift_audit_envelope_and_diff).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_capture_shift_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF current_setting('app.audit.via_gateway', true) = '1' THEN
        RETURN NEW;
    END IF;

    -- 1. ASSIGNED / UNASSIGNED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.assigned_employee_id IS NOT NULL AND OLD.assigned_employee_id IS NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ASSIGNED', COALESCE(NEW.assigned_at, now()));
        ELSIF (NEW.assigned_employee_id IS NULL AND OLD.assigned_employee_id IS NOT NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
            VALUES (NEW.id, OLD.assigned_employee_id, 'UNASSIGNED', now());
        END IF;
    ELSIF (TG_OP = 'INSERT') THEN
        IF (NEW.assigned_employee_id IS NOT NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ASSIGNED', COALESCE(NEW.assigned_at, now()));
        END IF;
    END IF;

    -- 2. OFFERED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.fulfillment_status = 'offered' AND OLD.fulfillment_status IS DISTINCT FROM 'offered') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
            VALUES (NEW.id, NEW.assigned_employee_id, 'OFFERED', COALESCE(NEW.offer_sent_at, now()));
        END IF;
    END IF;

    -- 3. ACCEPTED / EMERGENCY_ASSIGNED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.assignment_outcome = 'confirmed' AND OLD.assignment_outcome IS DISTINCT FROM 'confirmed') THEN
            IF (NEW.emergency_assigned_at IS NOT NULL
                AND OLD.emergency_assigned_at IS DISTINCT FROM NEW.emergency_assigned_at) THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
                VALUES (NEW.id, NEW.assigned_employee_id, 'EMERGENCY_ASSIGNED', COALESCE(NEW.emergency_assigned_at, now()));
            ELSE
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
                VALUES (NEW.id, NEW.assigned_employee_id, 'ACCEPTED', COALESCE(NEW.confirmed_at, now()));
            END IF;
        ELSIF (NEW.assignment_outcome = 'emergency_assigned' AND OLD.assignment_outcome IS DISTINCT FROM 'emergency_assigned') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
            VALUES (NEW.id, NEW.assigned_employee_id, 'EMERGENCY_ASSIGNED', COALESCE(NEW.emergency_assigned_at, now()));
        END IF;
    END IF;

    -- 4. CANCELLED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Cancelled' AND OLD.lifecycle_status IS DISTINCT FROM 'Cancelled') THEN
            IF (NEW.start_at IS NOT NULL AND (NEW.start_at - now()) < interval '12 hours') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
                VALUES (NEW.id, NEW.assigned_employee_id, 'LATE_CANCELLED', now());
            END IF;

            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
            VALUES (NEW.id, NEW.assigned_employee_id, 'CANCELLED', COALESCE(NEW.cancelled_at, now()));
        END IF;
    END IF;

    -- 4b. COMPLETED — lifecycle -> Completed (AUDIT: completion previously emitted
    --     no event; a cron sets this). Neutral OP_APPLIED carrying op=complete +
    --     the S11 -> S13 transition so the timeline shows the shift concluding.
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Completed' AND OLD.lifecycle_status IS DISTINCT FROM 'Completed') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, 'OP_APPLIED', now(),
                jsonb_build_object(
                    'op', 'complete',
                    'domain', 'lifecycle',
                    'from_state', public.get_shift_fsm_state(OLD.lifecycle_status, OLD.assignment_status, OLD.assignment_outcome, OLD.trading_status, OLD.is_cancelled, OLD.bidding_status),
                    'to_state',   public.get_shift_fsm_state(NEW.lifecycle_status, NEW.assignment_status, NEW.assignment_outcome, NEW.trading_status, NEW.is_cancelled, NEW.bidding_status),
                    'source', 'fn_capture_shift_event'
                ),
                'lifecycle');
        END IF;
    END IF;

    -- 5. ATTENDANCE (CHECKED_IN, LATE_IN, NO_SHOW)
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.attendance_status IS DISTINCT FROM OLD.attendance_status) THEN
            IF (NEW.attendance_status = 'checked_in') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
                VALUES (NEW.id, NEW.assigned_employee_id, 'CHECKED_IN', COALESCE(NEW.actual_start, now()));
            ELSIF (NEW.attendance_status = 'late') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
                VALUES (NEW.id, NEW.assigned_employee_id, 'LATE_IN', COALESCE(NEW.actual_start, now()));
            ELSIF (NEW.attendance_status = 'no_show') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
                VALUES (NEW.id, NEW.assigned_employee_id, 'NO_SHOW', now());
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Timesheet capture — manager finalize (status -> approved) and post-submission
--    billable-time adjustments, on the immutable ledger under the payroll domain.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_capture_timesheet_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  -- Only timesheets linked to a shift can appear on a shift timeline.
  IF NEW.shift_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Finalize: status -> approved. (finalize and adjust are mutually exclusive on
  -- a single UPDATE to avoid two OP_APPLIED rows colliding on the same
  -- (shift_id, employee_id, event_type, event_time); a separate adjust UPDATE
  -- gets its own event_time.)
  IF (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved') THEN
    INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain)
    VALUES (NEW.shift_id, NEW.employee_id, COALESCE(NEW.approved_by, v_actor), 'OP_APPLIED',
      jsonb_build_object('op', 'timesheet_finalize', 'domain', 'payroll',
                         'source', 'timesheets', 'net_hours', NEW.net_hours),
      'manager', 'payroll');

  -- Adjust: billable times changed on an already-submitted/approved sheet (a
  -- manager edit, not an employee editing their own draft).
  ELSIF (OLD.status IN ('submitted', 'approved') AND (
            NEW.clock_in   IS DISTINCT FROM OLD.clock_in
         OR NEW.clock_out  IS DISTINCT FROM OLD.clock_out
         OR NEW.start_time IS DISTINCT FROM OLD.start_time
         OR NEW.end_time   IS DISTINCT FROM OLD.end_time
         OR NEW.break_minutes IS DISTINCT FROM OLD.break_minutes)) THEN
    INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain)
    VALUES (NEW.shift_id, NEW.employee_id, v_actor, 'OP_APPLIED',
      jsonb_build_object('op', 'timesheet_adjust', 'domain', 'payroll', 'source', 'timesheets',
        'changes', jsonb_strip_nulls(jsonb_build_object(
          'clock_in',      CASE WHEN NEW.clock_in   IS DISTINCT FROM OLD.clock_in   THEN jsonb_build_object('old', OLD.clock_in,   'new', NEW.clock_in)   END,
          'clock_out',     CASE WHEN NEW.clock_out  IS DISTINCT FROM OLD.clock_out  THEN jsonb_build_object('old', OLD.clock_out,  'new', NEW.clock_out)  END,
          'break_minutes', CASE WHEN NEW.break_minutes IS DISTINCT FROM OLD.break_minutes THEN jsonb_build_object('old', OLD.break_minutes, 'new', NEW.break_minutes) END))),
      'manager', 'payroll');
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_capture_timesheet_event ON public.timesheets;
CREATE TRIGGER trg_capture_timesheet_event
    AFTER UPDATE ON public.timesheets
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_capture_timesheet_event();
