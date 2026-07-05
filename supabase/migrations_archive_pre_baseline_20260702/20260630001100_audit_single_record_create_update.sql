-- =============================================================================
-- Shift Audit System — collapse Create / Update into ONE ledger record + surface
-- the creation / assignment SOURCE.
-- =============================================================================
-- Before this migration a single form action wrote MULTIPLE shift_events rows:
--   * sm_create_shift (pre-assigned) -> a `create` event PLUS a trigger ASSIGNED.
--   * updateShift (edit + reassign)  -> a gateway `edit` event PLUS a trigger
--     ASSIGNED from the client's separate direct UPDATE of assigned_employee_id.
--
-- Goal: ONE record per Create / Update carrying the state transition, the field
-- diff, AND the folded assignment (who + source). Genuine STANDALONE actions
-- (drag-assign / select_winner / offer accept / trade / emergency) keep their own
-- single row, unchanged — they are merely re-labelled with a source downstream.
--
-- Four coordinated, forward-only, idempotent CREATE OR REPLACEs. Each reproduces
-- the LATEST authoritative body verbatim PLUS only the additions noted:
--   1. sm_create_shift        (base 20260630000400) — gateway guard + folded meta.
--   2. _apply_shift_op_write  (base 20260623000100) — `edit` op also owns the
--                                                     DRAFT assignment fold.
--   3. sm_apply_shift_op      (base 20260630000000) — assignment diff + source.
--   4. get_shift_event_timeline (base 20260630000600) — expose creation_source /
--                                                     assignment_source / assignee.
--
-- NOT APPLIED TO PROD by this file (forward-only on feat/episode-lifecycle-metrics).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. sm_create_shift — suppress the duplicate INSERT-trigger ASSIGNED and fold
--    the assignment (subject + source) into the single `create` event.
--    Body is 20260630000400 verbatim PLUS: the app.audit.via_gateway guard around
--    the shifts INSERT, and the two extra metadata keys.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."sm_create_shift"("p_shift_data" "jsonb", "p_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
    v_shift_id uuid;
    v_roster_id uuid;
    v_roster_subgroup_id uuid;
    v_shift_group_id uuid;
    v_sub_group_name text;
    v_creation_source text;
    v_assignment_source text;
BEGIN
    v_roster_id          := (p_shift_data->>'roster_id')::uuid;
    v_roster_subgroup_id := (p_shift_data->>'roster_subgroup_id')::uuid;
    v_shift_group_id     := (p_shift_data->>'shift_group_id')::uuid;
    v_sub_group_name     := p_shift_data->>'sub_group_name';

    v_creation_source := COALESCE(
        p_shift_data->>'creation_source',
        CASE WHEN COALESCE((p_shift_data->>'is_from_template')::boolean, false) THEN 'template' ELSE 'manual' END
    );

    v_assignment_source := CASE
        WHEN (p_shift_data->>'assigned_employee_id') IS NOT NULL
        THEN COALESCE(p_shift_data->>'assignment_source', 'direct')
        ELSE NULL
    END;

    IF v_roster_id IS NULL THEN
        RAISE EXCEPTION 'Roster ID is required';
    END IF;

    IF v_roster_subgroup_id IS NULL AND v_shift_group_id IS NOT NULL AND v_sub_group_name IS NOT NULL THEN
        SELECT id INTO v_roster_subgroup_id
        FROM roster_subgroups
        WHERE roster_group_id = v_shift_group_id
          AND (LOWER(name) = LOWER(v_sub_group_name)
               OR LOWER(name) = LOWER(REPLACE(v_sub_group_name, '_', ' ')))
        LIMIT 1;
    END IF;

    -- AUDIT DE-DUP: while the guard is set, fn_capture_shift_event short-circuits,
    -- so the INSERT-branch ASSIGNED is NOT written. The shift's origin (and any
    -- pre-assignment) is recorded by the SINGLE `create` event below instead.
    -- Transaction-local (is_local=true): auto-resets at txn end, never leaks.
    PERFORM set_config('app.audit.via_gateway', '1', true);

    INSERT INTO shifts (
        roster_id, department_id, shift_date, roster_date, start_time, end_time,
        organization_id, sub_department_id, group_type, sub_group_name, display_order,
        shift_group_id, roster_subgroup_id, role_id, remuneration_level_id,
        paid_break_minutes, unpaid_break_minutes, break_minutes, timezone,
        assigned_employee_id, required_skills, required_licenses, event_ids, tags, notes,
        template_id, template_group, template_sub_group, is_from_template, template_instance_id,
        lifecycle_status, created_by_user_id, creation_source, assignment_source,
        created_at, updated_at
    ) VALUES (
        v_roster_id,
        (p_shift_data->>'department_id')::uuid,
        (p_shift_data->>'shift_date')::date,
        (p_shift_data->>'roster_date')::date,
        (p_shift_data->>'start_time')::time,
        (p_shift_data->>'end_time')::time,
        (p_shift_data->>'organization_id')::uuid,
        (p_shift_data->>'sub_department_id')::uuid,
        (p_shift_data->>'group_type')::template_group_type,
        (p_shift_data->>'sub_group_name'),
        COALESCE((p_shift_data->>'display_order')::integer, 0),
        v_shift_group_id,
        v_roster_subgroup_id,
        (p_shift_data->>'role_id')::uuid,
        (p_shift_data->>'remuneration_level_id')::uuid,
        COALESCE((p_shift_data->>'paid_break_minutes')::integer, 0),
        COALESCE((p_shift_data->>'unpaid_break_minutes')::integer, 0),
        COALESCE((p_shift_data->>'break_minutes')::integer, 0),
        COALESCE(p_shift_data->>'timezone', 'Australia/Sydney'),
        (p_shift_data->>'assigned_employee_id')::uuid,
        COALESCE(p_shift_data->'required_skills', '[]'::jsonb),
        COALESCE(p_shift_data->'required_licenses', '[]'::jsonb),
        COALESCE(p_shift_data->'event_ids', '[]'::jsonb),
        COALESCE(p_shift_data->'tags', '[]'::jsonb),
        p_shift_data->>'notes',
        (p_shift_data->>'template_id')::uuid,
        (p_shift_data->>'template_group')::template_group_type,
        p_shift_data->>'template_sub_group',
        COALESCE((p_shift_data->>'is_from_template')::boolean, false),
        (p_shift_data->>'template_instance_id')::uuid,
        'Draft'::shift_lifecycle,
        p_user_id,
        v_creation_source,
        v_assignment_source,
        NOW(), NOW()
    )
    RETURNING id INTO v_shift_id;

    PERFORM set_config('app.audit.via_gateway', '0', true);

    -- AUDIT: record the shift's origin so the timeline has a CREATED anchor.
    -- A neutral OP_APPLIED (exempt from the employee_id-required validator) with
    -- the true verb in metadata.op. Draft at creation => S1 (or S2 if assigned).
    -- The assignment is FOLDED here (subject = employee_id, + assignment_source)
    -- so no separate ASSIGNED row is needed for a pre-assigned create.
    INSERT INTO public.shift_events (
        shift_id, employee_id, actor_id, event_type, metadata, actor_role, domain
    ) VALUES (
        v_shift_id,
        (p_shift_data->>'assigned_employee_id')::uuid,
        p_user_id,
        'OP_APPLIED'::public.shift_event_type,
        jsonb_build_object(
            'op', 'create',
            'domain', 'lifecycle',
            'from_state', NULL,
            'to_state', CASE WHEN (p_shift_data->>'assigned_employee_id') IS NOT NULL THEN 'S2' ELSE 'S1' END,
            'source', 'sm_create_shift',
            'creation_source', v_creation_source,
            'assigned_employee_id', (p_shift_data->>'assigned_employee_id')::uuid,
            'assignment_source', v_assignment_source
        ),
        CASE WHEN p_user_id IS NULL THEN 'system' ELSE 'manager' END,
        'lifecycle'
    );

    RETURN v_shift_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. _apply_shift_op_write — the `edit` op now ALSO owns a DRAFT assignment
