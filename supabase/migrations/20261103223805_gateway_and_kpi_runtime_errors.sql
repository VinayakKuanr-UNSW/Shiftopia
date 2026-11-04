-- ============================================================================
-- Migration: gateway_and_kpi_runtime_errors
-- Purpose:
--   Two live functions failed at run time after the 2026-11-02 rewrites —
--   found by CI on PR #47 and confirmed with plpgsql_check against Supabase
--   (no other PL/pgSQL or SQL function in public/internal/hr has an error).
--
--   public._apply_shift_op_write (the shift gateway's writer):
--     - fulfillment_status 'unfilled' and bidding_status 'open' are not values
--       of their enums; restored to what main wrote — publish (unassigned),
--       reject_offer, drop_shift -> bidding / on_bidding; expire_offer
--       (S3 -> S2) -> none / not_on_bidding. Publishing an open shift failed.
--     - offer_sent_at and confirmed_at were dropped from shifts (tier 1) but
--       still assigned: unpublish, accept_offer and offering a shift failed.
--     - cancel_trade matched swap status 'PENDING', which does not exist; the
--       in-flight set everywhere else is OPEN / OFFER_SELECTED / MANAGER_PENDING.
--   public.get_marketplace_kpis read sm.distinct_filled_shifts; the column is
--   on spm (as on main), so every call failed.
--
--   Bodies are the live pg_get_functiondef with only those edits.
-- ============================================================================

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

      IF ((v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp
            AT TIME ZONE 'Australia/Sydney') - INTERVAL '4 hours' <= NOW() THEN
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
          offer_expires_at       = NOW() + INTERVAL '48 hours',
          bidding_status         = 'not_on_bidding'::public.shift_bidding_status,
          published_at           = NOW(),
          last_modified_by       = p_actor,
          updated_at             = NOW()
        WHERE id = p_shift_id;
      END IF;
    ELSE
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
    IF ((v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp
          AT TIME ZONE 'Australia/Sydney') - INTERVAL '4 hours' <= NOW() THEN
      UPDATE public.shifts SET
        assigned_employee_id = NULL,
        assigned_at          = NULL,
        assignment_status    = 'unassigned'::public.shift_assignment_status,
        assignment_outcome   = NULL,
        fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
        last_dropped_by      = v_cur.assigned_employee_id,
        bidding_status       = 'on_bidding'::public.shift_bidding_status,
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
        fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
        last_dropped_by      = v_cur.assigned_employee_id,
        bidding_status       = 'on_bidding'::public.shift_bidding_status,
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

CREATE OR REPLACE FUNCTION public.get_marketplace_kpis(p_from date, p_to date, p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[], p_subdept_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(published_shifts integer, filled_shifts integer, fill_rate numeric, open_shifts integer, covered_open_shifts integer, open_coverage_rate numeric, published_snapshots integer, distinct_filled_shifts integer, churn_rate numeric, avg_time_to_fill_hours numeric, marketplace_eligible_shifts integer, marketplace_used_shifts integer, marketplace_utilization_rate numeric, offers_resolved integer, offer_accept_rate numeric, offer_reject_rate numeric, offer_ignore_rate numeric, trades_initiated integer, trade_completion_rate numeric, trade_rejection_rate numeric, trade_cancellation_rate numeric, trade_expiry_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    RETURN QUERY
    WITH
    pub_shifts AS (
        SELECT
            s.id,
            s.assigned_employee_id,
            s.start_at AS scheduled_start,
            s.shift_date,
            s.bidding_status,
            s.published_at,
            s.created_at,
            s.organization_id,
            s.department_id,
            s.sub_department_id
        FROM shifts s
          WHERE s.published_at IS NOT NULL
          AND s.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR s.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id = ANY(p_subdept_ids))
    ),
    shift_flags AS (
        SELECT
            ps.id,
            ps.assigned_employee_id,
            EXISTS (
                SELECT 1 FROM shift_events e
                WHERE e.shift_id = ps.id AND e.event_type = 'OFFERED'
            ) AS had_offer,
            EXISTS (
                SELECT 1 FROM shift_bids b WHERE b.shift_id = ps.id
            ) AS had_bid,
            EXISTS (
                SELECT 1 FROM shift_swaps sw WHERE sw.requester_shift_id = ps.id
            ) AS had_swap,
            (ps.bidding_status IN ('on_bidding', 'on_bidding_normal', 'on_bidding_urgent', 'bidding_closed_no_winner')) AS went_on_bidding
        FROM pub_shifts ps
    ),
    shift_metrics AS (
        SELECT
            COUNT(*)::int                                              AS published_shifts,
            COUNT(*) FILTER (WHERE assigned_employee_id IS NOT NULL)::int
                                                                       AS filled_shifts,
            COUNT(*) FILTER (WHERE had_offer OR had_bid OR went_on_bidding)::int
                                                                       AS open_shifts,
            COUNT(*) FILTER (
                WHERE (had_offer OR had_bid OR went_on_bidding)
                  AND assigned_employee_id IS NOT NULL
            )::int                                                     AS covered_open_shifts,
            COUNT(*)::int                                              AS marketplace_eligible_shifts,
            COUNT(*) FILTER (WHERE had_offer OR had_bid OR had_swap)::int
                                                                       AS marketplace_used_shifts
        FROM shift_flags
    ),
    snaps AS (
        SELECT
            asnp.shift_id,
            asnp.became_active_at,
            asnp.scheduled_start
        FROM assignment_snapshots asnp
        WHERE asnp.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR asnp.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR asnp.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR asnp.sub_department_id = ANY(p_subdept_ids))
    ),
    ttf AS (
        SELECT
            sn.shift_id,
            sn.became_active_at,
            COALESCE(
                (
                    SELECT MAX(e.event_time)
                    FROM shift_events e
                    WHERE e.shift_id   = sn.shift_id
                      AND e.event_type = 'OFFERED'
                      AND e.event_time < sn.became_active_at
                ),
                sh.published_at,
                sh.created_at
            ) AS open_started_at
        FROM snaps sn
        LEFT JOIN shifts sh ON sh.id = sn.shift_id
    ),
    snapshot_metrics AS (
        SELECT
            COUNT(*)::int                          AS published_snapshots,
            COUNT(DISTINCT shift_id)::int          AS distinct_filled_shifts
        FROM snaps
    ),
    ttf_metrics AS (
        SELECT
            AVG(
                EXTRACT(EPOCH FROM (became_active_at - open_started_at)) / 3600.0
            ) FILTER (
                WHERE open_started_at IS NOT NULL
                  AND became_active_at IS NOT NULL
                  AND became_active_at >= open_started_at
            ) AS avg_time_to_fill_hours
        FROM ttf
    ),
    offer_metrics AS (
        SELECT
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.had_accept)::int AS accepted,
            COUNT(*) FILTER (WHERE ep.had_offer AND NOT ep.had_accept
                                   AND ep.terminal_outcome NOT IN ('ignored','open'))::int AS rejected,
            COUNT(*) FILTER (WHERE ep.had_offer AND NOT ep.had_accept
                                   AND ep.terminal_outcome = 'ignored')::int AS ignored,
            COUNT(*) FILTER (WHERE ep.had_offer
                                   AND (ep.had_accept OR ep.terminal_outcome <> 'open'))::int AS resolved
        FROM v_shift_assignment_episodes ep
        WHERE ep.shift_date BETWEEN p_from AND p_to
          AND ep.terminal_outcome <> 'shift_deleted'
          AND (p_org_ids     IS NULL OR ep.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR ep.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR ep.sub_department_id = ANY(p_subdept_ids))
    ),
    trade_metrics AS (
        SELECT
            COUNT(*)::int                                                  AS total,
            COUNT(*) FILTER (WHERE ss.status = 'APPROVED')::int            AS completed,
            COUNT(*) FILTER (WHERE ss.status = 'REJECTED')::int            AS rejected,
            COUNT(*) FILTER (WHERE ss.status = 'CANCELLED')::int           AS cancelled,
            COUNT(*) FILTER (WHERE ss.status = 'EXPIRED')::int             AS expired
        FROM shift_swaps ss
        JOIN shifts s ON s.id = ss.requester_shift_id
          WHERE s.shift_date BETWEEN p_from AND p_to
          AND (p_org_ids     IS NULL OR s.organization_id   = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id     = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id = ANY(p_subdept_ids))
    )
    SELECT
        sm.published_shifts,
        sm.filled_shifts,
        CASE WHEN sm.published_shifts = 0 THEN 0
             ELSE ROUND(sm.filled_shifts::numeric / sm.published_shifts * 100, 2) END
                                                                       AS fill_rate,
        sm.open_shifts,
        sm.covered_open_shifts,
        CASE WHEN sm.open_shifts = 0 THEN 0
             ELSE ROUND(sm.covered_open_shifts::numeric / sm.open_shifts * 100, 2) END
                                                                       AS open_coverage_rate,
        spm.published_snapshots,
        spm.distinct_filled_shifts,
        CASE WHEN spm.distinct_filled_shifts = 0 THEN 0
             ELSE ROUND(
                 (spm.published_snapshots - spm.distinct_filled_shifts)::numeric
                 / spm.distinct_filled_shifts * 100, 2) END           AS churn_rate,
        ROUND(COALESCE(tm.avg_time_to_fill_hours, 0), 2)              AS avg_time_to_fill_hours,
        sm.marketplace_eligible_shifts,
        sm.marketplace_used_shifts,
        CASE WHEN sm.marketplace_eligible_shifts = 0 THEN 0
             ELSE ROUND(sm.marketplace_used_shifts::numeric
                        / sm.marketplace_eligible_shifts * 100, 2) END AS marketplace_utilization_rate,
        om.resolved                                                   AS offers_resolved,
        CASE WHEN om.resolved = 0 THEN 0
             ELSE ROUND(om.accepted::numeric / om.resolved * 100, 2) END AS offer_accept_rate,
        CASE WHEN om.resolved = 0 THEN 0
             ELSE ROUND(om.rejected::numeric / om.resolved * 100, 2) END AS offer_reject_rate,
        CASE WHEN om.resolved = 0 THEN 0
             ELSE ROUND(om.ignored::numeric  / om.resolved * 100, 2) END AS offer_ignore_rate,
        trm.total                                                     AS trades_initiated,
        CASE WHEN trm.total = 0 THEN 0
             ELSE ROUND(trm.completed::numeric / trm.total * 100, 2) END AS trade_completion_rate,
        CASE WHEN trm.total = 0 THEN 0
             ELSE ROUND(trm.rejected::numeric / trm.total * 100, 2) END AS trade_rejection_rate,
        CASE WHEN trm.total = 0 THEN 0
             ELSE ROUND(trm.cancelled::numeric / trm.total * 100, 2) END AS trade_cancellation_rate,
        CASE WHEN trm.total = 0 THEN 0
             ELSE ROUND(trm.expired::numeric / trm.total * 100, 2) END AS trade_expiry_rate
    FROM shift_metrics    sm
    CROSS JOIN snapshot_metrics spm
    CROSS JOIN ttf_metrics      tm
    CROSS JOIN offer_metrics    om
    CROSS JOIN trade_metrics    trm;
END;
$function$;
