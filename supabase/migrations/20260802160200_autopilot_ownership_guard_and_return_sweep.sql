-- ============================================================================
-- AutoPilot RDT engine — wire it in: enqueue stamps RDT, claim schedules by RDT
-- + atomically takes ownership, the gateway enforces the strict ownership lock,
-- and a sweep returns stale/undeliverable items to managers.
--
-- Depends on 20260802160000 (helpers + columns) and 20260802160050 (RETURNED).
-- All behaviour remains gated by the per-org `enabled` policy (unchanged), so no
-- org sees a difference until it has opted AutoPilot ON.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ENQUEUE — stamp RDT at insert (owner defaults MANAGER).
-- ─────────────────────────────────────────────────────────────────────────────

-- Bids (rewrites 20260802140200's trigger fn; predicate unchanged).
CREATE OR REPLACE FUNCTION public.enqueue_bid_auto_assign() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_pol_ver int;
  v_enabled boolean;
  v_idem text;
BEGIN
  IF NOT (NEW.bidding_status = 'bidding_closed_no_winner'
          AND OLD.bidding_status IS DISTINCT FROM NEW.bidding_status
          AND NEW.assignment_status = 'unassigned') THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.shift_bids WHERE shift_id = NEW.id AND status = 'pending') THEN
    RETURN NEW;
  END IF;

  SELECT version, enabled INTO v_pol_ver, v_enabled
  FROM public.bid_approval_rules
  WHERE organization_id = NEW.organization_id
    AND (department_id = NEW.department_id OR department_id IS NULL)
  ORDER BY department_id NULLS LAST
  LIMIT 1;

  IF v_pol_ver IS NULL OR v_enabled IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_idem := encode(
    extensions.digest(
      NEW.id::text || ':' || COALESCE(NEW.version, 0)::text || ':' ||
      NEW.bidding_status::text || ':' || v_pol_ver::text, 'sha256'), 'hex');

  INSERT INTO public.bid_review_queue (shift_id, idempotency_key, rdt)
  VALUES (NEW.id, v_idem, public.autopilot_bid_rdt(NEW.id))
  ON CONFLICT (shift_id, idempotency_key) DO NOTHING;

  INSERT INTO public.bid_audit_log (shift_id, event_type, actor, detail)
  VALUES (NEW.id, 'ENQUEUED', 'system',
          jsonb_build_object('idempotency_key', v_idem, 'policy_version', v_pol_ver,
                             'rdt', public.autopilot_bid_rdt(NEW.id)));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'enqueue_bid_auto_assign swallowed error (shift=%): %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

