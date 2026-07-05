-- Shift mutation gateway — the audit event is ALWAYS the neutral 'OP_APPLIED'.
--
-- ROOT CAUSE: shift_events is already event-sourced by the AFTER INSERT/UPDATE
-- trigger trg_capture_shift_event (fn_capture_shift_event), which emits the
-- SEMANTIC events — ASSIGNED / UNASSIGNED / OFFERED / ACCEPTED / EMERGENCY_ASSIGNED /
-- CANCELLED / LATE_CANCELLED / attendance — directly from the column deltas. The
-- gateway must NOT also write those: doing so
--   (a) violates uniq_shift_event(shift_id, employee_id, event_type, event_time)
--       because event_time defaults to now(), which is FROZEN per transaction, so the
--       gateway's ASSIGNED/UNASSIGNED lands on the exact key the trigger just wrote →
--       duplicate-key ERROR → the whole op rolls back (assign/unassign/select_winner
--       were failing in prod); and
--   (b) double-counts employee_daily_metrics (which counts event_type directly).
--
-- FIX: the gateway records ONLY that an op was applied — a single 'OP_APPLIED' row
-- carrying the true op + version delta + idempotency key + actor in metadata. The
-- trigger remains the single source of truth for semantic, employee-facing events.
-- employee_id is left NULL on the op-audit row (the subject lives on the trigger's
-- semantic event); NULLs are DISTINCT in the unique index, so op-audit rows can
-- never collide with each other or with the trigger's typed events.
--
-- Forward-only; redefines ONLY sm_apply_shift_op (fsm_op_is_legal /
-- _apply_shift_op_write from 20260623000100 are correct and untouched). Idempotent.

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
  v_caller  uuid := auth.uid();
  v_cur     RECORD;
  v_state   text;
  v_write   jsonb;
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

  -- (c) Idempotency replay: same shift already has an op-audit event with this key.
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

  -- (f) Dispatch the write (version bump handled by the BEFORE UPDATE trigger; any
  -- semantic shift_events rows are emitted by trg_capture_shift_event here).
  v_write := public._apply_shift_op_write(p_shift_id, p_op, p_payload, v_caller);

  -- Re-read the post-write row so the returned version/state reflect REALITY.
  SELECT * INTO v_cur FROM public.shifts WHERE id = p_shift_id;

  -- (g) Soft-reject. Dispatcher declined to mutate: NO UPDATE ran, version did NOT
  -- advance, and we write NO op-audit row (so the idempotency key stays unclaimed).
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

  -- (h) Append ONE neutral op-audit row. Semantic events are owned by
  -- trg_capture_shift_event — see header. employee_id NULL by design.
  INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, metadata)
  VALUES (
    p_shift_id,
    NULL,
    v_caller,
    'OP_APPLIED'::public.shift_event_type,
    jsonb_build_object(
      'op', p_op,
      'from_version', p_expected_version,
      'to_version', v_cur.version,
      'idem', p_idempotency_key,
      'payload', p_payload,
      'write', v_write
    )
  );

  -- (i) Success envelope. Use the RE-READ version.
  RETURN jsonb_build_object(
    'ok', true,
    'code', 'APPLIED',
    'version', v_cur.version,
    'state', public.get_shift_fsm_state(
      v_cur.lifecycle_status, v_cur.assignment_status, v_cur.assignment_outcome,
      v_cur.trading_status, v_cur.is_cancelled, v_cur.bidding_status)
  );

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error in sm_apply_shift_op (shift=%, op=%): %', p_shift_id, p_op, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.sm_apply_shift_op(uuid, integer, text, jsonb, uuid) TO authenticated;
