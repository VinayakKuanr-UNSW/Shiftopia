-- ============================================================================
-- Trading T2 — trade lifecycle (docs/design/shift-trading/01-trading-fsm.md §5, §6).
--   accept   : the offered shift comes from the offer row, not the client; it
--              must still be B's and confirmed; review expires at the earlier
--              start (D7).
--   withdraw : B may withdraw from S7 too, which ends the trade (D6).
--   cancel   : A may retract from S7 too; every live offer is cancelled, so no
--              hold outlives its request.
--   ending   : trg_swap_close_offers ends a request's live offers whenever the
--              request ends (approve -> ACCEPTED; reject, cancel, expiry). Before,
--              cancel and reject left B's shift held, and approval held A's new
--              shift forever.
--   reject   : manager-only, S7-only.
--   timers   : review expires at <= expires_at; an offer lapses when B's shift
--              starts while the request is still open.
-- Compliance at approval is enforced by the existing deferred
-- trg_shift_eba_compliance on the post-swap roster (no new check needed).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sm_accept_trade(p_swap_id uuid, p_offer_id uuid, p_offerer_id uuid, p_offer_shift_id uuid DEFAULT NULL::uuid, p_compliance_snapshot jsonb DEFAULT NULL::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_caller    uuid := auth.uid();
  v_swap      shift_swaps%ROWTYPE;
  v_offer     swap_offers%ROWTYPE;
  v_shift_ids uuid[];
  v_req       shifts%ROWTYPE;
  v_off       shifts%ROWTYPE;
  v_start_req timestamptz;
  v_start_off timestamptz;
BEGIN
  -- 1. Lock the swap row and verify it is still OPEN
  SELECT * INTO v_swap FROM shift_swaps WHERE id = p_swap_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Swap request not found', 'code', 'SWAP_NOT_FOUND');
  END IF;

  -- 1a. AUTHORIZATION (H2): only the swap's requester may accept an offer on it.
  IF v_caller IS NOT NULL
     AND v_caller <> v_swap.requester_id
     AND NOT public.can_act_on_shift('swap.approve', v_swap.requester_shift_id) THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized to accept this swap', 'code', 'FORBIDDEN');
  END IF;

  IF v_swap.status <> 'OPEN' THEN
    RETURN json_build_object(
      'success', false,
      'error', format('Swap is no longer OPEN (current status: %s)', v_swap.status),
      'code', 'SWAP_NOT_OPEN'
    );
  END IF;

  -- 1b. OFFER INTEGRITY
  SELECT * INTO v_offer FROM swap_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND OR v_offer.swap_request_id <> p_swap_id THEN
    RETURN json_build_object('success', false, 'error', 'Offer does not belong to this swap', 'code', 'OFFER_MISMATCH');
  END IF;
  IF v_offer.offerer_id <> p_offerer_id THEN
    RETURN json_build_object('success', false, 'error', 'Offerer does not match the offer', 'code', 'OFFERER_MISMATCH');
  END IF;
  IF v_offer.status <> 'SUBMITTED' THEN
    RETURN json_build_object(
      'success', false,
      'error', format('Offer is not selectable (status: %s)', v_offer.status),
      'code', 'OFFER_NOT_SUBMITTED'
    );
  END IF;

  -- 1c. COMPLIANCE GUARD
  IF p_compliance_snapshot IS NULL
     OR COALESCE((p_compliance_snapshot->>'feasible')::boolean, false) = false THEN
    RETURN json_build_object('success', false, 'error', 'Compliance snapshot missing or not feasible', 'code', 'COMPLIANCE_REQUIRED');
  END IF;

  -- 1d. BOTH SHIFTS STILL TRADEABLE: the offered shift is read from the offer
  -- row (never trusted from the client), still B's and confirmed; neither has
  -- started. Review expires at whichever start comes first (D7).
  SELECT * INTO v_req FROM shifts WHERE id = v_swap.requester_shift_id;
  SELECT * INTO v_off FROM shifts WHERE id = v_offer.offered_shift_id FOR UPDATE;
  IF v_off.assigned_employee_id IS DISTINCT FROM v_offer.offerer_id
     OR public.get_shift_fsm_state(v_off.lifecycle_status, v_off.assignment_status,
          v_off.assignment_outcome, v_off.trading_status, v_off.is_cancelled) <> 'S4' THEN
    RETURN json_build_object('success', false, 'error', 'The offered shift is no longer available', 'code', 'OFFER_STALE');
  END IF;
  v_start_req := COALESCE(v_req.start_at, (v_req.shift_date::text || ' ' || v_req.start_time::text)::timestamp
                                          AT TIME ZONE COALESCE(v_req.timezone, 'Australia/Sydney'));
  v_start_off := COALESCE(v_off.start_at, (v_off.shift_date::text || ' ' || v_off.start_time::text)::timestamp
                                          AT TIME ZONE COALESCE(v_off.timezone, 'Australia/Sydney'));
  IF LEAST(v_start_req, v_start_off) <= now() THEN
    RETURN json_build_object('success', false, 'error', 'Time locked: a shift has already started', 'code', 'TIME_LOCKED');
  END IF;

  -- 2. Move swap to MANAGER_PENDING
  UPDATE shift_swaps
  SET
    status          = 'MANAGER_PENDING',
    target_id       = p_offerer_id,
    target_shift_id = v_offer.offered_shift_id,
    expires_at      = LEAST(v_start_req, v_start_off),
    updated_at      = NOW()
  WHERE id = p_swap_id;

  -- 3. Mark chosen offer as SELECTED
  UPDATE swap_offers
  SET status              = 'SELECTED',
      compliance_snapshot = p_compliance_snapshot
  WHERE id = p_offer_id;

  -- 4. Reject all other outstanding offers for this swap
  UPDATE swap_offers
  SET status = 'REJECTED'
  WHERE swap_request_id = p_swap_id
    AND id <> p_offer_id
    AND status = 'SUBMITTED';

  -- 5. Lock both shifts to TradeAccepted
  v_shift_ids := ARRAY[v_swap.requester_shift_id, v_offer.offered_shift_id];
  UPDATE shifts
  SET trading_status = 'TradeAccepted'
  WHERE id = ANY(v_shift_ids)
    AND id IS NOT NULL;

  RETURN json_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_withdraw_swap_offer(p_offer_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_offer public.swap_offers%ROWTYPE;
  v_swap  public.shift_swaps%ROWTYPE;
BEGIN
  SELECT * INTO v_offer FROM public.swap_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND OR v_offer.offerer_id IS DISTINCT FROM auth.uid() THEN
    RETURN json_build_object('success', false, 'error', 'Offer not found', 'code', 'OFFER_NOT_FOUND');
  END IF;
  SELECT * INTO v_swap FROM public.shift_swaps WHERE id = v_offer.swap_request_id FOR UPDATE;
  IF v_swap.status = 'OPEN' AND v_offer.status = 'SUBMITTED' THEN
    -- S6: only this offer ends; the request stays open for others.
    UPDATE public.swap_offers SET status = 'WITHDRAWN', updated_at = now() WHERE id = p_offer_id;
    RETURN json_build_object('success', true);
  END IF;

  IF v_swap.status = 'MANAGER_PENDING' AND v_offer.status = 'SELECTED' THEN
    -- S7: withdrawing the accepted offer ends the trade; both shifts back to S4.
    UPDATE public.swap_offers SET status = 'WITHDRAWN', updated_at = now() WHERE id = p_offer_id;
    UPDATE public.shift_swaps SET status = 'CANCELLED', status_changed_at = now(), updated_at = now()
     WHERE id = v_swap.id;
    UPDATE public.shifts SET trading_status = 'NoTrade', trade_requested_at = NULL, updated_at = now()
     WHERE id IN (v_swap.requester_shift_id, v_swap.target_shift_id);
    RETURN json_build_object('success', true);
  END IF;

  RETURN json_build_object('success', false, 'error', 'This offer can no longer be withdrawn', 'code', 'OFFER_NOT_WITHDRAWABLE');
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_cancel_swap_request(p_swap_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_swap   shift_swaps%ROWTYPE;
BEGIN
  SELECT * INTO v_swap FROM shift_swaps WHERE id = p_swap_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Swap not found', 'code', 'SWAP_NOT_FOUND');
  END IF;

  IF v_caller IS NOT NULL AND v_caller <> v_swap.requester_id AND NOT public.can_act_on_shift('swap.approve', v_swap.requester_shift_id) THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized to cancel this swap', 'code', 'FORBIDDEN');
  END IF;

  IF v_swap.status NOT IN ('OPEN', 'MANAGER_PENDING') THEN
    RETURN json_build_object(
      'success', false,
      'error', format('Cannot cancel swap in state %s.', v_swap.status),
      'code', 'SWAP_NOT_OPEN'
    );
  END IF;

  -- A retracts from S6 or S7: the request and both shifts end together; the
  -- swap_offers trigger cancels its live offers (releasing every hold).
  UPDATE shift_swaps SET status = 'CANCELLED', status_changed_at = now(), updated_at = now()
  WHERE id = p_swap_id;

  UPDATE shifts SET trading_status = 'NoTrade', trade_requested_at = NULL, updated_at = now()
  WHERE id IN (v_swap.requester_shift_id, v_swap.target_shift_id);

  RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
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
    WHEN 'reject_trade'  THEN p_state IN ('S7')
    WHEN 'delete' THEN p_state IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7')
    WHEN 'edit' THEN p_state IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7')
    ELSE false
  END;
$function$;

-- One owner for "no live offer outlives its request": whenever a request
-- ends, its SUBMITTED/SELECTED offers end with it. Covers approve, reject,
-- cancel, expiry and every manager cascade (unpublish, cancel, delete).
CREATE OR REPLACE FUNCTION public.fn_swap_close_offers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  UPDATE public.swap_offers SET
    status = (CASE NEW.status
                WHEN 'APPROVED'  THEN CASE WHEN status = 'SELECTED' THEN 'ACCEPTED' ELSE 'REJECTED' END
                WHEN 'REJECTED'  THEN 'REJECTED'
                WHEN 'CANCELLED' THEN 'CANCELLED'
                ELSE 'EXPIRED'
              END)::public.swap_offer_status,
    updated_at = now()
  WHERE swap_request_id = NEW.id
    AND status IN ('SUBMITTED', 'SELECTED');
  RETURN NULL;
END;
$function$;

CREATE TRIGGER trg_swap_close_offers
  AFTER UPDATE OF status ON public.shift_swaps
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
        AND NEW.status IN ('APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'))
  EXECUTE FUNCTION public.fn_swap_close_offers();

REVOKE ALL ON FUNCTION public.fn_swap_close_offers() FROM PUBLIC, anon, authenticated;

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
