-- Redefine fsm_op_is_legal to allow unpublish from TradeRequested (S9 / S6) and TradeAccepted (S10 / S7)
CREATE OR REPLACE FUNCTION public.fsm_op_is_legal(p_state text, p_op text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE p_op
    -- select_winner: legal only while bidding is OPEN (unified on_bidding => S5;
    -- legacy urgent => S6). S8 = bidding_closed_no_winner is CLOSED => not legal.
    WHEN 'select_winner' THEN p_state IN ('S5', 'S6')

    -- publish: legal only from an unpublished/draft state, before start.
    -- S1 (Draft+unassigned) and S2 (Draft+assigned) only.
    WHEN 'publish' THEN p_state IN ('S1', 'S2')

    -- unpublish: legal only from Published + before start. Admit trade-pending (S9/S10)
    -- so that unpublishing a trade-in-flight shift is allowed (which cancels the swaps).
    WHEN 'unpublish' THEN p_state IN ('S3', 'S4', 'S5', 'S9', 'S10')

    -- assign: legal when unassigned (S1/S5/S6/S8) OR a reassign is allowed on an
    -- assigned-but-not-yet-started shift (S2/S3/S4). NOT legal once in progress
    -- (S11/S12), completed (S13/S14), cancelled (S15), or under a pending trade
    -- (S9/S10 — resolve the trade first). S7 = legacy emergency_assigned, treat
    -- as already assigned & pre-start => reassign allowed.
    WHEN 'assign' THEN p_state IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8')

    -- approve_trade: a manager approves only once the peer has accepted, i.e. at
    -- S10 = TradeAccepted (awaiting manager approval). Approving at S9
    -- (TradeRequested, peer not yet accepted) is premature. Matches the client
    -- matrix (shift-op-legality.ts).
    WHEN 'approve_trade' THEN p_state IN ('S10')
    -- reject_trade: a manager may reject at either pending stage (peer S9 or
    -- manager S10).
    WHEN 'reject_trade'  THEN p_state IN ('S9', 'S10')

    -- delete: legal unless completed or already started. Excludes S11/S12
    -- (InProgress), S13/S14 (Completed), and S15 (already terminal/cancelled).
    WHEN 'delete' THEN p_state IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10')

    -- edit: legal unless completed/started. Same admissible set as delete.
    WHEN 'edit' THEN p_state IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10')

    -- Unknown op => not legal (conservative).
    ELSE false
  END;
$function$;

ALTER FUNCTION public.fsm_op_is_legal(text, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.fsm_op_is_legal(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fsm_op_is_legal(text, text) TO service_role;


-- Redefine internal dispatcher write function to support swap cancellation on unpublish.
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
      -- Cancel shift_swaps (peer-to-peer / manager approval swaps)
      UPDATE public.shift_swaps SET
        status = 'CANCELLED',
        updated_at = NOW()
      WHERE (requester_shift_id = p_shift_id OR target_shift_id = p_shift_id)
        AND status IN ('OPEN', 'MANAGER_PENDING', 'OFFER_SELECTED');

      -- Revert trading_status on any counterparty shift involved in the swap request
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

      -- Cancel swap_requests (unified planning requests system)
      UPDATE public.swap_requests SET
        status = 'cancelled',
        updated_at = NOW()
      WHERE (original_shift_id = p_shift_id OR offered_shift_id = p_shift_id)
        AND status IN ('pending_employee', 'pending_manager');

      -- Revert trading_status on any counterparty shift involved in swap_requests
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

      -- Reset the trading status of the current shift itself
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
    -- last_modified_by which that thinner RPC omits. We inline (rather than
    -- delegate) to keep those fields and a single FOR UPDATE. KEEP IN SYNC: if
    -- sm_select_bid_winner's fan-out changes, mirror it here.
    -- Winner from payload.winner_id (fallback employee_id). Accept the winner
    -- bid, reject other pending bids, assign the shift, close bidding.
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
    -- are owned by their dedicated ops + the state machine and are NOT editable
    -- here.  COALESCE => only keys present in the payload change; 'notes' uses
    -- the `?` operator so it can be explicitly cleared. Array columns use CASE
    -- (present → replace entirely; absent → keep existing).
    --
    -- DELIBERATELY EXCLUDED:
    --   roster_id, department_id, organization_id  (structural / RLS-scoping move)
    --   assigned_employee_id, assignment_*          (owned by assign/unassign ops)
    --   lifecycle_status, bidding_*, trading_*      (owned by publish/cancel/trade)
    --   version, deleted_at, created_*              (system-managed)
    IF NOT (p_payload ?| ARRAY[
      'start_time','end_time','shift_date','break_minutes','paid_break_minutes',
      'unpaid_break_minutes','notes','role_id','sub_department_id',
      'remuneration_level_id','group_type','sub_group_name','display_order',
      'shift_group_id','shift_subgroup_id','timezone','is_training'
    ]) THEN
      RETURN jsonb_build_object('applied', false, 'note', 'NO_EDITABLE_FIELDS');
    END IF;

    UPDATE public.shifts SET
      -- Schedule
      start_time            = COALESCE(NULLIF(p_payload->>'start_time','')::time, start_time),
      end_time              = COALESCE(NULLIF(p_payload->>'end_time','')::time, end_time),
      shift_date            = COALESCE(NULLIF(p_payload->>'shift_date','')::date, shift_date),
      -- Breaks — paid/unpaid split; keep break_minutes = paid + unpaid in sync
      paid_break_minutes    = COALESCE((p_payload->>'paid_break_minutes')::int, paid_break_minutes),
      unpaid_break_minutes  = COALESCE((p_payload->>'unpaid_break_minutes')::int, unpaid_break_minutes),
      break_minutes         = COALESCE((p_payload->>'paid_break_minutes')::int, paid_break_minutes)
                            + COALESCE((p_payload->>'unpaid_break_minutes')::int, unpaid_break_minutes),
      -- Text / notes — explicit `?` check allows clearing to NULL/empty
      notes                 = CASE WHEN p_payload ? 'notes' THEN p_payload->>'notes' ELSE notes END,
      -- UUID references
      role_id               = COALESCE(NULLIF(p_payload->>'role_id','')::uuid, role_id),
      sub_department_id     = COALESCE(NULLIF(p_payload->>'sub_department_id','')::uuid, sub_department_id),
      remuneration_level_id = COALESCE(NULLIF(p_payload->>'remuneration_level_id','')::uuid, remuneration_level_id),
      shift_group_id        = COALESCE(NULLIF(p_payload->>'shift_group_id','')::uuid, shift_group_id),
      -- shift_subgroup_id is the payload key; DB column is roster_subgroup_id
      roster_subgroup_id    = COALESCE(NULLIF(p_payload->>'shift_subgroup_id','')::uuid, roster_subgroup_id),
      -- Grouping
      group_type            = COALESCE(NULLIF(p_payload->>'group_type','')::template_group_type, group_type),
      sub_group_name        = CASE WHEN p_payload ? 'sub_group_name' THEN p_payload->>'sub_group_name' ELSE sub_group_name END,
      display_order         = COALESCE((p_payload->>'display_order')::int, display_order),
      -- Timezone — start_at/end_at are recomputed by trg_recalc_shift_utc_timestamps
      -- (BEFORE UPDATE OF shift_date,start_time,end_time,timezone) — never set here.
      -- required_skills / required_licenses / event_ids are jsonb columns owned by
      -- the eligibility pipeline, not this generic schedule edit — excluded.
      timezone              = COALESCE(NULLIF(p_payload->>'timezone',''), timezone),
      -- Training flag
      is_training           = COALESCE((p_payload->>'is_training')::boolean, is_training),
      -- Audit
      last_modified_by      = p_actor,
      last_modified_reason  = COALESCE(p_payload->>'reason', last_modified_reason),
      updated_at            = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'delete' THEN
    -- SOFT tombstone (deleted_at), consistent with the gateway's GONE handling
    -- (the lock filters deleted_at IS NULL) and get_shift_delta tombstones. This
    -- is DELIBERATELY NOT the hard sm_delete_shift (archive + DELETE FROM shifts),
    -- which would break the gateway's post-write re-read / version-bump / audit-
    -- event flow and risk FK issues with shift_events. Hard archival remains
    -- available via sm_delete_shift for a permanent purge.
    UPDATE public.shifts SET
      deleted_at           = NOW(),
      deleted_by           = p_actor,
      last_modified_by     = p_actor,
      last_modified_reason = COALESCE(p_payload->>'reason', 'Deleted via shift gateway'),
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'reject_trade' THEN
    -- Reject a MANAGER_PENDING swap. public.shift_swaps is the AUTHORITATIVE swap
    -- table (requester_shift_id / target_shift_id); swap_requests is vestigial and
    -- the live swaps.api never touches it. Mirrors swaps.api rejectSwapRequest
    -- (T6): only MANAGER_PENDING is rejectable → flip to REJECTED and revert BOTH
    -- shifts' trading_status → NoTrade. Robust to whichever side (requester /
    -- target) the manager clicked. MANAGER_PENDING ↔ the shift's S10 state.
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
    -- Approve a MANAGER_PENDING swap (public.shift_swaps — authoritative). This is
    -- a TWO-shift (or giveaway), compliance-gated op:
    --   * the caller (TS) MUST run compliance FIRST (validateSwapCompliance) and
    --     assert it via payload.compliance_ok = true — mirrors approveSwapRequest,
    --     whose RPC sm_approve_peer_swap never re-checks compliance.
    --   * we resolve the MANAGER_PENDING swap and DELEGATE the reassignment to
    --     sm_approve_peer_swap (handles both 1:1 swap AND giveaway = NULL target
    --     shift), then mark the swap APPROVED. Do NOT reimplement the reassignment.
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

    -- Delegate the reassignment to the canonical swap RPC, using shift_swaps' own
    -- ids (requester_shift_id / target_shift_id / requester_id / target_id).
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


-- Redefine sm_unpublish_shift to allow unpublishing from TradeRequested (S9 / S6) and TradeAccepted (S10 / S7)
CREATE OR REPLACE FUNCTION public.sm_unpublish_shift(
  p_shift_id uuid,
  p_user_id  uuid DEFAULT auth.uid(),
  p_reason   text DEFAULT 'Unpublished'::text
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
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
      updated_at         = NOW()
    WHERE id = p_shift_id;
  END IF;
  
  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', v_to_state);
END;
$$;

ALTER FUNCTION public.sm_unpublish_shift(uuid, uuid, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.sm_unpublish_shift(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sm_unpublish_shift(uuid, uuid, text) TO service_role;
