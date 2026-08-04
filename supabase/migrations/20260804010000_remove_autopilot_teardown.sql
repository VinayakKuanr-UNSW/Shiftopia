-- ============================================================================
-- TEARDOWN — remove the AutoPilot auto-decision system entirely (Bids + Swaps +
-- Timesheets). "Change of plans": the autonomous ON/OFF workers, RDT ownership
-- engine, per-org policies, queues, decision logs and enqueue triggers are all
-- removed.
--
-- KEPT (must not break):
--   * sm_apply_shift_op  — restored to its exact pre-guard body (the AutoPilot
--     ownership guard block is removed; the gateway is otherwise unchanged).
--   * sm_select_bid_winner, manual "Review Bids -> pick winner", manual swap
--     approve/reject, and the interactive "Run Batch" auto-assign path.
--   * timesheet_audit_log + fn_timesheet_provenance / trg_timesheet_provenance
--     (the timesheet lifecycle audit — records manual approvals/edits, keeps).
--
-- Idempotent (IF EXISTS throughout). The crons + policies were already
-- unscheduled / disabled before this ran. Verified drop-safe: every enum below is
-- used only by a dropped table; the interactive auto-assign + provenance audit do
-- not reference any dropped object.
-- ============================================================================

-- ── 1) Restore sm_apply_shift_op WITHOUT the AutoPilot ownership guard ────────
CREATE OR REPLACE FUNCTION public.sm_apply_shift_op(p_shift_id uuid, p_expected_version integer, p_op text, p_payload jsonb DEFAULT '{}'::jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller     uuid := auth.uid();
  v_pre        RECORD;
  v_cur        RECORD;
  v_state      text;
  v_to_state   text;
  v_write      jsonb;
  v_event      public.shift_event_type;
  v_actor_role text;
  v_domain     text;
  v_changes    jsonb := '{}'::jsonb;
BEGIN
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

  SELECT * INTO v_pre
  FROM public.shifts
  WHERE id = p_shift_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'GONE');
  END IF;

  IF p_idempotency_key IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.shift_events e
       WHERE e.shift_id = p_shift_id
         AND e.metadata->>'idem' = p_idempotency_key::text
     ) THEN
    RETURN jsonb_build_object(
      'ok', true, 'code', 'IDEMPOTENT_REPLAY', 'version', v_pre.version
    );
  END IF;

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

  PERFORM set_config('app.audit.via_gateway', '1', true);
  v_write := public._apply_shift_op_write(p_shift_id, p_op, p_payload, v_caller);
  PERFORM set_config('app.audit.via_gateway', '0', true);

  SELECT * INTO v_cur FROM public.shifts WHERE id = p_shift_id;

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

  v_to_state := public.get_shift_fsm_state(
    v_cur.lifecycle_status, v_cur.assignment_status, v_cur.assignment_outcome,
    v_cur.trading_status, v_cur.is_cancelled, v_cur.bidding_status);

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
    IF v_pre.remuneration_level IS DISTINCT FROM v_cur.remuneration_level THEN
      v_changes := v_changes || jsonb_build_object('remuneration_level',
        jsonb_build_object('old', to_jsonb(v_pre.remuneration_level), 'new', to_jsonb(v_cur.remuneration_level)));
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
    IF v_pre.required_skills IS DISTINCT FROM v_cur.required_skills THEN
      v_changes := v_changes || jsonb_build_object('required_skills',
        jsonb_build_object('old', to_jsonb(v_pre.required_skills), 'new', to_jsonb(v_cur.required_skills)));
    END IF;
    IF v_pre.required_licenses IS DISTINCT FROM v_cur.required_licenses THEN
      v_changes := v_changes || jsonb_build_object('required_licenses',
        jsonb_build_object('old', to_jsonb(v_pre.required_licenses), 'new', to_jsonb(v_cur.required_licenses)));
    END IF;
    IF v_pre.event_ids IS DISTINCT FROM v_cur.event_ids THEN
      v_changes := v_changes || jsonb_build_object('event_ids',
        jsonb_build_object('old', to_jsonb(v_pre.event_ids), 'new', to_jsonb(v_cur.event_ids)));
    END IF;
    IF v_pre.assigned_employee_id IS DISTINCT FROM v_cur.assigned_employee_id THEN
      v_changes := v_changes || jsonb_build_object('assignment',
        jsonb_build_object('old', to_jsonb(v_pre.assigned_employee_id), 'new', to_jsonb(v_cur.assigned_employee_id)));
    END IF;
  END IF;

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
                ELSE 'lifecycle'
              END;

  v_event := CASE
               WHEN p_op = 'assign'        THEN 'ASSIGNED'
               WHEN p_op = 'select_winner' THEN 'ASSIGNED'
               WHEN p_op = 'unpublish'     THEN 'UNASSIGNED'
               WHEN p_op = 'delete' AND v_cur.assigned_employee_id IS NOT NULL
                                           THEN 'CANCELLED'
               ELSE 'OP_APPLIED'
             END::public.shift_event_type;

  INSERT INTO public.shift_events (
    shift_id, employee_id, actor_id, event_type, metadata,
    actor_role, domain, shift_version, idempotency_key
  )
  VALUES (
    p_shift_id,
    v_cur.assigned_employee_id,
    v_caller,
    v_event,
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

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'APPLIED',
    'version', v_cur.version,
    'state', v_to_state
  );

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error in sm_apply_shift_op (shift=%, op=%): %', p_shift_id, p_op, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END;
$function$;

