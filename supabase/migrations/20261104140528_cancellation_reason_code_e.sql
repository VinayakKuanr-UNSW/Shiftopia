-- ============================================================================
-- Cancellation reason codes C, D, and E (docs/design/shift-trading/03-bidding-fsm.md B-D10)
--   * Code C: Draft+Unassigned never published (S1 reaching kickoff)
--   * Code D: Draft+Assigned never published (S2 reaching kickoff)
--   * Code E: Published shift manually cancelled, requires an explicit p_reason (S3-S8 cancelled via sm_cancel_shift)
-- ============================================================================

-- 1. Extend CHECK constraint on shifts.kickoff_cancel_code to include 'E'
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_kickoff_cancel_code_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_kickoff_cancel_code_check
  CHECK (kickoff_cancel_code IN ('A', 'B', 'C', 'D', 'E'));

COMMENT ON COLUMN public.shifts.kickoff_cancel_code IS
  'Cancellation reason code: A offer ignored until shift started, B bidding found no winner, C Draft+Unassigned never published, D Draft+Assigned never published, E Published shift manually cancelled (requires reason note).';

-- 2. sm_cancel_shift sets kickoff_cancel_code = 'E' and requires non-empty reason
CREATE OR REPLACE FUNCTION public.sm_cancel_shift(p_shift_id uuid, p_reason text, p_expected_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift  public.shifts%ROWTYPE;
  v_state  text;
  v_note   text := NULLIF(btrim(p_reason), '');
  v_when   text;
  v_emp    uuid;
BEGIN
  -- cancelling replaces deleting for a published shift, so it needs the same right
  IF NOT public.sm_request_is_system() AND (auth.uid() IS NULL OR EXISTS (
       SELECT 1 FROM public.shifts s
        WHERE s.id = p_shift_id
          AND NOT public.user_has_action_in_scope('shift.delete', s.organization_id, s.department_id, s.sub_department_id))) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'You are not allowed to cancel shifts.');
  END IF;

  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'SHIFT_NOT_FOUND', 'error', 'Shift not found');
  END IF;
  IF p_expected_version IS NOT NULL AND v_shift.version <> p_expected_version THEN
    RETURN jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT',
      'error', 'This shift was changed by someone else. Refresh and try again.');
  END IF;

  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled, v_shift.bidding_status);
  IF NOT public.fsm_op_is_legal(v_state, 'cancel') THEN
    RETURN jsonb_build_object('success', false, 'code', 'ILLEGAL_STATE', 'state', v_state,
      'error', CASE WHEN v_state IN ('S1', 'S2') THEN 'A draft is deleted, not cancelled.'
                    ELSE 'This shift can no longer be cancelled.' END);
  END IF;
  IF EXISTS (SELECT 1 FROM public.timesheets t WHERE t.shift_id = p_shift_id AND t.clock_in IS NOT NULL) THEN
    RETURN jsonb_build_object('success', false, 'code', 'SHIFT_WORKED',
      'error', 'Someone has clocked in to this shift. Correct it through the timesheet instead.');
  END IF;
  IF v_note IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED', 'error', 'Say why the shift is cancelled.');
  END IF;

  v_when := to_char(v_shift.shift_date, 'Dy FMDD Mon') || ' ' ||
            to_char(v_shift.start_time, 'HH24:MI') || '–' || to_char(v_shift.end_time, 'HH24:MI');

  -- Tell the assignee, and everyone whose trade this ends, before the trade
  -- cascade (trg_shift_end_trades) clears the records. Bidders are told by
  -- trg_bid_outcome_notification when their bids close.
  FOR v_emp IN
    SELECT DISTINCT x FROM (
      SELECT v_shift.assigned_employee_id
      UNION ALL
      SELECT so.offerer_id FROM public.swap_offers so JOIN public.shift_swaps sw ON sw.id = so.swap_request_id
       WHERE sw.requester_shift_id = p_shift_id AND sw.status IN ('OPEN', 'MANAGER_PENDING')
         AND so.status IN ('SUBMITTED', 'SELECTED')
      UNION ALL
      SELECT sw.requester_id FROM public.shift_swaps sw
       WHERE sw.target_shift_id = p_shift_id AND sw.status = 'MANAGER_PENDING'
      UNION ALL
      SELECT sw.requester_id FROM public.swap_offers so JOIN public.shift_swaps sw ON sw.id = so.swap_request_id
       WHERE so.offered_shift_id = p_shift_id AND so.status IN ('SUBMITTED', 'SELECTED')
         AND sw.status IN ('OPEN', 'MANAGER_PENDING')
    ) people(x)
    WHERE x IS NOT NULL
  LOOP
    PERFORM public.notify_user(
      v_emp,
      'shift_cancelled',
      'Shift cancelled',
      CASE WHEN v_emp = v_shift.assigned_employee_id
           THEN format('Your shift on %s was cancelled: %s', v_when, v_note)
           ELSE format('The shift on %s in your trade was cancelled, so the trade has ended: %s', v_when, v_note)
      END,
      p_shift_id,
      'shift',
      '/my-roster',
      'shift_cancelled:' || p_shift_id::text || ':' || v_emp::text
    );
  END LOOP;

  -- an unanswered offer ends with the shift
  UPDATE public.shift_offers
     SET status = 'Expired', responded_at = now(), response_notes = 'Shift cancelled: ' || v_note
   WHERE shift_id = p_shift_id AND status = 'Pending';

  UPDATE public.shifts SET
    lifecycle_status     = 'Cancelled'::public.shift_lifecycle,
    is_cancelled         = TRUE,
    cancelled_at         = now(),
    kickoff_cancel_code  = 'E',
    bidding_status       = 'not_on_bidding'::public.shift_bidding_status,
    fulfillment_status   = 'none'::public.shift_fulfillment_status,
    last_modified_by     = auth.uid(),
    last_modified_reason = v_note,
    updated_at           = now()
  WHERE id = p_shift_id;

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S10');
END;
$function$;

