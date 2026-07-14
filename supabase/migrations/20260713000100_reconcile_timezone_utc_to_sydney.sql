-- ─────────────────────────────────────────────────────────────────────────────
-- Reconcile shift-timezone fallback: 'UTC' → 'Australia/Sydney'
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY
--   Two DB functions computed a shift's start/end instant from the naive
--   (shift_date + start_time) fields when start_at/end_at were absent, using
--   `... AT TIME ZONE COALESCE(timezone, 'UTC')`. Everywhere else in the schema
--   (shifts.timezone DEFAULT, trg_recalc_shift_utc_timestamps, get_* views,
--   the app) the fallback is 'Australia/Sydney'. A NULL timezone here would be
--   interpreted 10–11h off (Sydney is UTC+10/+11), skewing:
--     • fn_set_swap_expires_at  → swap expires_at (T-4h lock)
--     • process_shift_timers     → bidding timeout / auto-start / auto-complete /
--                                  swap-expiry sweep
--
-- IMPACT (verified against prod srfozdlphoempdattvtx, 645 shifts):
--   timezone IS NULL = 0, timezone <> 'Australia/Sydney' = 0, start_at IS NULL = 0.
--   The 'UTC' branch is currently NEVER reached (start_at is always present, and
--   timezone is always 'Australia/Sydney'), so this change is a no-op on existing
--   data — it only corrects the fallback for a future row inserted with BOTH
--   start_at NULL AND timezone NULL. Pure defensive correctness.
--
-- METHOD
--   Both functions are redefined verbatim from their current live definitions
--   (pg_get_functiondef), changing ONLY the fallback literal 'UTC' →
--   'Australia/Sydney'. No signature, security, or logic change otherwise.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. fn_set_swap_expires_at ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_set_swap_expires_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_shift_start TIMESTAMPTZ;
BEGIN
    SELECT COALESCE(s.start_at,
        (s.shift_date::TEXT||' '||s.start_time::TEXT)::TIMESTAMP AT TIME ZONE COALESCE(s.timezone,'Australia/Sydney'))
    INTO v_shift_start FROM public.shifts s WHERE s.id = NEW.requester_shift_id;
    IF v_shift_start IS NOT NULL THEN
        NEW.expires_at := v_shift_start - INTERVAL '4 hours';
    END IF;
    RETURN NEW;
END;
$function$;

-- 2. process_shift_timers -----------------------------------------------------
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
