-- ─────────────────────────────────────────────────────────────────────────────
-- Audit coverage for Published → Draft reverts and swap-expiry trade reverts.
--
-- Problem: fn_capture_shift_event logged publish/complete/in_progress but had
-- NO branch for Published → Draft, and sm_unpublish_shift never persisted its
-- p_reason. Every unpublish — manual/bulk unpublish, offer-expiry cron,
-- bidding timeout — was invisible in the shift_events ledger, so the shift
-- timeline showed S2→S3 twice with no S3→S2 leg in between. Swap expiry
-- (S9/S10 → S4 in process_shift_timers step 5) wrote no ledger row either;
-- offer expiry wrote only the metrics-grade IGNORED event (no state chips).
--
-- Fixes:
--   1. fn_capture_shift_event: new 4d UNPUBLISHED branch — any Published→Draft
--      UPDATE emits OP_APPLIED(op='unpublish', domain='lifecycle') with FSM
--      from/to states and the row's (freshly changed) last_modified_reason.
--      One branch covers every revert path because they all mutate the row.
--   2. sm_unpublish_shift: persist p_reason into last_modified_reason.
--   3. sm_expire_offer_now: stamp a reason (was silent).
--   4. process_shift_timers step 5: emit OP_APPLIED(op='trade_expired',
--      domain='trade') for each shift reverted S9/S10 → S4 by swap expiry.
--   5. Backfill: derive historical unpublish rows from cron-expiry IGNORED
--      events (same event_time; later created_at so they sort after).
-- ─────────────────────────────────────────────────────────────────────────────


-- 1. fn_capture_shift_event — add 4d UNPUBLISHED branch ----------------------

CREATE OR REPLACE FUNCTION "public"."fn_capture_shift_event"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
    v_from  text;
    v_to    text;
    v_actor uuid;
    v_auto  boolean;
BEGIN
    IF current_setting('app.audit.via_gateway', true) = '1' THEN
        RETURN NEW;
    END IF;

    v_actor := auth.uid();
    v_auto  := COALESCE(current_setting('app.audit.actor', true), '') = 'autoscheduler';
    v_to := public.get_shift_fsm_state(NEW.lifecycle_status, NEW.assignment_status, NEW.assignment_outcome, NEW.trading_status, NEW.is_cancelled, NEW.bidding_status);
    IF (TG_OP = 'UPDATE') THEN
        v_from := public.get_shift_fsm_state(OLD.lifecycle_status, OLD.assignment_status, OLD.assignment_outcome, OLD.trading_status, OLD.is_cancelled, OLD.bidding_status);
    END IF;

    -- 1. ASSIGNED / UNASSIGNED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.assigned_employee_id IS NOT NULL AND OLD.assigned_employee_id IS NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, actor_role)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ASSIGNED', COALESCE(NEW.assigned_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to)
                      || CASE WHEN v_auto THEN jsonb_build_object('source', 'autoscheduler') ELSE '{}'::jsonb END,
                    CASE WHEN v_auto THEN 'autoscheduler' ELSE NULL END);
        ELSIF (NEW.assigned_employee_id IS NULL AND OLD.assigned_employee_id IS NOT NULL) THEN
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

    -- 2. OFFERED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.fulfillment_status = 'offered' AND OLD.fulfillment_status IS DISTINCT FROM 'offered') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'OFFERED', COALESCE(NEW.offer_sent_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    END IF;

    -- 3. ACCEPTED / EMERGENCY_ASSIGNED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.assignment_outcome = 'confirmed' AND OLD.assignment_outcome IS DISTINCT FROM 'confirmed') THEN
            IF (NEW.emergency_assigned_at IS NOT NULL
                AND OLD.emergency_assigned_at IS DISTINCT FROM NEW.emergency_assigned_at) THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'EMERGENCY_ASSIGNED', COALESCE(NEW.emergency_assigned_at, now()),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            ELSE
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'ACCEPTED', COALESCE(NEW.confirmed_at, now()),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            END IF;
        ELSIF (NEW.assignment_outcome = 'emergency_assigned' AND OLD.assignment_outcome IS DISTINCT FROM 'emergency_assigned') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'EMERGENCY_ASSIGNED', COALESCE(NEW.emergency_assigned_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    END IF;

    -- 4. CANCELLED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Cancelled' AND OLD.lifecycle_status IS DISTINCT FROM 'Cancelled') THEN
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

    -- 4a. PUBLISHED — skipped when this write is an emergency assignment.
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Published' AND OLD.lifecycle_status IS DISTINCT FROM 'Published'
            AND NOT (NEW.emergency_assigned_at IS NOT NULL
                     AND OLD.emergency_assigned_at IS DISTINCT FROM NEW.emergency_assigned_at)) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', now(),
                jsonb_build_object('op', 'publish', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event'),
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END, 'lifecycle');
        END IF;
    END IF;

    -- 4b. COMPLETED — lifecycle -> Completed.
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Completed' AND OLD.lifecycle_status IS DISTINCT FROM 'Completed') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, 'OP_APPLIED', now(),
                jsonb_build_object(
                    'op', 'complete',
                    'domain', 'lifecycle',
                    'from_state', v_from,
                    'to_state',   v_to,
                    'source', 'fn_capture_shift_event'
                ),
                'lifecycle');
        END IF;
    END IF;

    -- 4c. IN PROGRESS — lifecycle -> InProgress (S4 -> S11).
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'InProgress' AND OLD.lifecycle_status IS DISTINCT FROM 'InProgress') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', COALESCE(NEW.actual_start, now()),
                jsonb_build_object('op', 'in_progress', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event'),
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'employee' END, 'lifecycle');
        END IF;
    END IF;

    -- 4d. UNPUBLISHED — lifecycle Published -> Draft. One branch covers EVERY
    --     revert path (manual/bulk unpublish, offer-expiry cron, bidding
    --     timeout, sm_expire_offer_now) because they all mutate the row here.
    --     The reason is only trusted when this same UPDATE changed it — a
    --     stale last_modified_reason from an earlier op must not be attached.
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Draft' AND OLD.lifecycle_status = 'Published') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', now(),
                jsonb_build_object('op', 'unpublish', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event')
                  || CASE WHEN NEW.last_modified_reason IS NOT NULL
                          AND NEW.last_modified_reason IS DISTINCT FROM OLD.last_modified_reason
                          THEN jsonb_build_object('reason', NEW.last_modified_reason)
                          ELSE '{}'::jsonb END,
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END, 'lifecycle')
            -- now() is transaction-stable: a publish+unpublish in ONE transaction
            -- would collide on uniq_shift_event and abort the caller. Drop the
            -- duplicate-second event instead of failing the business write.
            ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
        END IF;
    END IF;

    -- 5. ATTENDANCE (CHECKED_IN, LATE_IN, NO_SHOW)
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.attendance_status IS DISTINCT FROM OLD.attendance_status) THEN
            IF (NEW.attendance_status = 'checked_in') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'CHECKED_IN', COALESCE(NEW.actual_start, now()),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            ELSIF (NEW.attendance_status = 'late') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'LATE_IN', COALESCE(NEW.actual_start, now()),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            ELSIF (NEW.attendance_status = 'no_show') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
                VALUES (NEW.id, NEW.assigned_employee_id, 'NO_SHOW', now(),
                        jsonb_build_object('from_state', v_from, 'to_state', v_to));
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