--    change (assign / reassign / unassign), so an edit-and-reassign is a SINGLE
--    write (and, with the gateway guard, a SINGLE event). Body is 20260623000100
--    verbatim PLUS the assignment fold inside the `edit` branch.
--    Folding is gated on assign/unassign FSM legality from the CURRENT state, so a
--    published-shift assignment still routes through its dedicated op untouched.
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_cur        RECORD;
  v_winner     uuid;
  v_emp        uuid;
  v_swap       public.shift_swaps%ROWTYPE;
  -- edit-branch assignment fold
  v_edit_state text;
  v_new_emp    uuid;
  v_do_assign   boolean := false;
  v_do_unassign boolean := false;
  v_assign_src  text;
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
    -- Partial update of a WHITELIST of schedule + grouping fields. The whitelist
    -- now ALSO admits assigned_employee_id / assignment_source so a form
    -- edit-and-reassign is a single write; lifecycle / bidding / trading / version
    -- / soft-delete / compliance columns remain owned by their dedicated ops.
    IF NOT (p_payload ?| ARRAY[
      'start_time','end_time','shift_date','break_minutes','paid_break_minutes',
      'unpaid_break_minutes','notes','role_id','sub_department_id',
      'remuneration_level_id','group_type','sub_group_name','display_order',
      'shift_group_id','shift_subgroup_id','timezone','is_training',
      'assigned_employee_id','assignment_source'
    ]) THEN
      RETURN jsonb_build_object('applied', false, 'note', 'NO_EDITABLE_FIELDS');
    END IF;

    -- Decide the DRAFT assignment fold BEFORE the UPDATE (edit never touches the
    -- state columns, so v_cur's state is still authoritative here). Gated on
    -- assign/unassign FSM legality so a published shift's assignment is NOT folded
    -- (it keeps routing through its dedicated assign/emergency/unpublish op).
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
      -- Folded DRAFT assignment (no-op CASE arms when not assigning/unassigning).
      assigned_employee_id  = CASE WHEN v_do_assign   THEN v_new_emp
                                   WHEN v_do_unassign THEN NULL
                                   ELSE assigned_employee_id END,
      assigned_at           = CASE WHEN v_do_assign   THEN NOW()
                                   WHEN v_do_unassign THEN NULL
                                   ELSE assigned_at END,
      assignment_status     = CASE WHEN v_do_assign   THEN 'assigned'::public.shift_assignment_status
                                   WHEN v_do_unassign THEN 'unassigned'::public.shift_assignment_status
                                   ELSE assignment_status END,
      assignment_source     = CASE WHEN v_do_assign   THEN v_assign_src
                                   WHEN v_do_unassign THEN NULL
                                   ELSE assignment_source END,
      assignment_outcome    = CASE WHEN v_do_unassign THEN NULL ELSE assignment_outcome END,
      confirmed_at          = CASE WHEN v_do_unassign THEN NULL ELSE confirmed_at END,
      fulfillment_status    = CASE WHEN v_do_unassign THEN 'none'::public.shift_fulfillment_status
                                   ELSE fulfillment_status END,
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
-- 3. sm_apply_shift_op — fold the assignment delta into the single edit event's
--    metadata.changes (+ surface assignment_source). Body is 20260630000000
--    verbatim PLUS the `assignment` diff entry and the `assignment_source` key.
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_caller     uuid := auth.uid();
  v_pre        RECORD;   -- PRE-write snapshot (locked row), kept distinct from post
  v_cur        RECORD;   -- POST-write re-read
  v_state      text;     -- PRE-write FSM state (also the CAS/legality state)
  v_to_state   text;     -- POST-write FSM state
  v_write      jsonb;
  v_event      public.shift_event_type;
  v_actor_role text;
  v_domain     text;
  v_changes    jsonb := '{}'::jsonb;
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

  -- (b) Lock the live row. This is the PRE-write snapshot (kept in v_pre).
  SELECT * INTO v_pre
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
      'ok', true, 'code', 'IDEMPOTENT_REPLAY', 'version', v_pre.version
    );
  END IF;

  -- (d) Optimistic CAS. State derived ONLY via the canonical FSM function.
  IF v_pre.version <> p_expected_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'VERSION_CONFLICT',
      'current_version', v_pre.version,
      'current_state', public.get_shift_fsm_state(
        v_pre.lifecycle_status, v_pre.assignment_status, v_pre.assignment_outcome,
        v_pre.trading_status, v_pre.is_cancelled, v_pre.bidding_status),
      'last_modified_by', v_pre.last_modified_by,
      'updated_at', v_pre.updated_at,
      'server_row', to_jsonb(v_pre)
    );
  END IF;

  -- (e) FSM legality guard. v_state is the PRE-write (from-) state.
  v_state := public.get_shift_fsm_state(
    v_pre.lifecycle_status, v_pre.assignment_status, v_pre.assignment_outcome,
    v_pre.trading_status, v_pre.is_cancelled, v_pre.bidding_status);

  IF NOT public.fsm_op_is_legal(v_state, p_op) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'ILLEGAL_TRANSITION',
      'current_state', v_state,
      'attempted', p_op
    );
  END IF;

  -- (f) Dispatch the write (version bump handled by the BEFORE UPDATE trigger).
  -- De-dup guard: while set, fn_capture_shift_event (the AFTER trigger on shifts)
  -- short-circuits, so the enveloped event we write below in step (h) is the ONLY
  -- shift_events row for this op — no duplicate / no uniq_shift_event collision.
  -- Transaction-local (is_local=true): auto-resets at txn end and never leaks.
  PERFORM set_config('app.audit.via_gateway', '1', true);
  v_write := public._apply_shift_op_write(p_shift_id, p_op, p_payload, v_caller);
  PERFORM set_config('app.audit.via_gateway', '0', true);

  -- Re-read the post-write row so the returned version/state reflect REALITY.
  -- v_pre above is the PRE-write snapshot; still under the same FOR UPDATE.
  SELECT * INTO v_cur FROM public.shifts WHERE id = p_shift_id;

  -- (g) Soft-reject. The dispatcher passed authz + CAS + the FSM guard but
  -- declined to mutate (PUBLISH_TOO_LATE, a MISSING_*_ID payload, etc.). NO UPDATE
  -- ran, so the version did NOT advance. Return the REAL current version + a
  -- distinct code, and do NOT write an audit event (a phantom event would lie
  -- about to_version and pollute event-sourced metrics). Skipping the event also
  -- leaves the idempotency key unclaimed so the caller can legitimately retry.
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

  -- POST-write (to-) FSM state, derived ONLY via the canonical function.
  v_to_state := public.get_shift_fsm_state(
    v_cur.lifecycle_status, v_cur.assignment_status, v_cur.assignment_outcome,
    v_cur.trading_status, v_cur.is_cancelled, v_cur.bidding_status);

  -- (h.1) EDIT-DIFF: for op IN ('edit','move') build metadata.changes as
  -- {field:{old,new}} for ONLY the whitelisted schedule/grouping fields that
  -- ACTUALLY changed (v_pre vs the post-write re-read). IS DISTINCT FROM is
  -- NULL-safe; to_jsonb keeps native types (date/time/int/bool/uuid/text).
  IF p_op IN ('edit', 'move') THEN
    IF v_pre.start_time IS DISTINCT FROM v_cur.start_time THEN
      v_changes := v_changes || jsonb_build_object('start_time',
        jsonb_build_object('old', to_jsonb(v_pre.start_time), 'new', to_jsonb(v_cur.start_time)));
    END IF;
    IF v_pre.end_time IS DISTINCT FROM v_cur.end_time THEN
      v_changes := v_changes || jsonb_build_object('end_time',
        jsonb_build_object('old', to_jsonb(v_pre.end_time), 'new', to_jsonb(v_cur.end_time)));
    END IF;
    IF v_pre.shift_date IS DISTINCT FROM v_cur.shift_date THEN
      v_changes := v_changes || jsonb_build_object('shift_date',
        jsonb_build_object('old', to_jsonb(v_pre.shift_date), 'new', to_jsonb(v_cur.shift_date)));
    END IF;
    IF v_pre.paid_break_minutes IS DISTINCT FROM v_cur.paid_break_minutes THEN
      v_changes := v_changes || jsonb_build_object('paid_break_minutes',
        jsonb_build_object('old', to_jsonb(v_pre.paid_break_minutes), 'new', to_jsonb(v_cur.paid_break_minutes)));
    END IF;
    IF v_pre.unpaid_break_minutes IS DISTINCT FROM v_cur.unpaid_break_minutes THEN
      v_changes := v_changes || jsonb_build_object('unpaid_break_minutes',
        jsonb_build_object('old', to_jsonb(v_pre.unpaid_break_minutes), 'new', to_jsonb(v_cur.unpaid_break_minutes)));
    END IF;
    IF v_pre.notes IS DISTINCT FROM v_cur.notes THEN
      v_changes := v_changes || jsonb_build_object('notes',
        jsonb_build_object('old', to_jsonb(v_pre.notes), 'new', to_jsonb(v_cur.notes)));
    END IF;
    IF v_pre.role_id IS DISTINCT FROM v_cur.role_id THEN
      v_changes := v_changes || jsonb_build_object('role_id',
        jsonb_build_object('old', to_jsonb(v_pre.role_id), 'new', to_jsonb(v_cur.role_id)));
    END IF;
    IF v_pre.sub_department_id IS DISTINCT FROM v_cur.sub_department_id THEN
      v_changes := v_changes || jsonb_build_object('sub_department_id',
        jsonb_build_object('old', to_jsonb(v_pre.sub_department_id), 'new', to_jsonb(v_cur.sub_department_id)));
    END IF;
    IF v_pre.remuneration_level_id IS DISTINCT FROM v_cur.remuneration_level_id THEN
      v_changes := v_changes || jsonb_build_object('remuneration_level_id',
        jsonb_build_object('old', to_jsonb(v_pre.remuneration_level_id), 'new', to_jsonb(v_cur.remuneration_level_id)));
    END IF;
    IF v_pre.group_type IS DISTINCT FROM v_cur.group_type THEN
      v_changes := v_changes || jsonb_build_object('group_type',
        jsonb_build_object('old', to_jsonb(v_pre.group_type), 'new', to_jsonb(v_cur.group_type)));
    END IF;
    IF v_pre.sub_group_name IS DISTINCT FROM v_cur.sub_group_name THEN
      v_changes := v_changes || jsonb_build_object('sub_group_name',
        jsonb_build_object('old', to_jsonb(v_pre.sub_group_name), 'new', to_jsonb(v_cur.sub_group_name)));
    END IF;
    IF v_pre.display_order IS DISTINCT FROM v_cur.display_order THEN
      v_changes := v_changes || jsonb_build_object('display_order',
        jsonb_build_object('old', to_jsonb(v_pre.display_order), 'new', to_jsonb(v_cur.display_order)));
    END IF;
    IF v_pre.shift_group_id IS DISTINCT FROM v_cur.shift_group_id THEN
      v_changes := v_changes || jsonb_build_object('shift_group_id',
        jsonb_build_object('old', to_jsonb(v_pre.shift_group_id), 'new', to_jsonb(v_cur.shift_group_id)));
    END IF;
    IF v_pre.roster_subgroup_id IS DISTINCT FROM v_cur.roster_subgroup_id THEN
      v_changes := v_changes || jsonb_build_object('roster_subgroup_id',
        jsonb_build_object('old', to_jsonb(v_pre.roster_subgroup_id), 'new', to_jsonb(v_cur.roster_subgroup_id)));
    END IF;
    IF v_pre.timezone IS DISTINCT FROM v_cur.timezone THEN
      v_changes := v_changes || jsonb_build_object('timezone',
        jsonb_build_object('old', to_jsonb(v_pre.timezone), 'new', to_jsonb(v_cur.timezone)));
    END IF;
    IF v_pre.is_training IS DISTINCT FROM v_cur.is_training THEN
      v_changes := v_changes || jsonb_build_object('is_training',
        jsonb_build_object('old', to_jsonb(v_pre.is_training), 'new', to_jsonb(v_cur.is_training)));
    END IF;
    -- FOLDED ASSIGNMENT: a DRAFT reassign/unassign made INSIDE the edit op (the
    -- _apply_shift_op_write `edit` branch owns it). Records the worker subject
    -- delta so the single edit row reads "edited … reassigned A → B".
    IF v_pre.assigned_employee_id IS DISTINCT FROM v_cur.assigned_employee_id THEN
      v_changes := v_changes || jsonb_build_object('assignment',
        jsonb_build_object('old', to_jsonb(v_pre.assigned_employee_id), 'new', to_jsonb(v_cur.assigned_employee_id)));
    END IF;
  END IF;

  -- (h.2) actor_role. NULL caller => 'system'; admin or active gamma/delta/
  -- epsilon/zeta cert => 'manager'; otherwise 'employee'. Mirrors the authz gate
  -- in step (a) but classifies (the caller already passed authz).
  IF v_caller IS NULL THEN
    v_actor_role := 'system';
  ELSIF public.is_admin()
     OR EXISTS (
          SELECT 1 FROM public.app_access_certificates c
          WHERE c.user_id = v_caller
            AND c.is_active = true
            AND c.access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
        ) THEN
    v_actor_role := 'manager';
  ELSE
    v_actor_role := 'employee';
  END IF;

  -- (h.3) domain bucket — deterministic op -> domain map (audit contract).
  v_domain := CASE p_op
                WHEN 'create'        THEN 'lifecycle'
                WHEN 'publish'        THEN 'lifecycle'
                WHEN 'unpublish'      THEN 'lifecycle'
                WHEN 'delete'         THEN 'lifecycle'
                WHEN 'assign'         THEN 'assignment'
                WHEN 'unassign'       THEN 'assignment'
                WHEN 'select_winner'  THEN 'marketplace'
                WHEN 'edit'           THEN 'schedule'
                WHEN 'move'           THEN 'schedule'
                WHEN 'approve_trade'  THEN 'trade'
                WHEN 'reject_trade'   THEN 'trade'
                ELSE 'lifecycle'   -- defensive default for any future op
              END;

  -- (h.4) Coarse event_type — PRESERVED from 20260623000000/200: only genuine
  -- (un)assignment/cancellation ops use a subject-bound enum value (so the
  -- event_type counters in employee_daily_metrics stay honest); everything else
  -- uses the neutral OP_APPLIED, which the relaxed validator exempts from the
  -- employee_id-required rule. The TRUE op is ALWAYS in metadata.op.
  v_event := CASE
               WHEN p_op = 'assign'        THEN 'ASSIGNED'
               WHEN p_op = 'select_winner' THEN 'ASSIGNED'
               WHEN p_op = 'unpublish'     THEN 'UNASSIGNED'
               -- delete is a real cancellation ONLY when a worker was attached;
               -- deleting an open/unassigned shift has no subject => neutral audit.
               WHEN p_op = 'delete' AND v_cur.assigned_employee_id IS NOT NULL
                                           THEN 'CANCELLED'
               ELSE 'OP_APPLIED'   -- publish / edit / move / approve_trade /
                                   -- reject_trade / delete-of-unassigned
             END::public.shift_event_type;

  -- (h.5) Append the FULL audit envelope. v_cur is the POST-write re-read, so
  -- assigned_employee_id is the SUBJECT (NULL for an unassigned shift) and
  -- v_cur.version is the post-write shift version. Envelope columns
  -- (actor_role / domain / shift_version) are set EXPLICITLY so the fill-if-null
  -- enrich trigger (20260626090100) leaves them as authoritative provenance.
  INSERT INTO public.shift_events (
    shift_id, employee_id, actor_id, event_type, metadata,
    actor_role, domain, shift_version, idempotency_key
  )
  VALUES (
    p_shift_id,
    v_cur.assigned_employee_id,
    v_caller,
    v_event,
    -- Base metadata (shared contract) + `changes` concatenated ONLY for edit/move
    -- so the key is absent for every other op, exactly per the audit contract.
    jsonb_build_object(
      'op',                p_op,
      'reason',            p_payload->>'reason',
      'from_state',        v_state,
      'to_state',          v_to_state,
      'from_version',      p_expected_version,
      'to_version',        v_cur.version,
      'idem',              p_idempotency_key,
      'source',            'sm_apply_shift_op',
      'assignment_source', v_cur.assignment_source,
      'payload',           p_payload,
      'write',             v_write
    )
    || CASE WHEN p_op IN ('edit', 'move')
            THEN jsonb_build_object('changes', v_changes)
            ELSE '{}'::jsonb
       END,
    v_actor_role,
    v_domain,
    v_cur.version,
    p_idempotency_key
  );

  -- (i) Success envelope. Use the RE-READ version (the trigger bumped it on the
  -- applied UPDATE) rather than assuming expected + 1.
  RETURN jsonb_build_object(
    'ok', true,
    'code', 'APPLIED',
    'version', v_cur.version,
    'state', v_to_state
  );

