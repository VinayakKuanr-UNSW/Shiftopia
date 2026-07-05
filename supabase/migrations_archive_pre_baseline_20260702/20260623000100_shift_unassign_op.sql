-- Shift mutation gateway — add the `unassign` op (inverse of `assign`).
--
-- Managers remove an assigned worker from a DRAFT shift: S2 (Draft+assigned) → S1
-- (Draft+unassigned). Removing a worker from a PUBLISHED shift is intentionally NOT
-- supported here — a Published+unassigned+not-on-bidding row maps to UNKNOWN in
-- fn_shift_state, so the manager must `unpublish` first (S3/S4 → S2) then `unassign`.
--
-- Forward-only, dated AFTER 20260623000000 so these are the LAST definitions on a
-- fresh rebuild. All three functions are CREATE OR REPLACE'd from their CURRENT
-- authoritative bodies (224311 merge for fsm_op_is_legal/_apply_shift_op_write, the
-- 20260623000000 audit-event fix for sm_apply_shift_op) with ONLY the unassign
-- additions layered in — no other branch is changed. Idempotent.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Legality matrix: unassign is legal ONLY from S2.
CREATE OR REPLACE FUNCTION public.fsm_op_is_legal(p_state text, p_op text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE p_op
    WHEN 'select_winner' THEN p_state IN ('S5', 'S6')
    WHEN 'publish' THEN p_state IN ('S1', 'S2')
    WHEN 'unpublish' THEN p_state IN ('S3', 'S4', 'S5', 'S9', 'S10')

    -- assign: unassigned (S1/S5/S6/S8) OR reassign on assigned-but-pre-start (S2/S3/S4/S7).
    WHEN 'assign' THEN p_state IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8')

    -- unassign: inverse of assign, DRAFT-only. S2 (Draft+assigned) → S1. A published
    -- assigned shift (S3/S4) must be unpublished first (no defined unassigned-published
    -- FSM state), so it is NOT admitted here.
    WHEN 'unassign' THEN p_state IN ('S2')

    WHEN 'approve_trade' THEN p_state IN ('S10')
    WHEN 'reject_trade'  THEN p_state IN ('S9', 'S10')
    WHEN 'delete' THEN p_state IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10')
    WHEN 'edit' THEN p_state IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10')
    ELSE false
  END;
$function$;

ALTER FUNCTION public.fsm_op_is_legal(text, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.fsm_op_is_legal(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fsm_op_is_legal(text, text) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Write dispatcher: add the `unassign` branch (immediately after `assign`).
--    Full 224311-merged body reproduced verbatim; ONLY the unassign ELSIF is new.
CREATE OR REPLACE FUNCTION public._apply_shift_op_write(
  p_shift_id uuid,
  p_op       text,
  p_payload  jsonb,
  p_actor    uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_cur     RECORD;
  v_winner  uuid;
  v_emp     uuid;
  v_swap    public.shift_swaps%ROWTYPE;
BEGIN
  -- Re-read the already-locked row (caller holds FOR UPDATE in the same txn).
  SELECT * INTO v_cur FROM public.shifts WHERE id = p_shift_id;

  IF p_op = 'assign' THEN
    -- Mirror sm_bulk_assign / sm_emergency_assign assign semantics. Target
    -- worker comes from payload.employee_id.
    v_emp := NULLIF(p_payload->>'employee_id', '')::uuid;
    IF v_emp IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'MISSING_EMPLOYEE_ID');
    END IF;

    UPDATE public.shifts SET
      assigned_employee_id = v_emp,
      assigned_at          = NOW(),
      assignment_status    = 'assigned'::public.shift_assignment_status,
      assignment_outcome   = CASE WHEN lifecycle_status = 'Published'
                                  THEN 'confirmed'::public.shift_assignment_outcome
                                  ELSE assignment_outcome END,
      confirmed_at         = CASE WHEN lifecycle_status = 'Published'
                                  THEN NOW() ELSE confirmed_at END,
      bidding_status       = CASE WHEN lifecycle_status = 'Published'
                                  THEN 'not_on_bidding'::public.shift_bidding_status
                                  ELSE bidding_status END,
      is_on_bidding        = CASE WHEN lifecycle_status = 'Published'
                                  THEN FALSE ELSE is_on_bidding END,
      last_modified_by     = p_actor,
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'unassign' THEN
    -- Inverse of `assign`, DRAFT-only (the FSM guard restricts this to S2). The
    -- shift is an unpublished draft with a worker attached and NO offer/bidding to
    -- unwind (offers only exist once Published). Clear the worker + assignment
    -- bookkeeping back to S1; the BEFORE trigger trg_cleanup_offers_on_unassign
    -- additionally nulls assignment_outcome / resets a stale 'offered' fulfillment.
    IF v_cur.assigned_employee_id IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'ALREADY_UNASSIGNED');
    END IF;

    UPDATE public.shifts SET
      assigned_employee_id = NULL,
      assigned_at          = NULL,
      assignment_status    = 'unassigned'::public.shift_assignment_status,
      assignment_outcome   = NULL,
      confirmed_at         = NULL,
      fulfillment_status   = 'none'::public.shift_fulfillment_status,
      last_modified_by     = p_actor,
      last_modified_reason = COALESCE(p_payload->>'reason', 'Unassigned via shift gateway'),
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'publish' THEN
    -- Mirror publish_shift (20260619004412). Two arms: assigned => offered,
    -- unassigned => open bidding (unified on_bidding) with a 4h-before-start
    -- close. Re-validate the 4h window here (the FSM guard does not know start).
    IF v_cur.assigned_employee_id IS NOT NULL THEN
      INSERT INTO public.shift_offers (shift_id, employee_id, status)
      VALUES (p_shift_id, v_cur.assigned_employee_id, 'Pending')
      ON CONFLICT (shift_id, employee_id) DO NOTHING;

      UPDATE public.shifts SET
        lifecycle_status     = 'Published'::public.shift_lifecycle,
        fulfillment_status   = 'scheduled'::public.shift_fulfillment_status,
        assignment_outcome   = 'offered'::public.shift_assignment_outcome,
        published_at         = NOW(),
        published_by_user_id = p_actor,
        last_modified_by     = p_actor,
        updated_at           = NOW()
      WHERE id = p_shift_id;
    ELSE
      IF ((v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp
            AT TIME ZONE 'Australia/Sydney') - INTERVAL '4 hours' <= NOW() THEN
        RETURN jsonb_build_object('applied', false, 'note', 'PUBLISH_TOO_LATE');
      END IF;

      UPDATE public.shifts SET
        lifecycle_status     = 'Published'::public.shift_lifecycle,
        fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
        bidding_status       = 'on_bidding'::public.shift_bidding_status,
        published_at         = NOW(),
        published_by_user_id = p_actor,
        is_on_bidding        = TRUE,
        bidding_enabled      = TRUE,
        bidding_open_at      = NOW(),
        bidding_close_at     = ((v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp
                                  AT TIME ZONE 'Australia/Sydney') - INTERVAL '4 hours',
        last_modified_by     = p_actor,
        updated_at           = NOW()
      WHERE id = p_shift_id;
    END IF;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'unpublish' THEN
    -- If there's an in-flight trade request (S9/S10), we cancel the swap request
    -- and reset the trading_status of both the requester and offered shifts.
    IF v_cur.trading_status IN ('TradeRequested', 'TradeAccepted') THEN
      UPDATE public.shift_swaps SET
        status = 'CANCELLED',
        updated_at = NOW()
      WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
        AND status IN ('OPEN', 'MANAGER_PENDING', 'OFFER_SELECTED');

      UPDATE public.shifts SET
        trading_status = 'NoTrade'::public.shift_trading,
        trade_requested_at = NULL,
        last_modified_by = p_actor,
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
        last_modified_by = p_actor,
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

    -- Mirror sm_unpublish_shift (baseline). S3/S4 => Draft+assigned (S2),
    -- S5 => Draft+unassigned (S1). FSM guard already restricted to S3/S4/S5/S9/S10, so
    -- branch on whether a worker is attached.
    IF v_cur.assigned_employee_id IS NOT NULL THEN
      UPDATE public.shifts SET
        lifecycle_status   = 'Draft'::public.shift_lifecycle,
        assignment_outcome = NULL,
        bidding_status     = 'not_on_bidding'::public.shift_bidding_status,
        is_on_bidding      = FALSE,
        fulfillment_status = 'none'::public.shift_fulfillment_status,
        last_modified_by   = p_actor,
        updated_at         = NOW()
      WHERE id = p_shift_id;
    ELSE
      UPDATE public.shifts SET
        lifecycle_status   = 'Draft'::public.shift_lifecycle,
        bidding_status     = 'not_on_bidding'::public.shift_bidding_status,
        is_on_bidding      = FALSE,
        fulfillment_status = 'none'::public.shift_fulfillment_status,
        last_modified_by   = p_actor,
        updated_at         = NOW()
      WHERE id = p_shift_id;
    END IF;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'select_winner' THEN
    -- Deliberate SUPERSET of sm_select_bid_winner (20260619004412): same bid
    -- accept/reject fan-out + assignment, plus assigned_at / confirmed_at /
    -- last_modified_by which that thinner RPC omits. KEEP IN SYNC.
    v_winner := COALESCE(NULLIF(p_payload->>'winner_id', ''), NULLIF(p_payload->>'employee_id', ''))::uuid;
    IF v_winner IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'MISSING_WINNER_ID');
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
      is_on_bidding        = FALSE,
      fulfillment_status   = 'scheduled'::public.shift_fulfillment_status,
      confirmed_at         = NOW(),
      last_modified_by     = p_actor,
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'edit' THEN
    -- Partial update of a WHITELIST of schedule + grouping fields. Assignment /
    -- lifecycle / bidding / trading / version / soft-delete / compliance columns
    -- are owned by their dedicated ops + the state machine and are NOT editable here.
    IF NOT (p_payload ?| ARRAY[
      'start_time','end_time','shift_date','break_minutes','paid_break_minutes',
      'unpaid_break_minutes','notes','role_id','sub_department_id',
      'remuneration_level_id','group_type','sub_group_name','display_order',
      'shift_group_id','shift_subgroup_id','timezone','is_training'
    ]) THEN
      RETURN jsonb_build_object('applied', false, 'note', 'NO_EDITABLE_FIELDS');
    END IF;

    UPDATE public.shifts SET
      start_time            = COALESCE(NULLIF(p_payload->>'start_time','')::time, start_time),
      end_time              = COALESCE(NULLIF(p_payload->>'end_time','')::time, end_time),
      shift_date            = COALESCE(NULLIF(p_payload->>'shift_date','')::date, shift_date),
      paid_break_minutes    = COALESCE((p_payload->>'paid_break_minutes')::int, paid_break_minutes),
      unpaid_break_minutes  = COALESCE((p_payload->>'unpaid_break_minutes')::int, unpaid_break_minutes),
      break_minutes         = COALESCE((p_payload->>'paid_break_minutes')::int, paid_break_minutes)
                            + COALESCE((p_payload->>'unpaid_break_minutes')::int, unpaid_break_minutes),
      notes                 = CASE WHEN p_payload ? 'notes' THEN p_payload->>'notes' ELSE notes END,
      role_id               = COALESCE(NULLIF(p_payload->>'role_id','')::uuid, role_id),
      sub_department_id     = COALESCE(NULLIF(p_payload->>'sub_department_id','')::uuid, sub_department_id),
      remuneration_level_id = COALESCE(NULLIF(p_payload->>'remuneration_level_id','')::uuid, remuneration_level_id),
      shift_group_id        = COALESCE(NULLIF(p_payload->>'shift_group_id','')::uuid, shift_group_id),
      roster_subgroup_id    = COALESCE(NULLIF(p_payload->>'shift_subgroup_id','')::uuid, roster_subgroup_id),
      group_type            = COALESCE(NULLIF(p_payload->>'group_type','')::template_group_type, group_type),
      sub_group_name        = CASE WHEN p_payload ? 'sub_group_name' THEN p_payload->>'sub_group_name' ELSE sub_group_name END,
      display_order         = COALESCE((p_payload->>'display_order')::int, display_order),
      timezone              = COALESCE(NULLIF(p_payload->>'timezone',''), timezone),
      is_training           = COALESCE((p_payload->>'is_training')::boolean, is_training),
      last_modified_by      = p_actor,
      last_modified_reason  = COALESCE(p_payload->>'reason', last_modified_reason),
      updated_at            = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'delete' THEN
    -- SOFT tombstone (deleted_at), consistent with the gateway's GONE handling.
    UPDATE public.shifts SET
      deleted_at           = NOW(),
      deleted_by           = p_actor,
      last_modified_by     = p_actor,
      last_modified_reason = COALESCE(p_payload->>'reason', 'Deleted via shift gateway'),
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'reject_trade' THEN
    -- Reject a MANAGER_PENDING swap on the authoritative shift_swaps table.
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
    WHERE id = v_swap.requester_shift_id
       OR (v_swap.target_shift_id IS NOT NULL AND id = v_swap.target_shift_id);
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'approve_trade' THEN
    -- Approve a MANAGER_PENDING swap (compliance-gated; delegates reassignment).
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

  ELSE
    RETURN jsonb_build_object('applied', false, 'note', 'UNKNOWN_OP');
  END IF;
END;
$function$;

ALTER FUNCTION public._apply_shift_op_write(uuid, text, jsonb, uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public._apply_shift_op_write(uuid, text, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public._apply_shift_op_write(uuid, text, jsonb, uuid) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Public gateway: map `unassign` → UNASSIGNED and name the REMOVED worker as the
--    event subject. Captures the pre-write assignee (v_prev_assignee) so an
--    unassign/UNASSIGNED event still records who was removed (post-write is NULL).
CREATE OR REPLACE FUNCTION public.sm_apply_shift_op(
  p_shift_id         uuid,
  p_expected_version integer,
  p_op               text,
  p_payload          jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key  uuid  DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_caller        uuid := auth.uid();
  v_cur           RECORD;
  v_state         text;
  v_write         jsonb;
  v_event         public.shift_event_type;
  v_prev_assignee uuid;
BEGIN
  -- (a) Authorization. NULL caller = service-role/system => allowed.
  IF v_caller IS NOT NULL AND NOT (
       public.is_admin()
       OR EXISTS (
            SELECT 1 FROM public.app_access_certificates c
            WHERE c.user_id = v_caller
              AND c.is_active = true
              AND c.access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
          )
     ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  -- (b) Lock the live row.
  SELECT * INTO v_cur
  FROM public.shifts
  WHERE id = p_shift_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'GONE');
  END IF;

  -- Remember the PRE-write subject so a worker-removing op (unassign) can still name
  -- the removed worker in its audit event (post-write assigned_employee_id is NULL).
  v_prev_assignee := v_cur.assigned_employee_id;

  -- (c) Idempotency replay: same shift already has an event stamped with this key.
  IF p_idempotency_key IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.shift_events e
       WHERE e.shift_id = p_shift_id
         AND e.metadata->>'idem' = p_idempotency_key::text
     ) THEN
    RETURN jsonb_build_object(
      'ok', true, 'code', 'IDEMPOTENT_REPLAY', 'version', v_cur.version
    );
  END IF;

  -- (d) Optimistic CAS. State derived ONLY via the canonical FSM function.
  IF v_cur.version <> p_expected_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'VERSION_CONFLICT',
      'current_version', v_cur.version,
      'current_state', public.get_shift_fsm_state(
        v_cur.lifecycle_status, v_cur.assignment_status, v_cur.assignment_outcome,
        v_cur.trading_status, v_cur.is_cancelled, v_cur.bidding_status),
      'last_modified_by', v_cur.last_modified_by,
      'updated_at', v_cur.updated_at,
      'server_row', to_jsonb(v_cur)
    );
  END IF;

  -- (e) FSM legality guard.
  v_state := public.get_shift_fsm_state(
    v_cur.lifecycle_status, v_cur.assignment_status, v_cur.assignment_outcome,
    v_cur.trading_status, v_cur.is_cancelled, v_cur.bidding_status);

  IF NOT public.fsm_op_is_legal(v_state, p_op) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'ILLEGAL_TRANSITION',
      'current_state', v_state,
      'attempted', p_op
    );
  END IF;

  -- (f) Dispatch the write (version bump handled by the BEFORE UPDATE trigger).
  v_write := public._apply_shift_op_write(p_shift_id, p_op, p_payload, v_caller);

  -- Re-read the post-write row so the returned version/state reflect REALITY.
  SELECT * INTO v_cur FROM public.shifts WHERE id = p_shift_id;

  -- (g) Soft-reject. Dispatcher passed authz + CAS + FSM guard but declined to
  -- mutate. NO UPDATE ran, so the version did NOT advance and we write NO event.
  IF COALESCE((v_write->>'applied')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'WRITE_REJECTED',
      'note', v_write->>'note',
      'version', v_cur.version,
      'state', public.get_shift_fsm_state(
        v_cur.lifecycle_status, v_cur.assignment_status, v_cur.assignment_outcome,
        v_cur.trading_status, v_cur.is_cancelled, v_cur.bidding_status)
    );
  END IF;

  -- (h) Append an actor-stamped audit event (only for writes that ACTUALLY
  -- applied). event_type mapped HONESTLY: genuine (un)assignment/cancellation ops
  -- use a subject-bound enum value; everything else gets the neutral 'OP_APPLIED'
  -- (exempt from the employee_id rule, uncounted by employee_daily_metrics). True op
  -- in metadata.op. Subject = the worker the event is about: post-write assignee, or
  -- the pre-write assignee for a removal (unassign), via COALESCE.
  v_event := CASE
               WHEN p_op = 'assign'        THEN 'ASSIGNED'
               WHEN p_op = 'select_winner' THEN 'ASSIGNED'
               WHEN p_op IN ('unpublish', 'unassign') THEN 'UNASSIGNED'
               WHEN p_op = 'delete' AND v_cur.assigned_employee_id IS NOT NULL
                                           THEN 'CANCELLED'
               ELSE 'OP_APPLIED'
             END::public.shift_event_type;

  INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, metadata)
  VALUES (
    p_shift_id,
    COALESCE(v_cur.assigned_employee_id, v_prev_assignee),
    v_caller,
    v_event,
    jsonb_build_object(
      'op', p_op,
      'from_version', p_expected_version,
      'to_version', v_cur.version,
      'idem', p_idempotency_key,
      'payload', p_payload,
      'write', v_write
    )
  );

  -- (i) Success envelope. Use the RE-READ version.
  RETURN jsonb_build_object(
    'ok', true,
    'code', 'APPLIED',
    'version', v_cur.version,
    'state', public.get_shift_fsm_state(
      v_cur.lifecycle_status, v_cur.assignment_status, v_cur.assignment_outcome,
      v_cur.trading_status, v_cur.is_cancelled, v_cur.bidding_status)
  );

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error in sm_apply_shift_op (shift=%, op=%): %', p_shift_id, p_op, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.sm_apply_shift_op(uuid, integer, text, jsonb, uuid) TO authenticated;
