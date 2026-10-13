-- ============================================================================
-- Fix Clock Out Shift Event Unique Constraint Conflict
--
-- Prevents sm_clock_out_shift from failing with HTTP 409 / duplicate key error
-- on the `uniq_shift_event` unique constraint ("shift_id", "employee_id",
-- "event_type", "event_time") during rapid or concurrent clock-out operations.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sm_clock_out_shift(
    p_shift_id uuid,
    p_user_id uuid,
    p_lat double precision DEFAULT NULL::double precision,
    p_lon double precision DEFAULT NULL::double precision
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_shift         shifts%ROWTYPE;
  v_org           organizations%ROWTYPE;
  v_now           TIMESTAMPTZ := clock_timestamp();
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

  v_from_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status, v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status,
    v_shift.is_cancelled, v_shift.bidding_status
  );

  UPDATE shifts SET
    actual_end         = v_now,
    actual_net_minutes = round(v_net_minutes::NUMERIC, 0),
    lifecycle_status   = 'Completed',
    updated_at         = v_now
  WHERE id = p_shift_id;

  v_to_state := public.get_shift_fsm_state(
    'Completed', v_shift.assignment_status,
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
  )
  ON CONFLICT (shift_id, employee_id, event_type, event_time) DO NOTHING;

  RETURN jsonb_build_object(
    'success',          true,
    'actual_end',       v_now,
    'actual_net_minutes', round(v_net_minutes::NUMERIC, 0),
    'early_out',        v_early_out,
    'distance_m',       round(v_distance_m::NUMERIC, 1)
  );
END;
$$;
