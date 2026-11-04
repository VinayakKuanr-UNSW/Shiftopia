-- =============================================================================
-- Migration: Tier 3 Track 2A - Drop Low-Caller Attendance & Payroll Columns
-- Dropping: payroll_exported, actual_net_minutes, attendance_note from public.shifts
-- Also patching: fn_capture_shift_event to remove dead references to emergency_assigned_at
-- =============================================================================

-- 1. Update _sync_payroll_record to compute actual_net_minutes directly from punch timestamps
-- and stop syncing payroll_exported from shifts (it lives authoritatively on shift_payroll_records).
CREATE OR REPLACE FUNCTION public._sync_payroll_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF  NEW.actual_start IS DISTINCT FROM OLD.actual_start
     OR NEW.actual_end   IS DISTINCT FROM OLD.actual_end
    THEN
        INSERT INTO shift_payroll_records (
            shift_id,
            actual_start,
            actual_end,
            actual_net_minutes)
        VALUES (
            NEW.id,
            NEW.actual_start,
            NEW.actual_end,
            CASE
                WHEN NEW.actual_start IS NOT NULL AND NEW.actual_end IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (NEW.actual_end - NEW.actual_start)) / 60.0)::integer
                ELSE NULL
            END)
        ON CONFLICT (shift_id) DO UPDATE SET
            actual_start        = EXCLUDED.actual_start,
            actual_end          = EXCLUDED.actual_end,
            actual_net_minutes  = EXCLUDED.actual_net_minutes,
            updated_at          = now()
        WHERE (
            shift_payroll_records.actual_start IS DISTINCT FROM EXCLUDED.actual_start OR
            shift_payroll_records.actual_end   IS DISTINCT FROM EXCLUDED.actual_end
        );
    END IF;
    RETURN NEW;
END;
$function$;

-- 2. Update trigger trg_sync_payroll_record to listen only on actual_start, actual_end
DROP TRIGGER IF EXISTS trg_sync_payroll_record ON public.shifts;
CREATE TRIGGER trg_sync_payroll_record
    AFTER INSERT OR UPDATE OF actual_start, actual_end ON public.shifts
    FOR EACH ROW EXECUTE FUNCTION public._sync_payroll_record();

