-- ============================================================================
-- KPI consolidation — make employee shift drops observable.
--
-- WHY THIS EXISTS
-- ---------------
-- Every cancellation metric in the product (cancel_standard, cancel_late,
-- cancel_rate, late_cancel_rate, standard_drop_rate, urgent_drop_rate,
-- drop_rate) is derived from v_shift_assignment_episodes.terminal_outcome
-- being 'cancelled_standard' or 'cancelled_late'. That in turn requires a
-- CANCELLED or LATE_CANCELLED row in shift_events.
--
-- No such row has ever been written for an employee drop:
--
--   * sm_employee_drop_shift only nulls assigned_employee_id. It accepts a
--     p_reason argument and discards it — the reason is never persisted.
--   * fn_capture_shift_event emits CANCELLED / LATE_CANCELLED only when
--     lifecycle_status transitions to 'Cancelled', i.e. when a MANAGER cancels
--     the whole shift. An employee drop takes the assigned -> NULL branch and
--     produces UNASSIGNED, which the episodes view maps to 'unassigned' and
--     sm_refresh_shift_snapshots maps to end_reason 'reassigned'.
--
-- Production confirms it: 0 CANCELLED and 0 LATE_CANCELLED events exist, and
-- the single employee drop on record shows as UNASSIGNED. So the cancellation
-- family of metrics is structurally zero, not merely empty.
--
-- WHAT THIS DOES
-- --------------
--   1. cancellation_reasons — the pre-populated list an employee picks from.
--   2. sm_employee_drop_shift — validates the reason, writes the CANCELLED /
--      LATE_CANCELLED event carrying the reason, and records notice hours.
--   3. fn_capture_shift_event — suppresses its UNASSIGNED branch for that one
--      write, so a drop produces exactly one closing event.
--
-- STANDARD vs URGENT
-- ------------------
-- There are exactly two kinds. The discriminator is notice, not intent, and
-- the boundary is the 4-hour late_cancel_threshold already hard-coded in
-- v_shift_assignment_episodes:
--
--   notice >= 4h  -> CANCELLED       -> cancelled_standard -> "standard"
--   notice <  4h  -> LATE_CANCELLED  -> cancelled_late     -> "urgent"
--
-- The employee-facing drop button is itself blocked inside 4 hours
-- (ShiftDetailsDialog), so urgent cancellations can only arise from a
-- manager-side or override path. That is a product gap, not a bug here.
-- ============================================================================

