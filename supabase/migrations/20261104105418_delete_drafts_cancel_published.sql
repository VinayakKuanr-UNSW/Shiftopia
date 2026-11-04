-- ============================================================================
-- Delete drafts, cancel published (docs/design/shift-trading/03-bidding-fsm.md B-D13..B-D16).
--   * Delete is for drafts (S1/S2) only: fsm_op_is_legal, _shift_delete_refusal
--     (shared by sm_delete_shift, sm_bulk_delete_shifts, subgroup delete and
--     template undo) and the RLS delete policy for direct client deletes.
--   * sm_cancel_shift: S3-S7, and S8 while nobody has clocked in. A note is
--     required; the assignee and anyone whose trade ends are notified; trades
--     and bids end through the existing cascades; a pending offer row expires.
--   * fn_capture_shift_event: every cancellation is logged as OP_APPLIED
--     'cancel' (code or note), never CANCELLED / LATE_CANCELLED against the
--     assignee — a manager's cancellation never counts against the employee.
--   * Gateway publish follows sm_bulk_publish_shifts: refuses a started shift;
--     FT is confirmed directly (S4) and never published unassigned.
--   * sm_employee_drop_shift: the emergent (4h) urgency band is gone.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fsm_op_is_legal(p_state text, p_op text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE p_op
    WHEN 'select_winner' THEN p_state IN ('S5')
    WHEN 'publish' THEN p_state IN ('S1', 'S2')
    WHEN 'unpublish' THEN p_state IN ('S3', 'S4', 'S5', 'S6', 'S7')

    -- assign: unassigned (S1/S5) or a draft reassign (S2). A published assigned
    -- shift (S3/S4) changes person only after an unpublish (D8).
    WHEN 'assign' THEN p_state IN ('S1', 'S2', 'S5')

    -- unassign: inverse of assign, DRAFT-only. S2 (Draft+assigned) → S1. A published
    -- assigned shift (S3/S4) must be unpublished first (no defined unassigned-published
    -- FSM state), so it is NOT admitted here.
    WHEN 'unassign' THEN p_state IN ('S2')

    WHEN 'approve_trade' THEN p_state IN ('S7')
    WHEN 'reject_trade'  THEN p_state IN ('S7')
    -- delete: drafts only. A published shift is cancelled instead, which keeps its history.
    WHEN 'delete' THEN p_state IN ('S1', 'S2')
    -- cancel: published, or in progress while nobody has clocked in (sm_cancel_shift checks the punch)
    WHEN 'cancel' THEN p_state IN ('S3', 'S4', 'S5', 'S6', 'S7', 'S8')
    -- edit: drafts only. A published shift (S3-S7) is unpublished first (D8).
    WHEN 'edit' THEN p_state IN ('S1', 'S2')
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public._shift_delete_refusal(p_shift shifts)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.timesheets t
      WHERE t.shift_id = p_shift.id AND t.clock_in IS NOT NULL
    )
      OR p_shift.lifecycle_status::text IN ('InProgress', 'Completed')
      THEN 'SHIFT_WORKED'
    WHEN (p_shift.shift_date || ' ' || p_shift.start_time)::timestamp AT TIME ZONE 'Australia/Sydney' <= now()
      THEN 'SHIFT_STARTED'
    WHEN p_shift.lifecycle_status::text <> 'Draft'
      THEN 'SHIFT_PUBLISHED'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_delete_shift(p_shift_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_expected_version integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_refusal text;
BEGIN
  IF NOT public.sm_request_is_system() AND (auth.uid() IS NULL OR EXISTS (
       -- scope guard (20261011 access matrix)
       SELECT 1 FROM public.shifts s
        WHERE s.id = p_shift_id
          AND NOT public.user_has_action_in_scope('shift.delete', s.organization_id, s.department_id, s.sub_department_id))) THEN
    RETURN json_build_object('success', false, 'shift_id', p_shift_id,
      'error', 'You are not allowed to delete shifts.', 'code', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'shift_id', p_shift_id,
      'error', 'Shift not found', 'code', 'SHIFT_NOT_FOUND');
  END IF;

  IF p_expected_version IS NOT NULL AND v_shift.version <> p_expected_version THEN
    RETURN json_build_object('success', false, 'shift_id', p_shift_id,
      'error', 'This shift was changed by someone else. Refresh and try again.', 'code', 'VERSION_CONFLICT');
  END IF;

  v_refusal := public._shift_delete_refusal(v_shift);
  IF v_refusal = 'SHIFT_WORKED' THEN
    RETURN json_build_object('success', false, 'shift_id', p_shift_id,
      'error', 'This shift has been worked, so it cannot be deleted. Correct it through the timesheet instead.',
      'code', v_refusal);
  ELSIF v_refusal = 'SHIFT_STARTED' THEN
    RETURN json_build_object('success', false, 'shift_id', p_shift_id,
      'error', 'This shift has already started, so it cannot be deleted.', 'code', v_refusal);
  ELSIF v_refusal = 'SHIFT_PUBLISHED' THEN
    RETURN json_build_object('success', false, 'shift_id', p_shift_id,
      'error', 'This shift is published, so it cannot be deleted. Cancel it instead.', 'code', v_refusal);
  END IF;

  DELETE FROM public.shifts WHERE id = p_shift_id;

  RETURN json_build_object('success', true, 'shift_id', p_shift_id, 'message', 'Shift deleted');
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_bulk_delete_shifts(p_shift_ids uuid[], p_deleted_by uuid DEFAULT auth.uid(), p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_id uuid;
  v_shift public.shifts%ROWTYPE;
  v_refusal text;
  v_deleted uuid[] := '{}';
  v_failed jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.sm_request_is_system() AND (auth.uid() IS NULL OR EXISTS (
       -- scope guard (20261011 access matrix): every shift in the batch
       SELECT 1 FROM public.shifts s
        WHERE s.id = ANY (COALESCE(p_shift_ids, '{}'))
          AND NOT public.user_has_action_in_scope('shift.delete', s.organization_id, s.department_id, s.sub_department_id))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not allowed to delete shifts.',
      'total_requested', COALESCE(array_length(p_shift_ids, 1), 0), 'success_count', 0);
  END IF;

  FOREACH v_id IN ARRAY COALESCE(p_shift_ids, '{}') LOOP
    SELECT * INTO v_shift FROM public.shifts WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', 'Shift not found');
      CONTINUE;
    END IF;
    v_refusal := public._shift_delete_refusal(v_shift);
    IF v_refusal IS NOT NULL THEN
      v_failed := v_failed || jsonb_build_object('id', v_id, 'reason',
        CASE v_refusal WHEN 'SHIFT_WORKED' THEN 'Already worked'
                       WHEN 'SHIFT_PUBLISHED' THEN 'Published — cancel it instead'
                       ELSE 'Already started' END);
      CONTINUE;
    END IF;
    DELETE FROM public.shifts WHERE id = v_id;
    v_deleted := v_deleted || v_id;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'total_requested', COALESCE(array_length(p_shift_ids, 1), 0),
    'success_count', COALESCE(array_length(v_deleted, 1), 0),
    'failure_count', jsonb_array_length(v_failed),
    'deleted_ids', to_jsonb(v_deleted),
    'failed', v_failed
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_cancel_shift(p_shift_id uuid, p_reason text, p_expected_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift  public.shifts%ROWTYPE;
  v_state  text;
  v_note   text := NULLIF(btrim(p_reason), '');
  v_when   text;
  v_emp    uuid;
BEGIN
  -- cancelling replaces deleting for a published shift, so it needs the same right
  IF NOT public.sm_request_is_system() AND (auth.uid() IS NULL OR EXISTS (
       SELECT 1 FROM public.shifts s
        WHERE s.id = p_shift_id
          AND NOT public.user_has_action_in_scope('shift.delete', s.organization_id, s.department_id, s.sub_department_id))) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'You are not allowed to cancel shifts.');
  END IF;

  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'SHIFT_NOT_FOUND', 'error', 'Shift not found');
  END IF;
  IF p_expected_version IS NOT NULL AND v_shift.version <> p_expected_version THEN
    RETURN jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT',
      'error', 'This shift was changed by someone else. Refresh and try again.');
  END IF;

  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled, v_shift.bidding_status);
  IF NOT public.fsm_op_is_legal(v_state, 'cancel') THEN
    RETURN jsonb_build_object('success', false, 'code', 'ILLEGAL_STATE', 'state', v_state,
      'error', CASE WHEN v_state IN ('S1', 'S2') THEN 'A draft is deleted, not cancelled.'
                    ELSE 'This shift can no longer be cancelled.' END);
  END IF;
  IF EXISTS (SELECT 1 FROM public.timesheets t WHERE t.shift_id = p_shift_id AND t.clock_in IS NOT NULL) THEN
    RETURN jsonb_build_object('success', false, 'code', 'SHIFT_WORKED',
      'error', 'Someone has clocked in to this shift. Correct it through the timesheet instead.');
  END IF;
  IF v_note IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED', 'error', 'Say why the shift is cancelled.');
  END IF;

  v_when := to_char(v_shift.shift_date, 'Dy FMDD Mon') || ' ' ||
            to_char(v_shift.start_time, 'HH24:MI') || '–' || to_char(v_shift.end_time, 'HH24:MI');

  -- Tell the assignee, and everyone whose trade this ends, before the trade
  -- cascade (trg_shift_end_trades) clears the records. Bidders are told by
  -- trg_bid_outcome_notification when their bids close.
  FOR v_emp IN
    SELECT DISTINCT x FROM (
      SELECT v_shift.assigned_employee_id
      UNION ALL
      SELECT so.offerer_id FROM public.swap_offers so JOIN public.shift_swaps sw ON sw.id = so.swap_request_id
       WHERE sw.requester_shift_id = p_shift_id AND sw.status IN ('OPEN', 'MANAGER_PENDING')
         AND so.status IN ('SUBMITTED', 'SELECTED')
      UNION ALL
      SELECT sw.requester_id FROM public.shift_swaps sw
       WHERE sw.target_shift_id = p_shift_id AND sw.status = 'MANAGER_PENDING'
      UNION ALL
      SELECT sw.requester_id FROM public.swap_offers so JOIN public.shift_swaps sw ON sw.id = so.swap_request_id
       WHERE so.offered_shift_id = p_shift_id AND so.status IN ('SUBMITTED', 'SELECTED')
         AND sw.status IN ('OPEN', 'MANAGER_PENDING')
    ) people(x)
    WHERE x IS NOT NULL
  LOOP
    PERFORM public.notify_user(
      v_emp,
      'shift_cancelled',
      'Shift cancelled',
      CASE WHEN v_emp = v_shift.assigned_employee_id
           THEN format('Your shift on %s was cancelled: %s', v_when, v_note)
           ELSE format('The shift on %s in your trade was cancelled, so the trade has ended: %s', v_when, v_note)
      END,
      p_shift_id,
      'shift',
      '/my-roster',
      'shift_cancelled:' || p_shift_id::text || ':' || v_emp::text
    );
  END LOOP;

  -- an unanswered offer ends with the shift
  UPDATE public.shift_offers
     SET status = 'Expired', responded_at = now(), response_notes = 'Shift cancelled: ' || v_note
   WHERE shift_id = p_shift_id AND status = 'Pending';

  UPDATE public.shifts SET
    lifecycle_status     = 'Cancelled'::public.shift_lifecycle,
    is_cancelled         = TRUE,
    cancelled_at         = now(),
    bidding_status       = 'not_on_bidding'::public.shift_bidding_status,
    fulfillment_status   = 'none'::public.shift_fulfillment_status,
    last_modified_by     = auth.uid(),
    last_modified_reason = v_note,
    updated_at           = now()
  WHERE id = p_shift_id;

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S10');
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_capture_shift_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_from  text;
    v_to    text;
    v_actor uuid;
    v_auto  boolean;
    v_drop  boolean;
