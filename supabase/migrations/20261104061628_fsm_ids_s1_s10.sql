-- ============================================================================
-- Shift FSM IDs: one gapless S1-S10 model, the same on screen and in the DB.
--   old -> new: S9->S6 (trade, peer)  S10->S7 (trade, manager)
--               S11->S8 (in progress) S13->S9 (completed)  S15->S10 (cancelled)
--   S1-S5 unchanged. The retired lineage (S6 urgent bidding, S7/S12/S14
--   emergency, S8 bidding closed) is dropped: assignment_outcome is
--   CHECK-limited to NULL/confirmed/no_show and nothing writes the two bidding
--   values, so no reachable row changes state.
-- Stored history (shift_events.metadata from/to_state) holds only S1/S2, so no
-- data rewrite is needed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_shift_fsm_state(p_lifecycle_status shift_lifecycle, p_assignment_status shift_assignment_status, p_assignment_outcome shift_assignment_outcome, p_trading_status shift_trading, p_is_cancelled boolean, p_bidding_status shift_bidding_status DEFAULT NULL::shift_bidding_status)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF COALESCE(p_is_cancelled, FALSE) OR p_lifecycle_status = 'Cancelled' THEN RETURN 'S10'; END IF;
  IF p_lifecycle_status = 'Completed'  THEN RETURN 'S9'; END IF;
  IF p_lifecycle_status = 'InProgress' THEN RETURN 'S8'; END IF;

  IF p_lifecycle_status = 'Published' THEN
    IF p_trading_status = 'TradeRequested' THEN RETURN 'S6'; END IF;
    IF p_trading_status = 'TradeAccepted'  THEN RETURN 'S7'; END IF;

    IF p_assignment_status = 'assigned' THEN
      IF p_assignment_outcome = 'confirmed' THEN RETURN 'S4'; END IF;
      RETURN 'S3';   -- no outcome yet: awaiting the employee's decision
    END IF;

    RETURN 'S5';     -- unassigned + published = bidding
  END IF;

  IF p_lifecycle_status = 'Draft' THEN
    RETURN CASE WHEN p_assignment_status = 'assigned' THEN 'S2' ELSE 'S1' END;
  END IF;

  RETURN 'UNKNOWN';
END;
$function$;