-- Swaps (rewrites baseline's trigger fn; predicate unchanged).
CREATE OR REPLACE FUNCTION public.enqueue_swap_auto_decision() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_req_ver int; v_off_ver int; v_org uuid; v_dept uuid;
  v_pol_ver int; v_enabled boolean; v_idem text;
BEGIN
  IF NEW.status <> 'MANAGER_PENDING'
     OR (TG_OP='UPDATE' AND OLD.status='MANAGER_PENDING') THEN
    RETURN NEW;
  END IF;

  SELECT version, organization_id, department_id
    INTO v_req_ver, v_org, v_dept
  FROM public.shifts WHERE id = NEW.requester_shift_id;

  SELECT version, enabled INTO v_pol_ver, v_enabled
  FROM public.swap_approval_rules
  WHERE organization_id = v_org
    AND (department_id = v_dept OR department_id IS NULL)
  ORDER BY department_id NULLS LAST
  LIMIT 1;

  IF v_pol_ver IS NULL OR v_enabled IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.target_shift_id IS NOT NULL THEN
    SELECT version INTO v_off_ver FROM public.shifts WHERE id = NEW.target_shift_id;
  ELSE
    v_off_ver := 0;
  END IF;

  v_idem := encode(
    extensions.digest(NEW.id::text || ':' || COALESCE(v_req_ver,0)::text || ':' ||
           COALESCE(v_off_ver,0)::text || ':' || v_pol_ver::text, 'sha256'), 'hex');

  INSERT INTO public.swap_review_queue (swap_id, idempotency_key, rdt)
  VALUES (NEW.id, v_idem, public.autopilot_swap_rdt(NEW.id))
  ON CONFLICT (swap_id, idempotency_key) DO NOTHING;

  INSERT INTO public.swap_audit_log (swap_id, event_type, actor, detail)
  VALUES (NEW.id, 'ENQUEUED', 'system',
          jsonb_build_object('idempotency_key', v_idem, 'policy_version', v_pol_ver,
                             'rdt', public.autopilot_swap_rdt(NEW.id)));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'enqueue_swap_auto_decision swallowed error (swap=%): %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CLAIM — only ACT_NOW items, soonest-RDT first, atomic MANAGER→AUTOPILOT flip.
--    The single UPDATE ... RETURNING is the atomic ownership acquisition: a
--    concurrent manual manager action reads the committed `owner` (and version-CAS
--    remains the hard correctness guard downstream).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sm_bid_queue_claim(p_worker text, p_limit integer DEFAULT 10)
    RETURNS SETOF public.bid_review_queue
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
BEGIN
  RETURN QUERY
  UPDATE public.bid_review_queue q
     SET status = 'CLAIMED', locked_by = p_worker, locked_at = now(),
         owner = 'AUTOPILOT', owner_since = now(),
         rdt = public.autopilot_bid_rdt(q.shift_id),
         attempts = q.attempts + 1, updated_at = now()
   WHERE q.id IN (
     SELECT bq.id FROM public.bid_review_queue bq
      WHERE (
              (bq.status = 'PENDING' AND bq.next_attempt_at <= now())
              OR (bq.status = 'CLAIMED' AND bq.locked_at < now() - interval '5 minutes')
            )
        AND public.autopilot_queue_disposition(public.autopilot_bid_rdt(bq.shift_id), now()) = 'ACT_NOW'
      ORDER BY public.autopilot_bid_rdt(bq.shift_id) ASC NULLS LAST, bq.next_attempt_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT GREATEST(p_limit, 0)
   )
  RETURNING q.*;
END; $$;

CREATE OR REPLACE FUNCTION public.sm_swap_queue_claim(p_worker text, p_limit integer DEFAULT 10)
    RETURNS SETOF public.swap_review_queue
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
BEGIN
  RETURN QUERY
  UPDATE public.swap_review_queue q
     SET status = 'CLAIMED', locked_by = p_worker, locked_at = now(),
         owner = 'AUTOPILOT', owner_since = now(),
         rdt = public.autopilot_swap_rdt(q.swap_id),
         attempts = q.attempts + 1, updated_at = now()
   WHERE q.id IN (
     SELECT sq.id FROM public.swap_review_queue sq
      WHERE (
              (sq.status = 'PENDING' AND sq.next_attempt_at <= now())
              OR (sq.status = 'CLAIMED' AND sq.locked_at < now() - interval '5 minutes')
            )
        AND public.autopilot_queue_disposition(public.autopilot_swap_rdt(sq.swap_id), now()) = 'ACT_NOW'
      ORDER BY public.autopilot_swap_rdt(sq.swap_id) ASC NULLS LAST, sq.next_attempt_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT GREATEST(p_limit, 0)
   )
  RETURNING q.*;
END; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. COMPLETE — a row that reaches the DLQ returns ownership to the manager so
--    they immediately regain control (a RETRY keeps owner=AUTOPILOT: the bot
--    still owns the in-flight attempt).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sm_bid_queue_complete(p_id uuid, p_status text, p_error text DEFAULT NULL)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_row public.bid_review_queue%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.bid_review_queue WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

  IF p_status = 'DONE' THEN
    UPDATE public.bid_review_queue SET status = 'DONE', last_error = NULL, updated_at = now() WHERE id = p_id;
  ELSIF v_row.attempts >= v_row.max_attempts THEN
    UPDATE public.bid_review_queue
       SET status = 'DLQ', last_error = p_error, owner = 'MANAGER', returned_reason = 'dlq', updated_at = now()
     WHERE id = p_id;
  ELSE
    UPDATE public.bid_review_queue
       SET status = 'PENDING', last_error = p_error, locked_by = NULL, locked_at = NULL,
           next_attempt_at = now() + (interval '1 minute' * power(2, LEAST(v_row.attempts, 6))),
           updated_at = now()
     WHERE id = p_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'code', 'SETTLED');
END; $$;

CREATE OR REPLACE FUNCTION public.sm_swap_queue_complete(p_id uuid, p_status text, p_error text DEFAULT NULL)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_row public.swap_review_queue%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.swap_review_queue WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

  IF p_status = 'DONE' THEN
    UPDATE public.swap_review_queue
       SET status='DONE', last_error=p_error, locked_by=NULL, locked_at=NULL, updated_at=now()
     WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'code', 'DONE');

  ELSIF p_status = 'RETRY' THEN
    IF v_row.attempts >= v_row.max_attempts THEN
      UPDATE public.swap_review_queue
         SET status='DLQ', last_error=p_error, owner='MANAGER', returned_reason='dlq',
             locked_by=NULL, locked_at=NULL, updated_at=now()
       WHERE id = p_id;
      RETURN jsonb_build_object('ok', true, 'code', 'DLQ');
    END IF;
    UPDATE public.swap_review_queue
       SET status='PENDING', last_error=p_error, locked_by=NULL, locked_at=NULL,
           next_attempt_at = now() + make_interval(mins => LEAST(POWER(2, v_row.attempts)::int, 60)),
           updated_at=now()
     WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'code', 'RETRY_SCHEDULED');

  ELSIF p_status = 'DLQ' THEN
    UPDATE public.swap_review_queue
       SET status='DLQ', last_error=p_error, owner='MANAGER', returned_reason='dlq',
           locked_by=NULL, locked_at=NULL, updated_at=now()
     WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'code', 'DLQ');
  END IF;

  RETURN jsonb_build_object('ok', false, 'code', 'BAD_STATUS');
END; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. GATEWAY OWNERSHIP GUARD — strict lock in the sm_apply_shift_op wrapper.
--    Reproduces the baseline wrapper VERBATIM (only defined in the baseline) and
--    inserts the guard right after the FORBIDDEN check. A human (auth.uid() NOT
--    NULL) cannot manually resolve an item the bot has taken; the bot runs with
--    auth.uid()=NULL (service role) and is unaffected. version-CAS below is still
--    the hard correctness guard — this is the deterministic UI-facing refusal.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sm_apply_shift_op(
    p_shift_id uuid, p_expected_version integer, p_op text,
    p_payload jsonb DEFAULT '{}'::jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
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

  -- ── AutoPilot strict ownership lock ────────────────────────────────────────
  -- Only a human is blocked; only for the three ops a manager uses to resolve a
  -- swap / bid; only while the bot actively owns the item (owner=AUTOPILOT and
  -- the queue row is still in-flight). Otherwise fall through unchanged.
  IF v_caller IS NOT NULL AND p_op IN ('approve_trade', 'reject_trade') THEN
    IF EXISTS (
      SELECT 1 FROM public.swap_review_queue q
       WHERE q.swap_id = NULLIF(p_payload->>'swap_id', '')::uuid
         AND q.owner = 'AUTOPILOT'
         AND q.status IN ('CLAIMED', 'PENDING')
    ) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'AUTO_OWNER_ACTIVE',
                                'note', 'AutoPilot is resolving this swap.');
    END IF;
  ELSIF v_caller IS NOT NULL AND p_op = 'select_winner' THEN
    IF EXISTS (
      SELECT 1 FROM public.bid_review_queue q
       WHERE q.shift_id = p_shift_id
         AND q.owner = 'AUTOPILOT'
         AND q.status IN ('CLAIMED', 'PENDING')
    ) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'AUTO_OWNER_ACTIVE',
                                'note', 'AutoPilot is resolving this shift.');
    END IF;
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
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RETURN-TO-MANAGER SWEEP — runs day AND night on its own cron.
--    (a) deadline passed unresolved; (b) daytime-unreachable (bot off, RDT before
--    next 18:00); (c) worker-down (claimed, lease expired, heartbeat stale).
--    Each transition audits a RETURNED_TO_MANAGER event (the dashboard feed).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.autopilot_return_stale_ownership()
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_bids_down  boolean;
  v_swaps_down boolean;
  v_total int := 0; v_n int;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('job_autopilot_return_stale_ownership')) THEN
    RETURN jsonb_build_object('ok', true, 'code', 'SKIPPED_LOCKED');
  END IF;

  SELECT COALESCE(last_ok_at, 'epoch'::timestamptz) < now() - interval '10 minutes'
    INTO v_bids_down  FROM public.autopilot_worker_heartbeat WHERE domain = 'bids';
  v_bids_down := COALESCE(v_bids_down, true);
  SELECT COALESCE(last_ok_at, 'epoch'::timestamptz) < now() - interval '10 minutes'
    INTO v_swaps_down FROM public.autopilot_worker_heartbeat WHERE domain = 'swaps';
  v_swaps_down := COALESCE(v_swaps_down, true);

  -- ===== BIDS =====
  -- (a) deadline passed while still queued/claimed.
  WITH r AS (
    UPDATE public.bid_review_queue q
       SET status='RETURNED', owner='MANAGER', returned_reason='rdt_passed',
           locked_by=NULL, locked_at=NULL, updated_at=now()
     WHERE q.status IN ('PENDING','CLAIMED')
       AND public.autopilot_bid_rdt(q.shift_id) <= now()
     RETURNING q.shift_id),
  a AS (
    INSERT INTO public.bid_audit_log (shift_id, event_type, actor, detail)
    SELECT shift_id, 'RETURNED_TO_MANAGER', 'system', jsonb_build_object('reason','rdt_passed') FROM r
    RETURNING 1)
  SELECT count(*) INTO v_n FROM r; v_total := v_total + v_n;

  -- (b) daytime-unreachable (bot cannot act before RDT).
  WITH r AS (
    UPDATE public.bid_review_queue q
       SET status='RETURNED', owner='MANAGER', returned_reason='rdt_in_daytime',
           locked_by=NULL, locked_at=NULL, updated_at=now()
     WHERE q.status = 'PENDING'
       AND public.autopilot_queue_disposition(public.autopilot_bid_rdt(q.shift_id), now()) = 'RETURN_TO_MANAGER'
     RETURNING q.shift_id),
  a AS (
    INSERT INTO public.bid_audit_log (shift_id, event_type, actor, detail)
    SELECT shift_id, 'RETURNED_TO_MANAGER', 'system', jsonb_build_object('reason','rdt_in_daytime') FROM r
    RETURNING 1)
  SELECT count(*) INTO v_n FROM r; v_total := v_total + v_n;

  -- (c) worker-down: bot-owned, lease expired, heartbeat stale.
  IF v_bids_down THEN
    WITH r AS (
      UPDATE public.bid_review_queue q
         SET status='RETURNED', owner='MANAGER', returned_reason='worker_unavailable',
             locked_by=NULL, locked_at=NULL, updated_at=now()
       WHERE q.status='CLAIMED' AND q.owner='AUTOPILOT'
         AND q.locked_at < now() - interval '5 minutes'
       RETURNING q.shift_id),
    a AS (
      INSERT INTO public.bid_audit_log (shift_id, event_type, actor, detail)
      SELECT shift_id, 'RETURNED_TO_MANAGER', 'system', jsonb_build_object('reason','worker_unavailable') FROM r
      RETURNING 1)
    SELECT count(*) INTO v_n FROM r; v_total := v_total + v_n;
  END IF;

  -- ===== SWAPS =====
  WITH r AS (
    UPDATE public.swap_review_queue q
       SET status='RETURNED', owner='MANAGER', returned_reason='rdt_passed',
           locked_by=NULL, locked_at=NULL, updated_at=now()
     WHERE q.status IN ('PENDING','CLAIMED')
       AND public.autopilot_swap_rdt(q.swap_id) <= now()
     RETURNING q.swap_id),
  a AS (
    INSERT INTO public.swap_audit_log (swap_id, event_type, actor, detail)
    SELECT swap_id, 'RETURNED_TO_MANAGER', 'system', jsonb_build_object('reason','rdt_passed') FROM r
    RETURNING 1)
  SELECT count(*) INTO v_n FROM r; v_total := v_total + v_n;

  WITH r AS (
    UPDATE public.swap_review_queue q
       SET status='RETURNED', owner='MANAGER', returned_reason='rdt_in_daytime',
           locked_by=NULL, locked_at=NULL, updated_at=now()
     WHERE q.status = 'PENDING'
       AND public.autopilot_queue_disposition(public.autopilot_swap_rdt(q.swap_id), now()) = 'RETURN_TO_MANAGER'
     RETURNING q.swap_id),
  a AS (
    INSERT INTO public.swap_audit_log (swap_id, event_type, actor, detail)
    SELECT swap_id, 'RETURNED_TO_MANAGER', 'system', jsonb_build_object('reason','rdt_in_daytime') FROM r
    RETURNING 1)
  SELECT count(*) INTO v_n FROM r; v_total := v_total + v_n;

  IF v_swaps_down THEN
    WITH r AS (
      UPDATE public.swap_review_queue q
         SET status='RETURNED', owner='MANAGER', returned_reason='worker_unavailable',
             locked_by=NULL, locked_at=NULL, updated_at=now()
       WHERE q.status='CLAIMED' AND q.owner='AUTOPILOT'
         AND q.locked_at < now() - interval '5 minutes'
       RETURNING q.swap_id),
    a AS (
      INSERT INTO public.swap_audit_log (swap_id, event_type, actor, detail)
      SELECT swap_id, 'RETURNED_TO_MANAGER', 'system', jsonb_build_object('reason','worker_unavailable') FROM r
      RETURNING 1)
    SELECT count(*) INTO v_n FROM r; v_total := v_total + v_n;
  END IF;

  RETURN jsonb_build_object('ok', true, 'code', 'SWEPT', 'returned', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.autopilot_return_stale_ownership() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.autopilot_return_stale_ownership() TO service_role;

COMMENT ON FUNCTION public.autopilot_return_stale_ownership() IS
  'AutoPilot RDT engine sweep: returns bot-owned queue items to managers on deadline-passed, daytime-unreachable RDT, or worker-down. Idempotent; single-execution advisory lock. Cron every 5 min.';

-- ── Schedule the sweep (day + night; the worker only runs overnight). ────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autopilot_return_stale_ownership') THEN
    PERFORM cron.unschedule('autopilot_return_stale_ownership');
  END IF;
  PERFORM cron.schedule('autopilot_return_stale_ownership', '*/5 * * * *',
                        'SELECT public.autopilot_return_stale_ownership()');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'autopilot_return_stale_ownership cron not scheduled (pg_cron unavailable?): %', SQLERRM;
END $$;