-- ── 2) Drop enqueue triggers on core tables ─────────────────────────────────
DROP TRIGGER IF EXISTS trg_enqueue_bid_on_bid          ON public.shift_bids;
DROP TRIGGER IF EXISTS trg_enqueue_bid_auto_assign     ON public.shifts;
DROP TRIGGER IF EXISTS trg_enqueue_swap_auto_decision  ON public.shift_swaps;
DROP TRIGGER IF EXISTS trg_enqueue_timesheet_auto_verify ON public.shifts;

-- ── 3) Drop views ───────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.autopilot_queue_status_v;
DROP VIEW IF EXISTS public.autopilot_bid_enqueue_gap_v;

-- ── 4) Drop consumer functions (enqueue fns, queue RPCs, decide/revert, sweep) ─
DROP FUNCTION IF EXISTS public.enqueue_bid_auto_assign();
DROP FUNCTION IF EXISTS public.enqueue_bid_auto_assign_on_bid();
DROP FUNCTION IF EXISTS public.enqueue_swap_auto_decision();
DROP FUNCTION IF EXISTS public.enqueue_timesheet_auto_verify();
DROP FUNCTION IF EXISTS public.sm_bid_queue_claim(text, integer);
DROP FUNCTION IF EXISTS public.sm_bid_queue_complete(uuid, text, text);
DROP FUNCTION IF EXISTS public.sm_bid_auto_decide(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.sm_bid_auto_revert(uuid, uuid);
DROP FUNCTION IF EXISTS public.sm_swap_queue_claim(text, integer);
DROP FUNCTION IF EXISTS public.sm_swap_queue_complete(uuid, text, text);
DROP FUNCTION IF EXISTS public.sm_swap_auto_decide(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.sm_swap_auto_revert(uuid, uuid);
DROP FUNCTION IF EXISTS public.sm_timesheet_queue_claim(text, integer);
DROP FUNCTION IF EXISTS public.sm_timesheet_queue_complete(uuid, text, text);
DROP FUNCTION IF EXISTS public.sm_timesheet_auto_decide(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.sm_timesheet_auto_revert(uuid, uuid);
DROP FUNCTION IF EXISTS public.autopilot_return_stale_ownership();

-- ── 5) Drop helper functions ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.autopilot_bid_rdt(uuid);
DROP FUNCTION IF EXISTS public.autopilot_swap_rdt(uuid);
DROP FUNCTION IF EXISTS public.autopilot_queue_disposition(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.autopilot_shift_start_ts(uuid);
DROP FUNCTION IF EXISTS public.autopilot_next_window_open_after(timestamptz);
DROP FUNCTION IF EXISTS public.is_autopilot_window_open(timestamptz);
DROP FUNCTION IF EXISTS public.is_timesheet_autopilot_active(uuid, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.autopilot_heartbeat_ping(text, text);

-- ── 6) Drop tables (CASCADE clears intra-cluster FKs). KEEP timesheet_audit_log. ─
DROP TABLE IF EXISTS public.bid_review_queue        CASCADE;
DROP TABLE IF EXISTS public.bid_decisions           CASCADE;
DROP TABLE IF EXISTS public.bid_audit_log           CASCADE;
DROP TABLE IF EXISTS public.bid_approval_rules      CASCADE;
DROP TABLE IF EXISTS public.swap_review_queue       CASCADE;
DROP TABLE IF EXISTS public.swap_decisions          CASCADE;
DROP TABLE IF EXISTS public.swap_audit_log          CASCADE;
DROP TABLE IF EXISTS public.swap_approval_rules     CASCADE;
DROP TABLE IF EXISTS public.timesheet_review_queue  CASCADE;
DROP TABLE IF EXISTS public.timesheet_decisions     CASCADE;
DROP TABLE IF EXISTS public.timesheet_approval_rules CASCADE;
DROP TABLE IF EXISTS public.autopilot_worker_heartbeat CASCADE;

-- ── 7) Drop enums (now unreferenced) ────────────────────────────────────────
DROP TYPE IF EXISTS public.autopilot_decision_kind;
DROP TYPE IF EXISTS public.autopilot_owner;
DROP TYPE IF EXISTS public.autopilot_queue_status;
DROP TYPE IF EXISTS public.swap_queue_status;
