-- sm_request_trade: the 4-hour lockout refusal raised instead of explaining.
--
-- format() has no %f, so format('… %.1fh …') raised 22023 and the function's
-- catch-all returned 'unrecognized format() type specifier "."' to the
-- employee. Now %s with round(…, 1). Found by plpgsql_check; the only change
-- from the live definition (pg_get_functiondef, 2026-10-28) is that call.
-- Grants are kept by CREATE OR REPLACE.
-- Test: supabase/tests/sm_request_trade_lockout_message.sql

CREATE OR REPLACE FUNCTION public.sm_request_trade(p_shift_id uuid, p_user_id uuid, p_target_employee_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_shift             RECORD;
    v_state             TEXT;
    v_shift_start       TIMESTAMPTZ;
    v_hours_until_start NUMERIC;
    v_swap_id           UUID;
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_assignee_or(p_shift_id, p_user_id, 'shift.assign');
    -- 1. Lock the shift row
    SELECT * INTO v_shift
    FROM public.shifts
    WHERE id = p_shift_id AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
    END IF;

    -- 2. Derive current state using the canonical function
    v_state := public.fn_shift_state(
        v_shift.lifecycle_status::TEXT,
        v_shift.assignment_status::TEXT,
        v_shift.assignment_outcome::TEXT,
        v_shift.bidding_status::TEXT,
        v_shift.trading_status::TEXT,
        COALESCE(v_shift.is_cancelled, FALSE)
    );

    -- 3. Must be S4 (Published + Confirmed + NoTrade)
    IF v_state != 'S4' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('Cannot request trade from state %s — must be S4 (Confirmed)', v_state)
        );
    END IF;

    -- 4. Requesting user must be the assigned employee
    IF v_shift.assigned_employee_id IS DISTINCT FROM p_user_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'You are not assigned to this shift'
        );
    END IF;

    -- 5. Time lock: cannot trade within 4h of shift start
    v_shift_start := COALESCE(
        v_shift.start_at,
        (v_shift.shift_date::TEXT || ' ' || v_shift.start_time::TEXT)::TIMESTAMP
            AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney')
    );
    v_hours_until_start := EXTRACT(EPOCH FROM (v_shift_start - NOW())) / 3600.0;

    IF v_hours_until_start < 4 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format(
                'Cannot request trade: shift starts in %sh (4h lockout applies)',
                round(v_hours_until_start, 1)
            )
        );
    END IF;

    -- 6. Transition shift: S4 → S9
    --    fn_audit_shift_update trigger will fire and log TRADE_REQUESTED
    UPDATE public.shifts
    SET
        trading_status      = 'TradeRequested'::shift_trading,
        trade_requested_at  = NOW(),
        updated_at          = NOW(),
        last_modified_by    = p_user_id,
        last_modified_reason = 'Employee requested trade'
    WHERE id = p_shift_id;

    -- 7. Create the swap request record.
    --    The BEFORE INSERT trigger fn_set_swap_expires_at auto-sets
    --    expires_at = shift_start - 4h.
    --    The AFTER INSERT trigger fn_audit_swap_event does NOT log
    --    TRADE_REQUESTED (removed in dedup fix) — shift trigger handles it.
    INSERT INTO public.shift_swaps (
        requester_id,
        requester_shift_id,
        target_id,         -- NULL = open trade (anyone can respond)
        target_shift_id,   -- NULL = no specific counter-shift required
        swap_type,
        status
    ) VALUES (
        p_user_id,
        p_shift_id,
        p_target_employee_id,
        NULL,
        'swap',
        'OPEN'
    )
    RETURNING id INTO v_swap_id;

    RETURN jsonb_build_object(
        'success',    true,
        'swap_id',    v_swap_id,
        'trade_id',   p_shift_id,
        'from_state', 'S4',
        'to_state',   'S9',
        'expires_at', (SELECT expires_at FROM public.shift_swaps WHERE id = v_swap_id)
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$function$;
