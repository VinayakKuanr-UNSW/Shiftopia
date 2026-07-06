-- Shift mutation gateway — part 3/3: sm_apply_shift_op.
--
-- A single optimistic-concurrency (CAS) entry point for shift mutations. The
-- client passes the version it last saw (p_expected_version); the gateway locks
-- the row, re-checks version under FOR UPDATE, validates the requested op
-- against the canonical FSM state, dispatches the write, appends an
-- actor-stamped audit event, and returns a structured jsonb envelope.
--
-- Invariants honoured:
--   * NEVER set shifts.version manually — the BEFORE UPDATE trigger
--     trg_increment_shift_version -> fn_increment_shift_version bumps it on every
--     UPDATE. CAS compares p_expected_version against the CURRENT row.version
--     under FOR UPDATE. After a write the new version is p_expected_version + 1.
--   * State is ONLY derived via public.get_shift_fsm_state(...) (the canonical
--     6-arg column-based function — there is no (uuid) overload). We compute it
--     from the locked row columns, exactly as the sibling sm_* RPCs do.
--   * Authorization gates on the REAL caller auth.uid() via active gamma+ certs
--     or is_admin(); NULL caller = service-role/system => allowed. Mirrors
--     20260620043019_harden_sm_bulk_assign.sql (but does NOT use the broken-in-
--     prod is_manager_or_above()).
--
-- jsonb return contract (one of):
--   {ok:false, code:'FORBIDDEN'}
--   {ok:false, code:'GONE'}
--   {ok:true,  code:'IDEMPOTENT_REPLAY', version}
--   {ok:false, code:'VERSION_CONFLICT', current_version, current_state,
--              last_modified_by, updated_at, server_row}
--   {ok:false, code:'ILLEGAL_TRANSITION', current_state, attempted}
--   {ok:true,  code:'APPLIED', version, state}
--   {ok:false, code:'ERROR', error}

-- ─────────────────────────────────────────────────────────────────────────────
-- Internal write dispatcher. SECURITY DEFINER, called only from
-- sm_apply_shift_op (already past authz + CAS + FSM guard). Performs the actual
-- column mutations per op; the version trigger handles version bumps. Returns a
-- small jsonb note (e.g. {applied:true} or {applied:false, note:'NOT_IMPLEMENTED'})
-- so the caller can surface stub ops without corrupting data.
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
    -- Mirror sm_unpublish_shift (baseline). S3/S4 => Draft+assigned (S2),
    -- S5 => Draft+unassigned (S1). FSM guard already restricted to S3/S4/S5, so
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
    -- the `?` operator so it can be explicitly cleared.
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
      -- Timezone + UTC canonical timestamps
      timezone              = COALESCE(NULLIF(p_payload->>'timezone',''), timezone),
      -- NOTE: start_at / end_at are recomputed by trg_recalc_shift_utc_timestamps
      -- (BEFORE UPDATE OF shift_date,start_time,end_time,timezone) — never set here.
      -- required_skills / required_licenses / event_ids are jsonb columns owned by
      -- the eligibility pipeline, not this generic schedule edit — excluded.
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
    -- target) the manager clicked. The MANAGER_PENDING swap corresponds to the
    -- shift's S10 (TradeAccepted) state (see fsm_op_is_legal).
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

    -- Revert both locked shifts (requester + target, if present) to NoTrade.
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

    -- A counterparty (target_id) is required to reassign to. target_shift_id may be
    -- NULL for a giveaway — sm_approve_peer_swap handles a NULL offered shift.
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

REVOKE ALL ON FUNCTION public._apply_shift_op_write(uuid, text, jsonb, uuid) FROM public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Public gateway.
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
  v_caller    uuid := auth.uid();
  v_cur       RECORD;
  v_state     text;
  v_write     jsonb;
  v_event     public.shift_event_type;
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
  -- v_cur above is the PRE-write snapshot; still under the same FOR UPDATE.
  SELECT * INTO v_cur FROM public.shifts WHERE id = p_shift_id;

  -- (g) Soft-reject. The dispatcher passed authz + CAS + the FSM guard but
  -- declined to mutate (PUBLISH_TOO_LATE, a not-yet-ported NOT_IMPLEMENTED op, a
  -- MISSING_*_ID payload, etc.). NO UPDATE ran, so the version did NOT advance.
  -- Return the REAL current version + a distinct code, and do NOT write an audit
  -- event: a phantom event would (a) lie about to_version and (b) pollute the
  -- event-sourced metrics that read shift_events. Skipping the event also leaves
  -- the idempotency key unclaimed so the caller can legitimately retry.
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
  -- applied). We reuse an existing shift_event_type value (no per-op enum minted)
  -- and carry the true op + version delta + idempotency key in metadata. The real
  -- op is ALWAYS in metadata.op — analytics that need op granularity must read
  -- metadata.op, not event_type.
  v_event := CASE p_op
               WHEN 'assign'        THEN 'ASSIGNED'
               WHEN 'select_winner' THEN 'ASSIGNED'
               WHEN 'unpublish'     THEN 'UNASSIGNED'
               WHEN 'delete'        THEN 'CANCELLED'
               ELSE 'ASSIGNED'   -- generic audit row for publish/edit/trade ops
             END::public.shift_event_type;

  INSERT INTO public.shift_events (shift_id, actor_id, event_type, metadata)
  VALUES (
    p_shift_id,
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

  -- (i) Success envelope. Use the RE-READ version (the trigger bumped it on the
  -- applied UPDATE) rather than assuming expected + 1.
  RETURN jsonb_build_object(
    'ok', true,
    'code', 'APPLIED',
    'version', v_cur.version,
    'state', public.get_shift_fsm_state(
      v_cur.lifecycle_status, v_cur.assignment_status, v_cur.assignment_outcome,
      v_cur.trading_status, v_cur.is_cancelled, v_cur.bidding_status)
  );

EXCEPTION WHEN OTHERS THEN
  -- (i) Defensive catch-all. The whole op rolls back atomically.
  RAISE WARNING 'Error in sm_apply_shift_op (shift=%, op=%): %', p_shift_id, p_op, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.sm_apply_shift_op(uuid, integer, text, jsonb, uuid) TO authenticated;
