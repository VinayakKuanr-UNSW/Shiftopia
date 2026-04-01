-- ============================================================
-- FSM Migration 4: Wire emergency_source into all S4-producing assignment paths
--
-- Paths covered:
--   1. set_emergency_source()       — shared helper (write-once logic)
--   2. sm_emergency_assign          — rewrite: fix broken 'emergency_assigned' outcome
--   3. sm_select_bid_winner         — add emergency_source
--   4. sm_bulk_assign               — add emergency_source
--
-- assign_shift_employee is intentionally skipped — it creates S3 (Offered),
-- not S4 (Confirmed), so emergency_source does not apply.
-- ============================================================


-- ============================================================
-- 1. set_emergency_source()
--    Shared write-once helper.  Mirrors resolveEmergencySource() in TypeScript.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_emergency_source(
  p_action               text,   -- 'EMERGENCY_ASSIGN' | 'NORMAL_ASSIGN'
  p_time_to_start_sec    int,    -- seconds until scheduled_start (may be negative if already started)
  p_current              text    -- existing emergency_source value on the row
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- write-once: never overwrite an already-set value
  IF p_current IS NOT NULL THEN
    RETURN p_current;
  END IF;

  IF p_action = 'EMERGENCY_ASSIGN' THEN
    RETURN 'manual';
  END IF;

  IF p_time_to_start_sec < 4 * 60 * 60 THEN
    RETURN 'auto';
  END IF;

  RETURN NULL;
END;
$$;


-- ============================================================
-- 2. sm_emergency_assign  (FULL REWRITE)
--
--    Critical fixes vs. old version:
--      - 'emergency_assigned' outcome → 'confirmed' (old value now blocked by CHECK)
--      - State validation via get_shift_fsm_state() instead of get_shift_state_id()
--      - Valid source state: S5 only (per FSM transition table)
--      - emergency_source = 'manual' (via set_emergency_source)
--      - Removed: is_published=TRUE (redundant), fulfillment_status='fulfilled'
--      - Removed: is_cancelled=FALSE (never re-activate cancelled shifts here)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sm_emergency_assign(
  p_shift_id    uuid,
  p_employee_id uuid,
  p_reason      text    DEFAULT 'Emergency assignment',
  p_user_id     uuid    DEFAULT auth.uid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift  RECORD;
  v_state  text;
  v_tts    int;
BEGIN
  -- Lock the row for update
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
  END IF;

  -- Derive current FSM state
  v_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status,
    v_shift.assignment_status,
    v_shift.assignment_outcome,
    v_shift.trading_status,
    v_shift.is_cancelled
  );

  -- Emergency assignment is only valid from S5 (Published + Bidding/Unassigned)
  IF v_state != 'S5' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   format('EMERGENCY_ASSIGN requires state S5, current state is %s', v_state)
    );
  END IF;

  -- Time-to-start in seconds
  v_tts := EXTRACT(EPOCH FROM (v_shift.scheduled_start - NOW()))::int;

  UPDATE public.shifts
  SET
    assigned_employee_id = p_employee_id,
    assigned_at          = NOW(),
    assignment_status    = 'assigned'::public.shift_assignment_status,
    assignment_outcome   = 'confirmed'::public.shift_assignment_outcome,
    emergency_source     = public.set_emergency_source('EMERGENCY_ASSIGN', v_tts, v_shift.emergency_source),
    bidding_status       = 'not_on_bidding'::public.shift_bidding_status,
    is_on_bidding        = FALSE,
    fulfillment_status   = 'scheduled'::public.shift_fulfillment_status,
    confirmed_at         = NOW(),
    compliance_checked_at = NOW(),
    last_modified_by     = p_user_id,
    updated_at           = NOW()
  WHERE id = p_shift_id;

  INSERT INTO public.shift_audit_events (
    shift_id, event_category, event_type, performed_by_id, metadata
  ) VALUES (
    p_shift_id,
    'shift_lifecycle',
    'emergency_assign',
    p_user_id,
    jsonb_build_object(
      'reason',      p_reason,
      'from_state',  v_state,
      'to_state',    'S4',
      'assigned_to', p_employee_id,
      'tts_sec',     v_tts
    )
  );

  RETURN jsonb_build_object(
    'success',     true,
    'from_state',  v_state,
    'to_state',    'S4',
    'assigned_to', p_employee_id
  );
END;
$$;


