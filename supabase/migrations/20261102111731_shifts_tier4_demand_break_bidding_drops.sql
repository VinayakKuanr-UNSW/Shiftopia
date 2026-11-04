-- =============================================================================
-- Tier 4: drop demand_source, demand_group_id, break_minutes, is_on_bidding
--   demand_source / demand_group_id : never written (0/20 rows), no DB readers.
--   break_minutes : generated (paid + unpaid); cl 36/37 pair is authoritative.
--   is_on_bidding : duplicate of bidding_status IN ('on_bidding','on_bidding_normal','on_bidding_urgent').
-- =============================================================================

-- fn_full_time_shift_rules()
CREATE OR REPLACE FUNCTION public.fn_full_time_shift_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_was_bidding boolean := false;
  v_was_trading boolean := false;
  v_was_cancelled boolean := false;
BEGIN
  IF NEW.target_employment_type IS DISTINCT FROM 'FT' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_was_bidding := OLD.bidding_status::text IN ('on_bidding','on_bidding_normal','on_bidding_urgent');
    v_was_trading := OLD.trading_status::text <> 'NoTrade';
    v_was_cancelled := OLD.is_cancelled;
  END IF;

  IF (NEW.bidding_status::text IN ('on_bidding','on_bidding_normal','on_bidding_urgent')) AND NOT v_was_bidding THEN
    RAISE EXCEPTION 'Full-time shifts cannot be put up for bidding.' USING HINT = 'FT_NO_BIDDING';
  END IF;
  IF NEW.trading_status::text <> 'NoTrade' AND NOT v_was_trading THEN
    RAISE EXCEPTION 'Full-time shifts cannot be traded.' USING HINT = 'FT_NO_TRADING';
  END IF;
  IF NEW.is_cancelled AND NOT v_was_cancelled THEN
    RAISE EXCEPTION 'Full-time shifts cannot be cancelled. Delete the shift instead.' USING HINT = 'FT_NO_CANCEL';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.assigned_employee_id IS NOT NULL AND NEW.assigned_employee_id IS NULL THEN
    RAISE EXCEPTION 'Full-time shifts cannot be unassigned. Delete the shift instead.' USING HINT = 'FT_NO_UNASSIGN';
  END IF;
  RETURN NEW;
END;
$function$;

-- process_shift_timers()
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

-- fn_process_offer_expirations()
CREATE OR REPLACE FUNCTION public.fn_process_offer_expirations()
 RETURNS TABLE(res_shift_id uuid, from_state text, to_state text)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift       RECORD;
    v_new_state   TEXT := 'S2';
    v_shift_start TIMESTAMPTZ;
