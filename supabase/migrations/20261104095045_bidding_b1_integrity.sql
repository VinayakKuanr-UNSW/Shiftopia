-- ============================================================================
-- Bidding B1 — bid integrity (docs/design/shift-trading/03-bidding-fsm.md).
--   * sm_place_bid: the one way to bid. S5 only, before start, not by whoever
--     dropped or rejected the shift, and not on a hard impossibility (leave,
--     overlap, qualifications, employment target). A closed bid reopens with a
--     fresh created_at, so a re-bid rejoins the back of the queue.
--   * Bid statuses 'expired' (no winner by start) and 'cancelled'.
--   * trg_shift_close_bids: whenever a shift leaves S5, its pending bids end
--     (single owner; never patch each path).
--   * trg_leave_cancel_bids: approved leave cancels pending bids on its dates.
--   * sm_select_bid_winner: the 4h lock (an emergent-lane relic) is gone; a
--     winner may be picked until the shift starts.
--   * trg_bid_outcome_notification: tells bidders about expired / cancelled.
--   * fn_capture_shift_event: cancelling an UNASSIGNED shift wrote CANCELLED /
--     LATE_CANCELLED with a NULL employee, which fn_validate_shift_event
--     refuses. The first S5 shift to reach its start would have aborted every
--     process_shift_timers run from then on. It now logs OP_APPLIED 'cancel'.
-- Client write grants on shift_bids are revoked in B2, once the app that
-- places bids through sm_place_bid is deployed.
-- ============================================================================

ALTER TABLE public.shift_bids DROP CONSTRAINT shift_bids_status_check;
ALTER TABLE public.shift_bids ADD CONSTRAINT shift_bids_status_check
  CHECK (status = ANY (ARRAY['pending', 'accepted', 'rejected', 'withdrawn', 'expired', 'cancelled']));

CREATE OR REPLACE FUNCTION public.sm_place_bid(p_shift_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_shift  public.shifts%ROWTYPE;
  v_bid    public.shift_bids%ROWTYPE;
  v_rule   text;
  v_detail text;
  v_bid_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated', 'code', 'UNAUTHENTICATED');
  END IF;

  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND OR public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status,
       v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled, v_shift.bidding_status) <> 'S5' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This shift is not open for bidding', 'code', 'NOT_ON_BIDDING');
  END IF;
  IF COALESCE(v_shift.start_at, (v_shift.shift_date::text || ' ' || v_shift.start_time::text)::timestamp
                                AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney')) <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bidding closed: the shift has started', 'code', 'BIDDING_CLOSED');
  END IF;
  IF v_caller IN (v_shift.last_dropped_by, v_shift.last_rejected_by) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You dropped or declined this shift, so you cannot bid on it', 'code', 'EXCLUDED');
  END IF;

  SELECT * INTO v_bid FROM public.shift_bids
   WHERE shift_id = p_shift_id AND employee_id = v_caller FOR UPDATE;
  IF FOUND AND v_bid.status = 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'You have already bid on this shift', 'code', 'ALREADY_BID');
  END IF;

  -- hard impossibilities only; every other rule is checked when a winner is picked
  SELECT c.rule_id, c.details INTO v_rule, v_detail
    FROM internal.eba_check_assignment(p_shift_id, v_caller) c
   WHERE c.tier = 'BLOCKING'
     AND c.rule_id IN ('V8_LEAVE_CONFLICT', 'V8_NO_OVERLAP', 'V8_QUALIFICATIONS',
                       'V8_QUALIFICATION_EXPIRED', 'V8_EMPLOYMENT_TARGET')
   LIMIT 1;
  IF v_rule IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_detail, 'code', v_rule);
  END IF;

  IF v_bid.id IS NULL THEN
    INSERT INTO public.shift_bids (shift_id, employee_id, status, notes)
    VALUES (p_shift_id, v_caller, 'pending', p_notes)
    RETURNING id INTO v_bid_id;
  ELSE
    UPDATE public.shift_bids SET
      status      = 'pending',
      notes       = p_notes,
      created_at  = now(),
      reviewed_at = NULL,
      reviewed_by = NULL,
      updated_at  = now()
    WHERE id = v_bid.id
    RETURNING id INTO v_bid_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'bid_id', v_bid_id);