-- ============================================================
-- 3. sm_select_bid_winner  — add emergency_source
-- ============================================================
CREATE OR REPLACE FUNCTION public.sm_select_bid_winner(
  p_shift_id  uuid,
  p_winner_id uuid,
  p_user_id   uuid DEFAULT auth.uid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift     RECORD;
  v_iteration int;
  v_tts       int;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;

  v_iteration := v_shift.bidding_iteration;
  v_tts       := EXTRACT(EPOCH FROM (v_shift.scheduled_start - NOW()))::int;

  UPDATE public.shift_bids
  SET status = 'accepted', updated_at = now()
  WHERE shift_id = p_shift_id
    AND employee_id = p_winner_id
    AND bidding_iteration = v_iteration;

  UPDATE public.shift_bids
  SET status = 'rejected', updated_at = now()
  WHERE shift_id = p_shift_id
    AND employee_id != p_winner_id
    AND bidding_iteration = v_iteration
    AND status = 'pending';

  UPDATE public.shifts
  SET
    assigned_employee_id = p_winner_id,
    assignment_status    = 'assigned'::public.shift_assignment_status,
    assignment_outcome   = 'confirmed'::public.shift_assignment_outcome,
    emergency_source     = public.set_emergency_source('NORMAL_ASSIGN', v_tts, v_shift.emergency_source),
    bidding_status       = 'not_on_bidding'::public.shift_bidding_status,
    is_on_bidding        = FALSE,
    fulfillment_status   = 'scheduled'::public.shift_fulfillment_status,
    updated_at           = now()
  WHERE id = p_shift_id;

  INSERT INTO public.shift_audit_log (
    shift_id, action, actor_id, target_id, to_state, metadata
  ) VALUES (
    p_shift_id, 'BID_SELECTED', p_user_id, p_winner_id, 'S4',
    jsonb_build_object('iteration', v_iteration, 'tts_sec', v_tts)
  );

  RETURN jsonb_build_object('success', true, 'iteration', v_iteration);
END;
$$;


-- ============================================================
-- 4. sm_bulk_assign  — add emergency_source
-- ============================================================
CREATE OR REPLACE FUNCTION public.sm_bulk_assign(
  p_shift_ids  uuid[],
  p_employee_id uuid,
  p_user_id    uuid DEFAULT auth.uid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_count  int;
  v_success_count int;
  v_user_name    text;
  v_user_role    text;
  v_audit_role   text;
BEGIN
  v_total_count := array_length(p_shift_ids, 1);

  IF p_user_id IS NOT NULL THEN
    SELECT
      COALESCE(first_name || ' ' || COALESCE(last_name, ''), email),
      left(lower(legacy_system_role::text), 50)
    INTO v_user_name, v_user_role
    FROM public.profiles
    WHERE id = p_user_id;
  ELSE
    v_user_name := 'System';
    v_user_role := 'system_automation';
  END IF;

  CASE v_user_role
    WHEN 'team_member'       THEN v_audit_role := 'employee';
    WHEN 'employee'          THEN v_audit_role := 'employee';
    WHEN 'admin'             THEN v_audit_role := 'admin';
    WHEN 'manager'           THEN v_audit_role := 'manager';
    WHEN 'system_automation' THEN v_audit_role := 'system_automation';
    ELSE                          v_audit_role := 'system_automation';
  END CASE;

  WITH updated_rows AS (
    UPDATE public.shifts s
    SET
      assigned_employee_id = p_employee_id,
      assignment_status    = 'assigned'::public.shift_assignment_status,

      assignment_outcome = CASE
        WHEN s.lifecycle_status = 'Published' THEN 'confirmed'::public.shift_assignment_outcome
        ELSE s.assignment_outcome
      END,

      -- Only set emergency_source when we are producing a confirmed (S4) outcome
      emergency_source = CASE
        WHEN s.lifecycle_status = 'Published'
          THEN public.set_emergency_source(
                 'NORMAL_ASSIGN',
                 EXTRACT(EPOCH FROM (s.scheduled_start - NOW()))::int,
                 s.emergency_source
               )
        ELSE s.emergency_source
      END,

      confirmed_at = CASE
        WHEN s.lifecycle_status = 'Published' THEN NOW()
        ELSE s.confirmed_at
      END,

      updated_at       = NOW(),
      last_modified_by = p_user_id
    WHERE s.id = ANY(p_shift_ids)
      AND s.deleted_at IS NULL
    RETURNING s.id, s.lifecycle_status
  ),
  audit_inserts AS (
    INSERT INTO public.shift_audit_events (
      shift_id, event_type, event_category,
      performed_by_id, performed_by_name, performed_by_role,
      new_value, field_changed, metadata
    )
    SELECT
      ur.id,
      'shift_assigned',
      'assignment',
      p_user_id,
      COALESCE(v_user_name, 'System'),
      v_audit_role,
      p_employee_id::text,
      'assigned_employee_id',
      jsonb_build_object(
        'reason',         'Bulk assignment',
        'assigned_to',    p_employee_id,
        'bulk_operation', true
      )
    FROM updated_rows ur
  )
  SELECT count(*) INTO v_success_count FROM updated_rows;

  RAISE NOTICE 'Bulk Assigned: Requested %, Assigned %', v_total_count, v_success_count;

  RETURN jsonb_build_object(
    'success',        true,
    'total_requested', v_total_count,
    'success_count',  v_success_count,
    'failure_count',  v_total_count - v_success_count,
    'message',        format('Successfully assigned %s of %s shifts', v_success_count, v_total_count)
  );

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error in sm_bulk_assign: %', SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
