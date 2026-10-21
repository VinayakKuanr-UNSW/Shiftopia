-- Phase 1 of docs/handover/2026-10-04-ft-roster-handover.md:
-- the full-time branch of the shift state machine at PUBLISH.
--
--   Assigned FT Draft (S2)   → Published + Confirmed (S4) directly. Never Offered:
--                               full-time hours are contracted, there is nothing to
--                               accept, and a rejected offer would have to unassign —
--                               which trg_full_time_shift_rules refuses.
--   Unassigned FT Draft (S1) → refused. An FT shift always has its person; it can
--                               never be opened for Bidding (the trigger refuses that
--                               too — here it is refused with a reason instead of an
--                               exception that would fail a whole bulk batch).
--
-- Casual / part-time unchanged: S2 → S3 (Offered), S1 → S5 (Bidding), emergency
-- (≤4h) S2 → S4. The ≤4h single-shift path (gateway op 'publish') already lands
-- on S4 for everyone, FT included.
--
-- Both bodies are the live production definitions (pg_get_functiondef,
-- 2026-10-04) with only the FT branch added.

CREATE OR REPLACE FUNCTION public.sm_publish_shift(p_shift_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift RECORD;
  v_state text;
  v_to_state text;
  v_name text;
  v_role text;
  v_is_ft boolean;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted');
  END IF;

  SELECT COALESCE(first_name||' '||COALESCE(last_name,''), email), COALESCE(left(lower(legacy_system_role::text),50),'manager')
    INTO v_name, v_role FROM public.profiles WHERE id = p_user_id;
  v_name := COALESCE(v_name, 'System');
  v_role := COALESCE(v_role, 'system');

  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);
  v_is_ft := v_shift.target_employment_type = 'FT';

  IF v_state IN ('S3', 'S4', 'S5') THEN
    RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', v_state, 'message', 'Already published');
  END IF;
  IF v_state NOT IN ('S1', 'S2') THEN
    RETURN jsonb_build_object('success', false, 'error', format('sm_publish_shift requires state S1 or S2, current state is %s', v_state));
  END IF;

  IF v_state = 'S2' AND v_is_ft THEN
    -- S2 → S4: Draft+Assigned FT → Published+Confirmed. No offer.
    v_to_state := 'S4';
    UPDATE public.shifts SET
      lifecycle_status = 'Published'::public.shift_lifecycle,
      published_at = NOW(),
      assignment_outcome = 'confirmed',
      confirmed_at = NOW(),
      bidding_status = 'not_on_bidding'::public.shift_bidding_status,
      is_on_bidding = FALSE,
      fulfillment_status = 'scheduled'::public.shift_fulfillment_status,
      last_modified_by = p_user_id,
      updated_at = NOW()
    WHERE id = p_shift_id;
  ELSIF v_state = 'S2' THEN
    -- S2 → S3: Draft+Assigned → Published+Offered
    -- assignment_outcome stays NULL — employee must ACCEPT to move to S4
    v_to_state := 'S3';
    UPDATE public.shifts SET
      lifecycle_status = 'Published'::public.shift_lifecycle,
      assignment_outcome = NULL,
      bidding_status = 'not_on_bidding'::public.shift_bidding_status,
      is_on_bidding = FALSE,
      fulfillment_status = 'offered'::public.shift_fulfillment_status,
      last_modified_by = p_user_id,
      updated_at = NOW()
    WHERE id = p_shift_id;
  ELSIF v_is_ft THEN
    RETURN jsonb_build_object('success', false, 'code', 'FT_UNASSIGNED',
      'error', 'A full-time shift must be assigned before it is published — it can never go to bidding.');
  ELSE
    -- S1 → S5: Draft+Unassigned → Published+Bidding
    v_to_state := 'S5';
    UPDATE public.shifts SET
      lifecycle_status = 'Published'::public.shift_lifecycle,
      assignment_status = 'unassigned'::public.shift_assignment_status,
      assignment_outcome = NULL,
      bidding_status = 'on_bidding'::public.shift_bidding_status,
      is_on_bidding = TRUE,
      fulfillment_status = 'bidding'::public.shift_fulfillment_status,
      last_modified_by = p_user_id,
      updated_at = NOW()
    WHERE id = p_shift_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', v_to_state);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_bulk_publish_shifts(p_shift_ids uuid[], p_actor_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_total_count int;
    v_success_count int;
    v_actor_name text;
    v_actor_role text;
