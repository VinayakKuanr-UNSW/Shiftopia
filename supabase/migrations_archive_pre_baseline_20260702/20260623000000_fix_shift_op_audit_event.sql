-- Shift mutation gateway — fix the step-(h) audit-event insert.
--
-- BUG (prod): sm_apply_shift_op's audit INSERT mapped publish/edit/approve_trade/
-- reject_trade to event_type 'ASSIGNED' (and delete -> 'CANCELLED') but NEVER
-- supplied employee_id. The baseline trigger fn_validate_shift_event raises
-- 'employee_id is required for event type %' for any non-UNASSIGNED event with a
-- NULL subject, so the gateway's `EXCEPTION WHEN OTHERS` rolled back the ENTIRE op
-- and returned {ok:false,code:'ERROR'} at HTTP 200 — a red toast with an EMPTY
-- browser console. Every op except `unpublish` was silently discarded. Overloading
-- 'ASSIGNED' also inflated employee_daily_metrics (counts event_type='ASSIGNED').
--
-- FIX: map event_type HONESTLY — only assign/select_winner -> ASSIGNED, unpublish
-- -> UNASSIGNED, delete-of-assigned -> CANCELLED, everything else -> the neutral
-- 'OP_APPLIED' audit value (added by 20260621100050, exempted by 20260621100060) —
-- and supply employee_id = the post-write assigned_employee_id (the SUBJECT).
--
-- Forward-only: dated AFTER 20260621224311 so it is the LAST definition of
-- sm_apply_shift_op on a fresh rebuild. DELIBERATELY replaces ONLY the public
-- gateway function — it does NOT touch _apply_shift_op_write, whose prod copy is
-- the 224311-merged version (shift_swaps trades + edit jsonb fix). Idempotent.

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
  -- applied). The true op + version delta + idempotency key live in metadata; the
  -- real op is ALWAYS in metadata.op. event_type is mapped HONESTLY: only genuine
  -- (un)assignment/cancellation ops use a subject-bound enum value, so we never
  -- inflate the assignment/cancellation counters in employee_daily_metrics (which
  -- read event_type, NOT metadata.op). Everything else gets the neutral 'OP_APPLIED'
  -- audit value, which fn_validate_shift_event exempts from the employee_id rule.
  v_event := CASE
               WHEN p_op = 'assign'        THEN 'ASSIGNED'
               WHEN p_op = 'select_winner' THEN 'ASSIGNED'
               WHEN p_op = 'unpublish'     THEN 'UNASSIGNED'
               -- delete is a real cancellation ONLY when a worker was attached;
               -- deleting an open/unassigned shift has no subject => neutral audit.
               WHEN p_op = 'delete' AND v_cur.assigned_employee_id IS NOT NULL
                                           THEN 'CANCELLED'
               ELSE 'OP_APPLIED'   -- publish / edit / approve_trade / reject_trade /
                                   -- delete-of-unassigned: generic, subject-optional
             END::public.shift_event_type;

  -- v_cur is the POST-write re-read (step f), so assigned_employee_id is the SUBJECT
  -- the event is about (NULL for an unassigned shift); v_caller is the ACTOR.
  INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, metadata)
  VALUES (
    p_shift_id,
    v_cur.assigned_employee_id,
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
