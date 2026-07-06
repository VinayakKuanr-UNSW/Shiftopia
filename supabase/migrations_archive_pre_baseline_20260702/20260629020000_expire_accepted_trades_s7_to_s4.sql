-- Extend the per-minute lifecycle processor so that an in-flight trade that does
-- not reach a conclusion before T-4h reverts to the original confirmed assignment.
--
-- Before: step 5 only expired OPEN swaps (S9 / display S6, TradeRequested) and
-- only reverted the requester shift. A swap that a peer had ALREADY accepted
-- (MANAGER_PENDING / S10 / display S7, TradeAccepted) had no auto-expiry — it
-- could sit awaiting manager approval indefinitely past T-4h. The sm_expire_trade
-- RPC handled S9 AND S10 -> S4 but was never wired to the timer.
--
-- After: step 5 expires BOTH OPEN (S9) and MANAGER_PENDING (S10) swaps at T-4h and
-- reverts EVERY shift the swap locked (requester + target). trading_status drops
-- to NoTrade; the confirmed assignment (assignment_outcome='confirmed') is left
-- untouched, so each shift lands back on S4 — exactly the user's model:
--   * S3 (offer not accepted)  -> S2   (fn_process_offer_expirations, step 1)
--   * S5 (bidding, no winner)  -> S1   (step 2)
--   * S6/S7 (trade unresolved) -> S4   (this step 5)
--
-- Window is derived from BOTH the swap's expires_at (set at creation to the
-- requester shift's start - 4h) AND the requester shift's start time directly, so
-- a swap row with a NULL expires_at still expires at T-4h. Steps 1-4 are
-- reproduced verbatim from 20260619004412 (CREATE OR REPLACE replaces the whole
-- body).
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
                   AT TIME ZONE COALESCE(timezone, 'UTC')
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
                   AT TIME ZONE COALESCE(timezone, 'UTC')
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
                   AT TIME ZONE COALESCE(timezone, 'UTC')
               <= NOW())
          )
          AND deleted_at IS NULL
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM completed;
    IF v_count > 0 THEN operation:='AUTO_COMPLETE'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 5. Expire in-flight swap requests S9/S10 -> S4 at T-4h.
    --    OPEN (S9 / TradeRequested) and MANAGER_PENDING (S10 / TradeAccepted) both
    --    revert: the swap is EXPIRED and EVERY shift it locked (requester + target)
    --    drops trading_status back to NoTrade. The confirmed assignment is left
    --    untouched, so the shift lands on S4. OFFER_SELECTED is included as a
    --    defensive catch for the transient pre-MANAGER_PENDING status.
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
                   AT TIME ZONE COALESCE(rs.timezone, 'UTC')
               < NOW() + INTERVAL '4 hours')
          )
        RETURNING sw.id, sw.requester_shift_id, sw.target_shift_id
    ),
    reverted AS (
        UPDATE public.shifts s SET
            trading_status       = 'NoTrade',
            trade_requested_at   = NULL,
            updated_at           = NOW(),
            last_modified_reason = 'Swap request expired: not concluded before T-4h — reverted to confirmed (S4)'
        FROM expired_swaps e
        WHERE s.id IN (e.requester_shift_id, e.target_shift_id)
          AND s.trading_status IN ('TradeRequested', 'TradeAccepted')
        RETURNING s.id
    )
    SELECT COUNT(*) INTO v_count FROM expired_swaps;
    IF v_count > 0 THEN operation:='SWAP_EXPIRED'; affected:=v_count; RETURN NEXT; END IF;
END;
$function$;

ALTER FUNCTION public.process_shift_timers() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.process_shift_timers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_shift_timers() TO service_role;