BEGIN
    IF current_setting('app.audit.via_gateway', true) = '1' THEN
        RETURN NEW;
    END IF;

    v_actor := auth.uid();
    v_auto  := COALESCE(current_setting('app.audit.actor', true), '') = 'autoscheduler';
    v_drop  := COALESCE(current_setting('app.audit.employee_drop', true), '') = '1';
    v_to := public.get_shift_fsm_state(NEW.lifecycle_status, NEW.assignment_status, NEW.assignment_outcome, NEW.trading_status, NEW.is_cancelled, NEW.bidding_status);
    IF (TG_OP = 'UPDATE') THEN
        v_from := public.get_shift_fsm_state(OLD.lifecycle_status, OLD.assignment_status, OLD.assignment_outcome, OLD.trading_status, OLD.is_cancelled, OLD.bidding_status);
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.assigned_employee_id IS NOT NULL AND OLD.assigned_employee_id IS NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, actor_role)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ASSIGNED', COALESCE(NEW.assigned_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to)
                      || CASE WHEN v_auto THEN jsonb_build_object('source', 'autoscheduler') ELSE '{}'::jsonb END,
                    CASE WHEN v_auto THEN 'autoscheduler' ELSE NULL END);
        ELSIF (NEW.assigned_employee_id IS NULL AND OLD.assigned_employee_id IS NOT NULL AND NOT v_drop) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, OLD.assigned_employee_id, 'UNASSIGNED', now(),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    ELSIF (TG_OP = 'INSERT') THEN
        IF (NEW.assigned_employee_id IS NOT NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, actor_role)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ASSIGNED', COALESCE(NEW.assigned_at, now()),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to)
                      || CASE WHEN v_auto THEN jsonb_build_object('source', 'autoscheduler') ELSE '{}'::jsonb END,
                    CASE WHEN v_auto THEN 'autoscheduler' ELSE NULL END);
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.fulfillment_status = 'offered' AND OLD.fulfillment_status IS DISTINCT FROM 'offered') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'OFFERED', now(),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.assignment_outcome = 'confirmed' AND OLD.assignment_outcome IS DISTINCT FROM 'confirmed') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ACCEPTED', now(),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        ELSIF (NEW.assignment_outcome = 'emergency_assigned' AND OLD.assignment_outcome IS DISTINCT FROM 'emergency_assigned') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata)
            VALUES (NEW.id, NEW.assigned_employee_id, 'EMERGENCY_ASSIGNED', now(),
                    jsonb_build_object('from_state', v_from, 'to_state', v_to));
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Cancelled' AND OLD.lifecycle_status IS DISTINCT FROM 'Cancelled') THEN
            -- A cancellation is always the manager's or the system's act, never the
            -- employee's: it is logged as OP_APPLIED 'cancel', not CANCELLED /
            -- LATE_CANCELLED, so it never counts against the assignee (B-D10, B-D15).
            -- An employee's own drop is logged by sm_employee_drop_shift.
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', clock_timestamp(),
                jsonb_build_object('op', 'cancel', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event')
                  || CASE WHEN NEW.kickoff_cancel_code IS NOT NULL
                          THEN jsonb_build_object('reason_code', NEW.kickoff_cancel_code)
                          ELSE jsonb_build_object('note', NEW.last_modified_reason) END,
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END, 'lifecycle')
            ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Published' AND OLD.lifecycle_status IS DISTINCT FROM 'Published'
            AND NOT (NEW.assignment_outcome = 'emergency_assigned'
                     AND OLD.assignment_outcome IS DISTINCT FROM NEW.assignment_outcome)) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', clock_timestamp(),
                jsonb_build_object('op', 'publish', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event'),
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END, 'lifecycle')
            ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Completed' AND OLD.lifecycle_status IS DISTINCT FROM 'Completed') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, 'OP_APPLIED', clock_timestamp(),
                jsonb_build_object(
                    'op', 'complete',
                    'domain', 'lifecycle',
                    'from_state', v_from,
                    'to_state',   v_to,
                    'source', 'fn_capture_shift_event'
                ),
                'lifecycle')
            ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'InProgress' AND OLD.lifecycle_status IS DISTINCT FROM 'InProgress') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', clock_timestamp(),
                jsonb_build_object('op', 'in_progress', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event'),
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'employee' END, 'lifecycle')
            ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
        END IF;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Draft' AND OLD.lifecycle_status = 'Published') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
            VALUES (NEW.id, NEW.assigned_employee_id, v_actor, 'OP_APPLIED', clock_timestamp(),
                jsonb_build_object('op', 'unpublish', 'domain', 'lifecycle',
                                   'from_state', v_from, 'to_state', v_to,
                                   'source', 'fn_capture_shift_event')
                  || CASE WHEN NEW.last_modified_reason IS NOT NULL
                          AND NEW.last_modified_reason IS DISTINCT FROM OLD.last_modified_reason
                          THEN jsonb_build_object('reason', NEW.last_modified_reason)
                          ELSE '{}'::jsonb END,
                CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END, 'lifecycle')
            ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

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
    -- the same rules as sm_bulk_publish_shifts: nothing publishes once started,
    -- and full-time shifts are confirmed directly, never offered or bid on
    IF COALESCE(v_cur.start_at, (v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp AT TIME ZONE COALESCE(v_cur.timezone, 'Australia/Sydney')) <= now() THEN
      RETURN jsonb_build_object('applied', false, 'note', 'SHIFT_STARTED');
    END IF;
    IF v_cur.target_employment_type = 'FT' AND v_cur.assigned_employee_id IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'note', 'FT_NEEDS_ASSIGNEE');
    END IF;

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

      IF v_cur.target_employment_type = 'FT' THEN
        UPDATE public.shifts SET
          lifecycle_status   = 'Published'::public.shift_lifecycle,
          fulfillment_status = 'scheduled'::public.shift_fulfillment_status,
          assignment_outcome = 'confirmed'::public.shift_assignment_outcome,
          offer_expires_at   = NULL,
          bidding_status     = 'not_on_bidding'::public.shift_bidding_status,
          published_at       = NOW(),
          last_modified_by   = p_actor,
          updated_at         = NOW()
        WHERE id = p_shift_id;
        RETURN jsonb_build_object('applied', true);
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
    -- see sm_unpublish_shift: no unpublish once the shift has started
    IF COALESCE(v_cur.start_at, (v_cur.shift_date::text || ' ' || v_cur.start_time::text)::timestamp AT TIME ZONE COALESCE(v_cur.timezone, 'Australia/Sydney')) <= now() THEN
      RETURN jsonb_build_object('applied', false, 'note', 'SHIFT_STARTED');
    END IF;

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