CREATE OR REPLACE FUNCTION public.fsm_op_is_legal(p_state text, p_op text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE p_op
    WHEN 'select_winner' THEN p_state IN ('S5')
    WHEN 'publish' THEN p_state IN ('S1', 'S2')
    WHEN 'unpublish' THEN p_state IN ('S3', 'S4', 'S5', 'S6', 'S7')

    -- assign: unassigned (S1/S5) OR reassign on assigned-but-pre-start (S2/S3/S4).
    WHEN 'assign' THEN p_state IN ('S1', 'S2', 'S3', 'S4', 'S5')

    -- unassign: inverse of assign, DRAFT-only. S2 (Draft+assigned) → S1. A published
    -- assigned shift (S3/S4) must be unpublished first (no defined unassigned-published
    -- FSM state), so it is NOT admitted here.
    WHEN 'unassign' THEN p_state IN ('S2')

    WHEN 'approve_trade' THEN p_state IN ('S7')
    WHEN 'reject_trade'  THEN p_state IN ('S6', 'S7')
    WHEN 'delete' THEN p_state IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7')
    WHEN 'edit' THEN p_state IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7')
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_unpublish_shift(p_shift_id uuid, p_user_id uuid DEFAULT auth.uid(), p_reason text DEFAULT 'Unpublished'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift RECORD;
  v_state text;
  v_to_state text;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_shift_action(p_shift_id, 'shift.publish');
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); END IF;

  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);
  IF v_state NOT IN ('S3', 'S4', 'S5', 'S6', 'S7') THEN
    RETURN jsonb_build_object('success', false, 'error', format('sm_unpublish_shift requires a Published state (S3/S4/S5/S6/S7), current state is %s', v_state));
  END IF;

  -- Cancel active trade/swap requests if unpublishing a trade-pending shift (S6/S7)
  IF v_shift.trading_status IN ('TradeRequested', 'TradeAccepted') THEN
    UPDATE public.shift_swaps SET
      status = 'CANCELLED',
      updated_at = NOW()
    WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
      AND status IN ('OPEN', 'MANAGER_PENDING', 'OFFER_SELECTED');

    UPDATE public.shifts SET
      trading_status = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL,
      last_modified_by = p_user_id,
      updated_at = NOW()
    WHERE id IN (
      SELECT CASE WHEN requester_shift_id = p_shift_id THEN target_shift_id ELSE requester_shift_id END
      FROM public.shift_swaps
      WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
    ) AND id <> p_shift_id;

    UPDATE public.swap_requests SET
      status = 'cancelled',
      updated_at = NOW()
    WHERE (original_shift_id = p_shift_id OR offered_shift_id = p_shift_id)
      AND status IN ('pending_employee', 'pending_manager');

    UPDATE public.shifts SET
      trading_status = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL,
      last_modified_by = p_user_id,
      updated_at = NOW()
    WHERE id IN (
      SELECT CASE WHEN original_shift_id = p_shift_id THEN offered_shift_id ELSE original_shift_id END
      FROM public.swap_requests
      WHERE (original_shift_id = p_shift_id OR offered_shift_id = p_shift_id)
    ) AND id <> p_shift_id;

    UPDATE public.shifts SET
      trading_status = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL
    WHERE id = p_shift_id;
  END IF;

  IF v_state IN ('S3', 'S4', 'S6', 'S7') THEN
    v_to_state := 'S2';
    UPDATE public.shifts SET
      lifecycle_status   = 'Draft'::public.shift_lifecycle,
      assignment_outcome = NULL,
      bidding_status     = 'not_on_bidding'::public.shift_bidding_status,
      fulfillment_status = 'none'::public.shift_fulfillment_status,
      last_modified_by   = p_user_id,
      last_modified_reason = p_reason,
      updated_at         = NOW()
    WHERE id = p_shift_id;
  ELSE
    v_to_state := 'S1';
    UPDATE public.shifts SET
      lifecycle_status   = 'Draft'::public.shift_lifecycle,
      bidding_status     = 'not_on_bidding'::public.shift_bidding_status,
      fulfillment_status = 'none'::public.shift_fulfillment_status,
      last_modified_by   = p_user_id,
      last_modified_reason = p_reason,
      updated_at         = NOW()
    WHERE id = p_shift_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', v_to_state);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_clock_in(p_shift_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_shift RECORD; v_state text; v_name text; v_role text;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); END IF;

  -- P0 fix: bind to the authenticated caller (or a manager acting on
  -- an employee's behalf), and require the target employee to
  -- actually be the one assigned to this shift.
  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT public.can_act_on_shift('timesheet.approve', p_shift_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to clock in on behalf of this employee');
  END IF;
  IF v_shift.assigned_employee_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift is not assigned to this employee');
  END IF;

  SELECT COALESCE(first_name||' '||COALESCE(last_name,''), email), COALESCE(left(lower(legacy_system_role::text),50),'employee')
    INTO v_name, v_role FROM public.profiles WHERE id = p_user_id;
  v_name := COALESCE(v_name, 'System'); v_role := COALESCE(v_role, 'employee');
  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);
  IF v_state NOT IN ('S4', 'S6', 'S7') THEN RETURN jsonb_build_object('success', false, 'error', format('sm_clock_in requires state S4, S6 or S7, current state is %s', v_state)); END IF;
  UPDATE public.shifts SET
    lifecycle_status = 'InProgress'::public.shift_lifecycle, trading_status = 'NoTrade'::public.shift_trading,
    last_modified_by = p_user_id, updated_at = NOW()
  WHERE id = p_shift_id;
  -- shift_audit_events insert removed
  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S8');
END; $function$;

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
    -- 1. Expire pending offers S3 -> S2 (at offer_expires_at or shift kickoff)
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
            last_modified_reason = 'Unassigned shift expired at kickoff (TTS=0) - marked cancelled'
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
              (sw.expires_at IS NOT NULL AND sw.expires_at < NOW())
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
