-- Redefine sm_expire_offer_now to transition to S2 (Draft+Assigned) instead of S1.
CREATE OR REPLACE FUNCTION public.sm_expire_offer_now(p_shift_id uuid)
  RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    updated_at            = now()
  WHERE id = p_shift_id;

  RETURN json_build_object('success', true, 'from_state', 'S3', 'to_state', 'S2');
END;
$function$;

ALTER FUNCTION public.sm_expire_offer_now(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.sm_expire_offer_now(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_expire_offer_now(uuid) TO service_role;


-- Redefine sm_run_state_processor to transition S3 (Offered) to S2 (Draft+Assigned) instead of S1.
CREATE OR REPLACE PROCEDURE public.sm_run_state_processor()
  LANGUAGE plpgsql
  SET search_path TO 'pg_catalog', 'public'
AS $procedure$
BEGIN

  -- ── Pass 0a: Published + assigned → InProgress when shift starts ───────────
  BEGIN
    UPDATE shifts SET lifecycle_status = 'InProgress', updated_at = now()
    WHERE lifecycle_status = 'Published'
      AND assignment_status = 'assigned'
      AND (
        (start_at IS NOT NULL
          AND start_at <= now()
          AND start_at > now() - INTERVAL '12 hours')
        OR
        (start_at IS NULL
          AND (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ <= now()
          AND (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ > now() - INTERVAL '12 hours')
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 0a failed: %', SQLERRM;
  END;

  -- ── Pass 0b: InProgress → Completed when shift ends (scheduled end) ────────
  BEGIN
    UPDATE shifts SET lifecycle_status = 'Completed', updated_at = now()
    WHERE lifecycle_status = 'InProgress'
      AND (
        (end_at IS NOT NULL AND end_at <= now())
        OR
        (end_at IS NULL
          AND (shift_date::text || ' ' || end_time::text || ' Australia/Sydney')::TIMESTAMPTZ <= now())
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 0b failed: %', SQLERRM;
  END;

  -- ── Pass 1 (REMOVED): urgency escalation at TTS ≤ 24h ─────────────────────
  --    Previously: UPDATE shifts SET bidding_status='on_bidding_urgent'
  --    WHERE bidding_status='on_bidding_normal' AND TTS<=24h.
  --    S6/urgency is now derived from TTS at read time, so this pass is dead.

  -- ── Pass 2: Offer expiry S3 → S2 at TTS ≤ 4h ──────────────────────────────
  --    Now keeps assignment (transitions to S2 instead of S1)
  BEGIN
    UPDATE shifts SET
      lifecycle_status      = 'Draft',
      assignment_outcome    = NULL,
      bidding_status        = 'not_on_bidding',
      updated_at            = now()
    WHERE lifecycle_status = 'Published'
      AND assignment_outcome = 'offered'
      AND (
        (start_at IS NOT NULL AND start_at <= now() + INTERVAL '4 hours')
        OR
        (start_at IS NULL
          AND (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ <= now() + INTERVAL '4 hours')
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 2 failed: %', SQLERRM;
  END;

  -- ── Pass 3: Bidding expiry S5/S6 → S1 at TTS ≤ 4h ─────────────────────────
  -- (FIXED) include the unified 'on_bidding' value, plus the start_at NULL fallback.
  BEGIN
    UPDATE shifts SET
      lifecycle_status  = 'Draft',
      bidding_status    = 'not_on_bidding',
      is_on_bidding     = false,
      assignment_status = 'unassigned',
      updated_at        = now()
    WHERE lifecycle_status = 'Published'
      AND bidding_status IN ('on_bidding', 'on_bidding_normal', 'on_bidding_urgent')
      AND (
        (start_at IS NOT NULL AND start_at <= now() + INTERVAL '4 hours')
        OR
        (start_at IS NULL
          AND (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ <= now() + INTERVAL '4 hours')
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 3 failed: %', SQLERRM;
  END;

  -- ── Pass 4: Auto no-show — shift has ENDED with no clock-in ────────────────
  BEGIN
    UPDATE shifts SET attendance_status = 'no_show', updated_at = now()
    WHERE lifecycle_status IN ('InProgress', 'Completed')
      AND attendance_status = 'unknown'
      AND (
        (end_at IS NOT NULL AND end_at <= now())
        OR
        (end_at IS NULL
          AND (shift_date::text || ' ' || end_time::text || ' Australia/Sydney')::TIMESTAMPTZ <= now())
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 4 failed: %', SQLERRM;
  END;

  -- ── Pass 5: Auto clock-out — clocked-in shift past scheduled end ───────────
  BEGIN
    UPDATE shifts SET
      actual_end         = COALESCE(
        end_at,
        (shift_date::text || ' ' || end_time::text || ' Australia/Sydney')::TIMESTAMPTZ
      ),
      actual_net_minutes = GREATEST(0,
        EXTRACT(EPOCH FROM (
          COALESCE(
            end_at,
            (shift_date::text || ' ' || end_time::text || ' Australia/Sydney')::TIMESTAMPTZ
          ) - COALESCE(actual_start, start_at,
            (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ
          )
        )) / 60
      )::INTEGER,
      attendance_note    = 'auto_clocked_out',
      updated_at         = now()
    WHERE attendance_status IN ('checked_in', 'late')
      AND actual_end IS NULL
      AND (
        (end_at IS NOT NULL
          AND end_at + MAKE_INTERVAL(mins => COALESCE(unpaid_break_minutes, 30)) <= now())
        OR
        (end_at IS NULL
          AND (shift_date::text || ' ' || end_time::text || ' Australia/Sydney')::TIMESTAMPTZ
              + MAKE_INTERVAL(mins => COALESCE(unpaid_break_minutes, 30)) <= now())
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 5 failed: %', SQLERRM;
  END;

  -- ── Pass 6: 12.5h fallback safety net ───────────────────────────────────────
  BEGIN
    UPDATE shifts SET
      lifecycle_status   = 'Completed',
      attendance_status  = 'auto_clock_out',
      actual_end         = COALESCE(actual_end, now()),
      actual_net_minutes = GREATEST(0,
        EXTRACT(EPOCH FROM (
          COALESCE(actual_end, now()) -
          COALESCE(actual_start, start_at,
            (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ
          )
        )) / 60
      )::INTEGER,
      attendance_note    = 'Auto-completed by system (12.5hr limit)',
      updated_at         = now()
    WHERE lifecycle_status = 'InProgress'
      AND COALESCE(actual_start, start_at,
            (shift_date::text || ' ' || start_time::text || ' Australia/Sydney')::TIMESTAMPTZ
          ) + INTERVAL '12.5 hours' <= now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sm_run_state_processor] Pass 6 failed: %', SQLERRM;
  END;

END;
$procedure$;
