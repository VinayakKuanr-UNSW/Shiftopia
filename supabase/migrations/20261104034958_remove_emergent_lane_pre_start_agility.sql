-- ============================================================================
-- Remove the emergent lane (4-hour pre-start lockout): full pre-start agility.
--   1. Publish, drop, swap and bid up to T_start (TTS = 0).
--   2. Assigned shifts always take the S3 offer flow, expiring at
--      LEAST(NOW() + 48h, T_start). No direct-to-S4 bypass.
--   3. Unfilled published shifts are cancelled (S15) at T_start.
--   4. In-flight swaps stay open until T_start.
--   5. check_in_shift refuses punches after T_end (SHIFT_CLOSED_NO_SHOW).
--   6. At T_end with no punch: No-Show, shift Completed, 0h billable.
-- Every body below was rebuilt from the live pg_get_functiondef plus only the
-- changes above; auto clock-out stays retired.
-- ============================================================================

-- 1. get_time_category: EMERGENCY merges into URGENT (0h < TTS <= 24h)
CREATE OR REPLACE FUNCTION public.get_time_category(p_scheduled_start timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_hours_until_start NUMERIC;
BEGIN
    v_hours_until_start := EXTRACT(EPOCH FROM (p_scheduled_start - NOW())) / 3600;
    
    IF v_hours_until_start <= 0 THEN
        RETURN 'PAST';
    ELSIF v_hours_until_start <= 24 THEN
        RETURN 'URGENT';     -- 0h - 24h: real-time pre-start agility
    ELSE
        RETURN 'NORMAL';     -- > 24h
    END IF;
END;
$function$;

-- 2. _apply_shift_op_write: no 4h bypass on publish or drop_shift
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
  v_offer_deadline timestamptz;
BEGIN
  SELECT * INTO v_cur FROM public.shifts WHERE id = p_shift_id;

  IF p_op = 'assign' THEN
    v_emp := NULLIF(p_payload->>'employee_id', '')::uuid;
    IF v_emp IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'MISSING_EMPLOYEE_ID');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_emp::text));

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
      PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_cur.assigned_employee_id::text));

      SELECT rule_id, details INTO v_breach_rule, v_breach_details
        FROM internal.eba_check_assignment(p_shift_id, v_cur.assigned_employee_id) WITH ORDINALITY AS c(is_compliant, rule_id, rule_name, tier, summary, details, payload, eba_ord)
       WHERE tier = 'BLOCKING'
       ORDER BY c.eba_ord
       LIMIT 1;

      IF v_breach_rule IS NOT NULL THEN
        RETURN jsonb_build_object('applied', false, 'note', 'EBA_COMPLIANCE_BREACH', 'rule_id', v_breach_rule, 'details', v_breach_details);
      END IF;

      -- Standard S3 Offer flow for all assigned non-FT shifts, regardless of time-to-start.
      -- Offers always expire at shift start (TTS=0) or in 48h, whichever is sooner.
      v_offer_deadline := LEAST(
        NOW() + INTERVAL '48 hours',
        COALESCE(
          v_cur.start_at,
          (v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp AT TIME ZONE COALESCE(v_cur.timezone, 'Australia/Sydney')
        )
      );

      INSERT INTO public.shift_offers (shift_id, employee_id, status, offer_expires_at)
      VALUES (p_shift_id, v_cur.assigned_employee_id, 'Pending', v_offer_deadline)
      ON CONFLICT (shift_id, employee_id) DO UPDATE
        SET offer_expires_at = EXCLUDED.offer_expires_at,
            status           = 'Pending',
            updated_at       = NOW();

      UPDATE public.shifts SET
        lifecycle_status       = 'Published'::public.shift_lifecycle,
        fulfillment_status     = 'offered'::public.shift_fulfillment_status,
        assignment_outcome     = NULL,
        offer_expires_at       = v_offer_deadline,
        bidding_status         = 'not_on_bidding'::public.shift_bidding_status,
        published_at           = NOW(),
        last_modified_by       = p_actor,
        updated_at             = NOW()
      WHERE id = p_shift_id;
    ELSE
      -- Unassigned shifts open for open bidding up to kickoff.
      UPDATE public.shifts SET
        lifecycle_status     = 'Published'::public.shift_lifecycle,
        fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
        bidding_status       = 'on_bidding'::public.shift_bidding_status,
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
      offer_expires_at     = NULL,
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
      fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
      last_rejected_by     = v_cur.assigned_employee_id,
      bidding_status       = 'on_bidding'::public.shift_bidding_status,
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
      fulfillment_status   = 'none'::public.shift_fulfillment_status,
      last_dropped_by      = v_cur.assigned_employee_id,
      bidding_status       = 'not_on_bidding'::public.shift_bidding_status,
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
      AND status IN ('OPEN', 'OFFER_SELECTED', 'MANAGER_PENDING');

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
    -- Even if dropped minutes before start, shift is pushed to open bidding
    UPDATE public.shifts SET
      assigned_employee_id = NULL,
      assigned_at          = NULL,
      assignment_status    = 'unassigned'::public.shift_assignment_status,
      assignment_outcome   = NULL,
      fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
      last_dropped_by      = v_cur.assigned_employee_id,
      bidding_status       = 'on_bidding'::public.shift_bidding_status,
      last_modified_by     = p_actor,
      last_modified_reason = COALESCE(p_payload->>'reason', 'Dropped by employee'),
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'select_winner' THEN
    v_winner := COALESCE(NULLIF(p_payload->>'winner_id', ''), NULLIF(p_payload->>'employee_id', ''))::uuid;
    IF v_winner IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'MISSING_WINNER_ID');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_winner::text));

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
      'unpaid_break_minutes','break_start','break_end','unpaid_breaks',
      'notes','role_id','sub_department_id',
      'display_order',
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
      p_payload ? 'break_start' OR p_payload ? 'break_end' OR p_payload ? 'unpaid_breaks'
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
      unpaid_breaks         = CASE
                                WHEN p_payload ? 'unpaid_breaks' THEN
                                  CASE WHEN jsonb_typeof(p_payload->'unpaid_breaks') = 'array'
                                       THEN p_payload->'unpaid_breaks'
                                       ELSE '[]'::jsonb
                                  END
                                ELSE unpaid_breaks
                              END,
      notes                 = CASE WHEN p_payload ? 'notes' THEN p_payload->>'notes' ELSE notes END,
      role_id               = COALESCE(NULLIF(p_payload->>'role_id','')::uuid, role_id),
      sub_department_id     = COALESCE(NULLIF(p_payload->>'sub_department_id','')::uuid, sub_department_id),
      shift_group_id        = COALESCE(NULLIF(p_payload->>'shift_group_id','')::uuid, shift_group_id),
      roster_subgroup_id    = COALESCE(NULLIF(p_payload->>'shift_subgroup_id','')::uuid, roster_subgroup_id),
      display_order         = COALESCE((p_payload->>'display_order')::int, display_order),
      timezone              = COALESCE(NULLIF(p_payload->>'timezone',''), timezone),
      is_training           = COALESCE((p_payload->>'is_training')::boolean, is_training),
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
      trading_status     = 'NoTrade'::public.shift_trading,
      trade_requested_at = NULL
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);
  ELSE
    RETURN jsonb_build_object('applied', false, 'note', 'UNSUPPORTED_OP');
  END IF;