BEGIN
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

    WITH shift_calculations AS (
        SELECT
            s.id,
            s.assigned_employee_id,
            s.target_employment_type = 'FT' AS is_ft,
            get_shift_state_id(s.id) as current_state,
            COALESCE(s.scheduled_start, s.start_at) as shift_start_tz,
            get_time_category(COALESCE(s.scheduled_start, s.start_at)) as time_cat
        FROM shifts s
        WHERE s.id = ANY(p_shift_ids)
          AND s.deleted_at IS NULL
    ),
    valid_transitions AS (
        SELECT
            id,
            current_state,
            time_cat,
            CASE
                -- FT: assigned → Confirmed directly; unassigned FT is never published.
                WHEN is_ft AND current_state = 'S2' THEN 'S4'
                WHEN is_ft THEN NULL
                WHEN current_state = 'S1' AND time_cat IN ('URGENT','NORMAL') THEN 'S5'
                WHEN current_state = 'S2' AND time_cat = 'EMERGENCY' THEN 'S4'
                WHEN current_state = 'S2' THEN 'S3'
                ELSE NULL
            END as new_state_id,
            CASE
                WHEN EXTRACT(EPOCH FROM (shift_start_tz - NOW())) / 3600.0 <= 4 THEN NOW()
                WHEN EXTRACT(EPOCH FROM (shift_start_tz - NOW())) / 3600.0 <= 24 THEN LEAST(NOW() + INTERVAL '4 hours', shift_start_tz - INTERVAL '4 hours')
                WHEN EXTRACT(EPOCH FROM (shift_start_tz - NOW())) / 3600.0 <= 48 THEN NOW() + INTERVAL '8 hours'
                ELSE NOW() + INTERVAL '12 hours'
            END as offer_deadline
        FROM shift_calculations
        WHERE current_state IN ('S1', 'S2')
          AND time_cat != 'PAST'
          AND NOT (current_state = 'S1' AND time_cat = 'EMERGENCY')
    ),
    updated_rows AS (
        UPDATE shifts s
        SET
            lifecycle_status = 'Published',
            published_at = NOW(),
            last_modified_by = p_actor_id,
            updated_at = NOW(),
            bidding_status = CASE
                WHEN vt.new_state_id = 'S5' THEN 'on_bidding'
                ELSE s.bidding_status
            END,
            is_on_bidding = CASE
                WHEN vt.new_state_id = 'S5' THEN TRUE
                ELSE s.is_on_bidding
            END,
            bidding_open_at = CASE
                WHEN vt.new_state_id = 'S5' THEN NOW()
                ELSE s.bidding_open_at
            END,
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
            confirmed_at = CASE
                WHEN vt.new_state_id = 'S4' THEN NOW()
                ELSE s.confirmed_at
            END,
            offer_sent_at = CASE
                WHEN vt.new_state_id = 'S3' THEN NOW()
                ELSE s.offer_sent_at
            END,
            offer_expires_at = CASE
                WHEN vt.new_state_id = 'S3' THEN vt.offer_deadline
                ELSE s.offer_expires_at
            END
        FROM valid_transitions vt
        WHERE s.id = vt.id AND vt.new_state_id IS NOT NULL
        RETURNING s.id, vt.current_state, vt.new_state_id, vt.offer_deadline
    ),
    offers_update AS (
        UPDATE public.shift_offers so
        SET offer_expires_at = ur.offer_deadline
        FROM updated_rows ur
        WHERE so.shift_id = ur.id
          AND ur.new_state_id = 'S3'
          AND so.status = 'Pending'
        RETURNING so.id
    )
    SELECT count(*) INTO v_success_count FROM updated_rows;

    RETURN jsonb_build_object(
        'success', true,
        'total_requested', v_total_count,
        'success_count', v_success_count,
        'failure_count', v_total_count - v_success_count,
        'message', format('Successfully published %s of %s shifts', v_success_count, v_total_count)
    );

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error in sm_bulk_publish_shifts: %', SQLERRM;
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