-- ── 1. Reason catalogue ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cancellation_reasons (
    code           text PRIMARY KEY,
    label          text        NOT NULL,
    description    text,
    -- Free-text note becomes mandatory (e.g. "Other").
    requires_note  boolean     NOT NULL DEFAULT false,
    sort_order     integer     NOT NULL DEFAULT 100,
    is_active      boolean     NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cancellation_reasons IS
    'Pre-populated reasons an employee chooses from when dropping a shift. '
    'Read-only to employees; the manager KPI dashboard aggregates the distribution.';

INSERT INTO public.cancellation_reasons (code, label, description, requires_note, sort_order) VALUES
    ('ILLNESS',           'Illness',                 'Unwell and unable to work the shift',                 false, 10),
    ('INJURY',            'Injury',                  'Injured and unable to work the shift',                false, 20),
    ('FAMILY_EMERGENCY',  'Family emergency',        'Urgent family or carer responsibility',               false, 30),
    ('TRANSPORT',         'Transport problem',       'Unable to reach the venue',                           false, 40),
    ('STUDY',             'Study or exam',           'Class, placement or assessment clash',                false, 50),
    ('WORK_CONFLICT',     'Clashing work commitment','Committed to other work for the same window',         false, 60),
    ('ROSTER_ERROR',      'Rostered in error',       'Should not have been rostered for this shift',        false, 70),
    ('PERSONAL',          'Personal reason',         'Personal circumstances',                              false, 80),
    ('OTHER',             'Other',                   'Anything not covered above — a note is required',     true, 999)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.cancellation_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cancellation_reasons_read ON public.cancellation_reasons;
CREATE POLICY cancellation_reasons_read
    ON public.cancellation_reasons
    FOR SELECT
    TO authenticated
    USING (true);

REVOKE ALL     ON TABLE public.cancellation_reasons FROM PUBLIC, anon;
GRANT  SELECT  ON TABLE public.cancellation_reasons TO authenticated;
GRANT  ALL     ON TABLE public.cancellation_reasons TO service_role;

-- ── 2. Drop writes a real closing event ─────────────────────────────────────
-- DROP + CREATE, not CREATE OR REPLACE: the argument list gains p_reason_code,
-- and an overload differing only by a defaulted trailing argument makes the
-- PostgREST call ambiguous. Grants restored below.

DROP FUNCTION IF EXISTS public.sm_employee_drop_shift(uuid, uuid, text);

CREATE FUNCTION public.sm_employee_drop_shift(
    p_shift_id    uuid,
    p_employee_id uuid DEFAULT auth.uid(),
    p_reason      text DEFAULT NULL,
    p_reason_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_shift          RECORD;
    v_state          text;
    v_reason         public.cancellation_reasons%ROWTYPE;
    v_notice         interval;
    v_notice_hours   numeric;
    v_is_urgent      boolean;
    v_event_type     public.shift_event_type;
    v_threshold      constant interval := interval '4 hours';
BEGIN
    SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id AND deleted_at IS NULL FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
    END IF;

    IF v_shift.assigned_employee_id IS DISTINCT FROM p_employee_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You are not assigned to this shift');
    END IF;

    v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status,
                                          v_shift.assignment_outcome, v_shift.trading_status,
                                          v_shift.is_cancelled);

    IF v_state NOT IN ('S3', 'S4') THEN
        RETURN jsonb_build_object('success', false,
            'error', format('sm_employee_drop_shift requires state S3 or S4, current state is %s', v_state));
    END IF;

    -- Reason is now structured. NULL is still accepted so existing callers do
    -- not break mid-deploy, but a supplied code must be real and active.
    IF p_reason_code IS NOT NULL THEN
        SELECT * INTO v_reason
        FROM public.cancellation_reasons
        WHERE code = p_reason_code AND is_active;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false,
                'error', format('Unknown cancellation reason: %s', p_reason_code));
        END IF;

        IF v_reason.requires_note AND COALESCE(btrim(p_reason), '') = '' THEN
            RETURN jsonb_build_object('success', false,
                'error', format('Reason "%s" requires a note', v_reason.label));
        END IF;
    END IF;

    v_notice       := v_shift.start_at - now();
    v_notice_hours := ROUND(EXTRACT(epoch FROM v_notice)::numeric / 3600, 2);
    v_is_urgent    := v_shift.start_at IS NOT NULL AND v_notice < v_threshold;
    v_event_type   := CASE WHEN v_is_urgent THEN 'LATE_CANCELLED' ELSE 'CANCELLED' END::public.shift_event_type;

    -- Suppress fn_capture_shift_event's UNASSIGNED branch for this write only.
    -- Transaction-local (third arg true), mirroring app.audit.via_gateway.
    PERFORM set_config('app.audit.employee_drop', '1', true);

    UPDATE public.shifts SET
        assigned_employee_id = NULL,
        assigned_at          = NULL,
        assignment_status    = 'unassigned'::public.shift_assignment_status,
        assignment_outcome   = NULL,
        bidding_status       = 'on_bidding'::public.shift_bidding_status,
        is_on_bidding        = TRUE,
        fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
        confirmed_at         = NULL,
        last_dropped_by      = p_employee_id,
        last_rejected_by     = NULL,
        last_modified_by     = p_employee_id,
        updated_at           = NOW()
    WHERE id = p_shift_id;

    PERFORM set_config('app.audit.employee_drop', '0', true);

    -- The closing event every cancellation metric reads. employee_id is the
    -- person who dropped it — the shift row no longer carries them.
    INSERT INTO public.shift_events
        (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
    VALUES (
        p_shift_id,
        p_employee_id,
        p_employee_id,
        v_event_type,
        now(),
        jsonb_build_object(
            'op',           'employee_drop',
            'from_state',   v_state,
            'to_state',     'S5',
            'cancellation', CASE WHEN v_is_urgent THEN 'urgent' ELSE 'standard' END,
            'notice_hours', v_notice_hours,
            'source',       'sm_employee_drop_shift'
        )
        || CASE WHEN p_reason_code IS NOT NULL
                THEN jsonb_build_object('reason_code', p_reason_code) ELSE '{}'::jsonb END
        || CASE WHEN COALESCE(btrim(p_reason), '') <> ''
                THEN jsonb_build_object('reason_note', btrim(p_reason)) ELSE '{}'::jsonb END,
        'employee',
        'assignment'
    )
    ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;

    RETURN jsonb_build_object(
        'success',      true,
        'from_state',   v_state,
        'to_state',     'S5',
        'cancellation', CASE WHEN v_is_urgent THEN 'urgent' ELSE 'standard' END,
        'notice_hours', v_notice_hours
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sm_employee_drop_shift(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sm_employee_drop_shift(uuid, uuid, text, text) TO authenticated, service_role;

-- ── 3. Trigger yields the closing event to the RPC ──────────────────────────
-- Only the UNASSIGNED branch changes. Everything else is byte-identical to the
-- deployed definition read from pg_get_functiondef().

CREATE OR REPLACE FUNCTION public.fn_capture_shift_event()
RETURNS trigger
LANGUAGE plpgsql
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
    -- sm_employee_drop_shift writes its own CANCELLED / LATE_CANCELLED event
    -- so the drop carries a reason. Without this guard the same UPDATE also
    -- produced an UNASSIGNED event, and the episodes view would close the
    -- episode as 'unassigned' — which is exactly why no drop has ever counted
    -- as a cancellation.
    v_drop  := COALESCE(current_setting('app.audit.employee_drop', true), '') = '1';
    v_to := public.get_shift_fsm_state(NEW.lifecycle_status, NEW.assignment_status, NEW.assignment_outcome, NEW.trading_status, NEW.is_cancelled, NEW.bidding_status);
    IF (TG_OP = 'UPDATE') THEN
        v_from := public.get_shift_fsm_state(OLD.lifecycle_status, OLD.assignment_status, OLD.assignment_outcome, OLD.trading_status, OLD.is_cancelled, OLD.bidding_status);
    END IF;

    -- 1. ASSIGNED / UNASSIGNED
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

    -- 4. CANCELLED (manager cancels the whole shift)
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

    -- 4a. PUBLISHED — skipped when this write is an emergency assignment.
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Published' AND OLD.lifecycle_status IS DISTINCT FROM 'Published'
            AND NOT (NEW.emergency_assigned_at IS NOT NULL
                     AND OLD.emergency_assigned_at IS DISTINCT FROM NEW.emergency_assigned_at)) THEN
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

    -- 4c. IN PROGRESS — lifecycle -> InProgress (S4 -> S11).
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

    -- 4d. UNPUBLISHED — lifecycle Published -> Draft.
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