END;
$function$;

-- 3. sm_bulk_publish_shifts: no emergency partition or S1 time lockout
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
                WHEN current_state = 'S1' THEN 'S5'
                WHEN current_state = 'S2' THEN 'S3'
                ELSE NULL
            END as new_state_id,
            LEAST(NOW() + INTERVAL '48 hours', shift_start_tz) as offer_deadline
        FROM shift_calculations
        WHERE current_state IN ('S1', 'S2')
          AND time_cat != 'PAST'
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
    offers_upsert AS (
        INSERT INTO public.shift_offers (shift_id, employee_id, status, offer_expires_at)
        SELECT ur.id, l.assigned_employee_id, 'Pending', ur.offer_deadline
        FROM updated_rows ur
        JOIN locked l ON l.id = ur.id
        WHERE ur.new_state_id = 'S3'
          AND l.assigned_employee_id IS NOT NULL
        ON CONFLICT (shift_id, employee_id) DO UPDATE
        SET offer_expires_at = EXCLUDED.offer_expires_at,
            status           = 'Pending',
            updated_at       = NOW()
        RETURNING id
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

-- 4. fn_process_offer_expirations: expire at the deadline or at shift start
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

        UPDATE public.shifts
        SET
            lifecycle_status     = 'Draft',
            assignment_status    = 'assigned',
            assignment_outcome   = NULL,
            fulfillment_status   = 'none'::shift_fulfillment_status,
            bidding_status       = 'not_on_bidding'::shift_bidding_status,
            updated_at           = NOW(),
            last_modified_reason = 'Offer expired - Reverted to Draft Assigned'
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
                    'reason', 'offer_expired'
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

-- 5. process_shift_timers: unfilled -> S15 at start; swaps expire at start;
--    No-Show at end completes the shift with a 0h billable
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
    -- 1. Expire pending offers S3 -> S2 (at offer_expires_at or shift kickoff)
    FOR v_rec IN SELECT * FROM public.fn_process_offer_expirations() LOOP
        v_count := v_count + 1;
    END LOOP;
    IF v_count > 0 THEN operation := 'OFFER_EXPIRED'; affected := v_count; RETURN NEXT; END IF;
    v_count := 0;

    -- 2. Expire unassigned bidding shifts at shift kickoff (TTS <= 0) -> S15 Cancelled
    WITH timed_out AS (
        UPDATE public.shifts SET
            lifecycle_status     = 'Cancelled'::shift_lifecycle,
            is_cancelled         = TRUE,
            bidding_status       = 'not_on_bidding'::shift_bidding_status,
            fulfillment_status   = 'none'::shift_fulfillment_status,
            updated_at           = NOW(),
            last_modified_reason = 'Unassigned shift expired at kickoff (TTS=0) - marked cancelled'
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

    -- 4. Auto-complete S11/S12 -> S13/S14 (for shifts without an open punch)
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

    -- 5. Expire in-flight swap requests S9/S10 -> S4 at kickoff (rs.start_at <= NOW()).
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
            jsonb_build_object('from_state', e.from_state, 'to_state', 'S13', 'source', 'process_shift_timers')
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

-- 6. check_in_shift: no punch after T_end
CREATE OR REPLACE FUNCTION public.check_in_shift(p_shift_id uuid, p_lat double precision, p_lon double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift           public.shifts%ROWTYPE;
  v_ts_id           uuid;
  v_now             timestamptz := clock_timestamp();
  v_effective_start timestamptz;
  v_effective_end   timestamptz;
  v_distance_m      double precision := 0;
  v_min_distance_m  double precision;
  v_arrival_track   public.attendance_arrival_track;
  v_legacy_status   text;
  v_loc             RECORD;
  v_any_location    boolean := false;
  v_inside          boolean := false;
  v_earth_radius    CONSTANT double precision := 6371000;
  v_lat1_rad        double precision;
  v_lat2_rad        double precision;
  v_dlat            double precision;
  v_dlon            double precision;
  v_a               double precision;
  v_dist            double precision;
  v_org             public.organizations%ROWTYPE;
  v_from_state      text;
  v_to_state        text;
BEGIN
  PERFORM public.sm_require_assignee_or(p_shift_id, NULL, 'shift.edit');
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
  END IF;

  IF v_shift.assigned_employee_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift has no assigned employee');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.timesheets t
    WHERE t.shift_id = p_shift_id AND t.clock_in IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already clocked in for this shift');
  END IF;

  IF v_shift.start_at IS NOT NULL THEN
    v_effective_start := v_shift.start_at;
  ELSE
    v_effective_start := (
      v_shift.shift_date::text || ' ' || v_shift.start_time::text || ' ' || COALESCE(v_shift.timezone, 'Australia/Sydney')
    )::timestamptz;
  END IF;

  IF v_shift.end_at IS NOT NULL THEN
    v_effective_end := v_shift.end_at;
  ELSE
    v_effective_end := (
      (v_shift.shift_date + v_shift.end_time)
      + CASE WHEN v_shift.end_time <= v_shift.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END
    ) AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney');
  END IF;

  -- Post-T_end Punch Gating: reject punch once shift has completed, ended, or marked No Show
  IF v_shift.lifecycle_status = 'Completed'
     OR v_now >= v_effective_end
     OR EXISTS (
       SELECT 1 FROM public.timesheets t WHERE t.shift_id = p_shift_id AND t.is_no_show = true
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code',    'SHIFT_CLOSED_NO_SHOW',
      'error',   'Shift ended at scheduled completion time. Contact manager for manual review.'
    );
  END IF;

  IF v_now < v_effective_start - INTERVAL '1 hour' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Clock-in window not open yet');
  END IF;

  IF v_now > v_effective_start + INTERVAL '750 minutes' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Clock-in window has closed (more than 12.5 hours after shift start)'
    );
  END IF;

  IF p_lat IS NULL OR p_lon IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'GPS location is required to clock in');
  END IF;

  v_min_distance_m := NULL;
  v_inside := false;
  FOR v_loc IN
    SELECT lat, lng, radius_m
    FROM public.allowed_locations
    WHERE org_id = v_shift.organization_id AND is_active = true
  LOOP
    v_any_location := true;
    v_lat1_rad := radians(v_loc.lat);
    v_lat2_rad := radians(p_lat);
    v_dlat     := radians(p_lat - v_loc.lat);
    v_dlon     := radians(p_lon - v_loc.lng);
    v_a        := sin(v_dlat / 2)^2 + cos(v_lat1_rad) * cos(v_lat2_rad) * sin(v_dlon / 2)^2;
    v_dist     := v_earth_radius * 2 * atan2(sqrt(v_a), sqrt(1 - v_a));

    IF v_min_distance_m IS NULL OR v_dist < v_min_distance_m THEN
      v_min_distance_m := v_dist;
    END IF;
    IF v_dist <= v_loc.radius_m THEN
      v_inside     := true;
      v_distance_m := v_dist;
    END IF;
  END LOOP;

  IF v_any_location AND NOT v_inside THEN
    RETURN jsonb_build_object(
      'success',    false,
      'error',      'You are too far from any allowed location to clock in',
      'distance_m', round(COALESCE(v_min_distance_m, 0)::numeric, 1)
    );
  END IF;

  IF NOT v_any_location THEN
    SELECT * INTO v_org FROM public.organizations WHERE id = v_shift.organization_id;
    IF v_org.venue_lat IS NOT NULL AND v_org.venue_lon IS NOT NULL THEN
      v_lat1_rad := radians(v_org.venue_lat);
      v_lat2_rad := radians(p_lat);
      v_dlat     := radians(p_lat - v_org.venue_lat);
      v_dlon     := radians(p_lon - v_org.venue_lon);
      v_a        := sin(v_dlat / 2)^2 + cos(v_lat1_rad) * cos(v_lat2_rad) * sin(v_dlon / 2)^2;
      v_distance_m := v_earth_radius * 2 * atan2(sqrt(v_a), sqrt(1 - v_a));
      IF v_distance_m > 100 THEN
        RETURN jsonb_build_object(
          'success',    false,
          'error',      'You are too far from the venue to clock in',
          'distance_m', round(v_distance_m::numeric, 1)
        );
      END IF;
    END IF;
  END IF;

  IF v_now < v_effective_start - INTERVAL '7 minutes 30 seconds' THEN
    v_arrival_track := 'early_in';
  ELSIF v_now <= v_effective_start + INTERVAL '7 minutes 30 seconds' THEN
    v_arrival_track := 'on_time';
  ELSE
    v_arrival_track := 'late_in';
  END IF;

  v_legacy_status := CASE WHEN v_arrival_track = 'late_in' THEN 'late' ELSE 'checked_in' END;

  v_from_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status, v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status,
    v_shift.is_cancelled, v_shift.bidding_status
  );

  INSERT INTO public.timesheets (
    shift_id,
    employee_id,
    organization_id,
    clock_in,
    arrival_track,
    source
  ) VALUES (
    p_shift_id,
    v_shift.assigned_employee_id,
    v_shift.organization_id,
    v_now,
    v_arrival_track,
    'mobile_gps'
  )
  ON CONFLICT (shift_id) DO UPDATE SET
    employee_id     = EXCLUDED.employee_id,
    organization_id = EXCLUDED.organization_id,
    clock_in        = EXCLUDED.clock_in,
    arrival_track   = EXCLUDED.arrival_track,
    source          = EXCLUDED.source,
    updated_at      = v_now
  WHERE public.timesheets.clock_in IS NULL
  RETURNING id INTO v_ts_id;

  IF v_ts_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already clocked in for this shift');
  END IF;

  UPDATE public.shifts SET
    lifecycle_status = CASE
      WHEN lifecycle_status = 'Published'::public.shift_lifecycle THEN 'InProgress'::public.shift_lifecycle
      ELSE lifecycle_status
    END,
    trading_status = 'NoTrade'::public.shift_trading,
    updated_at = v_now
  WHERE id = p_shift_id;

  v_to_state := public.get_shift_fsm_state(
    CASE WHEN v_shift.lifecycle_status = 'Published'::public.shift_lifecycle THEN 'InProgress'::public.shift_lifecycle ELSE v_shift.lifecycle_status END,
    v_shift.assignment_status,
    v_shift.assignment_outcome,
    'NoTrade'::public.shift_trading,
    v_shift.is_cancelled,
    v_shift.bidding_status
  );

  INSERT INTO public.shift_events (
    shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain
  ) VALUES (
    p_shift_id,
    v_shift.assigned_employee_id,
    auth.uid(),
    CASE WHEN v_arrival_track = 'late_in' THEN 'LATE_IN' ELSE 'CHECKED_IN' END::public.shift_event_type,
    v_now,
    jsonb_build_object(
      'from_state', v_from_state,
      'to_state', v_to_state,
      'arrival_track', v_arrival_track::text,
      'source', 'check_in_shift'
    ),
    'employee',
    'attendance'
  )
  ON CONFLICT (shift_id, employee_id, event_type, event_time) DO NOTHING;

  RETURN jsonb_build_object(
    'success',           true,
    'arrival_track',     v_arrival_track::text,
    'attendance_status', v_legacy_status,
    'clock_in',          v_now,
    'actual_start',      v_now,
    'distance_m',        round(v_distance_m::numeric, 1)
  );
