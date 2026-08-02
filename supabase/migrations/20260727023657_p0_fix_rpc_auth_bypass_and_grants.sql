-- ─────────────────────────────────────────────────────────────────────────────
-- Backfilled into version control 2026-08-02 from the PRODUCTION migration
-- ledger (supabase_migrations.schema_migrations @ version 20260727023657).
--
-- This migration was applied DIRECTLY to prod via the Supabase MCP during the
-- 2026-07-27/28 security & payroll audit and had no committed source file until
-- now. It is ALREADY APPLIED in prod — do not re-run against production.
-- Context: docs/investigations/2026-08-02_migration-reconciliation.md
-- ─────────────────────────────────────────────────────────────────────────────

-- P0 security fix (payroll & compliance audit, 2026-07-27)
-- Findings C-1, C-2, C-3: sm_bulk_assign_atomic and
-- sm_finalize_planning_request treated "no JWT subject" (auth.uid()
-- IS NULL) as an implicitly-trusted service/system caller -- the
-- correct pattern already used by sm_apply_shift_op -- but unlike
-- sm_apply_shift_op, anon EXECUTE was never revoked on them, so an
-- unauthenticated anon-key caller (which also has auth.uid() IS
-- NULL) fell through the same bypass. _apply_shift_op_write had no
-- check at all and was also anon-executable. Fix: distinguish
-- trusted system callers by JWT role (auth.role() = 'service_role')
-- instead of presence-of-uid, add a real check to
-- sm_finalize_planning_request, and revoke anon on all three.