CREATE OR REPLACE FUNCTION public.sm_employee_drop_shift(p_shift_id uuid, p_employee_id uuid DEFAULT auth.uid(), p_reason text DEFAULT NULL::text, p_reason_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_shift          RECORD;
    v_state          text;
    v_reason         public.cancellation_reasons%ROWTYPE;
    v_notice         interval;
    v_notice_hours   numeric;
    v_is_critical    boolean;
    v_urgency        text;
    v_event_type     public.shift_event_type;
    -- Standard vs critical (late) cancellation, and the urgent lane (B-D3).
    v_cancel_cutoff  constant interval := interval '24 hours';
BEGIN
  -- authz guard (20261005 rpc guards): reject callers without authority before any work
  PERFORM public.sm_require_assignee_or(p_shift_id, p_employee_id, 'shift.assign');
    SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
    END IF;

    IF v_shift.assigned_employee_id IS DISTINCT FROM p_employee_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You are not assigned to this shift');
    END IF;

    v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status,
                                          v_shift.assignment_outcome, v_shift.trading_status,
                                          v_shift.is_cancelled);

    -- S4 only: an unanswered offer (S3) is rejected, which costs the employee
    -- nothing; dropping it logged a cancellation against them
    IF v_state <> 'S4' THEN
        RETURN jsonb_build_object('success', false, 'code', 'ILLEGAL_STATE',
            'error', format('sm_employee_drop_shift requires state S4, current state is %s', v_state));
    END IF;

    IF COALESCE(v_shift.start_at, (v_shift.shift_date::text || ' ' || v_shift.start_time::text)::timestamp AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney')) <= now() THEN
        RETURN jsonb_build_object('success', false, 'code', 'SHIFT_STARTED',
            'error', 'This shift has already started and cannot be dropped');
    END IF;

    IF public.shift_is_held(p_shift_id) THEN
        RETURN jsonb_build_object('success', false, 'code', 'TRADE_IN_PROGRESS',
            'error', 'This shift is offered in a trade — withdraw the offer before dropping it');
    END IF;

    IF p_reason_code IS NOT NULL THEN
        SELECT * INTO v_reason
        FROM public.cancellation_reasons
        WHERE code = p_reason_code AND is_active;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false,
                'error', format('Unknown cancellation reason: %s', p_reason_code));
        END IF;

        IF v_reason.requires_note AND COALESCE(btrim(p_reason), '') = '' THEN
            RETURN jsonb_build_object('success', false,
                'error', format('Reason "%s" requires a note', v_reason.label));
        END IF;
    END IF;

    v_notice       := v_shift.start_at - now();
    v_notice_hours := ROUND(EXTRACT(epoch FROM v_notice)::numeric / 3600, 2);
    v_is_critical  := v_shift.start_at IS NOT NULL AND v_notice <= v_cancel_cutoff;
    v_urgency      := CASE
                          WHEN v_shift.start_at IS NULL             THEN 'normal'
                          WHEN v_notice <= v_cancel_cutoff          THEN 'urgent'
                          ELSE 'normal'
                      END;
    v_event_type   := CASE WHEN v_is_critical THEN 'LATE_CANCELLED' ELSE 'CANCELLED' END::public.shift_event_type;

    PERFORM set_config('app.audit.employee_drop', '1', true);

    UPDATE public.shifts SET
        assigned_employee_id = NULL,
        assigned_at          = NULL,
        assignment_status    = 'unassigned'::public.shift_assignment_status,
        assignment_outcome   = NULL,
        bidding_status       = 'on_bidding'::public.shift_bidding_status,
        fulfillment_status   = 'bidding'::public.shift_fulfillment_status,
        last_dropped_by      = p_employee_id,
        last_rejected_by     = NULL,
        last_modified_by     = p_employee_id,
        updated_at           = NOW()
    WHERE id = p_shift_id;

    PERFORM set_config('app.audit.employee_drop', '0', true);

    INSERT INTO public.shift_events
        (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
    VALUES (
        p_shift_id,
        p_employee_id,
        p_employee_id,
        v_event_type,
        now(),
        jsonb_build_object(
            'op',           'employee_drop',
            'from_state',   v_state,
            'to_state',     'S5',
            'cancellation', CASE WHEN v_is_critical THEN 'critical' ELSE 'standard' END,
            'urgency',      v_urgency,
            'notice_hours', v_notice_hours,
            'source',       'sm_employee_drop_shift'
        )
        || CASE WHEN p_reason_code IS NOT NULL
                THEN jsonb_build_object('reason_code', p_reason_code) ELSE '{}'::jsonb END
        || CASE WHEN COALESCE(btrim(p_reason), '') <> ''
                THEN jsonb_build_object('reason_note', btrim(p_reason)) ELSE '{}'::jsonb END,
        'employee',
        'assignment'
    )
    ON CONFLICT ON CONSTRAINT uniq_shift_event DO NOTHING;

    RETURN jsonb_build_object(
        'success',      true,
        'from_state',   v_state,
        'to_state',     'S5',
        'cancellation', CASE WHEN v_is_critical THEN 'critical' ELSE 'standard' END,
        'urgency',      v_urgency,
        'notice_hours', v_notice_hours
    );
END;
$function$;

ALTER POLICY shifts_delete_rbac ON public.shifts
  USING (lifecycle_status = 'Draft'
         AND user_has_action_in_scope('shift.delete'::text, organization_id, department_id, sub_department_id));

REVOKE ALL ON FUNCTION public.sm_cancel_shift(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sm_cancel_shift(uuid, text, integer) TO authenticated;