BEGIN
    FOR v_shift IN
        SELECT s.*
        FROM public.shifts s
        WHERE s.lifecycle_status   = 'Published'
          AND s.assignment_status  = 'assigned'
          AND s.assignment_outcome IS NULL
          AND (
              (s.offer_expires_at IS NOT NULL AND s.offer_expires_at < NOW())
              OR
              (
                COALESCE(
                    s.start_at,
                    (s.shift_date::TEXT || ' ' || s.start_time::TEXT)::TIMESTAMP
                        AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
                ) < (NOW() + INTERVAL '4 hours')
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
            response_notes = CASE
                WHEN v_shift.offer_expires_at IS NOT NULL AND v_shift.offer_expires_at < NOW()
                    THEN 'Auto-expired: deadline passed'
                ELSE 'Auto-retracted: 4h pre-shift lockout reached'
            END
        WHERE shift_id = v_shift.id
          AND status   = 'Pending';

        UPDATE public.shifts
        SET
            lifecycle_status     = 'Draft',
            assignment_status    = 'assigned',
            assignment_outcome   = NULL,
            fulfillment_status   = 'none'::shift_fulfillment_status,
            bidding_status       = 'not_on_bidding'::shift_bidding_status,
            updated_at           = NOW(),
            last_modified_reason = CASE
                WHEN v_shift.offer_expires_at IS NOT NULL AND v_shift.offer_expires_at < NOW()
                    THEN 'Offer expired - Reverted to Draft Assigned'
                ELSE '4h Lockout - Auto-retracted to Draft Assigned'
            END
        WHERE id = v_shift.id;

        IF v_shift.assigned_employee_id IS NOT NULL THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (
                v_shift.id,
                v_shift.assigned_employee_id,
                'IGNORED',
                COALESCE(v_shift.offer_expires_at, NOW()),
                jsonb_build_object(
                    'source', 'fn_process_offer_expirations',
                    'reason', CASE
                        WHEN v_shift.offer_expires_at IS NOT NULL AND v_shift.offer_expires_at < NOW()
                            THEN 'offer_expired'
                        ELSE 'pre_shift_lockout'
                    END
                )
            );
        END IF;

        res_shift_id := v_shift.id;
        from_state   := 'S3';
        to_state     := v_new_state;
        RETURN NEXT;
    END LOOP;
END;
$function$;

-- sm_reject_offer(uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.sm_reject_offer(p_shift_id uuid, p_user_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_shift RECORD; v_state text;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_assignee_or(p_shift_id, p_user_id, 'shift.assign');
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
  END IF;

  IF v_shift.assigned_employee_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: You can only reject shifts offered to you');
  END IF;

  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);

  IF v_state != 'S3' THEN
    RETURN jsonb_build_object('success', false, 'error', format('sm_reject_offer requires state S3, current state is %s', v_state));
  END IF;

  UPDATE public.shifts SET
    assigned_employee_id = NULL,
    assigned_at          = NULL,
    assignment_status    = 'unassigned'::public.shift_assignment_status,
    assignment_outcome   = NULL,
    bidding_status       = 'on_bidding'::public.shift_bidding_status,
    fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
    last_rejected_by     = p_user_id,
    last_dropped_by      = NULL,
    last_modified_by     = p_user_id,
    updated_at           = NOW()
  WHERE id = p_shift_id;

  INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
  VALUES (p_shift_id, p_user_id, 'REJECTED', NOW(), jsonb_build_object('source', 'sm_reject_offer', 'reason', p_reason));

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S5');
END;
$function$;

-- sm_emergency_assign(uuid,uuid,text,uuid)
CREATE OR REPLACE FUNCTION public.sm_emergency_assign(p_shift_id uuid, p_employee_id uuid, p_reason text DEFAULT 'Emergency assignment'::text, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_shift RECORD; v_state text; v_name text; v_role text;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_shift_action(p_shift_id, 'shift.assign');
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); END IF;

  SELECT COALESCE(first_name||' '||COALESCE(last_name,''), email), COALESCE(left(lower(legacy_system_role::text),50),'manager')
    INTO v_name, v_role FROM public.profiles WHERE id = p_user_id;
  v_name := COALESCE(v_name, 'System'); v_role := COALESCE(v_role, 'system');

  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);

  IF v_state NOT IN ('S4', 'S5') THEN
    RETURN jsonb_build_object('success', false, 'error', format('sm_emergency_assign requires state S4 or S5, current state is %s', v_state));
  END IF;

  UPDATE public.shifts SET
    assigned_employee_id = p_employee_id,
    assigned_at = NOW(),
    assignment_status = 'assigned'::public.shift_assignment_status,
    assignment_outcome = 'confirmed'::public.shift_assignment_outcome,
    bidding_status = 'not_on_bidding'::public.shift_bidding_status,
    fulfillment_status = 'scheduled'::public.shift_fulfillment_status,
    last_modified_by = p_user_id,
    updated_at = NOW()
  WHERE id = p_shift_id;

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S4', 'assigned_to', p_employee_id);
END; $function$;

-- sm_employee_drop_shift(uuid,uuid,text,text)
CREATE OR REPLACE FUNCTION public.sm_employee_drop_shift(p_shift_id uuid, p_employee_id uuid DEFAULT auth.uid(), p_reason text DEFAULT NULL::text, p_reason_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_shift          RECORD;
    v_state          text;
    v_reason         public.cancellation_reasons%ROWTYPE;
    v_notice         interval;
    v_notice_hours   numeric;
    v_is_critical    boolean;
    v_urgency        text;
    v_event_type     public.shift_event_type;
    -- Standard vs critical. NOT the same line as the emergent lockout.
    v_cancel_cutoff  constant interval := interval '24 hours';
    -- Urgent vs emergent. Mirrors EMERGENT_WINDOW_MS in bidding-urgency.ts.
    v_emergent_cutoff constant interval := interval '4 hours';
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_assignee_or(p_shift_id, p_employee_id, 'shift.assign');
    SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
    END IF;

    IF v_shift.assigned_employee_id IS DISTINCT FROM p_employee_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You are not assigned to this shift');
    END IF;

    v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status,
                                          v_shift.assignment_outcome, v_shift.trading_status,
                                          v_shift.is_cancelled);

    IF v_state NOT IN ('S3', 'S4') THEN
        RETURN jsonb_build_object('success', false,
            'error', format('sm_employee_drop_shift requires state S3 or S4, current state is %s', v_state));
    END IF;

    IF p_reason_code IS NOT NULL THEN
        SELECT * INTO v_reason
        FROM public.cancellation_reasons
        WHERE code = p_reason_code AND is_active;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false,
                'error', format('Unknown cancellation reason: %s', p_reason_code));
        END IF;

        IF v_reason.requires_note AND COALESCE(btrim(p_reason), '') = '' THEN
            RETURN jsonb_build_object('success', false,
                'error', format('Reason "%s" requires a note', v_reason.label));
        END IF;
    END IF;

    v_notice       := v_shift.start_at - now();
    v_notice_hours := ROUND(EXTRACT(epoch FROM v_notice)::numeric / 3600, 2);
    v_is_critical  := v_shift.start_at IS NOT NULL AND v_notice <= v_cancel_cutoff;
    v_urgency      := CASE
                          WHEN v_shift.start_at IS NULL             THEN 'normal'
                          WHEN v_notice <= v_emergent_cutoff        THEN 'emergent'
                          WHEN v_notice <= v_cancel_cutoff          THEN 'urgent'
                          ELSE 'normal'
                      END;
    v_event_type   := CASE WHEN v_is_critical THEN 'LATE_CANCELLED' ELSE 'CANCELLED' END::public.shift_event_type;

    PERFORM set_config('app.audit.employee_drop', '1', true);

    UPDATE public.shifts SET
        assigned_employee_id = NULL,
        assigned_at          = NULL,
        assignment_status    = 'unassigned'::public.shift_assignment_status,
        assignment_outcome   = NULL,
        bidding_status       = 'on_bidding'::public.shift_bidding_status,
        fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
        last_dropped_by      = p_employee_id,
        last_rejected_by     = NULL,
        last_modified_by     = p_employee_id,
        updated_at           = NOW()
    WHERE id = p_shift_id;

    PERFORM set_config('app.audit.employee_drop', '0', true);

    INSERT INTO public.shift_events
        (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
    VALUES (
        p_shift_id,
        p_employee_id,
        p_employee_id,
        v_event_type,
        now(),
        jsonb_build_object(
            'op',           'employee_drop',
            'from_state',   v_state,
            'to_state',     'S5',
            'cancellation', CASE WHEN v_is_critical THEN 'critical' ELSE 'standard' END,
            'urgency',      v_urgency,
            'notice_hours', v_notice_hours,
            'source',       'sm_employee_drop_shift'
        )
        || CASE WHEN p_reason_code IS NOT NULL
                THEN jsonb_build_object('reason_code', p_reason_code) ELSE '{}'::jsonb END
        || CASE WHEN COALESCE(btrim(p_reason), '') <> ''
                THEN jsonb_build_object('reason_note', btrim(p_reason)) ELSE '{}'::jsonb END,
        'employee',
        'assignment'
    )
    ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;

    RETURN jsonb_build_object(
        'success',      true,
        'from_state',   v_state,
        'to_state',     'S5',
        'cancellation', CASE WHEN v_is_critical THEN 'critical' ELSE 'standard' END,
        'urgency',      v_urgency,
        'notice_hours', v_notice_hours
    );
END;
$function$;

-- _apply_shift_op_write(uuid,text,jsonb,uuid)
CREATE OR REPLACE FUNCTION public._apply_shift_op_write(p_shift_id uuid, p_op text, p_payload jsonb, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cur            RECORD;
  v_winner         uuid;
  v_emp            uuid;
  v_swap           public.shift_swaps%ROWTYPE;
  v_edit_state     text;
  v_new_emp        uuid;
  v_do_assign      boolean := false;
  v_do_unassign    boolean := false;
  v_assign_src     text;
  v_breach_rule    text;
  v_breach_details text;
BEGIN
  SELECT * INTO v_cur FROM public.shifts WHERE id = p_shift_id;

  IF p_op = 'assign' THEN
    v_emp := NULLIF(p_payload->>'employee_id', '')::uuid;
    IF v_emp IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'MISSING_EMPLOYEE_ID');
    END IF;

    -- Concurrency Contract: Lock employee identity before running checks
    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_emp::text));

    -- Full EBA compliance check (blocking tier)
    SELECT rule_id, details INTO v_breach_rule, v_breach_details
      FROM internal.eba_check_assignment(p_shift_id, v_emp) WITH ORDINALITY AS c(is_compliant, rule_id, rule_name, tier, summary, details, payload, eba_ord)
     WHERE tier = 'BLOCKING'
     ORDER BY c.eba_ord
     LIMIT 1;

    IF v_breach_rule IS NOT NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'EBA_COMPLIANCE_BREACH', 'rule_id', v_breach_rule, 'details', v_breach_details);
    END IF;

    UPDATE public.shifts SET
      assigned_employee_id = v_emp,
      assigned_at          = NOW(),
      assignment_status    = 'assigned'::public.shift_assignment_status,
      assignment_outcome   = CASE WHEN lifecycle_status = 'Published'
                                  THEN 'confirmed'::public.shift_assignment_outcome
                                  ELSE assignment_outcome END,
      bidding_status       = CASE WHEN lifecycle_status = 'Published'
                                  THEN 'not_on_bidding'::public.shift_bidding_status
                                  ELSE bidding_status END,
      last_modified_by     = p_actor,
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'unassign' THEN
    IF v_cur.assigned_employee_id IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'ALREADY_UNASSIGNED');
    END IF;

    UPDATE public.shifts SET
      assigned_employee_id = NULL,
      assigned_at          = NULL,
      assignment_status    = 'unassigned'::public.shift_assignment_status,
      assignment_outcome   = NULL,
      fulfillment_status   = 'none'::public.shift_fulfillment_status,
      last_modified_by     = p_actor,
      last_modified_reason = COALESCE(p_payload->>'reason', 'Unassigned via shift gateway'),
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'publish' THEN
    IF v_cur.assigned_employee_id IS NOT NULL THEN
      -- Concurrency Contract: Lock employee identity before running checks
      PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_cur.assigned_employee_id::text));

      -- Full EBA compliance validation before publishing assigned shift
      SELECT rule_id, details INTO v_breach_rule, v_breach_details
        FROM internal.eba_check_assignment(p_shift_id, v_cur.assigned_employee_id) WITH ORDINALITY AS c(is_compliant, rule_id, rule_name, tier, summary, details, payload, eba_ord)
       WHERE tier = 'BLOCKING'
       ORDER BY c.eba_ord
       LIMIT 1;

      IF v_breach_rule IS NOT NULL THEN
        RETURN jsonb_build_object('applied', false, 'note', 'EBA_COMPLIANCE_BREACH', 'rule_id', v_breach_rule, 'details', v_breach_details);
      END IF;

      IF ((v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp
            AT TIME ZONE 'Australia/Sydney') - INTERVAL '4 hours' <= NOW() THEN
        -- Emergency window: confirm directly
        UPDATE public.shifts SET
          lifecycle_status       = 'Published'::public.shift_lifecycle,
          fulfillment_status     = 'scheduled'::public.shift_fulfillment_status,
          assignment_outcome     = 'confirmed'::public.shift_assignment_outcome,
          bidding_status         = 'not_on_bidding'::public.shift_bidding_status,
          published_at           = NOW(),
          last_modified_by       = p_actor,
          updated_at             = NOW()
        WHERE id = p_shift_id;
      ELSE
        INSERT INTO public.shift_offers (shift_id, employee_id, status)
        VALUES (p_shift_id, v_cur.assigned_employee_id, 'pending')
        ON CONFLICT DO NOTHING;

        UPDATE public.shifts SET
          lifecycle_status       = 'Published'::public.shift_lifecycle,
          fulfillment_status     = 'scheduled'::public.shift_fulfillment_status,
          assignment_outcome     = NULL,
          offer_sent_at          = NOW(),
          offer_expires_at       = NOW() + INTERVAL '48 hours',
          bidding_status         = 'not_on_bidding'::public.shift_bidding_status,
          published_at           = NOW(),
          last_modified_by       = p_actor,
          updated_at             = NOW()
        WHERE id = p_shift_id;
      END IF;
    ELSE
      -- Unassigned shift publish: opens for bidding
      UPDATE public.shifts SET
        lifecycle_status     = 'Published'::public.shift_lifecycle,
        fulfillment_status   = 'unfilled'::public.shift_fulfillment_status,
        bidding_status       = 'open'::public.shift_bidding_status,
        bidding_open_at      = NOW(),
        published_at         = NOW(),
        last_modified_by     = p_actor,
        updated_at           = NOW()
      WHERE id = p_shift_id;
    END IF;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'unpublish' THEN
    UPDATE public.shift_offers SET status = 'cancelled', updated_at = NOW()
    WHERE shift_id = p_shift_id AND status = 'pending';

    UPDATE public.shifts SET
      lifecycle_status     = 'Draft'::public.shift_lifecycle,
      fulfillment_status   = 'none'::public.shift_fulfillment_status,
      assignment_outcome   = NULL,
      bidding_status       = 'not_on_bidding'::public.shift_bidding_status,
      offer_sent_at        = NULL,
      offer_expires_at     = NULL,
      bidding_open_at      = NULL,
      bidding_close_at     = NULL,
      published_at         = NULL,
      last_modified_by     = p_actor,
      last_modified_reason = COALESCE(p_payload->>'reason', 'Unpublished via shift gateway'),
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'accept_offer' THEN
    UPDATE public.shift_offers SET status = 'accepted', responded_at = NOW(), updated_at = NOW()
    WHERE shift_id = p_shift_id AND employee_id = v_cur.assigned_employee_id AND status = 'pending';

    UPDATE public.shifts SET
      assignment_outcome = 'confirmed'::public.shift_assignment_outcome,
      confirmed_at       = NOW(),
      last_modified_by   = p_actor,
      updated_at         = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'reject_offer' THEN
    UPDATE public.shift_offers SET
      status = 'rejected', responded_at = NOW(),
      response_notes = p_payload->>'reason', updated_at = NOW()
    WHERE shift_id = p_shift_id AND employee_id = v_cur.assigned_employee_id AND status = 'pending';

    UPDATE public.shifts SET
      assigned_employee_id = NULL,
      assigned_at          = NULL,
      assignment_status    = 'unassigned'::public.shift_assignment_status,
      assignment_outcome   = NULL,
      fulfillment_status   = 'unfilled'::public.shift_fulfillment_status,
      last_rejected_by     = v_cur.assigned_employee_id,
      bidding_status       = 'open'::public.shift_bidding_status,
      bidding_open_at      = NOW(),
      last_modified_by     = p_actor,
      last_modified_reason = COALESCE(p_payload->>'reason', 'Offer rejected by employee'),
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'expire_offer' THEN
    UPDATE public.shift_offers SET status = 'expired', updated_at = NOW()
    WHERE shift_id = p_shift_id AND status = 'pending';

    UPDATE public.shifts SET
      assigned_employee_id = NULL,
      assigned_at          = NULL,
      assignment_status    = 'unassigned'::public.shift_assignment_status,
      assignment_outcome   = NULL,
      fulfillment_status   = 'unfilled'::public.shift_fulfillment_status,
      last_dropped_by      = v_cur.assigned_employee_id,
      bidding_status       = 'open'::public.shift_bidding_status,
      bidding_open_at      = NOW(),
      last_modified_by     = p_actor,
      last_modified_reason = 'Offer expired',
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'request_trade' THEN
    UPDATE public.shifts SET
      trading_status     = 'TradeRequested'::public.shift_trading,
      trade_requested_at = NOW(),
      last_modified_by   = p_actor,
      updated_at         = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'cancel_trade' THEN
    UPDATE public.shift_swaps SET
      status = 'CANCELLED'::public.swap_request_status,
      reason = COALESCE(p_payload->>'reason', 'Trade request cancelled'),
      status_changed_at = NOW(),
      updated_at = NOW()
    WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
      AND status IN ('PENDING', 'MANAGER_PENDING');

    UPDATE public.shifts SET
      trading_status     = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL,
      last_modified_by   = p_actor,
      updated_at         = NOW()
    WHERE id IN (
      SELECT CASE WHEN requester_shift_id = p_shift_id THEN target_shift_id ELSE requester_shift_id END
      FROM public.shift_swaps
      WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
    ) AND id <> p_shift_id;

    UPDATE public.shifts SET
      trading_status     = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL,
      last_modified_by   = p_actor,
      updated_at         = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'drop_shift' THEN
    IF ((v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp
          AT TIME ZONE 'Australia/Sydney') - INTERVAL '4 hours' <= NOW() THEN
      UPDATE public.shifts SET
        assigned_employee_id = NULL,
        assigned_at          = NULL,
        assignment_status    = 'unassigned'::public.shift_assignment_status,
        assignment_outcome   = NULL,
        fulfillment_status   = 'unfilled'::public.shift_fulfillment_status,
        last_dropped_by      = v_cur.assigned_employee_id,
        bidding_status       = 'open'::public.shift_bidding_status,
        bidding_open_at      = NOW(),
        last_modified_by     = p_actor,
        last_modified_reason = COALESCE(p_payload->>'reason', 'Late drop - opened for emergency bidding'),
        updated_at           = NOW()
      WHERE id = p_shift_id;
    ELSE
      UPDATE public.shifts SET
        assigned_employee_id = NULL,
        assigned_at          = NULL,
        assignment_status    = 'unassigned'::public.shift_assignment_status,
        assignment_outcome   = NULL,
        fulfillment_status   = 'unfilled'::public.shift_fulfillment_status,
        last_dropped_by      = v_cur.assigned_employee_id,
        bidding_status       = 'open'::public.shift_bidding_status,
        bidding_open_at      = NOW(),
        last_modified_by     = p_actor,
        last_modified_reason = COALESCE(p_payload->>'reason', 'Dropped by employee'),
        updated_at           = NOW()
      WHERE id = p_shift_id;
    END IF;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'select_winner' THEN
    v_winner := COALESCE(NULLIF(p_payload->>'winner_id', ''), NULLIF(p_payload->>'employee_id', ''))::uuid;
    IF v_winner IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'MISSING_WINNER_ID');
    END IF;

    -- Concurrency Contract: Lock employee identity before running checks
    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_winner::text));

    -- Full EBA compliance validation
    SELECT rule_id, details INTO v_breach_rule, v_breach_details
      FROM internal.eba_check_assignment(p_shift_id, v_winner) WITH ORDINALITY AS c(is_compliant, rule_id, rule_name, tier, summary, details, payload, eba_ord)
     WHERE tier = 'BLOCKING'
     ORDER BY c.eba_ord
     LIMIT 1;

    IF v_breach_rule IS NOT NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'EBA_COMPLIANCE_BREACH', 'rule_id', v_breach_rule, 'details', v_breach_details);
    END IF;

    UPDATE public.shift_bids SET status = 'accepted', updated_at = NOW()
    WHERE shift_id = p_shift_id AND employee_id = v_winner;

    UPDATE public.shift_bids SET status = 'rejected', updated_at = NOW()
    WHERE shift_id = p_shift_id AND employee_id <> v_winner
      AND status = 'pending';

    UPDATE public.shifts SET
      assigned_employee_id = v_winner,
      assigned_at          = NOW(),
      assignment_status    = 'assigned'::public.shift_assignment_status,
      assignment_outcome   = 'confirmed'::public.shift_assignment_outcome,
      bidding_status       = 'not_on_bidding'::public.shift_bidding_status,
      fulfillment_status   = 'scheduled'::public.shift_fulfillment_status,
      last_modified_by     = p_actor,
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'edit' THEN
    IF NOT (p_payload ?| ARRAY[
      'start_time','end_time','shift_date','paid_break_minutes',
      'unpaid_break_minutes','break_start','break_end','notes','role_id','sub_department_id',
      'remuneration_level','display_order',
      'shift_group_id','shift_subgroup_id','timezone','is_training',
      'assigned_employee_id','required_skills','required_licenses','event_ids'
    ]) THEN
      RETURN jsonb_build_object('applied', false, 'note', 'NO_EDITABLE_FIELDS');
    END IF;

    IF p_payload ? 'assigned_employee_id' THEN
      v_edit_state := public.get_shift_fsm_state(
        v_cur.lifecycle_status, v_cur.assignment_status, v_cur.assignment_outcome,
        v_cur.trading_status, v_cur.is_cancelled, v_cur.bidding_status);
      v_new_emp := NULLIF(p_payload->>'assigned_employee_id', '')::uuid;

      IF v_new_emp IS NOT NULL
          AND v_new_emp IS DISTINCT FROM v_cur.assigned_employee_id
          AND public.fsm_op_is_legal(v_edit_state, 'assign') THEN
        v_do_assign  := true;
        v_assign_src := COALESCE(NULLIF(p_payload->>'assignment_source', ''), 'manual');
      ELSIF v_new_emp IS NULL
          AND v_cur.assigned_employee_id IS NOT NULL
          AND public.fsm_op_is_legal(v_edit_state, 'unassign') THEN
        v_do_unassign := true;
      END IF;
    END IF;

    -- Concurrency Contract & Compliance checks on edit:
    IF v_do_assign THEN
      PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_new_emp::text));

      SELECT rule_id, details INTO v_breach_rule, v_breach_details
        FROM internal.eba_check_assignment(
          p_shift_id,
          v_new_emp,
          COALESCE(NULLIF(p_payload->>'shift_date','')::date, v_cur.shift_date),
          COALESCE(NULLIF(p_payload->>'start_time','')::time, v_cur.start_time),
          COALESCE(NULLIF(p_payload->>'end_time','')::time, v_cur.end_time),
          COALESCE((p_payload->>'unpaid_break_minutes')::int, v_cur.unpaid_break_minutes),
          COALESCE(NULLIF(p_payload->>'role_id','')::uuid, v_cur.role_id)
        ) WITH ORDINALITY AS c(is_compliant, rule_id, rule_name, tier, summary, details, payload, eba_ord)
       WHERE tier = 'BLOCKING'
       ORDER BY c.eba_ord
       LIMIT 1;

      IF v_breach_rule IS NOT NULL THEN
        RETURN jsonb_build_object('applied', false, 'note', 'EBA_COMPLIANCE_BREACH', 'rule_id', v_breach_rule, 'details', v_breach_details);
      END IF;
    ELSIF v_cur.assigned_employee_id IS NOT NULL AND NOT v_do_unassign AND (
      p_payload ? 'start_time' OR p_payload ? 'end_time' OR p_payload ? 'shift_date' OR
      p_payload ? 'role_id' OR p_payload ? 'unpaid_break_minutes' OR
      p_payload ? 'break_start' OR p_payload ? 'break_end'
    ) THEN
      PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_cur.assigned_employee_id::text));

      SELECT rule_id, details INTO v_breach_rule, v_breach_details
        FROM internal.eba_check_assignment(
          p_shift_id,
          v_cur.assigned_employee_id,
          COALESCE(NULLIF(p_payload->>'shift_date','')::date, v_cur.shift_date),
          COALESCE(NULLIF(p_payload->>'start_time','')::time, v_cur.start_time),
          COALESCE(NULLIF(p_payload->>'end_time','')::time, v_cur.end_time),
          COALESCE((p_payload->>'unpaid_break_minutes')::int, v_cur.unpaid_break_minutes),
          COALESCE(NULLIF(p_payload->>'role_id','')::uuid, v_cur.role_id)
        ) WITH ORDINALITY AS c(is_compliant, rule_id, rule_name, tier, summary, details, payload, eba_ord)
       WHERE tier = 'BLOCKING'
       ORDER BY c.eba_ord
       LIMIT 1;

      IF v_breach_rule IS NOT NULL THEN
        RETURN jsonb_build_object('applied', false, 'note', 'EBA_COMPLIANCE_BREACH', 'rule_id', v_breach_rule, 'details', v_breach_details);
      END IF;
    END IF;

    UPDATE public.shifts SET
      start_time            = COALESCE(NULLIF(p_payload->>'start_time','')::time, start_time),
      end_time              = COALESCE(NULLIF(p_payload->>'end_time','')::time, end_time),
      shift_date            = COALESCE(NULLIF(p_payload->>'shift_date','')::date, shift_date),
      paid_break_minutes    = COALESCE((p_payload->>'paid_break_minutes')::int, paid_break_minutes),
      unpaid_break_minutes  = COALESCE((p_payload->>'unpaid_break_minutes')::int, unpaid_break_minutes),
      break_start           = CASE WHEN p_payload ? 'break_start' THEN NULLIF(p_payload->>'break_start', '')::time ELSE break_start END,
      break_end             = CASE WHEN p_payload ? 'break_end' THEN NULLIF(p_payload->>'break_end', '')::time ELSE break_end END,
      notes                 = CASE WHEN p_payload ? 'notes' THEN p_payload->>'notes' ELSE notes END,
      role_id               = COALESCE(NULLIF(p_payload->>'role_id','')::uuid, role_id),
      sub_department_id     = COALESCE(NULLIF(p_payload->>'sub_department_id','')::uuid, sub_department_id),
      remuneration_level    = COALESCE(NULLIF(p_payload->>'remuneration_level','')::smallint, remuneration_level),
      shift_group_id        = COALESCE(NULLIF(p_payload->>'shift_group_id','')::uuid, shift_group_id),
      roster_subgroup_id    = COALESCE(NULLIF(p_payload->>'shift_subgroup_id','')::uuid, roster_subgroup_id),
      display_order         = COALESCE((p_payload->>'display_order')::int, display_order),
      timezone              = COALESCE(NULLIF(p_payload->>'timezone',''), timezone),
      is_training            = COALESCE((p_payload->>'is_training')::boolean, is_training),
      required_skills       = CASE WHEN p_payload ? 'required_skills' THEN COALESCE(p_payload->'required_skills', '[]'::jsonb) ELSE required_skills END,
      required_licenses     = CASE WHEN p_payload ? 'required_licenses' THEN COALESCE(p_payload->'required_licenses', '[]'::jsonb) ELSE required_licenses END,
      event_ids             = CASE WHEN p_payload ? 'event_ids' THEN COALESCE(p_payload->'event_ids', '[]'::jsonb) ELSE event_ids END,
      assigned_employee_id  = CASE WHEN v_do_assign   THEN v_new_emp
                                   WHEN v_do_unassign THEN NULL
                                   ELSE assigned_employee_id END,
      assigned_at           = CASE WHEN v_do_assign   THEN NOW()
                                   WHEN v_do_unassign THEN NULL
                                   ELSE assigned_at END,
      assignment_status     = CASE WHEN v_do_assign   THEN 'assigned'::public.shift_assignment_status
                                   WHEN v_do_unassign THEN 'unassigned'::public.shift_assignment_status
                                   ELSE assignment_status END,
      assignment_outcome    = CASE WHEN v_do_unassign THEN NULL ELSE assignment_outcome END,
      fulfillment_status    = CASE WHEN v_do_unassign THEN 'none'::public.shift_fulfillment_status
                                   ELSE fulfillment_status END,
      last_modified_by      = p_actor,
      last_modified_reason  = COALESCE(p_payload->>'reason', last_modified_reason),
      updated_at            = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'delete' THEN
    RETURN jsonb_build_object('applied', false, 'note', 'USE_SM_DELETE_SHIFT');

  ELSIF p_op = 'approve_trade' THEN
    IF COALESCE((p_payload->>'compliance_ok')::boolean, false) IS NOT TRUE THEN
      RETURN jsonb_build_object('applied', false, 'note', 'COMPLIANCE_NOT_CONFIRMED');
    END IF;

    SELECT * INTO v_swap
    FROM public.shift_swaps
    WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
      AND status = 'MANAGER_PENDING'
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('applied', false, 'note', 'NO_MANAGER_PENDING_SWAP');
    END IF;

    IF v_swap.target_id IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'UNRESOLVED_SWAP_TARGET');
    END IF;

    -- Concurrency Contract: Multi-Employee Lock Ordering (Deadlock Prevention)
    -- Advisory locks MUST be acquired in ascending lexicographical UUID order: LEAST then GREATEST
    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || LEAST(v_swap.requester_id, v_swap.target_id)::text));
    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || GREATEST(v_swap.requester_id, v_swap.target_id)::text));

    PERFORM public.sm_approve_peer_swap(
      v_swap.requester_shift_id, v_swap.target_shift_id,
      v_swap.requester_id, v_swap.target_id);

    UPDATE public.shift_swaps SET
      status            = 'APPROVED'::public.swap_request_status,
      manager_approved  = TRUE,
      approved_by       = p_actor,
      approved_at       = NOW(),
      status_changed_at = NOW(),
      updated_at        = NOW()
    WHERE id = v_swap.id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'reject_trade' THEN
    SELECT * INTO v_swap
    FROM public.shift_swaps
    WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
      AND status = 'MANAGER_PENDING'
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('applied', false, 'note', 'NO_MANAGER_PENDING_SWAP');
    END IF;

    UPDATE public.shift_swaps SET
      status            = 'REJECTED'::public.swap_request_status,
      reason            = COALESCE(NULLIF(p_payload->>'reason',''), 'Rejected by manager'),
      rejection_reason  = COALESCE(NULLIF(p_payload->>'reason',''), 'Rejected by manager'),
      status_changed_at = NOW(),
      updated_at        = NOW()
    WHERE id = v_swap.id AND status = 'MANAGER_PENDING';

    UPDATE public.shifts SET
      trading_status     = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL,
      last_modified_by   = p_actor,
      updated_at         = NOW()
    WHERE id IN (
      SELECT CASE WHEN requester_shift_id = p_shift_id THEN target_shift_id ELSE requester_shift_id END
      FROM public.shift_swaps
      WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
    ) AND id <> p_shift_id;

    UPDATE public.shifts SET
      trading_status = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);
  ELSE
    RETURN jsonb_build_object('applied', false, 'note', 'UNSUPPORTED_OP');
  END IF;