-- 3. Update sm_clock_out_shift: remove assignment to actual_net_minutes on shifts
CREATE OR REPLACE FUNCTION public.sm_clock_out_shift(
    p_shift_id uuid,
    p_user_id uuid,
    p_lat double precision DEFAULT NULL::double precision,
    p_lon double precision DEFAULT NULL::double precision
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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

  -- P0 fix: see sm_clock_in for rationale.
  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT public.can_act_on_shift('timesheet.approve', p_shift_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to clock out on behalf of this employee');
  END IF;
  IF v_shift.assigned_employee_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift is not assigned to this employee');
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
$function$;

-- 4. Update sm_handle_auto_clock_out: remove assignment to attendance_note on shifts
CREATE OR REPLACE FUNCTION public.sm_handle_auto_clock_out()
 RETURNS TABLE(affected_shift_id uuid, previous_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH resolved AS (
    SELECT
      id,
      lifecycle_status::text AS prev_status,
      GREATEST(
        COALESCE(actual_start, start_at,
          (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ),
        COALESCE(start_at,
          (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ)
      ) AS anchor
    FROM shifts
    WHERE attendance_status IN ('checked_in', 'late')
      AND actual_end IS NULL
      AND lifecycle_status IN ('InProgress', 'Completed')
  ),
  eligible AS (
    SELECT r.id, r.prev_status
    FROM resolved r
    WHERE r.anchor + INTERVAL '12.5 hours' <= now()
  ),
  updated AS (
    UPDATE shifts s SET
      lifecycle_status   = 'Completed',
      attendance_status  = 'auto_clock_out',
      updated_at         = now()
    FROM eligible e
    WHERE s.id = e.id
    RETURNING s.id, e.prev_status
  )
  SELECT u.id, u.prev_status FROM updated u;
END;
$function$;

-- 5. Update fn_capture_shift_event: remove dead references to emergency_assigned_at
CREATE OR REPLACE FUNCTION public.fn_capture_shift_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_from  text;
    v_to    text;
    v_actor uuid;
    v_auto  boolean;
    v_drop  boolean;
BEGIN
    IF current_setting('app.audit.via_gateway', true) = '1' THEN
        RETURN NEW;
    END IF;

    v_actor := auth.uid();
    v_auto  := COALESCE(current_setting('app.audit.actor', true), '') = 'autoscheduler';
    v_drop  := COALESCE(current_setting('app.audit.employee_drop', true), '') = '1';
    v_to := public.get_shift_fsm_state(NEW.lifecycle_status, NEW.assignment_status, NEW.assignment_outcome, NEW.trading_status, NEW.is_cancelled, NEW.bidding_status);
    IF (TG_OP = 'UPDATE') THEN
        v_from := public.get_shift_fsm_state(OLD.lifecycle_status, OLD.assignment_status, OLD.assignment_outcome, OLD.trading_status, OLD.is_cancelled, OLD.bidding_status);
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.assigned_employee_id IS NOT NULL AND OLD.assigned_employee_id IS NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, actor_role)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ASSIGNED', COALESCE(NEW.assigned_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to)
                      || CASE WHEN v_auto THEN jsonb_build_object('source', 'autoscheduler') ELSE '{}'::jsonb END,
                    CASE WHEN v_auto THEN 'autoscheduler' ELSE NULL END);
        ELSIF (NEW.assigned_employee_id IS NULL AND OLD.assigned_employee_id IS NOT NULL AND NOT v_drop) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, OLD.assigned_employee_id, 'UNASSIGNED', now(),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    ELSIF (TG_OP = 'INSERT') THEN
        IF (NEW.assigned_employee_id IS NOT NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, actor_role)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ASSIGNED', COALESCE(NEW.assigned_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to)
                      || CASE WHEN v_auto THEN jsonb_build_object('source', 'autoscheduler') ELSE '{}'::jsonb END,
                    CASE WHEN v_auto THEN 'autoscheduler' ELSE NULL END);
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.fulfillment_status = 'offered' AND OLD.fulfillment_status IS DISTINCT FROM 'offered') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'OFFERED', now(),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.assignment_outcome = 'confirmed' AND OLD.assignment_outcome IS DISTINCT FROM 'confirmed') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ACCEPTED', now(),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        ELSIF (NEW.assignment_outcome = 'emergency_assigned' AND OLD.assignment_outcome IS DISTINCT FROM 'emergency_assigned') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'EMERGENCY_ASSIGNED', now(),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Cancelled' AND OLD.lifecycle_status IS DISTINCT FROM 'Cancelled') THEN
            IF (NEW.start_at IS NOT NULL AND (NEW.start_at - now()) < interval '12 hours') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'LATE_CANCELLED', now(),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            END IF;

            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'CANCELLED', COALESCE(NEW.cancelled_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Published' AND OLD.lifecycle_status IS DISTINCT FROM 'Published'
            AND NOT (NEW.assignment_outcome = 'emergency_assigned'
                     AND OLD.assignment_outcome IS DISTINCT FROM NEW.assignment_outcome)) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', now(),
                jsonb_build_object('op', 'publish', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event'),
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END, 'lifecycle');
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Completed' AND OLD.lifecycle_status IS DISTINCT FROM 'Completed') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, 'OP_APPLIED', now(),
                jsonb_build_object(
                    'op', 'complete',
                    'domain', 'lifecycle',
                    'from_state', v_from,
                    'to_state',   v_to,
                    'source', 'fn_capture_shift_event'
                ),
                'lifecycle');
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'InProgress' AND OLD.lifecycle_status IS DISTINCT FROM 'InProgress') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', COALESCE(NEW.actual_start, now()),
                jsonb_build_object('op', 'in_progress', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event'),
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'employee' END, 'lifecycle');
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Draft' AND OLD.lifecycle_status = 'Published') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', now(),
                jsonb_build_object('op', 'unpublish', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event')
                  || CASE WHEN NEW.last_modified_reason IS NOT NULL
                          AND NEW.last_modified_reason IS DISTINCT FROM OLD.last_modified_reason
                          THEN jsonb_build_object('reason', NEW.last_modified_reason)
                          ELSE '{}'::jsonb END,
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END, 'lifecycle')
            ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.attendance_status IS DISTINCT FROM OLD.attendance_status) THEN
            IF (NEW.attendance_status = 'checked_in') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'CHECKED_IN', COALESCE(NEW.actual_start, now()),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            ELSIF (NEW.attendance_status = 'late') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'LATE_IN', COALESCE(NEW.actual_start, now()),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            ELSIF (NEW.attendance_status = 'no_show') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'NO_SHOW', now(),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

-- 6. Drop the 3 columns from public.shifts
ALTER TABLE public.shifts
  DROP COLUMN IF EXISTS payroll_exported,
  DROP COLUMN IF EXISTS actual_net_minutes,
  DROP COLUMN IF EXISTS attendance_note;
