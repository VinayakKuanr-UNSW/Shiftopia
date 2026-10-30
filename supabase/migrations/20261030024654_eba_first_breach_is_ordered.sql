-- The gateway and the EBA trigger report the FIRST blocking breach the engine finds.
--
-- They took `LIMIT 1` over internal.eba_check_assignment(...) with no ORDER BY.
-- The engine emits rows in a fixed sequence (employment target, then each EBA
-- rule in evaluation order), and a function scan returns them in that order in
-- practice, but SQL only guarantees an order under ORDER BY. Each call now
-- numbers the rows WITH ORDINALITY and orders by that, so "first" is the
-- engine's own order by contract. Same answer as today; 5 sites in
-- _apply_shift_op_write and 1 in internal.trg_shift_eba_compliance, each
-- rebuilt from its live definition with only those lines changed.
--
-- Test: supabase/tests/eba_first_breach_is_ordered.sql.

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
          is_on_bidding          = FALSE,
          confirmed_at           = NOW(),
          emergency_assigned_at  = NOW(),
          emergency_assigned_by  = p_actor,
          published_at           = NOW(),
          published_by_user_id   = p_actor,
          last_modified_by       = p_actor,
          updated_at             = NOW()
        WHERE id = p_shift_id;
      ELSE
        INSERT INTO public.shift_offers (shift_id, employee_id, status)
        VALUES (p_shift_id, v_cur.assigned_employee_id, 'Pending')
        ON CONFLICT (shift_id, employee_id) DO NOTHING;

        UPDATE public.shifts SET
          lifecycle_status     = 'Published'::public.shift_lifecycle,
          fulfillment_status   = 'scheduled'::public.shift_fulfillment_status,
          published_at         = NOW(),
          published_by_user_id = p_actor,
          last_modified_by     = p_actor,
          updated_at           = NOW()
        WHERE id = p_shift_id;
      END IF;
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
        bidding_open_at      = NOW(),
        bidding_close_at     = ((v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp
                                  AT TIME ZONE 'Australia/Sydney') - INTERVAL '4 hours',
        last_modified_by     = p_actor,
        updated_at           = NOW()
      WHERE id = p_shift_id;
    END IF;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'unpublish' THEN
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
      is_on_bidding        = FALSE,
      fulfillment_status   = 'scheduled'::public.shift_fulfillment_status,
      confirmed_at         = NOW(),
      last_modified_by     = p_actor,
      updated_at           = NOW()
    WHERE id = p_shift_id;
    RETURN jsonb_build_object('applied', true);

  ELSIF p_op = 'edit' THEN
    IF NOT (p_payload ?| ARRAY[
      'start_time','end_time','shift_date','break_minutes','paid_break_minutes',
      'unpaid_break_minutes','break_start','break_end','notes','role_id','sub_department_id',
      'remuneration_level','group_type','sub_group_name','display_order',
      'shift_group_id','shift_subgroup_id','timezone','is_training',
      'assigned_employee_id','assignment_source','required_skills','required_licenses','event_ids'
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
      break_minutes         = COALESCE((p_payload->>'paid_break_minutes')::int, paid_break_minutes)
                            + COALESCE((p_payload->>'unpaid_break_minutes')::int, unpaid_break_minutes),
      notes                 = CASE WHEN p_payload ? 'notes' THEN p_payload->>'notes' ELSE notes END,
      role_id               = COALESCE(NULLIF(p_payload->>'role_id','')::uuid, role_id),
      sub_department_id     = COALESCE(NULLIF(p_payload->>'sub_department_id','')::uuid, sub_department_id),
      remuneration_level    = COALESCE(NULLIF(p_payload->>'remuneration_level','')::smallint, remuneration_level),
      shift_group_id        = COALESCE(NULLIF(p_payload->>'shift_group_id','')::uuid, shift_group_id),
      roster_subgroup_id    = COALESCE(NULLIF(p_payload->>'shift_subgroup_id','')::uuid, roster_subgroup_id),
      group_type            = COALESCE(NULLIF(p_payload->>'group_type','')::template_group_type, group_type),
      sub_group_name        = CASE WHEN p_payload ? 'sub_group_name' THEN p_payload->>'sub_group_name' ELSE sub_group_name END,
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

CREATE OR REPLACE FUNCTION internal.trg_shift_eba_compliance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_cur  public.shifts%ROWTYPE;
    v_key  text;
    v_done text;
    v_hit  record;
    v_name text;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.assigned_employee_id     IS NOT DISTINCT FROM OLD.assigned_employee_id
       AND NEW.shift_date               IS NOT DISTINCT FROM OLD.shift_date
       AND NEW.start_time               IS NOT DISTINCT FROM OLD.start_time
       AND NEW.end_time                 IS NOT DISTINCT FROM OLD.end_time
       AND NEW.break_start              IS NOT DISTINCT FROM OLD.break_start
       AND NEW.break_end                IS NOT DISTINCT FROM OLD.break_end
       AND NEW.unpaid_break_minutes     IS NOT DISTINCT FROM OLD.unpaid_break_minutes
       AND NEW.role_id                  IS NOT DISTINCT FROM OLD.role_id
       AND NEW.sub_department_id        IS NOT DISTINCT FROM OLD.sub_department_id
       AND NEW.target_employment_type   IS NOT DISTINCT FROM OLD.target_employment_type
       AND NEW.target_requires_flexible IS NOT DISTINCT FROM OLD.target_requires_flexible
       AND NEW.is_training              IS NOT DISTINCT FROM OLD.is_training
       AND NEW.user_contract_id         IS NOT DISTINCT FROM OLD.user_contract_id
       AND NEW.required_skills          IS NOT DISTINCT FROM OLD.required_skills
       AND NEW.required_licenses        IS NOT DISTINCT FROM OLD.required_licenses
       AND NOT (NEW.lifecycle_status = 'Published' AND OLD.lifecycle_status IS DISTINCT FROM 'Published')
       AND NOT (COALESCE(OLD.is_cancelled, false) AND NOT COALESCE(NEW.is_cancelled, false))
    THEN
        RETURN NULL;
    END IF;

    -- At commit: the row as it finally stands, not as this event saw it.
    SELECT * INTO v_cur FROM public.shifts s WHERE s.id = NEW.id;
    IF NOT FOUND
       OR v_cur.assigned_employee_id IS NULL
       OR COALESCE(v_cur.is_cancelled, false)
       OR v_cur.lifecycle_status = 'Cancelled' THEN
        RETURN NULL;
    END IF;

    -- A shift written several times in one transaction is checked once per
    -- final version (trg_increment_shift_version bumps it on every UPDATE).
    v_key  := v_cur.id::text || ':' || v_cur.version::text;
    v_done := COALESCE(current_setting('eba.checked', true), '');
    IF strpos(v_done, v_key) > 0 THEN
        RETURN NULL;
    END IF;
    PERFORM set_config('eba.checked', v_done || ',' || v_key, true);

    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_cur.assigned_employee_id::text));

    SELECT r.rule_id, r.details INTO v_hit
      FROM internal.eba_check_assignment(v_cur.id, v_cur.assigned_employee_id) WITH ORDINALITY AS r(is_compliant, rule_id, rule_name, tier, summary, details, payload, eba_ord)
     WHERE r.tier = 'BLOCKING'
     ORDER BY r.eba_ord
     LIMIT 1;

    IF FOUND THEN
        SELECT NULLIF(trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '')
          INTO v_name FROM public.profiles p WHERE p.id = v_cur.assigned_employee_id;
        RAISE EXCEPTION '% cannot work the shift on % (%–%): %',
            COALESCE(v_name, 'This employee'),
            to_char(v_cur.shift_date, 'Dy FMDD Mon'),
            to_char(v_cur.start_time, 'HH24:MI'),
            to_char(v_cur.end_time, 'HH24:MI'),
            v_hit.details
            USING ERRCODE = 'check_violation', HINT = 'EBA_COMPLIANCE:' || v_hit.rule_id;
    END IF;

    RETURN NULL;
END;
$function$;