EXCEPTION WHEN unique_violation THEN
  -- a concurrent bid by the same employee won the race
  RETURN jsonb_build_object('success', false, 'error', 'You have already bid on this shift', 'code', 'ALREADY_BID');
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_shift_close_bids()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.assigned_employee_id IS NOT NULL AND NEW.lifecycle_status = 'Published' AND NOT NEW.is_cancelled THEN
    -- filled: by a winner, or directly by a manager
    UPDATE public.shift_bids SET status = 'accepted', updated_at = now()
     WHERE shift_id = NEW.id AND employee_id = NEW.assigned_employee_id AND status = 'pending';
    UPDATE public.shift_bids SET status = 'rejected', updated_at = now()
     WHERE shift_id = NEW.id AND status = 'pending';
  ELSIF (NEW.is_cancelled OR NEW.lifecycle_status = 'Cancelled')
        AND COALESCE(NEW.start_at, (NEW.shift_date::text || ' ' || NEW.start_time::text)::timestamp
                                   AT TIME ZONE COALESCE(NEW.timezone, 'Australia/Sydney')) <= now() THEN
    -- reached its start with no winner
    UPDATE public.shift_bids SET status = 'expired', updated_at = now()
     WHERE shift_id = NEW.id AND status = 'pending';
  ELSE
    -- unpublished, or cancelled by a manager before start
    UPDATE public.shift_bids SET status = 'cancelled', updated_at = now()
     WHERE shift_id = NEW.id AND status = 'pending';
  END IF;
  RETURN NULL;
END;
$function$;

-- fires on every way out of S5 (Published, unassigned, not cancelled)
CREATE TRIGGER trg_shift_close_bids
  AFTER UPDATE OF lifecycle_status, assignment_status, assigned_employee_id, is_cancelled ON public.shifts
  FOR EACH ROW
  WHEN (OLD.lifecycle_status = 'Published' AND OLD.assignment_status IS DISTINCT FROM 'assigned'
        AND NOT COALESCE(OLD.is_cancelled, false)
        AND (NEW.lifecycle_status IS DISTINCT FROM 'Published' OR NEW.assignment_status = 'assigned'
             OR COALESCE(NEW.is_cancelled, false)))
  EXECUTE FUNCTION public.fn_shift_close_bids();

CREATE OR REPLACE FUNCTION public.fn_leave_cancel_bids()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  UPDATE public.shift_bids b SET status = 'cancelled', updated_at = now()
    FROM public.shifts s
   WHERE s.id = b.shift_id
     AND b.employee_id = NEW.employee_id
     AND b.status = 'pending'
     AND s.shift_date BETWEEN (NEW.start_date AT TIME ZONE 'UTC')::date
                          AND (NEW.end_date   AT TIME ZONE 'UTC')::date;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER trg_leave_cancel_bids
  AFTER INSERT OR UPDATE OF status ON public.leave_requests
  FOR EACH ROW
  WHEN (NEW.status = 'approved')
  EXECUTE FUNCTION public.fn_leave_cancel_bids();