REVOKE ALL ON FUNCTION public.sm_cancel_shift(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sm_cancel_shift(uuid, text, integer) TO authenticated;

-- 3. fn_capture_shift_event includes both reason_code and note on cancellation
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
            -- A cancellation is always the manager's or the system's act, never the
            -- employee's: it is logged as OP_APPLIED 'cancel', not CANCELLED /
            -- LATE_CANCELLED, so it never counts against the assignee (B-D10, B-D15).
            -- An employee's own drop is logged by sm_employee_drop_shift.
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', clock_timestamp(),
                jsonb_build_object('op', 'cancel', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event')
                  || CASE WHEN NEW.kickoff_cancel_code IS NOT NULL
                          THEN jsonb_build_object('reason_code', NEW.kickoff_cancel_code)
                          ELSE '{}'::jsonb END
                  || CASE WHEN NEW.last_modified_reason IS NOT NULL
                          THEN jsonb_build_object('note', NEW.last_modified_reason)
                          ELSE '{}'::jsonb END,
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END, 'lifecycle')
            ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
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
                    jsonb_build_object('op', 'complete', 'domain', 'lifecycle',
                                       'from_state', v_from, 'to_state', v_to,
                                       'source', 'fn_capture_shift_event'),
                    'lifecycle')
            ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

-- 4. process_shift_timers sets naming conventions for Code C and D
CREATE OR REPLACE FUNCTION public.process_shift_timers()
 RETURNS TABLE(operation text, affected integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_count INT := 0;
    v_rec   RECORD;
BEGIN
    -- 1. Expire pending offers: S3 -> S5 at the 48h deadline, S3 -> S10 (A) at kickoff
    FOR v_rec IN SELECT * FROM public.fn_process_offer_expirations() LOOP
        v_count := v_count + 1;
    END LOOP;
    IF v_count > 0 THEN operation := 'OFFER_EXPIRED'; affected := v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 2. Expire unassigned bidding shifts at shift kickoff (TTS <= 0) -> S10 Cancelled
    WITH timed_out AS (
        UPDATE public.shifts SET
            lifecycle_status     = 'Cancelled'::shift_lifecycle,
            is_cancelled         = TRUE,
            bidding_status       = 'not_on_bidding'::shift_bidding_status,
            fulfillment_status   = 'none'::shift_fulfillment_status,
            updated_at           = NOW(),
            cancelled_at         = NOW(),
            kickoff_cancel_code  = 'B',
            last_modified_reason = 'Bidding found no winner by kickoff (TTS=0) - cancelled (B)'
        WHERE lifecycle_status = 'Published'
          AND assignment_status = 'unassigned'
          AND (
              (start_at IS NOT NULL AND start_at <= NOW())
              OR
              (start_at IS NULL AND
               (shift_date::TEXT || ' ' || start_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(timezone, 'Australia/Sydney')
               <= NOW())
          )
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM timed_out;
    IF v_count > 0 THEN operation := 'UNASSIGNED_KICKOFF_CANCELLED'; affected := v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 2b. Drafts reaching kickoff (TTS <= 0) -> S10:
    --     Code C: Draft+Unassigned never published (S1)
    --     Code D: Draft+Assigned never published (S2)
    --     The assignee stays (a started shift cannot change hands).
    WITH draft_cancelled AS (
        UPDATE public.shifts SET
            lifecycle_status     = 'Cancelled'::shift_lifecycle,
            is_cancelled         = TRUE,
            cancelled_at         = NOW(),
            kickoff_cancel_code  = CASE WHEN assigned_employee_id IS NULL THEN 'C' ELSE 'D' END,
            bidding_status       = 'not_on_bidding'::shift_bidding_status,
            fulfillment_status   = 'none'::shift_fulfillment_status,
            updated_at           = NOW(),
            last_modified_reason = CASE
                                       WHEN assigned_employee_id IS NULL THEN 'Draft+Unassigned never published'
                                       ELSE 'Draft+Assigned never published'
                                   END
        WHERE lifecycle_status = 'Draft'
          AND NOT is_cancelled
          AND COALESCE(start_at,
                (shift_date::TEXT || ' ' || start_time::TEXT)::TIMESTAMP
                    AT TIME ZONE COALESCE(timezone, 'Australia/Sydney'))
              BETWEEN TIMESTAMPTZ '2026-11-04 10:00:00+00' AND NOW()
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM draft_cancelled;
    IF v_count > 0 THEN operation := 'DRAFT_KICKOFF_CANCELLED'; affected := v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 3. Auto-start S4 -> S8
    WITH started AS (
        UPDATE public.shifts SET
            lifecycle_status     = 'InProgress',
            updated_at           = NOW(),
            last_modified_reason = 'Auto-started: scheduled start time reached'
        WHERE lifecycle_status = 'Published'
          AND assignment_outcome IN ('confirmed', 'emergency_assigned')
          AND (
              (start_at IS NOT NULL AND start_at <= NOW())
              OR
              (start_at IS NULL AND
               (shift_date::TEXT || ' ' || start_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(timezone, 'Australia/Sydney')
               <= NOW())
          )
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM started;
    IF v_count > 0 THEN operation := 'AUTO_START'; affected := v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 3b. Missing arrival at start + 0m (flips to on_time / late_in if employee punches in later)
    WITH missing_in AS (
        INSERT INTO public.timesheets (
            shift_id,
            employee_id,
            organization_id,
            arrival_track,
            source
        )
        SELECT
            s.id,
            s.assigned_employee_id,
            s.organization_id,
            'missing'::public.attendance_arrival_track,
            'system_timer'
        FROM public.shifts s
        WHERE s.lifecycle_status = 'InProgress'
          AND s.assigned_employee_id IS NOT NULL
          AND NOT s.is_cancelled
          AND (
              (s.start_at IS NOT NULL AND s.start_at <= NOW())
              OR
              (s.start_at IS NULL AND
               (s.shift_date::TEXT || ' ' || s.start_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
               <= NOW())
          )
          AND (
              (s.end_at IS NOT NULL AND s.end_at > NOW())
              OR
              (s.end_at IS NULL AND
               ((s.shift_date + s.end_time)
                 + CASE WHEN s.end_time <= s.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END)
                   AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
               > NOW())
          )
          AND NOT EXISTS (
              SELECT 1 FROM public.leave_requests lr
              WHERE lr.employee_id = s.assigned_employee_id
                AND lr.status = 'approved'
                AND s.shift_date BETWEEN lr.start_date::date AND lr.end_date::date
          )
          AND NOT EXISTS (
              SELECT 1 FROM public.timesheets t
              WHERE t.shift_id = s.id AND t.arrival_track IS NOT NULL
          )
        ON CONFLICT (shift_id) DO UPDATE
          SET arrival_track = 'missing'::public.attendance_arrival_track,
              updated_at    = NOW()
        WHERE public.timesheets.clock_in IS NULL
          AND public.timesheets.arrival_track IS NULL
        RETURNING shift_id
    )
    SELECT COUNT(*) INTO v_count FROM missing_in;
    IF v_count > 0 THEN operation := 'MISSING_ARRIVAL'; affected := v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 4. Auto-complete S8 -> S9 (for shifts without an open punch)
    WITH completed AS (
        UPDATE public.shifts s SET
            lifecycle_status     = 'Completed',
            updated_at           = NOW(),
            last_modified_reason = 'Auto-completed: scheduled end time reached'
        WHERE s.lifecycle_status = 'InProgress'
          AND (
              (s.end_at IS NOT NULL AND s.end_at <= NOW())
              OR
              (s.end_at IS NULL AND
               ((s.shift_date + s.end_time)
                 + CASE WHEN s.end_time <= s.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END)
                   AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
               <= NOW())
          )
          AND NOT EXISTS (
              SELECT 1 FROM public.timesheets t
              WHERE t.shift_id = s.id
                AND t.clock_in IS NOT NULL
                AND t.clock_out IS NULL
          )
        RETURNING s.id
    )
    SELECT COUNT(*) INTO v_count FROM completed;
    IF v_count > 0 THEN operation := 'AUTO_COMPLETE'; affected := v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 5. Expire in-flight swap requests S6/S7 -> S4 at kickoff (rs.start_at <= NOW()).
    WITH expired_swaps AS (
        UPDATE public.shift_swaps sw SET
            status     = 'EXPIRED',
            updated_at = NOW()
        FROM public.shifts rs
        WHERE rs.id = sw.requester_shift_id
          AND sw.status IN ('OPEN', 'MANAGER_PENDING', 'OFFER_SELECTED')
          AND (
              (sw.expires_at IS NOT NULL AND sw.expires_at <= NOW())
              OR
              (rs.start_at IS NOT NULL AND rs.start_at <= NOW())
              OR
              (rs.start_at IS NULL AND
               (rs.shift_date::TEXT || ' ' || rs.start_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(rs.timezone, 'Australia/Sydney')
               <= NOW())
          )
        RETURNING sw.id, sw.requester_shift_id, sw.target_shift_id
    ),
    expired_offers AS (
        UPDATE public.swap_offers so SET
            status     = 'EXPIRED',
            updated_at = NOW()
        FROM expired_swaps e
        WHERE so.swap_request_id = e.id
          AND so.status IN ('SUBMITTED', 'SELECTED')
        RETURNING so.id
    ),
    to_revert AS (
        SELECT DISTINCT ON (s.id)
               s.id,
               s.assigned_employee_id,
               public.get_shift_fsm_state(s.lifecycle_status, s.assignment_status, s.assignment_outcome, s.trading_status, s.is_cancelled, s.bidding_status) AS from_state,
               public.get_shift_fsm_state(s.lifecycle_status, s.assignment_status, s.assignment_outcome, 'NoTrade'::public.shift_trading, s.is_cancelled, s.bidding_status) AS to_state
        FROM public.shifts s
        JOIN expired_swaps e ON s.id IN (e.requester_shift_id, e.target_shift_id)
        WHERE s.trading_status IN ('TradeRequested', 'TradeAccepted')
    ),
    reverted AS (
        UPDATE public.shifts s SET
            trading_status       = 'NoTrade',
            trade_requested_at   = NULL,
            updated_at           = NOW(),
            last_modified_reason = 'Swap request expired: not concluded before kickoff — reverted to confirmed (S4)'
        FROM to_revert t
        WHERE s.id = t.id
        RETURNING s.id
    ),
    logged AS (
        INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, actor_role, domain)
        SELECT t.id, t.assigned_employee_id, 'OP_APPLIED', NOW(),
               jsonb_build_object('op', 'trade_expired', 'domain', 'trade',
                                  'from_state', t.from_state, 'to_state', t.to_state,
                                  'reason', 'Swap request expired: not concluded before kickoff — reverted to confirmed (S4)',
                                  'source', 'process_shift_timers'),
               'system', 'trade'
        FROM to_revert t
        ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM expired_swaps;
    IF v_count > 0 THEN operation := 'SWAP_EXPIRED'; affected := v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 5b. An offered shift reached its start while the request is still open:
    --     that offer lapses (hold released); the request stays open for others.
    WITH lapsed AS (
        UPDATE public.swap_offers so SET
            status     = 'EXPIRED',
            updated_at = NOW()
        FROM public.shifts os, public.shift_swaps sw
        WHERE os.id = so.offered_shift_id
          AND sw.id = so.swap_request_id
          AND sw.status = 'OPEN'
          AND so.status = 'SUBMITTED'
          AND COALESCE(os.start_at,
                (os.shift_date::TEXT || ' ' || os.start_time::TEXT)::TIMESTAMP
                    AT TIME ZONE COALESCE(os.timezone, 'Australia/Sydney')) <= NOW()
        RETURNING so.id
    )
    SELECT COUNT(*) INTO v_count FROM lapsed;
    IF v_count > 0 THEN operation := 'SWAP_OFFER_LAPSED'; affected := v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 6. No-show at end + 0m: shift has ENDED and nobody clocked in (unless on approved leave).
    WITH eligible_no_shows AS (
        SELECT
            s.id AS shift_id,
            s.assigned_employee_id AS employee_id,
            s.organization_id,
            public.get_shift_fsm_state(
                s.lifecycle_status, s.assignment_status, s.assignment_outcome,
                s.trading_status, s.is_cancelled, s.bidding_status
            ) AS from_state
        FROM public.shifts s
        LEFT JOIN public.timesheets t ON t.shift_id = s.id
        WHERE s.lifecycle_status IN ('InProgress', 'Completed')
          AND s.assigned_employee_id IS NOT NULL
          AND NOT s.is_cancelled
          AND t.clock_in IS NULL
          AND t.clock_out IS NULL
          AND COALESCE(t.is_no_show, false) = false
          AND (
              (s.end_at IS NOT NULL AND s.end_at <= NOW())
              OR
              (s.end_at IS NULL AND
               ((s.shift_date + s.end_time)
                 + CASE WHEN s.end_time <= s.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END)
                   AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
               <= NOW())
          )
          AND NOT EXISTS (
              SELECT 1 FROM public.leave_requests lr
              WHERE lr.employee_id = s.assigned_employee_id
                AND lr.status = 'approved'
                AND s.shift_date BETWEEN lr.start_date::date AND lr.end_date::date
          )
    ),
    upserted_ts AS (
        INSERT INTO public.timesheets (
            shift_id,
            employee_id,
            organization_id,
            arrival_track,
            departure_track,
            source
        )
        SELECT
            e.shift_id,
            e.employee_id,
            e.organization_id,
            'missing'::public.attendance_arrival_track,
            'missing'::public.attendance_departure_track,
            'system_timer'
        FROM eligible_no_shows e
        ON CONFLICT (shift_id) DO UPDATE
          SET arrival_track   = 'missing'::public.attendance_arrival_track,
              departure_track = 'missing'::public.attendance_departure_track,
              updated_at      = NOW()
        WHERE public.timesheets.clock_in IS NULL
          AND public.timesheets.clock_out IS NULL
        RETURNING shift_id, employee_id
    ),
    updated_shifts AS (
        UPDATE public.shifts s SET
            lifecycle_status     = 'Completed',
            assignment_outcome   = 'no_show'::public.shift_assignment_outcome,
            updated_at           = NOW(),
            last_modified_reason = 'No-show: scheduled end time reached with no punch'
        FROM upserted_ts u
        WHERE s.id = u.shift_id
        RETURNING s.id
    ),
    upserted_billables AS (
        INSERT INTO public.billables (
            shift_id,
            employee_id,
            organization_id,
            timesheet_id,
            status,
            gross_length_minutes,
            net_length_minutes,
            unpaid_break_minutes,
            paid_break_minutes,
            hours_source
        )
        SELECT
            u.shift_id,
            u.employee_id,
            e.organization_id,
            ts.id,
            'no_show'::public.timesheet_status,
            0,
            0,
            0,
            0,
            'no_show'
        FROM upserted_ts u
        JOIN eligible_no_shows e ON e.shift_id = u.shift_id
        LEFT JOIN public.timesheets ts ON ts.shift_id = u.shift_id
        ON CONFLICT (shift_id) DO UPDATE
          SET status               = 'no_show'::public.timesheet_status,
              gross_length_minutes = 0,
              net_length_minutes   = 0,
              unpaid_break_minutes = 0,
              paid_break_minutes   = 0,
              hours_source         = 'no_show',
              updated_at           = NOW()
        WHERE public.billables.status IN ('draft'::public.timesheet_status, 'no_show'::public.timesheet_status)
        RETURNING id
    ),
    logged_no_shows AS (
        INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
        SELECT
            u.shift_id,
            u.employee_id,
            'NO_SHOW'::public.shift_event_type,
            NOW(),
            jsonb_build_object('from_state', e.from_state, 'to_state', 'S9', 'source', 'process_shift_timers')
        FROM upserted_ts u
        JOIN eligible_no_shows e ON e.shift_id = u.shift_id
        ON CONFLICT (shift_id, employee_id, event_type, event_time) DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM upserted_ts;
    IF v_count > 0 THEN operation := 'NO_SHOW'; affected := v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 7. Missing departure at end + 0m: clocked in, scheduled end reached, no clock-out yet.
    --    (Auto-clockout is intentionally retired: clock_out remains NULL until worker punches out
    --    or manager supplies billable_end on public.billables.)
    WITH missing_out AS (
        UPDATE public.timesheets t SET
            departure_track = 'missing'::public.attendance_departure_track,
            updated_at      = NOW()
        FROM public.shifts s
        WHERE s.id = t.shift_id
          AND s.lifecycle_status IN ('InProgress', 'Completed')
          AND NOT s.is_cancelled
          AND t.clock_in IS NOT NULL
          AND t.clock_out IS NULL
          AND t.departure_track IS NULL
          AND (
              (s.end_at IS NOT NULL AND s.end_at <= NOW())
              OR
              (s.end_at IS NULL AND
               ((s.shift_date + s.end_time)
                 + CASE WHEN s.end_time <= s.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END)
                   AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
               <= NOW())
          )
        RETURNING t.shift_id
    )
    SELECT COUNT(*) INTO v_count FROM missing_out;
    IF v_count > 0 THEN operation := 'MISSING_DEPARTURE'; affected := v_count; RETURN NEXT; END IF;
END;
$function$;