EXCEPTION WHEN OTHERS THEN
  -- (j) Defensive catch-all. The whole op rolls back atomically (incl. the
  -- transaction-local app.audit.via_gateway guard, which is reset on rollback).
  RAISE WARNING 'Error in sm_apply_shift_op (shift=%, op=%): %', p_shift_id, p_op, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.sm_apply_shift_op(uuid, integer, text, jsonb, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. get_shift_event_timeline — expose creation_source / assignment_source and
--    the assignee's display name so the timeline can render source badges + the
--    folded assignment line. Body is 20260630000600 verbatim PLUS three columns.
--    DROP first: adding OUT columns changes the result type, which CREATE OR
--    REPLACE cannot do ("cannot change return type of existing function").
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS "public"."get_shift_event_timeline"("uuid");

CREATE OR REPLACE FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid")
RETURNS TABLE(
    "event_id"   "uuid",
    "event_time" timestamp with time zone,
    "domain"     "text",
    "event_type" "public"."shift_event_type",
    "op"         "text",
    "actor_id"   "uuid",
    "actor_role" "text",
    "actor_name" "text",
    "employee_id" "uuid",
    "assignee_name" "text",
    "from_state" "text",
    "to_state"   "text",
    "from_version" "text",
    "to_version" "text",
    "changes"    "jsonb",
    "reason"     "text",
    "creation_source"   "text",
    "assignment_source" "text"
)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Replicate the shift_events SELECT RLS gate (see 20260630000100 header).
    -- SECURITY DEFINER bypasses RLS, so authorize explicitly: managers see any
    -- shift's timeline; a non-manager only sees a shift they are a subject of.
    IF NOT (
        EXISTS (
            SELECT 1
            FROM public.user_contracts uc
            WHERE uc.user_id = (SELECT auth.uid())
              AND uc.access_level = ANY (ARRAY[
                    'alpha'::public.access_level,
                    'beta'::public.access_level,
                    'gamma'::public.access_level,
                    'delta'::public.access_level,
                    'epsilon'::public.access_level,
                    'zeta'::public.access_level])
              AND uc.status = 'Active'
        )
        OR public.user_has_delta_access((SELECT auth.uid()))
        OR EXISTS (
            SELECT 1
            FROM public.shift_events se_auth
            WHERE se_auth.shift_id = p_shift_id
              AND se_auth.employee_id = (SELECT auth.uid())
        )
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        se.id                                       AS event_id,
        se.event_time                               AS event_time,
        COALESCE(se.domain, se.metadata->>'domain') AS domain,
        se.event_type                               AS event_type,
        se.metadata->>'op'                          AS op,
        se.actor_id                                 AS actor_id,
        se.actor_role                               AS actor_role,
        -- Human-readable actor name; NULL when there is no actor (cron/system) or
        -- the profile is gone — the UI then falls back to the role chip alone.
        COALESCE(
            p.full_name,
            NULLIF(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '')
        )                                           AS actor_name,
        se.employee_id                              AS employee_id,
        -- Display name of the worker the event is ABOUT (the folded assignee).
        COALESCE(
            pe.full_name,
            NULLIF(TRIM(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')), '')
        )                                           AS assignee_name,
        se.metadata->>'from_state'                  AS from_state,
        se.metadata->>'to_state'                    AS to_state,
        se.metadata->>'from_version'                AS from_version,
        se.metadata->>'to_version'                  AS to_version,
        se.metadata->'changes'                      AS changes,
        se.metadata->>'reason'                      AS reason,
        se.metadata->>'creation_source'             AS creation_source,
        se.metadata->>'assignment_source'           AS assignment_source
    FROM public.shift_events se
    LEFT JOIN public.shifts s ON s.id = se.shift_id
    LEFT JOIN public.profiles p ON p.id = COALESCE(
        se.actor_id,
        CASE
            WHEN se.actor_role = 'employee' THEN se.employee_id
            WHEN se.actor_role = 'manager' THEN s.last_modified_by
        END
    )
    LEFT JOIN public.profiles pe ON pe.id = se.employee_id
    WHERE se.shift_id = p_shift_id
    ORDER BY se.event_time ASC, se.created_at ASC;
END;
$$;

ALTER FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid") OWNER TO "postgres";
GRANT ALL ON FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid") TO "service_role";
