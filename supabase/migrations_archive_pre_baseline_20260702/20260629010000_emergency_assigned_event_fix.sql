-- =============================================================================
-- Emergency-assigned metric: restore the EMERGENCY_ASSIGNED event signal
-- =============================================================================
-- ROOT CAUSE
--   The "Emergency Assigned" performance metric is sourced from the event-sourcing
--   pipeline:  shift_events('EMERGENCY_ASSIGNED')
--                -> v_shift_assignment_episodes.had_emergency
--                -> assignment_snapshots.source = 'emergency'
--                -> employee_performance_metrics.emergency_assignments.
--
--   The capture trigger fn_capture_shift_event only emits 'EMERGENCY_ASSIGNED' when
--   assignment_outcome transitions to the enum value 'emergency_assigned'. But the
--   FSM reduction (20260619004202 / 20260619004412) changed every emergency / direct
--   force-assign path to write assignment_outcome = 'confirmed' so the shift lands in
--   S4 (Confirmed) instead of the dedicated S7 emergency state. As a result NOTHING
--   writes 'emergency_assigned' anymore, so 'EMERGENCY_ASSIGNED' is never emitted and
--   the metric is permanently 0.
--
-- DESIGN
--   The intended end state is S4 (Confirmed), NOT a resurrected S7 — so we must NOT
--   re-introduce assignment_outcome = 'emergency_assigned' (that maps to S7/S12/S14 in
--   get_shift_fsm_state and would ripple through the card FSM + op-legality guards).
--   Instead we decouple the EMERGENCY *event* from the persisted FSM state by using the
--   dedicated, otherwise-unused shifts.emergency_assigned_at column as the discriminator:
--     * emergency / direct force-assign paths stamp emergency_assigned_at = NOW()
--       while still setting assignment_outcome = 'confirmed' (state stays S4).
--     * fn_capture_shift_event, on a confirm transition, emits 'EMERGENCY_ASSIGNED'
--       when emergency_assigned_at was just set, else the normal 'ACCEPTED'.
--   Normal accept (sm_accept_offer), bid-winner selection (select_bid_winner) and
--   roster sync never set emergency_assigned_at, so they keep emitting 'ACCEPTED'.
--
--   NOTE: this pipeline lives on feat/episode-lifecycle-metrics and is NOT yet applied
--   to prod; this migration extends that not-yet-shipped pipeline.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Capture trigger: emit EMERGENCY_ASSIGNED when emergency_assigned_at is set
--    on a confirm transition (state remains S4). Legacy 'emergency_assigned'
--    outcome branch kept for backward compatibility.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_capture_shift_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
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
    --    A confirm transition is an emergency force-assign when emergency_assigned_at
    --    was just stamped (state stays S4/confirmed); otherwise it is a normal accept.
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
            -- Legacy path (pre-FSM-reduction): the dedicated emergency outcome value.
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
            VALUES (NEW.id, NEW.assigned_employee_id, 'EMERGENCY_ASSIGNED', COALESCE(NEW.emergency_assigned_at, now()));
        END IF;
    END IF;

    -- 4. CANCELLED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Cancelled' AND OLD.lifecycle_status IS DISTINCT FROM 'Cancelled') THEN
            -- Check if it's a late cancellation (< 12 hours before start)
            IF (NEW.start_at IS NOT NULL AND (NEW.start_at - now()) < interval '12 hours') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
                VALUES (NEW.id, NEW.assigned_employee_id, 'LATE_CANCELLED', now());
            END IF;

            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
            VALUES (NEW.id, NEW.assigned_employee_id, 'CANCELLED', COALESCE(NEW.cancelled_at, now()));
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

-- -----------------------------------------------------------------------------
-- 2. sm_emergency_assign: stamp emergency_assigned_at (state stays S4/confirmed)
--    so the confirm transition is captured as EMERGENCY_ASSIGNED.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sm_emergency_assign(p_shift_id uuid, p_employee_id uuid, p_reason text DEFAULT 'Emergency assignment'::text, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_shift RECORD; v_state text; v_name text; v_role text;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); END IF;

  SELECT COALESCE(first_name||' '||COALESCE(last_name,''), email), COALESCE(left(lower(legacy_system_role::text),50),'manager')
    INTO v_name, v_role FROM public.profiles WHERE id = p_user_id;
  v_name := COALESCE(v_name, 'System'); v_role := COALESCE(v_role, 'system');

  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);

  IF v_state NOT IN ('S4', 'S5') THEN
    RETURN jsonb_build_object('success', false, 'error', format('sm_emergency_assign requires state S4 or S5, current state is %s', v_state));
  END IF;

  UPDATE public.shifts SET
    assigned_employee_id = p_employee_id,
    assigned_at = NOW(),
    assignment_status = 'assigned'::public.shift_assignment_status,
    assignment_outcome = 'confirmed'::public.shift_assignment_outcome,
    assignment_source = 'direct',
    bidding_status = 'not_on_bidding'::public.shift_bidding_status,
    is_on_bidding = FALSE,
    fulfillment_status = 'scheduled'::public.shift_fulfillment_status,
    confirmed_at = NOW(),
    emergency_assigned_at = NOW(),
    compliance_checked_at = NOW(),
    last_modified_by = p_user_id,
    updated_at = NOW()
  WHERE id = p_shift_id;

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S4', 'assigned_to', p_employee_id);
END; $function$;

-- -----------------------------------------------------------------------------
-- 3. emergency_assign_shift (legacy): same emergency_assigned_at stamp.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emergency_assign_shift(p_shift_id uuid, p_employee_id uuid, p_assigned_by uuid, p_reason text DEFAULT 'Emergency assignment'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift RECORD;
    v_compliance RECORD;
BEGIN
    SELECT * INTO v_shift
    FROM shifts WHERE id = p_shift_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
    END IF;

    IF v_shift.lifecycle_status != 'Published'
       OR v_shift.assigned_employee_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift cannot be emergency assigned');
    END IF;

    SELECT * INTO v_compliance
    FROM check_shift_compliance(v_shift.roster_shift_id, p_employee_id);

    IF v_compliance.compliance_status = 'blocked' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Compliance check failed', 'violations', v_compliance.violations);
    END IF;

    UPDATE shifts SET
        assigned_employee_id = p_employee_id,
        assigned_at = NOW(),
        assignment_status = 'assigned'::shift_assignment_status,
        assignment_outcome = 'confirmed'::shift_assignment_outcome,
        fulfillment_status = 'fulfilled'::shift_fulfillment_status,
        confirmed_at = NOW(),
        emergency_assigned_at = NOW(),
        is_on_bidding = FALSE,
        bidding_status = 'not_on_bidding'::shift_bidding_status,
        locked_at = COALESCE(locked_at, NOW()),
        offer_expires_at = NULL,
        offer_sent_at = NULL,
        eligibility_snapshot = v_compliance.eligibility_snapshot,
        compliance_checked_at = NOW(),
        updated_at = NOW(),
        last_modified_by = p_assigned_by,
        last_modified_reason = p_reason
    WHERE id = p_shift_id;

    UPDATE public.shift_offers
    SET status = 'Expired', responded_at = NOW(), response_notes = 'Superseded by direct assignment'
    WHERE shift_id = p_shift_id AND status = 'Pending';

    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'employee_id', p_employee_id,
        'transition', 'S5 -> S4',
        'new_state', 'confirmed'
    );
END;
$function$;