CREATE OR REPLACE FUNCTION public.sm_select_bid_winner(p_shift_id uuid, p_winner_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_shift  public.shifts%ROWTYPE;
  v_state  text;
  v_ver    int;
  v_idem   uuid;
  v_result jsonb;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR SHARE;
  IF NOT FOUND OR v_shift.is_cancelled THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_GONE');
  END IF;
  v_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome,
    v_shift.trading_status, v_shift.is_cancelled, v_shift.bidding_status);
  IF NOT public.fsm_op_is_legal(v_state, 'select_winner') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ILLEGAL_STATE', 'state', v_state);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.shift_bids
    WHERE shift_id = p_shift_id AND employee_id = p_winner_id AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'WINNER_NOT_PENDING');
  END IF;
  IF v_shift.start_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'BIDDING_CLOSED');
  END IF;
  v_ver  := v_shift.version;
  v_idem := extensions.uuid_generate_v5('00000000-0000-0000-0000-0000000000bb'::uuid,
              p_shift_id::text || ':' || v_ver::text || ':' || p_winner_id::text);
  v_result := public.sm_apply_shift_op(p_shift_id, v_ver, 'select_winner',
                jsonb_build_object('winner_id', p_winner_id), v_idem);
  IF COALESCE((v_result->>'ok')::boolean, false)
     AND v_result->>'code' IN ('APPLIED', 'IDEMPOTENT_REPLAY') THEN
    RETURN jsonb_build_object('success', true, 'version', v_result->>'version');
  END IF;
  RETURN jsonb_build_object('success', false,
                            'error', COALESCE(v_result->>'code', 'GATEWAY_FAILURE'), 'detail', v_result);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_select_bid_winner error (shift=%): %', p_shift_id, SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_bid_outcome_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift RECORD;
  v_date  text;
  -- a bid row is reused across bidding rounds; created_at marks the round
  v_round text := NEW.id::text || ':' || extract(epoch FROM NEW.created_at)::bigint::text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT shift_date, start_time, lifecycle_status, assignment_status, is_cancelled
  INTO   v_shift
  FROM   shifts
  WHERE  id = NEW.shift_id
  LIMIT  1;
  v_date := COALESCE(v_shift.shift_date::TEXT, 'an upcoming date');

  IF NEW.status = 'accepted' THEN
    PERFORM notify_user(
      NEW.employee_id,
      'bid_accepted',
      'Bid accepted — shift assigned',
      'Your bid for the shift on ' || v_date || ' was accepted. Check My Roster.',
      NEW.shift_id,
      'shift',
      '/my-roster',
      'bid_accepted:' || v_round
    );
  ELSIF NEW.status = 'rejected' THEN
    PERFORM notify_user(
      NEW.employee_id,
      'bid_rejected',
      'Bid not selected',
      'Your bid for the shift on ' || v_date || ' was not selected this time.',
      NEW.shift_id,
      'shift',
      '/bids',
      'bid_rejected:' || v_round
    );
  ELSIF NEW.status = 'expired' THEN
    PERFORM notify_user(
      NEW.employee_id,
      'bid_rejected',
      'Bidding closed',
      'Bidding for the shift on ' || v_date || ' closed at its start without a winner.',
      NEW.shift_id,
      'shift',
      '/bids',
      'bid_expired:' || v_round
    );
  ELSIF NEW.status = 'cancelled' THEN
    PERFORM notify_user(
      NEW.employee_id,
      'shift_updated',
      'Bid cancelled',
      CASE WHEN v_shift.lifecycle_status = 'Published' AND v_shift.assignment_status IS DISTINCT FROM 'assigned'
                AND NOT COALESCE(v_shift.is_cancelled, false)
           THEN 'Your bid for the shift on ' || v_date || ' was cancelled because your leave on that day was approved.'
           ELSE 'The shift on ' || v_date || ' was withdrawn from bidding, so your bid was cancelled.'
      END,
      NEW.shift_id,
      'shift',
      '/bids',
      'bid_cancelled:' || v_round
    );
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
            IF (NEW.assigned_employee_id IS NULL) THEN
                -- nobody holds it: CANCELLED / LATE_CANCELLED are per-employee events and
                -- refuse a NULL employee, which aborted the whole timer sweep at S5 -> S10
                INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
                VALUES (NEW.id, NULL, v_actor, 'OP_APPLIED', clock_timestamp(),
                    jsonb_build_object('op', 'cancel', 'domain', 'lifecycle',
                                       'from_state', v_from, 'to_state', v_to,
                                       'source', 'fn_capture_shift_event'),
                    CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END, 'lifecycle')
                ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
            ELSE
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

REVOKE ALL ON FUNCTION public.sm_place_bid(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sm_place_bid(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_shift_close_bids() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_leave_cancel_bids() FROM PUBLIC, anon, authenticated;