END;
$function$;

-- sm_unpublish_shift(uuid,uuid,text)
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

-- sm_unassign_shift(uuid,uuid)
CREATE OR REPLACE FUNCTION public.sm_unassign_shift(p_shift_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_shift RECORD; v_state text; v_to_state text;
  v_user_name text; v_user_role text;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_shift_action(p_shift_id, 'shift.assign');
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); END IF;
  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);
  IF v_state NOT IN ('S2', 'S3', 'S4') THEN
    RETURN jsonb_build_object('success', false, 'error', format('Cannot unassign from state %s (requires S2, S3, or S4)', v_state));
  END IF;

  v_to_state := CASE WHEN v_shift.lifecycle_status = 'Published' THEN 'S5' ELSE 'S1' END;
  UPDATE public.shifts SET
    assigned_employee_id = NULL,
    assigned_at          = NULL,
    assignment_status    = 'unassigned'::public.shift_assignment_status,
    assignment_outcome   = NULL,
    bidding_status       = CASE WHEN v_shift.lifecycle_status = 'Published'
                                THEN 'on_bidding'::public.shift_bidding_status
                                ELSE 'not_on_bidding'::public.shift_bidding_status END,
    fulfillment_status   = CASE WHEN v_shift.lifecycle_status = 'Published'
                                THEN 'bidding'::public.shift_fulfillment_status
                                ELSE 'none'::public.shift_fulfillment_status END,
    last_modified_by     = p_user_id,
    updated_at           = NOW()
  WHERE id = p_shift_id;

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', v_to_state);
END; $function$;