END;
$function$;

-- 7. sm_create_swap_request: locked only once the shift has started
CREATE OR REPLACE FUNCTION public.sm_create_swap_request(p_requester_shift_id uuid, p_target_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
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

  SELECT * INTO v_shift FROM shifts WHERE id = p_requester_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Shift not found', 'code', 'SHIFT_NOT_FOUND');
  END IF;

  IF v_shift.assigned_employee_id IS DISTINCT FROM v_caller AND NOT public.can_act_on_shift('swap.approve', v_shift.id) THEN
    RETURN json_build_object('success', false, 'error', 'You are not assigned to this shift', 'code', 'FORBIDDEN');
  END IF;

  v_start := COALESCE(
    v_shift.start_at,
    (v_shift.shift_date::text || ' ' || v_shift.start_time::text)::timestamp
      AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney')
  );
  IF v_start IS NOT NULL AND v_start <= now() THEN
    RETURN json_build_object('success', false, 'error', 'Time locked: shift has already started', 'code', 'TIME_LOCKED');
  END IF;

  IF EXISTS (
    SELECT 1 FROM shift_swaps
    WHERE requester_shift_id = p_requester_shift_id
      AND status IN ('OPEN', 'MANAGER_PENDING')
  ) THEN
    RETURN json_build_object('success', false, 'error', 'An active swap already exists for this shift', 'code', 'SWAP_EXISTS');
  END IF;

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

-- 8. trg_bid_lock_check: bidding closes at shift start (and reads the shift's
--    own timezone instead of the session's)
CREATE OR REPLACE FUNCTION public.trg_bid_lock_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift_start TIMESTAMPTZ;
BEGIN
  SELECT COALESCE(start_at,
         (shift_date::TEXT || ' ' || start_time::TEXT)::TIMESTAMP AT TIME ZONE COALESCE(timezone, 'Australia/Sydney'))
  INTO   v_shift_start
  FROM   shifts
  WHERE  id = NEW.shift_id
  LIMIT  1;

  IF v_shift_start IS NOT NULL AND v_shift_start <= NOW() THEN
    RAISE EXCEPTION 'BIDDING_LOCKED: Bidding is closed once the shift has started';
  END IF;

  RETURN NEW;
END;
$function$;

-- 9. fn_set_swap_expires_at: swaps expire at shift start
CREATE OR REPLACE FUNCTION public.fn_set_swap_expires_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_shift_start TIMESTAMPTZ;
BEGIN
    SELECT COALESCE(s.start_at,
        (s.shift_date::TEXT||' '||s.start_time::TEXT)::TIMESTAMP AT TIME ZONE COALESCE(s.timezone,'Australia/Sydney'))
    INTO v_shift_start FROM public.shifts s WHERE s.id = NEW.requester_shift_id;
    IF v_shift_start IS NOT NULL THEN
        NEW.expires_at := v_shift_start;
    END IF;
    RETURN NEW;
END;
$function$;

-- 10. Swap-expiry notifications no longer cite the 4-hour window
CREATE OR REPLACE FUNCTION public.trg_shift_swap_outcome_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'APPROVED' THEN
    PERFORM notify_user(NEW.requester_id, 'swap_approved', 'Swap approved',
      'Your shift swap request has been approved by your manager. Check My Roster.',
      NEW.id, 'swap_request', '/my-swaps', 'swap_approved:' || NEW.id::text);
    IF NEW.target_id IS NOT NULL AND NEW.target_id <> NEW.requester_id THEN
      PERFORM notify_user(NEW.target_id, 'swap_approved', 'Swap completed',
        'A shift swap you offered on was approved by the manager. Check My Roster.',
        NEW.id, 'swap_request', '/my-swaps', 'swap_approved_offerer:' || NEW.id::text);
    END IF;

  ELSIF NEW.status = 'REJECTED' THEN
    PERFORM notify_user(NEW.requester_id, 'swap_rejected', 'Swap not approved',
      'Your shift swap request was not approved' ||
        CASE WHEN NEW.rejection_reason IS NOT NULL THEN ': ' || NEW.rejection_reason ELSE '.' END,
      NEW.id, 'swap_request', '/my-swaps', 'swap_rejected:' || NEW.id::text);

  ELSIF NEW.status = 'EXPIRED' THEN
    PERFORM notify_user(NEW.requester_id, 'swap_expired', 'Swap request expired',
      'Your swap request expired because the shift has started. No changes were made.',
      NEW.id, 'swap_request', '/my-swaps', 'swap_expired:' || NEW.id::text);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_swap_expired_notification_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status != 'EXPIRED' THEN RETURN NEW; END IF;

  PERFORM notify_user(
    OLD.requested_by_employee_id,
    'swap_expired',
    'Swap Request Expired',
    'Your swap request expired because the shift has started. No changes were made.',
    '/my-swaps',
    'swap_request',
    NEW.id::text
  );

  RETURN NEW;
END;
$function$;
