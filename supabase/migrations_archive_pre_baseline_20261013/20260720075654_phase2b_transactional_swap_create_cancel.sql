-- =============================================================================
-- Phase 2b — Transactional swap create/cancel (M2).
--
-- createSwapRequest / cancelSwapRequest were two-step CLIENT operations
-- (insert shift_swaps → update shifts; update shift_swaps → update shifts) whose
-- second step could fail and leave orphaned state (the code even logged "ideally
-- we would rollback"). These SECURITY DEFINER RPCs make each an atomic
-- transaction and add server-side ownership authorization that RLS could not
-- express (swaps_insert_own only checked requester_id = uid, NOT that the caller
-- is actually assigned to the shift being offered).
--
-- Granted to authenticated + service_role only (never anon — cf. Phase 1 H1).
-- NOT YET APPLIED — pending review + checkpoint sign-off.
-- =============================================================================

-- ── Create ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."sm_create_swap_request"(
  "p_requester_shift_id" "uuid",
  "p_target_id" "uuid" DEFAULT NULL::"uuid",
  "p_reason" "text" DEFAULT NULL::"text"
) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $function$
DECLARE
  v_caller  uuid := auth.uid();
  v_shift   shifts%ROWTYPE;
  v_start   timestamptz;
  v_swap_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated', 'code', 'UNAUTHENTICATED');
  END IF;

  SELECT * INTO v_shift FROM shifts WHERE id = p_requester_shift_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Shift not found', 'code', 'SHIFT_NOT_FOUND');
  END IF;

  -- Only the assigned worker (or a manager/admin) may put this shift up for swap.
  IF v_shift.assigned_employee_id IS DISTINCT FROM v_caller AND NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'You are not assigned to this shift', 'code', 'FORBIDDEN');
  END IF;

  -- §9 time lock — mirror fn_set_swap_expires_at's start computation (tz-correct).
  v_start := COALESCE(
    v_shift.start_at,
    (v_shift.shift_date::text || ' ' || v_shift.start_time::text)::timestamp
      AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney')
  );
  IF v_start IS NOT NULL AND v_start - now() < interval '4 hours' THEN
    RETURN json_build_object('success', false, 'error', 'Time locked: shift starts in < 4h', 'code', 'TIME_LOCKED');
  END IF;

  -- One active swap per shift.
  IF EXISTS (
    SELECT 1 FROM shift_swaps
    WHERE requester_shift_id = p_requester_shift_id
      AND status IN ('OPEN', 'MANAGER_PENDING')
  ) THEN
    RETURN json_build_object('success', false, 'error', 'An active swap already exists for this shift', 'code', 'SWAP_EXISTS');
  END IF;

  -- Atomic: create the OPEN request (trg_set_swap_expires_at stamps expires_at)
  -- and flip the shift to TradeRequested (S4 → S9) in one transaction.
  INSERT INTO shift_swaps (requester_id, requester_shift_id, target_id, reason, status)
  VALUES (v_caller, p_requester_shift_id, p_target_id, p_reason, 'OPEN')
  RETURNING id INTO v_swap_id;

  UPDATE shifts
  SET trading_status = 'TradeRequested', trade_requested_at = now()
  WHERE id = p_requester_shift_id;

  RETURN json_build_object('success', true, 'swap_id', v_swap_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$function$;

-- ── Cancel ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."sm_cancel_swap_request"("p_swap_id" "uuid")
  RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_swap   shift_swaps%ROWTYPE;
BEGIN
  SELECT * INTO v_swap FROM shift_swaps WHERE id = p_swap_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Swap not found', 'code', 'SWAP_NOT_FOUND');
  END IF;

  IF v_caller IS NOT NULL AND v_caller <> v_swap.requester_id AND NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized to cancel this swap', 'code', 'FORBIDDEN');
  END IF;

  IF v_swap.status <> 'OPEN' THEN
    RETURN json_build_object(
      'success', false,
      'error', format('Cannot cancel swap in state %s. Must be OPEN.', v_swap.status),
      'code', 'SWAP_NOT_OPEN'
    );
  END IF;

  -- Atomic: cancel the request and revert the shift to NoTrade (only when no
  -- other active swap still references it).
  UPDATE shift_swaps SET status = 'CANCELLED', updated_at = now()
  WHERE id = p_swap_id AND status = 'OPEN';

  UPDATE shifts SET trading_status = 'NoTrade', trade_requested_at = NULL
  WHERE id = v_swap.requester_shift_id
    AND NOT EXISTS (
      SELECT 1 FROM shift_swaps s2
      WHERE s2.requester_shift_id = v_swap.requester_shift_id
        AND s2.id <> p_swap_id
        AND s2.status IN ('OPEN', 'MANAGER_PENDING')
    );

  RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$function$;

-- ── Grants (authenticated + service_role only; never anon) ───────────────────
-- NB: Supabase default privileges auto-GRANT EXECUTE to `anon` on new functions,
-- and REVOKE ... FROM PUBLIC does NOT remove that role-specific grant — the
-- explicit `FROM anon` revoke is required (cf. Phase 1 H1).
REVOKE ALL ON FUNCTION "public"."sm_create_swap_request"("uuid", "uuid", "text") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."sm_create_swap_request"("uuid", "uuid", "text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."sm_create_swap_request"("uuid", "uuid", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."sm_create_swap_request"("uuid", "uuid", "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."sm_cancel_swap_request"("uuid") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."sm_cancel_swap_request"("uuid") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."sm_cancel_swap_request"("uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."sm_cancel_swap_request"("uuid") TO "service_role";