-- sm_bulk_publish_shifts(uuid[],uuid,jsonb)
CREATE OR REPLACE FUNCTION public.sm_bulk_publish_shifts(p_shift_ids uuid[], p_actor_id uuid DEFAULT auth.uid(), p_expected_versions jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_total_count int;
    v_success_count int;
    v_stale_ids uuid[];
    v_actor_name text;
    v_actor_role text;
BEGIN
    -- authz guard (2026-10-13): every shift must be publishable by the caller —
    -- the check sm_publish_shift makes via sm_require_shift_action. Without it
    -- any signed-in user could publish any shift in any organisation, and name
    -- any actor. System callers (cron, service role) pass, as there.
    IF NOT public.sm_request_is_system() THEN
        p_actor_id := auth.uid();
        PERFORM public.sm_require_shift_action(sid, 'shift.publish') FROM unnest(p_shift_ids) AS sid;
    END IF;

    v_total_count := array_length(p_shift_ids, 1);

    IF p_actor_id IS NOT NULL THEN
        SELECT
            COALESCE(first_name || ' ' || COALESCE(last_name, ''), email),
            left(lower(legacy_system_role::text), 50)
        INTO v_actor_name, v_actor_role
        FROM profiles
        WHERE id = p_actor_id;
    ELSE
        v_actor_name := 'System';
        v_actor_role := 'system_automation';
    END IF;

    -- Lock first, then decide (2026-10-18). The state used to be read by
    -- get_shift_state_id() into this CTE and the UPDATE below re-checked only
    -- the id, so a shift changed by another manager between the two (assigned,
    -- unassigned, published) was rewritten from the stale state: S5 bidding
    -- columns onto a just-assigned shift; offer timestamps reset on a shift
    -- already published. FOR UPDATE (in id order, so two bulk publishes never
    -- deadlock) makes a concurrent writer wait, and the state is read from the
    -- LOCKED row, which READ COMMITTED returns at its latest committed version.
    -- The S1/S2 test is get_shift_state_id(uuid)'s own, inlined.
    WITH locked AS MATERIALIZED (
        SELECT
            s.id,
            s.version,
            s.assigned_employee_id,
            s.shift_date,
            s.target_employment_type,
            s.lifecycle_status,
            s.assignment_status,
            s.start_at
        FROM shifts s
        WHERE s.id = ANY(p_shift_ids)
        ORDER BY s.id
        FOR UPDATE
    ),
    -- Changed since the caller's check (or never checked): not published.
    stale AS (
        SELECT l.id
        FROM locked l
        WHERE p_expected_versions IS NOT NULL
          AND (p_expected_versions ->> l.id::text)::int IS DISTINCT FROM l.version
    ),
    shift_calculations AS (
        SELECT
            l.id,
            l.assigned_employee_id,
            l.shift_date,
            l.target_employment_type = 'FT' AS is_ft,
            CASE
                WHEN l.lifecycle_status::text = 'Draft' AND l.assignment_status::text = 'unassigned' THEN 'S1'
                WHEN l.lifecycle_status::text = 'Draft' AND l.assignment_status::text = 'assigned' THEN 'S2'
            END as current_state,
            l.start_at as shift_start_tz,
            get_time_category(l.start_at) as time_cat
        FROM locked l
        WHERE l.id NOT IN (SELECT id FROM stale)
    ),
    valid_transitions AS (
        SELECT
            id,
            current_state,
            time_cat,
            CASE
                WHEN is_ft AND current_state = 'S2' THEN 'S4'
                WHEN is_ft THEN NULL
                WHEN current_state = 'S1' AND time_cat IN ('URGENT','NORMAL') THEN 'S5'
                WHEN current_state = 'S2' AND time_cat = 'EMERGENCY' THEN 'S4'
                WHEN current_state = 'S2' THEN 'S3'
                ELSE NULL
            END as new_state_id,
            CASE
                WHEN EXTRACT(EPOCH FROM (shift_start_tz - NOW())) / 3600.0 <= 4 THEN NOW()
                WHEN EXTRACT(EPOCH FROM (shift_start_tz - NOW())) / 3600.0 <= 24 THEN LEAST(NOW() + INTERVAL '4 hours', shift_start_tz - INTERVAL '4 hours')
                WHEN EXTRACT(EPOCH FROM (shift_start_tz - NOW())) / 3600.0 <= 48 THEN NOW() + INTERVAL '8 hours'
                ELSE NOW() + INTERVAL '12 hours'
            END as offer_deadline
        FROM shift_calculations
        WHERE current_state IN ('S1', 'S2')
          AND time_cat != 'PAST'
          AND NOT (current_state = 'S1' AND time_cat = 'EMERGENCY')
          -- Approved leave: an assigned shift is never published onto it.
          AND NOT (assigned_employee_id IS NOT NULL
                   AND public.employee_on_approved_leave(assigned_employee_id, shift_date))
    ),
    updated_rows AS (
        UPDATE shifts s
        SET
            lifecycle_status = 'Published',
            published_at = NOW(),
            last_modified_by = p_actor_id,
            updated_at = NOW(),
            bidding_status = CASE WHEN vt.new_state_id = 'S5' THEN 'on_bidding' ELSE s.bidding_status END,
            bidding_open_at = CASE WHEN vt.new_state_id = 'S5' THEN NOW() ELSE s.bidding_open_at END,
            fulfillment_status = CASE
                WHEN vt.new_state_id = 'S5' THEN 'bidding'::shift_fulfillment_status
                WHEN vt.new_state_id = 'S4' THEN 'scheduled'::shift_fulfillment_status
                WHEN vt.new_state_id = 'S3' THEN 'offered'::shift_fulfillment_status
                ELSE s.fulfillment_status
            END,
            assignment_outcome = CASE
                WHEN vt.new_state_id = 'S4' THEN 'confirmed'
                WHEN vt.new_state_id = 'S3' THEN NULL
                ELSE s.assignment_outcome
            END,
            offer_expires_at = CASE WHEN vt.new_state_id = 'S3' THEN vt.offer_deadline ELSE s.offer_expires_at END
        FROM valid_transitions vt
        WHERE s.id = vt.id AND vt.new_state_id IS NOT NULL
        RETURNING s.id, vt.current_state, vt.new_state_id, vt.offer_deadline
    ),
    offers_update AS (
        UPDATE public.shift_offers so
        SET offer_expires_at = ur.offer_deadline
        FROM updated_rows ur
        WHERE so.shift_id = ur.id
          AND ur.new_state_id = 'S3'
          AND so.status = 'Pending'
        RETURNING so.id
    )
    SELECT
        (SELECT count(*) FROM updated_rows),
        (SELECT COALESCE(array_agg(id), '{}') FROM stale)
    INTO v_success_count, v_stale_ids;

    RETURN jsonb_build_object(
        'success', true,
        'total_requested', v_total_count,
        'success_count', v_success_count,
        'failure_count', v_total_count - v_success_count,
        'stale_ids', to_jsonb(v_stale_ids),
        'message', format('Successfully published %s of %s shifts', v_success_count, v_total_count)
    );

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error in sm_bulk_publish_shifts: %', SQLERRM;
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- sm_reject_offer(uuid,uuid)
CREATE OR REPLACE FUNCTION public.sm_reject_offer(p_shift_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_shift RECORD; v_state text;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_assignee_or(p_shift_id, p_user_id, 'shift.assign');
  -- 1. Get shift and lock it
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  
  IF NOT FOUND THEN 
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); 
  END IF;
  
  -- 2. Authorization check: Only the assigned employee can reject their own offer
  IF v_shift.assigned_employee_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: You can only reject shifts offered to you');
  END IF;

  -- 3. State check: Must be in S3 (Published + Offered)
  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);
  
  IF v_state != 'S3' THEN
    RETURN jsonb_build_object('success', false, 'error', format('sm_reject_offer requires state S3, current state is %s', v_state));
  END IF;
  
  -- 4. Transition S3 -> S5 (Bidding)
  UPDATE public.shifts SET
    assigned_employee_id = NULL,
    assigned_at          = NULL,
    assignment_status    = 'unassigned'::public.shift_assignment_status,
    assignment_outcome   = NULL,
    bidding_status       = 'on_bidding'::public.shift_bidding_status,
    fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
    last_rejected_by     = p_user_id,
    last_dropped_by      = NULL,
    last_modified_by     = p_user_id,
    updated_at           = NOW()
  WHERE id = p_shift_id;

  -- 5. Log the event for permanent history
  INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
  VALUES (p_shift_id, p_user_id, 'REJECTED', NOW());
  
  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S5');
END; 
$function$;

-- Keep the "bidding requires unassigned" invariant, now on bidding_status.
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS chk_bidding_requires_unassigned;
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_demand_source_check;
ALTER TABLE public.shifts ADD CONSTRAINT chk_bidding_requires_unassigned
  CHECK (NOT (bidding_status::text IN ('on_bidding','on_bidding_normal','on_bidding_urgent') AND assigned_employee_id IS NOT NULL));

ALTER TABLE public.shifts
  DROP COLUMN IF EXISTS demand_source,
  DROP COLUMN IF EXISTS demand_group_id,
  DROP COLUMN IF EXISTS break_minutes,
  DROP COLUMN IF EXISTS is_on_bidding;
