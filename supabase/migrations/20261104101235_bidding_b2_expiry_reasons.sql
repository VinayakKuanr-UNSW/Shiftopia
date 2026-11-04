-- ============================================================================
-- Bidding B2 — expiry and cancellation reasons (docs/design/shift-trading/03-bidding-fsm.md
-- B-D9, B-D10, §7), and bids become RPC-only.
--   * shifts.kickoff_cancel_code: why the system cancelled a shift at kickoff —
--     A offer ignored, B bidding found no winner, C draft never assigned,
--     D assigned draft never published. NULL for a manager's cancellation.
--   * fn_process_offer_expirations: an offer unanswered at its 48h deadline goes
--     to bidding (S5) like a rejection, not back to Draft; still pending at
--     kickoff, the shift is cancelled with A.
--   * process_shift_timers: S5 at kickoff -> S10 B; drafts at kickoff -> S10 C/D,
--     only for drafts starting after 2026-11-04 10:00:00+00 (product owner: leave older
--     drafts alone).
--   * fn_capture_shift_event: a reason-coded cancellation is logged as one
--     OP_APPLIED 'cancel' carrying the code, never as CANCELLED / LATE_CANCELLED
--     against the employee (codes do not feed reliability).
--   * shift_bids: clients lose INSERT/UPDATE/DELETE; sm_place_bid and
--     withdraw_bid_rpc (B1) are the only writers besides the gateway.
-- ============================================================================

ALTER TABLE public.shifts ADD COLUMN kickoff_cancel_code text
  CONSTRAINT shifts_kickoff_cancel_code_check CHECK (kickoff_cancel_code IN ('A', 'B', 'C', 'D'));
COMMENT ON COLUMN public.shifts.kickoff_cancel_code IS
  'Why the system cancelled the shift at kickoff: A offer ignored, B bidding found no winner, C draft never assigned, D assigned draft never published. NULL for a manual cancellation.';

CREATE OR REPLACE FUNCTION public.fn_process_offer_expirations()
 RETURNS TABLE(res_shift_id uuid, from_state text, to_state text)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift       RECORD;
    v_shift_start TIMESTAMPTZ;
BEGIN
    FOR v_shift IN
        SELECT s.*
        FROM public.shifts s
        WHERE s.lifecycle_status   = 'Published'
          AND s.assignment_status  = 'assigned'
          AND s.assignment_outcome IS NULL
          AND (
              (s.offer_expires_at IS NOT NULL AND s.offer_expires_at <= NOW())
              OR
              (
                COALESCE(
                    s.start_at,
                    (s.shift_date::TEXT || ' ' || s.start_time::TEXT)::TIMESTAMP
                        AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
                ) <= NOW()
              )
          )
        FOR UPDATE SKIP LOCKED
    LOOP
        v_shift_start := COALESCE(
            v_shift.start_at,
            (v_shift.shift_date::TEXT || ' ' || v_shift.start_time::TEXT)::TIMESTAMP
                AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney')
        );

        UPDATE public.shift_offers
        SET
            status         = 'Expired',
            responded_at   = NOW(),
            response_notes = 'Auto-expired: deadline passed or shift started'
        WHERE shift_id = v_shift.id
          AND status   = 'Pending';

        IF v_shift_start <= NOW() THEN
            -- Still unanswered at kickoff: S3 -> S10 (A). The assignee stays: a
            -- started shift cannot change hands (tr_lock_past_shifts).
            UPDATE public.shifts
            SET
                lifecycle_status     = 'Cancelled',
                is_cancelled         = TRUE,
                cancelled_at         = NOW(),
                kickoff_cancel_code  = 'A',
                bidding_status       = 'not_on_bidding'::shift_bidding_status,
                fulfillment_status   = 'none'::shift_fulfillment_status,
                updated_at           = NOW(),
                last_modified_reason = 'Offer ignored until kickoff - cancelled (A)'
            WHERE id = v_shift.id;
            to_state := 'S10';
        ELSE
            -- Deadline passed: treated like a rejection, S3 -> S5 (B-D9). The
            -- employee who ignored it may not bid on it.
            UPDATE public.shifts
            SET
                assigned_employee_id = NULL,
                assigned_at          = NULL,
                assignment_status    = 'unassigned',
                assignment_outcome   = NULL,
                offer_expires_at     = NULL,
                bidding_status       = 'on_bidding'::shift_bidding_status,
                fulfillment_status   = 'bidding'::shift_fulfillment_status,
                last_rejected_by     = v_shift.assigned_employee_id,
                last_dropped_by      = NULL,
                updated_at           = NOW(),
                last_modified_reason = 'Offer not answered in time - opened for bidding'
            WHERE id = v_shift.id;
            to_state := 'S5';
        END IF;

        IF v_shift.assigned_employee_id IS NOT NULL THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (
                v_shift.id,
                v_shift.assigned_employee_id,
                'IGNORED',
                COALESCE(v_shift.offer_expires_at, NOW()),
                jsonb_build_object(
                    'source', 'fn_process_offer_expirations',
                    'reason', 'offer_expired'
                )
            );
        END IF;

        res_shift_id := v_shift.id;
        from_state   := 'S3';
        RETURN NEXT;
    END LOOP;
END;
$function$;

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

    -- 2b. Drafts reaching kickoff (TTS <= 0) -> S10: C never assigned (S1), D assigned but
    --     never published (S2). The assignee stays (a started shift cannot change hands).
    --     Only drafts starting after this rule went live: older ones are left alone
    --     (product owner, 2026-11-04).
    WITH draft_cancelled AS (
        UPDATE public.shifts SET
            lifecycle_status     = 'Cancelled'::shift_lifecycle,
            is_cancelled         = TRUE,
            cancelled_at         = NOW(),
            kickoff_cancel_code  = CASE WHEN assigned_employee_id IS NULL THEN 'C' ELSE 'D' END,
            bidding_status       = 'not_on_bidding'::shift_bidding_status,
            fulfillment_status   = 'none'::shift_fulfillment_status,
            updated_at           = NOW(),
            last_modified_reason = 'Draft reached kickoff without being published - cancelled'
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
            IF (NEW.assigned_employee_id IS NULL OR NEW.kickoff_cancel_code IS NOT NULL) THEN
                -- nobody holds it, or the system cancelled it at kickoff with a reason code
                -- (03-bidding-fsm.md B-D10). CANCELLED / LATE_CANCELLED are per-employee
                -- events: they refuse a NULL employee, and a reason-coded cancellation is
                -- not a cancellation on the employee.
                INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
                VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', clock_timestamp(),
                    jsonb_build_object('op', 'cancel', 'domain', 'lifecycle',
                                       'from_state', v_from, 'to_state', v_to,
                                       'source', 'fn_capture_shift_event')
                      || CASE WHEN NEW.kickoff_cancel_code IS NOT NULL
                              THEN jsonb_build_object('reason_code', NEW.kickoff_cancel_code)
                              ELSE '{}'::jsonb END,
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

DROP POLICY bids_insert_own ON public.shift_bids;
DROP POLICY bids_update_own ON public.shift_bids;
DROP POLICY bids_delete_own ON public.shift_bids;
DROP POLICY bids_block_dropped_reinsert ON public.shift_bids;
DROP POLICY bids_block_rejected_reinsert ON public.shift_bids;
REVOKE INSERT, UPDATE, DELETE ON public.shift_bids FROM anon, authenticated;
