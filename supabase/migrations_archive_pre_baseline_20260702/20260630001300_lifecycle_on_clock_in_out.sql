-- Fix: lifecycle_status not transitioning on clock-in / clock-out.
--
-- Bug #1 — check_in_shift (the RPC called by the app) only updates
--          attendance_status + actual_start. It never sets lifecycle_status
--          to 'InProgress', so the badge stays S4 until the cron catches up.
--
-- Bug #2 — sm_clock_out_shift only sets actual_end / actual_net_minutes.
--          lifecycle_status stays 'InProgress' until the cron fires.
--
-- Fix A: check_in_shift — add lifecycle_status = 'InProgress'.
-- Fix B: sm_clock_out_shift — add lifecycle_status = 'Completed' and fix
--        the audit event to_state to reflect the post-update Completed state.
--
-- Both existing trigger branches in fn_capture_shift_event (4b: Completed,
-- 4c: InProgress) fire automatically on the lifecycle column change, so the
-- audit timeline events are emitted without any additional work.
--
-- The cron (process_shift_timers steps 3+4) is a no-op for shifts already
-- in the target state, so there is no double-transition risk.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- Fix A: check_in_shift — add lifecycle_status = 'InProgress'
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."check_in_shift"("p_shift_id" "uuid", "p_lat" double precision, "p_lon" double precision) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_shift           shifts%ROWTYPE;
  v_now             TIMESTAMPTZ := now();
  v_effective_start TIMESTAMPTZ;
  v_distance_m      DOUBLE PRECISION := 0;
  v_min_distance_m  DOUBLE PRECISION;
  v_new_status      shift_attendance_status;
  v_loc             RECORD;
  v_any_location    BOOLEAN := false;
  v_inside          BOOLEAN := false;
  v_earth_radius    CONSTANT DOUBLE PRECISION := 6371000;
  v_lat1_rad        DOUBLE PRECISION;
  v_lat2_rad        DOUBLE PRECISION;
  v_dlat            DOUBLE PRECISION;
  v_dlon            DOUBLE PRECISION;
  v_a               DOUBLE PRECISION;
  v_dist            DOUBLE PRECISION;
  v_org             organizations%ROWTYPE;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
  END IF;

  IF v_shift.assigned_employee_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift has no assigned employee');
  END IF;

  IF v_shift.attendance_status != 'unknown' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already clocked in for this shift');
  END IF;

  -- Effective start: use start_at if set, else derive from shift_date + start_time (Sydney TZ)
  IF v_shift.start_at IS NOT NULL THEN
    v_effective_start := v_shift.start_at;
  ELSE
    v_effective_start := (v_shift.shift_date::text || ' ' || v_shift.start_time::text || ' Australia/Sydney')::TIMESTAMPTZ;
  END IF;

  -- Clock-in window: [start - 1 h,  start + 12.5 h (750 min)]
  IF v_now < v_effective_start - INTERVAL '1 hour' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Clock-in window not open yet');
  END IF;

  IF v_now > v_effective_start + INTERVAL '750 minutes' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Clock-in window has closed (more than 12.5 hours after shift start)'
    );
  END IF;

  -- Geolocation required
  IF p_lat IS NULL OR p_lon IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'GPS location is required to clock in');
  END IF;

  -- Multi-geofence check against allowed_locations
  v_min_distance_m := NULL;
  v_inside := false;
  FOR v_loc IN
    SELECT lat, lng, radius_m
    FROM allowed_locations
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
      'error',      'You are too far from any allowed location to clock in',
      'distance_m', round(COALESCE(v_min_distance_m, 0)::NUMERIC, 1)
    );
  END IF;

  -- Fallback: no allowed_locations → check org.venue_lat/venue_lon
  IF NOT v_any_location THEN
    SELECT * INTO v_org FROM organizations WHERE id = v_shift.organization_id;
    IF v_org.venue_lat IS NOT NULL AND v_org.venue_lon IS NOT NULL THEN
      v_lat1_rad := radians(v_org.venue_lat);
      v_lat2_rad := radians(p_lat);
      v_dlat     := radians(p_lat - v_org.venue_lat);
      v_dlon     := radians(p_lon - v_org.venue_lon);
      v_a        := sin(v_dlat / 2)^2 + cos(v_lat1_rad) * cos(v_lat2_rad) * sin(v_dlon / 2)^2;
      v_distance_m := v_earth_radius * 2 * atan2(sqrt(v_a), sqrt(1 - v_a));
      IF v_distance_m > 100 THEN
        RETURN jsonb_build_object(
          'success',    false,
          'error',      'You are too far from the venue to clock in',
          'distance_m', round(v_distance_m::NUMERIC, 1)
        );
      END IF;
    END IF;
    -- No geofence configured → allow clock-in
  END IF;

  -- Status: at/before start → checked_in, after start → late
  IF v_now <= v_effective_start THEN
    v_new_status := 'checked_in';
  ELSE
    v_new_status := 'late';
  END IF;

  -- ── FIX: also set lifecycle_status to InProgress (was missing) ──
  -- fn_capture_shift_event branch 4c fires on this transition and emits
  -- the in_progress audit event automatically.
  UPDATE shifts SET
    attendance_status = v_new_status,
    actual_start      = v_now,
    lifecycle_status  = 'InProgress',
    updated_at        = v_now
  WHERE id = p_shift_id;

  RETURN jsonb_build_object(
    'success',           true,
    'attendance_status', v_new_status::text,
    'actual_start',      v_now,
    'distance_m',        round(v_distance_m::NUMERIC, 1)
  );
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Fix B: sm_clock_out_shift — add lifecycle_status = 'Completed'
--        and fix audit event to_state to reflect post-update Completed state.
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
  v_from_state    TEXT;
  v_to_state      TEXT;
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

  -- Capture pre-update FSM state for the audit event
  v_from_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status, v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status,
    v_shift.is_cancelled, v_shift.bidding_status
  );

  -- ── FIX: also set lifecycle_status to Completed (was deferred to cron) ──
  -- fn_capture_shift_event branch 4b fires on this transition and emits
  -- the complete audit event automatically.
  UPDATE shifts SET
    actual_end         = v_now,
    actual_net_minutes = round(v_net_minutes::NUMERIC, 0),
    lifecycle_status   = 'Completed',
    updated_at         = v_now
  WHERE id = p_shift_id;

  -- Compute post-update FSM state (now Completed) for the departure audit event
  v_to_state := public.get_shift_fsm_state(
    'Completed', v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status,
    v_shift.is_cancelled, v_shift.bidding_status
  );

  -- AUDIT: record the departure event. EARLY_OUT feeds the early-out metric;
  -- on-time/late departures use a neutral OP_APPLIED. from_state shows pre-
  -- clock-out (InProgress), to_state shows post-clock-out (Completed).
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
      'from_state', v_from_state,
      'to_state',   v_to_state,
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
