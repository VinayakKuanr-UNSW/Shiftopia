-- =============================================================================
-- Shift Audit System — capture PUBLISH + IN-PROGRESS so the timeline is coherent.
-- =============================================================================
-- The audit timeline read incoherently because two lifecycle transitions were
-- never recorded as events:
--   * Draft → Published  (S2 → S4)   — publish
--   * Published → InProgress (S4 → S11) — shift start
-- so a clocked-in/clocked-out shift appeared to still be a Draft (S2) — the UI's
-- carry-forward had no anchor to advance the state. The honest fix is to RECORD
-- the transitions, not interpolate them.
--
-- 1. fn_capture_shift_event gains two branches (mirroring the COMPLETED branch):
--    lifecycle → Published emits op=publish; lifecycle → InProgress emits
--    op=in_progress. Both neutral OP_APPLIED + metadata.{op,from_state,to_state}.
--    The via_gateway guard still short-circuits gateway-driven writes (no dupes).
--
-- 2. Backfill: synthesise publish + in_progress for existing InProgress/Completed
--    shifts that lack them, from the shift's own timestamps. published_at is often
--    NULL, so publish is anchored just before the in-progress moment when needed
--    (re-publish aware: only added when no publish exists AFTER the last unpublish).
--    Idempotent, tagged source='backfill_lifecycle_states_20260630' for rollback.
--
-- Append-only to public.shift_events; op=publish/in_progress are OP_APPLIED and
-- are not counted by any metric. Forward capture is the durable fix.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_capture_shift_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    -- Net FSM transition for this row write, shared by every event it emits.
    v_from  text;
    v_to    text;
    v_actor uuid;
BEGIN
    IF current_setting('app.audit.via_gateway', true) = '1' THEN
        RETURN NEW;
    END IF;

    v_actor := auth.uid();
    v_to := public.get_shift_fsm_state(NEW.lifecycle_status, NEW.assignment_status, NEW.assignment_outcome, NEW.trading_status, NEW.is_cancelled, NEW.bidding_status);
    IF (TG_OP = 'UPDATE') THEN
        v_from := public.get_shift_fsm_state(OLD.lifecycle_status, OLD.assignment_status, OLD.assignment_outcome, OLD.trading_status, OLD.is_cancelled, OLD.bidding_status);
    END IF;

    -- 1. ASSIGNED / UNASSIGNED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.assigned_employee_id IS NOT NULL AND OLD.assigned_employee_id IS NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ASSIGNED', COALESCE(NEW.assigned_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        ELSIF (NEW.assigned_employee_id IS NULL AND OLD.assigned_employee_id IS NOT NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, OLD.assigned_employee_id, 'UNASSIGNED', now(),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    ELSIF (TG_OP = 'INSERT') THEN
        IF (NEW.assigned_employee_id IS NOT NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ASSIGNED', COALESCE(NEW.assigned_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    END IF;

    -- 2. OFFERED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.fulfillment_status = 'offered' AND OLD.fulfillment_status IS DISTINCT FROM 'offered') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'OFFERED', COALESCE(NEW.offer_sent_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    END IF;

    -- 3. ACCEPTED / EMERGENCY_ASSIGNED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.assignment_outcome = 'confirmed' AND OLD.assignment_outcome IS DISTINCT FROM 'confirmed') THEN
            IF (NEW.emergency_assigned_at IS NOT NULL
                AND OLD.emergency_assigned_at IS DISTINCT FROM NEW.emergency_assigned_at) THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'EMERGENCY_ASSIGNED', COALESCE(NEW.emergency_assigned_at, now()),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            ELSE
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'ACCEPTED', COALESCE(NEW.confirmed_at, now()),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            END IF;
        ELSIF (NEW.assignment_outcome = 'emergency_assigned' AND OLD.assignment_outcome IS DISTINCT FROM 'emergency_assigned') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'EMERGENCY_ASSIGNED', COALESCE(NEW.emergency_assigned_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    END IF;

    -- 4. CANCELLED
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

    -- 4a. PUBLISHED — lifecycle -> Published (S2 -> S4). Catch-all for non-gateway
    --     publishes; gateway publishes already emit op=publish + short-circuit here.
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Published' AND OLD.lifecycle_status IS DISTINCT FROM 'Published') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', now(),
                jsonb_build_object('op', 'publish', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event'),
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END, 'lifecycle');
        END IF;
    END IF;

    -- 4b. COMPLETED — lifecycle -> Completed.
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

    -- 4c. IN PROGRESS — lifecycle -> InProgress (S4 -> S11). Usually a start cron
    --     (system) or an early clock-in flipping the lifecycle.
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

    -- 5. ATTENDANCE (CHECKED_IN, LATE_IN, NO_SHOW)
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: give existing InProgress/Completed shifts their publish + in_progress
-- anchors so historical timelines read coherently (S2 → S4 → S11 → …).
-- ─────────────────────────────────────────────────────────────────────────────

-- PUBLISH — only when the shift has no publish AFTER its latest unpublish (so a
-- re-published shift gets its second publish too). Anchored at published_at when
-- present, else 1s before the in-progress moment (published_at is frequently NULL).
INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
SELECT
    s.id, s.assigned_employee_id, s.last_modified_by, 'OP_APPLIED',
    COALESCE(s.published_at, COALESCE(s.actual_start, s.start_at) - interval '1 second'),
    jsonb_build_object('op', 'publish', 'domain', 'lifecycle',
        'from_state', public.get_shift_fsm_state('Draft',     s.assignment_status, s.assignment_outcome, s.trading_status, s.is_cancelled, s.bidding_status),
        'to_state',   public.get_shift_fsm_state('Published', s.assignment_status, s.assignment_outcome, s.trading_status, s.is_cancelled, s.bidding_status),
        'source', 'backfill_lifecycle_states_20260630'),
    CASE WHEN s.last_modified_by IS NULL THEN 'system' ELSE 'manager' END, 'lifecycle'
FROM public.shifts s
WHERE s.deleted_at IS NULL
  AND s.lifecycle_status IN ('InProgress', 'Completed')
  AND COALESCE(s.actual_start, s.start_at) IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.shift_events e
      WHERE e.shift_id = s.id AND e.metadata->>'op' = 'publish'
        AND e.event_time > COALESCE(
              (SELECT max(u.event_time) FROM public.shift_events u
               WHERE u.shift_id = s.id AND u.metadata->>'op' = 'unpublish'),
              '-infinity'::timestamptz)
  );

-- IN PROGRESS — one per started shift, at the clock-in (else scheduled start).
INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, actor_role, domain)
SELECT
    s.id, s.assigned_employee_id, 'OP_APPLIED',
    COALESCE(s.actual_start, s.start_at),
    jsonb_build_object('op', 'in_progress', 'domain', 'lifecycle',
        'from_state', public.get_shift_fsm_state('Published',  s.assignment_status, s.assignment_outcome, s.trading_status, s.is_cancelled, s.bidding_status),
        'to_state',   public.get_shift_fsm_state('InProgress', s.assignment_status, s.assignment_outcome, s.trading_status, s.is_cancelled, s.bidding_status),
        'source', 'backfill_lifecycle_states_20260630'),
    'system', 'lifecycle'
FROM public.shifts s
WHERE s.deleted_at IS NULL
  AND s.lifecycle_status IN ('InProgress', 'Completed')
  AND COALESCE(s.actual_start, s.start_at) IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.shift_events e
      WHERE e.shift_id = s.id AND e.metadata->>'op' = 'in_progress'
  );
