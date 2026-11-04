-- ============================================================================
-- Migration: Use clock_timestamp() + ON CONFLICT DO NOTHING for OP_APPLIED
--            shift_events in fn_capture_shift_event & fn_capture_billable_event
-- ============================================================================
-- Prevents transaction-timestamp (`now()`) collisions on `uniq_shift_event`
-- `(shift_id, employee_id, event_type, event_time)` when multiple OP_APPLIED
-- lifecycle or billable transitions execute within the same transaction.

CREATE OR REPLACE FUNCTION public.fn_capture_billable_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.shift_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF (NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved')) THEN
    INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
    VALUES (
      NEW.shift_id,
      NEW.employee_id,
      COALESCE(NEW.approved_by, v_actor),
      'OP_APPLIED',
      clock_timestamp(),
      jsonb_build_object(
        'op', 'timesheet_finalize',
        'domain', 'payroll',
        'source', 'billables',
        'net_minutes', NEW.net_length_minutes
      ),
      'manager',
      'payroll'
    )
    ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
  ELSIF TG_OP = 'UPDATE'
        AND OLD.status IN ('submitted', 'approved')
        AND (
          NEW.billable_start IS DISTINCT FROM OLD.billable_start
          OR NEW.billable_end IS DISTINCT FROM OLD.billable_end
          OR NEW.unpaid_break_minutes IS DISTINCT FROM OLD.unpaid_break_minutes
        ) THEN
    INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
    VALUES (
      NEW.shift_id,
      NEW.employee_id,
      v_actor,
      'OP_APPLIED',
      clock_timestamp(),
      jsonb_build_object(
        'op', 'timesheet_adjust',
        'domain', 'payroll',
        'source', 'billables',
        'changes', jsonb_strip_nulls(jsonb_build_object(
          'billable_start',       CASE WHEN NEW.billable_start IS DISTINCT FROM OLD.billable_start THEN jsonb_build_object('old', OLD.billable_start, 'new', NEW.billable_start) END,
          'billable_end',         CASE WHEN NEW.billable_end IS DISTINCT FROM OLD.billable_end THEN jsonb_build_object('old', OLD.billable_end, 'new', NEW.billable_end) END,
          'unpaid_break_minutes', CASE WHEN NEW.unpaid_break_minutes IS DISTINCT FROM OLD.unpaid_break_minutes THEN jsonb_build_object('old', OLD.unpaid_break_minutes, 'new', NEW.unpaid_break_minutes) END
        ))
      ),
      'manager',
      'payroll'
    )
    ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

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
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', clock_timestamp(),
                jsonb_build_object('op', 'publish', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event'),
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END, 'lifecycle')
            ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Completed' AND OLD.lifecycle_status IS DISTINCT FROM 'Completed') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, 'OP_APPLIED', clock_timestamp(),
                jsonb_build_object(
                    'op', 'complete',
                    'domain', 'lifecycle',
                    'from_state', v_from,
                    'to_state',   v_to,
                    'source', 'fn_capture_shift_event'
                ),
                'lifecycle')
            ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'InProgress' AND OLD.lifecycle_status IS DISTINCT FROM 'InProgress') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', clock_timestamp(),
                jsonb_build_object('op', 'in_progress', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event'),
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'employee' END, 'lifecycle')
            ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Draft' AND OLD.lifecycle_status = 'Published') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', clock_timestamp(),
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

    RETURN NEW;
END;
$function$;

