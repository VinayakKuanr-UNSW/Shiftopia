-- ─────────────────────────────────────────────────────────────────────────────
-- Close the swap-offer cleanup gap in process_shift_timers step 5
-- ─────────────────────────────────────────────────────────────────────────────
--
-- GAP
--   process_shift_timers (pg_cron `shift-timer-sweep`, every minute) step 5
--   flips in-flight shift_swaps -> EXPIRED at T-4h and reverts the shift, but it
--   never expired the child swap_offers. Only expire_locked_swaps() did that, and
--   that function has NO scheduled caller (the `shift-state-processor` cron runs
--   the DB proc sm_run_state_processor, NOT the edge function that calls it; no
--   pg_cron http_post targets the edge function). No trigger on shift_swaps
--   cascades status to swap_offers either. Result: an expired swap left its
--   swap_offers rows stuck in SUBMITTED/SELECTED.
--
--   Latent only: the app derives active-ness from the PARENT swap status
--   (getMyActiveOffers filters active_swap.status IN OPEN/MANAGER_PENDING;
--   renderMyOfferCard shows "Expired" via isExpired-first), and offer-funnel KPIs
--   are event-sourced from shift_events — so no user-facing bug. This is a
--   data-hygiene fix that makes the every-minute sweep self-contained (and makes
--   expire_locked_swaps / the shift-state-processor edge fn fully redundant).
--
-- CHANGE
--   1. Redefine process_shift_timers verbatim from its current live definition
--      (post tz-reconcile), adding one CTE `expired_offers` to step 5 that sets
--      the just-expired swaps' SUBMITTED/SELECTED offers -> EXPIRED.
--   2. One-time backfill of any already-stale offers (offers still
--      SUBMITTED/SELECTED whose parent swap is already EXPIRED).
-- ─────────────────────────────────────────────────────────────────────────────

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
    -- 1. Expire pending offers S3 -> S2
    FOR v_rec IN SELECT * FROM public.fn_process_offer_expirations() LOOP
        v_count := v_count + 1;
    END LOOP;
    IF v_count > 0 THEN operation:='OFFER_EXPIRED'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 2. Bidding timeout S5/S6 -> S1 (direct; no S8 hop). Single UPDATE so
    --    trg_bidding_expired_notification_fn fires the manager notification.
    --    (Published -> Draft, so trg_capture_shift_event logs the unpublish.)
    WITH timed_out AS (
        UPDATE public.shifts SET
            lifecycle_status     = 'Draft',
            bidding_status       = 'not_on_bidding'::shift_bidding_status,
            is_on_bidding        = FALSE,
            locked_at            = NULL,
            updated_at           = NOW(),
            last_modified_reason = 'Bidding timeout: T-4h passed, no winner — reverted to draft'
        WHERE lifecycle_status = 'Published'
          AND bidding_status IN (
              'on_bidding'::shift_bidding_status,
              'on_bidding_normal'::shift_bidding_status,
              'on_bidding_urgent'::shift_bidding_status
          )
          AND assignment_status = 'unassigned'
          AND (
              (start_at IS NOT NULL AND start_at < NOW() + INTERVAL '4 hours')
              OR
              (start_at IS NULL AND
               (shift_date::TEXT || ' ' || start_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(timezone, 'Australia/Sydney')
               < NOW() + INTERVAL '4 hours')
          )
          AND deleted_at IS NULL
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM timed_out;
    IF v_count > 0 THEN operation:='BIDDING_TIMEOUT'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 3. Auto-start S4/S7 -> S11/S12
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
          AND deleted_at IS NULL
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM started;
    IF v_count > 0 THEN operation:='AUTO_START'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 4. Auto-complete S11/S12 -> S13/S14
    WITH completed AS (
        UPDATE public.shifts SET
            lifecycle_status     = 'Completed',
            updated_at           = NOW(),
            last_modified_reason = 'Auto-completed: scheduled end time reached'
        WHERE lifecycle_status = 'InProgress'
          AND (
              (end_at IS NOT NULL AND end_at <= NOW())
              OR
              (end_at IS NULL AND
               (shift_date::TEXT || ' ' || end_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(timezone, 'Australia/Sydney')
               <= NOW())
          )
          AND deleted_at IS NULL
          -- Exclude currently clocked-in employees (they must clock out or hit 12.5h)
          AND NOT (attendance_status IN ('checked_in', 'late') AND actual_end IS NULL)
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM completed;
    IF v_count > 0 THEN operation:='AUTO_COMPLETE'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 5. Expire in-flight swap requests S9/S10 -> S4 at T-4h.
    --    to_revert snapshots each shift's pre-revert FSM state so the audit row
    --    can record the true from_state (trg_capture_shift_event has no branch
    --    for trading_status-only changes, so we log explicitly here).
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
              (rs.start_at IS NOT NULL AND rs.start_at < NOW() + INTERVAL '4 hours')
              OR
              (rs.start_at IS NULL AND
               (rs.shift_date::TEXT || ' ' || rs.start_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(rs.timezone, 'Australia/Sydney')
               < NOW() + INTERVAL '4 hours')
          )
        RETURNING sw.id, sw.requester_shift_id, sw.target_shift_id
    ),
    -- Expire the child offers of the just-expired swaps (parity with
    -- expire_locked_swaps). Without this they linger as SUBMITTED/SELECTED.
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
            last_modified_reason = 'Swap request expired: not concluded before T-4h — reverted to confirmed (S4)'
        FROM to_revert t
        WHERE s.id = t.id
        RETURNING s.id
    ),
    logged AS (
        INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, actor_role, domain)
        SELECT t.id, t.assigned_employee_id, 'OP_APPLIED', NOW(),
               jsonb_build_object('op', 'trade_expired', 'domain', 'trade',
                                  'from_state', t.from_state, 'to_state', t.to_state,
                                  'reason', 'Swap request expired: not concluded before T-4h — reverted to confirmed (S4)',
                                  'source', 'process_shift_timers'),
               'system', 'trade'
        FROM to_revert t
        ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM expired_swaps;
    IF v_count > 0 THEN operation:='SWAP_EXPIRED'; affected:=v_count; RETURN NEXT; END IF;
END;
$function$;

-- One-time backfill: expire offers left stale on already-EXPIRED swaps.
UPDATE public.swap_offers so
SET    status = 'EXPIRED', updated_at = NOW()
FROM   public.shift_swaps ss
WHERE  ss.id = so.swap_request_id
  AND  ss.status = 'EXPIRED'
  AND  so.status IN ('SUBMITTED', 'SELECTED');
