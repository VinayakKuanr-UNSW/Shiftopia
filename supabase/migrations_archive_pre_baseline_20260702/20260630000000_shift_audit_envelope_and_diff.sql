-- =============================================================================
-- Shift Audit System — write-path: envelope population + edit-diff + trigger
-- de-dup, on the EXISTING immutable public.shift_events ledger.
-- =============================================================================
--
-- This migration turns the gateway's single audit INSERT into a FULL audit
-- envelope and makes it the *sole* writer for gateway-driven ops, so analytics
-- (Agent B's KPI RPCs) can read provenance directly off shift_events without
-- re-deriving it. No new tables — shift_events is the ledger.
--
-- Three coordinated changes, all forward-only / CREATE OR REPLACE / idempotent:
--
--   1. EDIT-DIFF CAPTURE — sm_apply_shift_op now snapshots the PRE-write row into
--      a distinct v_pre (previously v_cur was reused for both pre and post). For
--      op IN ('edit','move') it computes metadata.changes = {field:{old,new}} for
--      ONLY the whitelisted schedule/grouping fields that ACTUALLY changed,
--      comparing v_pre against the post-write re-read.
--
--   2. ENVELOPE POPULATION — the step-(h) INSERT now also sets the envelope
--      columns added by 20260626090000:
--        * actor_role    text  ∈ {manager, employee, system}
--        * domain        text  ∈ {lifecycle, assignment, schedule, offer,
--                                  marketplace, trade, drop, attendance,
--                                  compliance}
--        * shift_version integer = the POST-write shifts.version
--      plus from_state / to_state (via get_shift_fsm_state on v_pre / post) and
--      from_version / to_version inside metadata. The existing coarse event_type
--      CASE map (subject-bound enum for genuine (un)assign/cancel, neutral
--      OP_APPLIED otherwise) and the existing metadata fields (op, idem, payload,
--      write) are preserved.
--
--   3. TRIGGER DE-DUP — the gateway's UPDATE on public.shifts also fires
--      trg_capture_shift_event -> fn_capture_shift_event, which would emit a
--      DUPLICATE semantic event (e.g. an 'assign' op makes the gateway write
--      ASSIGNED and the trigger write ASSIGNED too — colliding on
--      uniq_shift_event(shift_id, employee_id, event_type, event_time) because
--      event_time = now() is frozen per txn). A transaction-local guard
--      app.audit.via_gateway='1' is set immediately before _apply_shift_op_write
--      and reset to '0' after; fn_capture_shift_event short-circuits (RETURN NEW —
--      it is an AFTER ROW trigger) while the guard is set, so the gateway's
--      enveloped event is the only one written.
--
-- INVARIANTS PRESERVED (unchanged from 20260623000200 / 20260621100200):
--   * NEVER set shifts.version manually — the BEFORE UPDATE version trigger bumps
--     it. We read the post-write version back.
--   * FSM state derived ONLY via public.get_shift_fsm_state(...) (the 6-arg
--     column overload the gateway already uses).
--   * IDEMPOTENT_REPLAY and WRITE_REJECTED still write NO event (and leave the
--     idempotency key unclaimed). Only an ACTUALLY-applied op writes a row.
--   * employee_id stays the post-write SUBJECT (NULL only for subject-optional
--     ops, which the relaxed validator 20260621100060 exempts).
--
-- NOT APPLIED TO PROD by this file (forward-only migration on
-- feat/episode-lifecycle-metrics). Apply order: this runs AFTER the envelope
-- columns (20260626090000) and the latest fn_capture_shift_event
-- (20260629010000) exist.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1+2. Gateway: pre/post snapshot, edit-diff, envelope population.
--    Body is the 20260623000200 gateway verbatim PLUS the additions above.
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
      'op',           p_op,
      'reason',       p_payload->>'reason',
      'from_state',   v_state,
      'to_state',     v_to_state,
      'from_version', p_expected_version,
      'to_version',   v_cur.version,
      'idem',         p_idempotency_key,
      'source',       'sm_apply_shift_op',
      'payload',      p_payload,
      'write',        v_write
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
-- 3. Capture trigger de-dup guard.
--    Body is VERBATIM from the latest definition (20260629010000) PLUS an early
--    short-circuit: when the gateway already wrote the enveloped event for this
--    op (app.audit.via_gateway = '1'), skip — the gateway is the sole writer for
--    its ops. RETURN NEW because trg_capture_shift_event is an AFTER ROW trigger
--    (the return value is ignored for AFTER triggers, but NEW is the correct,
--    non-NULL convention so the row is never accidentally dropped if the timing
--    is ever changed).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_capture_shift_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    -- 0. De-dup guard: when sm_apply_shift_op already wrote the enveloped event
    --    for this op, suppress the trigger's duplicate (it would collide on
    --    uniq_shift_event(shift_id, employee_id, event_type, event_time) and
    --    double-count event-sourced metrics). Transaction-local; defaults to '0'.
    IF current_setting('app.audit.via_gateway', true) = '1' THEN
        RETURN NEW;
    END IF;

    -- 1. ASSIGNED / UNASSIGNED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.assigned_employee_id IS NOT NULL AND OLD.assigned_employee_id IS NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ASSIGNED', COALESCE(NEW.assigned_at, now()));
        ELSIF (NEW.assigned_employee_id IS NULL AND OLD.assigned_employee_id IS NOT NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
            VALUES (NEW.id, OLD.assigned_employee_id, 'UNASSIGNED', now());
        END IF;
    ELSIF (TG_OP = 'INSERT') THEN
        IF (NEW.assigned_employee_id IS NOT NULL) THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
            VALUES (NEW.id, NEW.assigned_employee_id, 'ASSIGNED', COALESCE(NEW.assigned_at, now()));
        END IF;
    END IF;

    -- 2. OFFERED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.fulfillment_status = 'offered' AND OLD.fulfillment_status IS DISTINCT FROM 'offered') THEN
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
            VALUES (NEW.id, NEW.assigned_employee_id, 'OFFERED', COALESCE(NEW.offer_sent_at, now()));
        END IF;
    END IF;

    -- 3. ACCEPTED / EMERGENCY_ASSIGNED
    --    A confirm transition is an emergency force-assign when emergency_assigned_at
    --    was just stamped (state stays S4/confirmed); otherwise it is a normal accept.
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.assignment_outcome = 'confirmed' AND OLD.assignment_outcome IS DISTINCT FROM 'confirmed') THEN
            IF (NEW.emergency_assigned_at IS NOT NULL
                AND OLD.emergency_assigned_at IS DISTINCT FROM NEW.emergency_assigned_at) THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
                VALUES (NEW.id, NEW.assigned_employee_id, 'EMERGENCY_ASSIGNED', COALESCE(NEW.emergency_assigned_at, now()));
            ELSE
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
                VALUES (NEW.id, NEW.assigned_employee_id, 'ACCEPTED', COALESCE(NEW.confirmed_at, now()));
            END IF;
        ELSIF (NEW.assignment_outcome = 'emergency_assigned' AND OLD.assignment_outcome IS DISTINCT FROM 'emergency_assigned') THEN
            -- Legacy path (pre-FSM-reduction): the dedicated emergency outcome value.
            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
            VALUES (NEW.id, NEW.assigned_employee_id, 'EMERGENCY_ASSIGNED', COALESCE(NEW.emergency_assigned_at, now()));
        END IF;
    END IF;

    -- 4. CANCELLED
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.lifecycle_status = 'Cancelled' AND OLD.lifecycle_status IS DISTINCT FROM 'Cancelled') THEN
            -- Check if it's a late cancellation (< 12 hours before start)
            IF (NEW.start_at IS NOT NULL AND (NEW.start_at - now()) < interval '12 hours') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
                VALUES (NEW.id, NEW.assigned_employee_id, 'LATE_CANCELLED', now());
            END IF;

            INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
            VALUES (NEW.id, NEW.assigned_employee_id, 'CANCELLED', COALESCE(NEW.cancelled_at, now()));
        END IF;
    END IF;

    -- 5. ATTENDANCE (CHECKED_IN, LATE_IN, NO_SHOW)
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.attendance_status IS DISTINCT FROM OLD.attendance_status) THEN
            IF (NEW.attendance_status = 'checked_in') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
                VALUES (NEW.id, NEW.assigned_employee_id, 'CHECKED_IN', COALESCE(NEW.actual_start, now()));
            ELSIF (NEW.attendance_status = 'late') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
                VALUES (NEW.id, NEW.assigned_employee_id, 'LATE_IN', COALESCE(NEW.actual_start, now()));
            ELSIF (NEW.attendance_status = 'no_show') THEN
                INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time)
                VALUES (NEW.id, NEW.assigned_employee_id, 'NO_SHOW', now());
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;
