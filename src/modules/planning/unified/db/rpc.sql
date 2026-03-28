-- =============================================================================
-- sm_finalize_planning_request
-- =============================================================================
--
-- Atomically finalises an approved planning request.
--
-- For BID:
--   Assigns the winning offerer (offer.offered_by) to the open shift.
--
-- For SWAP:
--   Performs a two-way atomic swap of assigned_employee_id between the
--   initiator's shift and the selected offerer's shift.
--
-- Safety guarantees:
--   • Row-level lock on planning_requests prevents concurrent finalisations.
--   • Optimistic lock on shifts.updated_at prevents acting on stale shift data.
--   • All mutations occur inside a single implicit transaction (plpgsql function).
--
-- Error codes raised (via SQLSTATE 'P0001' with the listed strings):
--   WRONG_STATE              — request is not in MANAGER_PENDING status
--   NO_SELECTED_OFFER        — no SELECTED offer found for this request
--   SHIFT_MUTATED: shift_id=X        — initiator's shift was modified since snapshot
--   SHIFT_MUTATED: target_shift_id=X — offerer's shift was modified since snapshot
--   MISSING_TARGET_SHIFT_TIMESTAMP   — SWAP request missing target_shift updated_at
--
-- Parameters:
--   p_request_id              UUID of the planning_request to finalise
--   p_offer_id                UUID of the planning_offer (must have status=SELECTED)
--   p_manager_id              UUID of the approving manager
--   p_manager_notes           Free-text manager notes (may be NULL)
--   p_shift_updated_at        updated_at of the initiator's shift at snapshot time
--   p_target_shift_updated_at updated_at of the offerer's shift at snapshot time (SWAP only)

CREATE OR REPLACE FUNCTION sm_finalize_planning_request(
  p_request_id              uuid,
  p_offer_id                uuid,
  p_manager_id              uuid,
  p_manager_notes           text,
  p_shift_updated_at        timestamptz,
  p_target_shift_updated_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request       planning_requests%ROWTYPE;
  v_offer         planning_offers%ROWTYPE;
  v_shift_updated timestamptz;
  v_target_updated timestamptz;
BEGIN

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
$$;

-- Grant execute to authenticated role (adjust as needed for your RLS setup)
GRANT EXECUTE ON FUNCTION sm_finalize_planning_request(uuid, uuid, uuid, text, timestamptz, timestamptz)
  TO authenticated;
