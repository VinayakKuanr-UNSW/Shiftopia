-- 1. Drop Dependent Policies
DROP POLICY IF EXISTS shifts_select_access ON shifts;
DROP POLICY IF EXISTS swaps_delete_own ON shift_swaps;

-- 2. Update Enum: Add missing values
ALTER TYPE swap_request_status ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE swap_request_status ADD VALUE IF NOT EXISTS 'EXPIRED';

-- 3. Consolidate Status Columns
-- Backfill request_status from legacy status
UPDATE shift_swaps
SET request_status = 'OPEN'
WHERE status = 'pending' OR status = 'pending_employee';

UPDATE shift_swaps
SET request_status = 'MANAGER_PENDING'
WHERE status = 'pending_manager';

UPDATE shift_swaps
SET request_status = 'APPROVED'
WHERE status = 'approved' OR status = 'completed';

UPDATE shift_swaps
SET request_status = 'CANCELLED'
WHERE status = 'cancelled';

UPDATE shift_swaps
SET request_status = 'REJECTED'
WHERE status = 'rejected';

-- Now DROP the old status column
ALTER TABLE shift_swaps DROP COLUMN IF EXISTS status;

-- Rename 'request_status' to 'status'
ALTER TABLE shift_swaps RENAME COLUMN request_status TO status;


-- 4. Recreate Policies
-- shifts_select_access: Allow viewing shifts if they are involved in an OPEN or MANAGER_PENDING swap
CREATE POLICY shifts_select_access ON shifts
FOR SELECT
USING (
  (assigned_employee_id = auth.uid()) OR 
  ((is_published = true) AND 
    ((bidding_status = ANY (ARRAY['on_bidding_normal'::shift_bidding_status, 'on_bidding_urgent'::shift_bidding_status, 'bidding_closed_no_winner'::shift_bidding_status])) OR 
    (EXISTS ( SELECT 1
       FROM shift_swaps ss
       WHERE ((ss.requester_shift_id = shifts.id) OR (ss.target_shift_id = shifts.id)) 
         AND (ss.status IN ('OPEN', 'MANAGER_PENDING', 'APPROVED', 'CANCELLED', 'REJECTED')) -- Broaden visibility or keep to OPEN? Legacy was just 'pending'. Let's include MANAGER_PENDING.
    )))) OR 
  has_permission(auth.uid(), sub_department_id, 'Alpha'::text) OR 
  user_has_delta_access(auth.uid())
);

-- swaps_delete_own: Allow deleting (cancelling) own swaps if OPEN or MANAGER_PENDING
CREATE POLICY swaps_delete_own ON shift_swaps
FOR DELETE
USING (
  ((requester_id = auth.uid()) AND (status IN ('OPEN', 'MANAGER_PENDING'))) OR 
  user_has_delta_access(auth.uid())
);


-- 5. Data Integrity: Ensure only one SELECTED offer per request
CREATE UNIQUE INDEX IF NOT EXISTS unique_selected_offer_per_request 
ON swap_offers (swap_request_id) 
WHERE status = 'SELECTED';


-- 6. New RPC: sm_approve_peer_swap
CREATE OR REPLACE FUNCTION sm_approve_peer_swap(
  p_requester_shift_id uuid,
  p_offered_shift_id uuid, -- nullable (if 1-way)
  p_requester_id uuid,
  p_offerer_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_requester_shift shifts%ROWTYPE;
  v_offered_shift shifts%ROWTYPE;
BEGIN
  -- 1. Validate Requester Shift
  SELECT * INTO v_requester_shift FROM shifts WHERE id = p_requester_shift_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requester shift not found';
  END IF;

  -- 2. Validate Offered Shift (if exists)
  IF p_offered_shift_id IS NOT NULL THEN
    SELECT * INTO v_offered_shift FROM shifts WHERE id = p_offered_shift_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Offered shift not found';
    END IF;
  END IF;

  -- 3. Execute Trade for Requester Shift (Requester -> Offerer)
  UPDATE shifts 
  SET assigned_employee_id = p_offerer_id,
      updated_at = NOW()
  WHERE id = p_requester_shift_id;

  -- 4. Execute Trade for Offered Shift (Offerer -> Requester)
  IF p_offered_shift_id IS NOT NULL THEN
    UPDATE shifts 
    SET assigned_employee_id = p_requester_id,
        updated_at = NOW()
    WHERE id = p_offered_shift_id;
  END IF;

  -- 5. Log Audit Events (Crucial for SM)
  INSERT INTO shift_audit_events (
    shift_id, event_type, old_employee_id, new_employee_id, changed_by, reason, details
  ) VALUES 
  (p_requester_shift_id, 'SWAP_COMPLETED', p_requester_id, p_offerer_id, auth.uid(), 'Swap Approved', '{"method": "sm_approve_peer_swap"}');

  IF p_offered_shift_id IS NOT NULL THEN
    INSERT INTO shift_audit_events (
      shift_id, event_type, old_employee_id, new_employee_id, changed_by, reason, details
    ) VALUES 
    (p_offered_shift_id, 'SWAP_COMPLETED', p_offerer_id, p_requester_id, auth.uid(), 'Swap Approved', '{"method": "sm_approve_peer_swap"}');
  END IF;

END;
$$;