-- 2. sm_unpublish_shift — persist p_reason ------------------------------------

CREATE OR REPLACE FUNCTION "public"."sm_unpublish_shift"("p_shift_id" "uuid", "p_user_id" "uuid" DEFAULT "auth"."uid"(), "p_reason" "text" DEFAULT 'Unpublished'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_shift RECORD;
  v_state text;
  v_to_state text;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); END IF;

  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);
  IF v_state NOT IN ('S3', 'S4', 'S5', 'S9', 'S10') THEN
    RETURN jsonb_build_object('success', false, 'error', format('sm_unpublish_shift requires a Published state (S3/S4/S5/S9/S10), current state is %s', v_state));
  END IF;

  -- Cancel active trade/swap requests if unpublishing a trade-pending shift (S9/S10)
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

  IF v_state IN ('S3', 'S4', 'S9', 'S10') THEN
    v_to_state := 'S2';
    UPDATE public.shifts SET
      lifecycle_status   = 'Draft'::public.shift_lifecycle,
      assignment_outcome = NULL,
      bidding_status     = 'not_on_bidding'::public.shift_bidding_status,
      is_on_bidding      = FALSE,
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
      is_on_bidding      = FALSE,
      fulfillment_status = 'none'::public.shift_fulfillment_status,
      last_modified_by   = p_user_id,
      last_modified_reason = p_reason,
      updated_at         = NOW()
    WHERE id = p_shift_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', v_to_state);
END;
$$;


-- 3. sm_expire_offer_now — stamp a reason so the audit row records WHY --------

CREATE OR REPLACE FUNCTION "public"."sm_expire_offer_now"("p_shift_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_shift shifts%ROWTYPE;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Shift not found'); END IF;
  IF v_shift.assignment_outcome IS DISTINCT FROM 'offered' THEN RETURN json_build_object('success', false, 'error', 'Shift is not in offered state'); END IF;

  UPDATE shifts SET
    lifecycle_status      = 'Draft',
    assignment_outcome    = NULL,
    bidding_status        = 'not_on_bidding',
    last_modified_reason  = 'Offer expired manually - Reverted to Draft Assigned',
    updated_at            = now()
  WHERE id = p_shift_id;

  RETURN json_build_object('success', true, 'from_state', 'S3', 'to_state', 'S2');
END;
$$;


-- 4. process_shift_timers — log trade_expired on swap expiry (step 5) ---------

CREATE OR REPLACE FUNCTION "public"."process_shift_timers"() RETURNS TABLE("operation" "text", "affected" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
                   AT TIME ZONE COALESCE(rs.timezone, 'UTC')
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
$$;


-- 5. Backfill unpublish rows for historical cron offer expiries ---------------
-- Every IGNORED event written by fn_process_offer_expirations marks a real
-- S3 -> S2 revert that got no lifecycle row. Same event_time keeps the timeline
-- chronological; the later created_at sorts it after the IGNORED sibling.

INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, actor_role, domain)
SELECT se.shift_id, se.employee_id, 'OP_APPLIED', se.event_time,
       jsonb_build_object('op', 'unpublish', 'domain', 'lifecycle',
                          'from_state', 'S3', 'to_state', 'S2',
                          'reason', CASE se.metadata->>'reason'
                                      WHEN 'pre_shift_lockout' THEN '4h Lockout - Auto-retracted to Draft Assigned'
                                      ELSE 'Offer expired - Reverted to Draft Assigned'
                                    END,
                          'source', 'backfill_20260704_unpublish_audit'),
       'system', 'lifecycle'
FROM public.shift_events se
WHERE se.event_type = 'IGNORED'
  AND se.metadata->>'source' = 'fn_process_offer_expirations'
  AND NOT EXISTS (
      SELECT 1 FROM public.shift_events x
      WHERE x.shift_id  = se.shift_id
        AND x.event_type = 'OP_APPLIED'
        AND x.metadata->>'op' = 'unpublish'
        AND x.event_time = se.event_time
  );