-- ---------------------------------------------------------------
-- C-1: sm_bulk_assign_atomic
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sm_bulk_assign_atomic(p_assignments jsonb, p_user_id uuid DEFAULT auth.uid(), p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_caller        uuid := auth.uid();
    v_user_name     text;
    v_user_role     text;
    v_pair          jsonb;
    v_employee_id   uuid;
    v_shift_ids     uuid[];
    v_pair_total    int;
    v_pair_success  int;
    v_pair_conflicts jsonb;
    v_total_requested   int := 0;
    v_total_success     int := 0;
    v_total_conflict    int := 0;
    v_per_employee      jsonb := '[]'::jsonb;
    v_all_conflicts     jsonb := '[]'::jsonb;
    v_updated_ids       uuid[];
    v_shift_id          uuid;
    v_final_result      jsonb;
    v_stored_result     jsonb;
BEGIN
    PERFORM set_config('app.audit.actor', 'autoscheduler', true);

    IF p_idempotency_key IS NOT NULL THEN
        SELECT result INTO v_stored_result
        FROM public.bulk_assign_idempotency
        WHERE key = p_idempotency_key;
        IF FOUND THEN
            RETURN v_stored_result;
        END IF;
    END IF;

    -- P0 fix: was "v_caller IS NOT NULL AND NOT (...)", which skipped
    -- this check entirely for any caller with no JWT subject --
    -- including an unauthenticated anon-key request. Trust only a
    -- genuine service_role JWT unconditionally; every other caller
    -- (including one with a null uid) must pass the role check.
    IF auth.role() IS DISTINCT FROM 'service_role' AND NOT (
           public.is_manager_or_above()
           OR public.is_admin()
           OR EXISTS (
                SELECT 1 FROM public.app_access_certificates c
                WHERE c.user_id = v_caller
                  AND c.is_active = true
                  AND c.access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
              )
         ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Not authorized to assign shifts',
            'total_requested', 0,
            'success_count', 0,
            'conflict_count', 0,
            'conflicts', '[]'::jsonb,
            'per_employee', '[]'::jsonb
        );
    END IF;

    IF p_user_id IS NOT NULL THEN
        SELECT COALESCE(first_name || ' ' || COALESCE(last_name, ''), email),
               left(lower(legacy_system_role::text), 50)
        INTO v_user_name, v_user_role
        FROM public.profiles
        WHERE id = p_user_id;
    ELSE
        v_user_name := 'System';
        v_user_role := 'system_automation';
    END IF;

    FOR v_pair IN SELECT * FROM jsonb_array_elements(p_assignments)
    LOOP
        v_employee_id := (v_pair->>'employee_id')::uuid;
        v_shift_ids   := ARRAY(
            SELECT (elem::text)::uuid
            FROM jsonb_array_elements_text(v_pair->'shift_ids') AS elem
        );
        v_pair_total    := array_length(v_shift_ids, 1);
        v_pair_success  := 0;
        v_pair_conflicts := '[]'::jsonb;
        v_updated_ids   := '{}';

        IF v_pair_total IS NULL OR v_pair_total = 0 THEN
            CONTINUE;
        END IF;

        v_total_requested := v_total_requested + v_pair_total;

        WITH updated_rows AS (
            UPDATE public.shifts s SET
                assigned_employee_id = v_employee_id,
                assignment_status    = 'assigned'::public.shift_assignment_status,
                assignment_outcome   = CASE
                                         WHEN s.lifecycle_status = 'Published'
                                         THEN 'confirmed'::public.shift_assignment_outcome
                                         ELSE s.assignment_outcome
                                       END,
                confirmed_at         = CASE
                                         WHEN s.lifecycle_status = 'Published'
                                         THEN NOW()
                                         ELSE s.confirmed_at
                                       END,
                updated_at           = NOW(),
                last_modified_by     = p_user_id
            WHERE s.id = ANY(v_shift_ids)
              AND s.deleted_at IS NULL
              AND (s.assigned_employee_id IS NULL OR s.assigned_employee_id = v_employee_id)
            RETURNING s.id
        )
        SELECT array_agg(id) INTO v_updated_ids FROM updated_rows;

        IF v_updated_ids IS NULL THEN
            v_updated_ids := '{}';
        END IF;

        v_pair_success := array_length(v_updated_ids, 1);
        IF v_pair_success IS NULL THEN v_pair_success := 0; END IF;

        FOREACH v_shift_id IN ARRAY v_shift_ids LOOP
            IF NOT (v_shift_id = ANY(v_updated_ids)) THEN
                v_pair_conflicts := v_pair_conflicts || to_jsonb(v_shift_id::text);
                v_all_conflicts  := v_all_conflicts  || to_jsonb(v_shift_id::text);
            END IF;
        END LOOP;

        v_total_success  := v_total_success  + v_pair_success;
        v_total_conflict := v_total_conflict + (v_pair_total - v_pair_success);

        v_per_employee := v_per_employee || jsonb_build_object(
            'employee_id', v_employee_id,
            'committed',   v_pair_success,
            'conflicts',   v_pair_conflicts
        );
    END LOOP;

    v_final_result := jsonb_build_object(
        'success',         true,
        'total_requested', v_total_requested,
        'success_count',   v_total_success,
        'conflict_count',  v_total_conflict,
        'conflicts',       v_all_conflicts,
        'per_employee',    v_per_employee
    );

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.bulk_assign_idempotency (key, result)
        VALUES (p_idempotency_key, v_final_result)
        ON CONFLICT (key) DO NOTHING;
    END IF;

    RETURN v_final_result;

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error in sm_bulk_assign_atomic: %', SQLERRM;
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM,
        'total_requested', v_total_requested,
        'success_count', 0,
        'conflict_count', 0,
        'conflicts', '[]'::jsonb,
        'per_employee', '[]'::jsonb
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sm_bulk_assign_atomic(jsonb, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sm_bulk_assign_atomic(jsonb, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.sm_bulk_assign_atomic(jsonb, uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------
-- C-2: _apply_shift_op_write -- pure privilege lockdown, no logic
-- change. This is the internal write primitive behind the
-- version-CAS/FSM-guarded sm_apply_shift_op gateway; it is called
-- internally as the SECURITY DEFINER owner (which retains implicit
-- execute rights on functions it owns), so revoking anon/
-- authenticated here does not affect the gateway's ability to call
-- it -- it only blocks callers from reaching the raw primitive
-- directly and bypassing the gateway's CAS+FSM guard.
-- ---------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._apply_shift_op_write(uuid, text, jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._apply_shift_op_write(uuid, text, jsonb, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._apply_shift_op_write(uuid, text, jsonb, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._apply_shift_op_write(uuid, text, jsonb, uuid) TO service_role;

-- ---------------------------------------------------------------
-- C-3: sm_finalize_planning_request -- had NO authorization check
-- at all (not even the flawed pattern above), and p_manager_id was
-- caller-supplied and never verified. Add a real check and bind
-- p_manager_id to the authenticated caller.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sm_finalize_planning_request(p_request_id uuid, p_offer_id uuid, p_manager_id uuid, p_manager_notes text, p_shift_updated_at timestamp with time zone, p_target_shift_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
DECLARE
  v_request       planning_requests%ROWTYPE;
  v_offer         planning_offers%ROWTYPE;
  v_shift_updated timestamptz;
  v_target_updated timestamptz;
BEGIN

  -- P0 security fix (2026-07-27): this function previously had zero
  -- authorization check and trusted p_manager_id verbatim, while
  -- also being anon-executable -- letting an unauthenticated caller
  -- approve shift swap/bid requests and forge the approving
  -- manager's identity in the audit trail.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF NOT (public.is_manager_or_above() OR public.is_admin()) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: caller is not a manager or admin';
    END IF;
    IF p_manager_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'MANAGER_ID_MISMATCH: p_manager_id must match the authenticated caller';
    END IF;
  END IF;

  -- ===========================================================================
  -- STEP 1: Lock the planning_request row for the duration of this transaction.
  -- This prevents two concurrent approve calls from both proceeding.
  -- ===========================================================================

  SELECT *
    INTO v_request
    FROM planning_requests
   WHERE id = p_request_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Planning request % not found', p_request_id;
  END IF;


  -- ===========================================================================
  -- STEP 2: Validate request status.
  -- ===========================================================================

  IF v_request.status <> 'MANAGER_PENDING' THEN
    RAISE EXCEPTION 'WRONG_STATE: request % has status % (expected MANAGER_PENDING)',
      p_request_id, v_request.status;
  END IF;


  -- ===========================================================================
  -- STEP 3: Fetch and validate the selected offer.
  -- ===========================================================================

  SELECT *
    INTO v_offer
    FROM planning_offers
   WHERE id         = p_offer_id
     AND request_id = p_request_id
     AND status     = 'SELECTED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_SELECTED_OFFER: no SELECTED offer % for request %',
      p_offer_id, p_request_id;
  END IF;


  -- ===========================================================================
  -- STEP 4: Optimistic lock check — initiator's shift.
  -- ===========================================================================

  SELECT updated_at
    INTO v_shift_updated
    FROM shifts
   WHERE id = v_request.shift_id;

  IF v_shift_updated IS DISTINCT FROM p_shift_updated_at THEN
    RAISE EXCEPTION 'SHIFT_MUTATED: shift_id=%', v_request.shift_id;
  END IF;


  -- ===========================================================================
  -- STEP 5: Optimistic lock check — offerer's shift (SWAP only).
  -- ===========================================================================

  IF v_request.type = 'SWAP' AND v_offer.offered_shift_id IS NOT NULL THEN

    IF p_target_shift_updated_at IS NULL THEN
      RAISE EXCEPTION 'MISSING_TARGET_SHIFT_TIMESTAMP: SWAP request requires p_target_shift_updated_at';
    END IF;

    SELECT updated_at
      INTO v_target_updated
      FROM shifts
     WHERE id = v_offer.offered_shift_id;

    IF v_target_updated IS DISTINCT FROM p_target_shift_updated_at THEN
      RAISE EXCEPTION 'SHIFT_MUTATED: target_shift_id=%', v_offer.offered_shift_id;
    END IF;

  END IF;


  -- ===========================================================================
  -- STEP 6 / 7: Perform the shift mutation.
  -- BID  → assign initiator to the shift.
  -- SWAP → atomic two-way assignment swap.
  -- ===========================================================================

  IF v_request.type = 'BID' THEN

    -- Assign the winning bidder (the offer submitter) to the open shift.
    UPDATE shifts
       SET assigned_employee_id = v_offer.offered_by,
           workflow_status      = 'IDLE',
           updated_at           = now()
     WHERE id = v_request.shift_id;

  ELSIF v_request.type = 'SWAP' THEN

    -- Two-way atomic swap: both employees exchange shifts simultaneously.
    -- We capture the existing owners first to avoid ordering issues.
    DECLARE
      v_initiator_current_owner uuid;
      v_offerer_current_owner   uuid;
    BEGIN
      SELECT assigned_employee_id INTO v_initiator_current_owner
        FROM shifts WHERE id = v_request.shift_id;

      SELECT assigned_employee_id INTO v_offerer_current_owner
        FROM shifts WHERE id = v_offer.offered_shift_id;

      -- Assign offerer to initiator's shift
      UPDATE shifts
         SET assigned_employee_id = v_offerer_current_owner,
             workflow_status      = 'IDLE',
             updated_at           = now()
       WHERE id = v_request.shift_id;

      -- Assign initiator to offerer's shift
      UPDATE shifts
         SET assigned_employee_id = v_initiator_current_owner,
             workflow_status      = 'IDLE',
             updated_at           = now()
       WHERE id = v_offer.offered_shift_id;
    END;

  END IF;


  -- ===========================================================================
  -- STEP 8: Mark the planning_request as APPROVED.
  -- ===========================================================================

  UPDATE planning_requests
     SET status       = 'APPROVED',
         manager_id   = p_manager_id,
         manager_notes = p_manager_notes,
         decided_at   = now(),
         updated_at   = now()
   WHERE id = p_request_id;

END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sm_finalize_planning_request(uuid, uuid, uuid, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sm_finalize_planning_request(uuid, uuid, uuid, text, timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.sm_finalize_planning_request(uuid, uuid, uuid, text, timestamptz, timestamptz) TO authenticated, service_role;
