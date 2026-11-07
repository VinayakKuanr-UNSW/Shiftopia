-- process_shift_timers: end trades before starting shifts; isolate each step.
--
-- 1. ORDER. Auto-start (S4 -> S8) ran before swap expiry, and does not look at
--    trading_status, so a shift still in a trade (S6/S7) at kickoff was started
--    first and its trade ended afterwards. Both happen in one transaction, so no
--    reader saw the mixed state, but the record was wrong: the trade_expired
--    event read S8 -> S8, and the shift's last note said "reverted to confirmed
--    (S4)" on a running shift. Swap expiry and offer lapse now run before
--    auto-start: the trade ends (S6/S7 -> S4), then the shift starts (S4 -> S8).
--
-- 2. ISOLATION. Every step ran in the one transaction pg_cron opens, so an error
--    in any step rolled back every step that minute, and every minute after
--    while the cause remained. Each step is now its own block: a failure rolls
--    back that step only, the rest still apply, and the failure is recorded —
--    a row in internal.timer_step_failures, a WARNING in the Postgres log, and a
--    '<STEP>_FAILED' row in the result. It is not swallowed silently.
--    A bad row still stops its whole step (each step is one bulk statement);
--    per-row isolation would mean looping, and is not done here.
--
-- Step bodies are the live definition (prosrc md5 a573d4eed1017074d3023bfeb0b2185a,
-- identical to 20261104140528) unchanged; only their order and the wrapping
-- blocks are new. pg_cron runs one instance of a job at a time, so no advisory
-- lock is added.
--
-- Test: supabase/tests/process_shift_timers_order_and_isolation.sql

CREATE TABLE IF NOT EXISTS internal.timer_step_failures (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    step       text        NOT NULL,
    sqlstate   text,
    message    text,
    failed_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE internal.timer_step_failures IS
    'One row per failed process_shift_timers step. The other steps of that run still applied.';
CREATE INDEX IF NOT EXISTS timer_step_failures_failed_at_idx ON internal.timer_step_failures (failed_at DESC);
REVOKE ALL ON internal.timer_step_failures FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION internal.record_timer_step_failure(p_step text, p_sqlstate text, p_message text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'internal'
AS $function$
BEGIN
    INSERT INTO internal.timer_step_failures (step, sqlstate, message)
    VALUES (p_step, p_sqlstate, p_message);
    RAISE WARNING 'process_shift_timers step % failed (%): %', p_step, p_sqlstate, p_message;
END;
$function$;
REVOKE EXECUTE ON FUNCTION internal.record_timer_step_failure(text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.process_shift_timers()
 RETURNS TABLE(operation text, affected integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_count INT := 0;
    v_rec   RECORD;
    v_state TEXT;
    v_msg   TEXT;
BEGIN
    -- 1. Expire pending offers: S3 -> S5 at the 48h deadline, S3 -> S10 (A) at kickoff
    BEGIN
        FOR v_rec IN SELECT * FROM public.fn_process_offer_expirations() LOOP
            v_count := v_count + 1;
        END LOOP;
        IF v_count > 0 THEN operation := 'OFFER_EXPIRED'; affected := v_count; RETURN NEXT; END IF;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        PERFORM internal.record_timer_step_failure('OFFER_EXPIRED', v_state, v_msg);
        operation := 'OFFER_EXPIRED_FAILED'; affected := 0; RETURN NEXT;
    END;
    v_count := 0;

    -- 2. Expire unassigned bidding shifts at shift kickoff (TTS <= 0) -> S10 Cancelled
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        PERFORM internal.record_timer_step_failure('UNASSIGNED_KICKOFF_CANCELLED', v_state, v_msg);
        operation := 'UNASSIGNED_KICKOFF_CANCELLED_FAILED'; affected := 0; RETURN NEXT;
    END;
    v_count := 0;

    -- 2b. Drafts reaching kickoff (TTS <= 0) -> S10:
    --     Code C: Draft+Unassigned never published (S1)
    --     Code D: Draft+Assigned never published (S2)
    --     The assignee stays (a started shift cannot change hands).
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        PERFORM internal.record_timer_step_failure('DRAFT_KICKOFF_CANCELLED', v_state, v_msg);
        operation := 'DRAFT_KICKOFF_CANCELLED_FAILED'; affected := 0; RETURN NEXT;
    END;
    v_count := 0;

    -- 3. Expire in-flight swap requests S6/S7 -> S4 at kickoff (rs.start_at <= NOW()).
    --    Before auto-start, so a traded shift returns to S4 and then starts.
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        PERFORM internal.record_timer_step_failure('SWAP_EXPIRED', v_state, v_msg);
        operation := 'SWAP_EXPIRED_FAILED'; affected := 0; RETURN NEXT;
    END;
    v_count := 0;

    -- 3b. An offered shift reached its start while the request is still open:
    --     that offer lapses (hold released); the request stays open for others.
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        PERFORM internal.record_timer_step_failure('SWAP_OFFER_LAPSED', v_state, v_msg);
        operation := 'SWAP_OFFER_LAPSED_FAILED'; affected := 0; RETURN NEXT;
    END;
    v_count := 0;

    -- 4. Auto-start S4 -> S8
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        PERFORM internal.record_timer_step_failure('AUTO_START', v_state, v_msg);
        operation := 'AUTO_START_FAILED'; affected := 0; RETURN NEXT;
    END;
    v_count := 0;

    -- 4b. Missing arrival at start + 0m (flips to on_time / late_in if employee punches in later)
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        PERFORM internal.record_timer_step_failure('MISSING_ARRIVAL', v_state, v_msg);
        operation := 'MISSING_ARRIVAL_FAILED'; affected := 0; RETURN NEXT;
    END;
    v_count := 0;

    -- 5. Auto-complete S8 -> S9 (for shifts without an open punch)
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        PERFORM internal.record_timer_step_failure('AUTO_COMPLETE', v_state, v_msg);
        operation := 'AUTO_COMPLETE_FAILED'; affected := 0; RETURN NEXT;
    END;
    v_count := 0;

    -- 6. No-show at end + 0m: shift has ENDED and nobody clocked in (unless on approved leave).
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        PERFORM internal.record_timer_step_failure('NO_SHOW', v_state, v_msg);
        operation := 'NO_SHOW_FAILED'; affected := 0; RETURN NEXT;
    END;
    v_count := 0;

    -- 7. Missing departure at end + 0m: clocked in, scheduled end reached, no clock-out yet.
    --    (Auto-clockout is intentionally retired: clock_out remains NULL until worker punches out
    --    or manager supplies billable_end on public.billables.)
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        PERFORM internal.record_timer_step_failure('MISSING_DEPARTURE', v_state, v_msg);
        operation := 'MISSING_DEPARTURE_FAILED'; affected := 0; RETURN NEXT;
    END;
END;
$function$;
