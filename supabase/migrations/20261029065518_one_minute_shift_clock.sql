-- One scheduler for every time-driven shift change, every minute.
--
-- Before: four pg_cron jobs moved shifts as time passed —
--   shift-timer-sweep      every 1 min   process_shift_timers()
--   shift-state-processor  every 15 min  sm_run_state_processor()
--   sweep_expired_offers   every 5 min   fn_process_offer_expirations()
--   shift-auto-clockout    every 5 min   sm_handle_auto_clock_out()
-- Compared step by step on 2026-10-29 (live definitions):
--   - offer expiry: the 15-min pass matched assignment_outcome = 'offered', a
--     value nothing writes (0 rows) — dead; the 5-min job called the same
--     function the 1-min job already calls every minute.
--   - bidding timeout: the 15-min pass had no assignment_status guard and SET
--     assignment_status = 'unassigned' — it would strip an assignee from a
--     shift left marked on-bidding. The 1-min step only touches unassigned.
--   - auto-start: the 15-min pass would also start an unaccepted offer
--     (assigned, outcome NULL); the 1-min step needs a confirmed assignee.
--   - auto-complete: the same rule in both.
--   - auto clock-out: the 15-min Pass 6 was a copy of sm_handle_auto_clock_out.
--   - no-show: ONLY in the 15-min job (Pass 4). It moves here unchanged; it
--     gains the deleted_at IS NULL every sibling step carries, which is inert —
--     CHECK shifts_no_soft_delete keeps deleted_at NULL on every shift.
-- The 15-min procedure also swallowed every error as a WARNING, so its runs
-- always reported success; process_shift_timers fails loudly.
--
-- Steps 1–5 below are the live body (md5 a7bd1ad9797f1e25cde0740393440ad8)
-- verbatim; steps 6 and 7 are new. Signature and grants are unchanged.
--
-- Rollback: ~/Documents/superman-db-exports/2026-10-29/processors/
-- (the four definitions + the cron schedules).

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

    -- 2. Bidding timeout S5/S6 -> S1
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
          AND NOT (attendance_status IN ('checked_in', 'late') AND actual_end IS NULL)
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM completed;
    IF v_count > 0 THEN operation:='AUTO_COMPLETE'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 5. Expire in-flight swap requests S9/S10 -> S4 at T-4h (+ their child offers).
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
    v_count := 0;

    -- 6. No-show: the shift has ENDED and nobody clocked in. A shift inside the
    --    employee's APPROVED leave is not a no-show — the absence is authorised
    --    (it stays 'unknown'; leave pay comes from leave_requests).
    WITH no_shows AS (
        UPDATE public.shifts SET
            attendance_status    = 'no_show',
            updated_at           = NOW(),
            last_modified_reason = 'No-show: shift ended with no clock-in'
        WHERE lifecycle_status IN ('InProgress', 'Completed')
          AND attendance_status = 'unknown'
          AND (
              (end_at IS NOT NULL AND end_at <= NOW())
              OR
              (end_at IS NULL AND
               (shift_date::TEXT || ' ' || end_time::TEXT)::TIMESTAMP
                   AT TIME ZONE COALESCE(timezone, 'Australia/Sydney')
               <= NOW())
          )
          AND deleted_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.leave_requests lr
              WHERE lr.employee_id = shifts.assigned_employee_id
                AND lr.status = 'approved'
                AND shifts.shift_date BETWEEN lr.start_date::date AND lr.end_date::date
          )
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM no_shows;
    IF v_count > 0 THEN operation:='NO_SHOW'; affected:=v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 7. Auto clock-out: still clocked in 12.5h after the later of clock-in and start.
    FOR v_rec IN SELECT * FROM public.sm_handle_auto_clock_out() LOOP
        v_count := v_count + 1;
    END LOOP;
    IF v_count > 0 THEN operation:='AUTO_CLOCK_OUT'; affected:=v_count; RETURN NEXT; END IF;
END;
$function$;

-- Only jobs that exist: they were scheduled outside the migrations, so a
-- database rebuilt from this repo never had them.
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN ('shift-state-processor', 'sweep_expired_offers', 'shift-auto-clockout');

DROP PROCEDURE public.sm_run_state_processor();
