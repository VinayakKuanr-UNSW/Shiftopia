-- Function to approve a swap request
CREATE OR REPLACE FUNCTION approve_swap_request(request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_request record;
    v_original_shift record;
    v_offered_shift record;
    v_actor_id uuid;
BEGIN
    -- Get current user
    v_actor_id := auth.uid();
    
    -- 1. Lock and Retrieve Request
    SELECT * INTO v_request 
    FROM swap_requests 
    WHERE id = request_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Swap request not found';
    END IF;

    -- 2. Validate Request Status
    IF v_request.status NOT IN ('pending_manager', 'pending_employee') THEN
        RAISE EXCEPTION 'Swap request is not in complete pending state (current status: %)', v_request.status;
    END IF;

    -- 3. Validate Shifts
    IF v_request.original_shift_id IS NULL OR v_request.offered_shift_id IS NULL THEN
        RAISE EXCEPTION 'Cannot approve swap: missing one or both shifts';
    END IF;

    SELECT * INTO v_original_shift FROM shifts WHERE id = v_request.original_shift_id;
    SELECT * INTO v_offered_shift FROM shifts WHERE id = v_request.offered_shift_id;

    IF v_original_shift IS NULL OR v_offered_shift IS NULL THEN
        RAISE EXCEPTION 'One or both shifts not found';
    END IF;

    IF v_original_shift.is_cancelled OR v_offered_shift.is_cancelled THEN
        RAISE EXCEPTION 'One or both shifts are cancelled';
    END IF;

    IF v_original_shift.scheduled_start < now() OR v_offered_shift.scheduled_start < now() THEN
        RAISE EXCEPTION 'Cannot swap past shifts';
    END IF;

    -- 4. Execute Swap (Update Shifts)
    -- Update original shift to be owned by target employee
    UPDATE shifts 
    SET employee_id = v_request.swap_with_employee_id,
        updated_at = now()
    WHERE id = v_request.original_shift_id;

    -- Update offered shift to be owned by requesting employee
    UPDATE shifts 
    SET employee_id = v_request.requested_by_employee_id,
        updated_at = now()
    WHERE id = v_request.offered_shift_id;

    -- 5. Update Request Status
    UPDATE swap_requests
    SET status = 'approved',
        approved_by_manager_id = v_actor_id,
        manager_approved_at = now(),
        updated_at = now()
    WHERE id = request_id;

    -- 6. Log to Audit
    INSERT INTO swap_audit_logs (swap_request_id, actor_id, previous_status, new_status, reason)
    VALUES (request_id, v_actor_id, v_request.status, 'approved', 'Manager approval via RPC');

    -- Note: shift_audit_events should be triggered automatically by table triggers on 'shifts'

    -- 7. Create Approval Record (reuse existing table)
    INSERT INTO swap_approvals (swap_request_id, approver_id, action, actioned_at)
    VALUES (request_id, v_actor_id, 'approved', now());

END;
$$;

-- Function to reject a swap request
CREATE OR REPLACE FUNCTION reject_swap_request(request_id uuid, reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_request record;
    v_actor_id uuid;
BEGIN
    v_actor_id := auth.uid();

    -- 1. Lock Request
    SELECT * INTO v_request 
    FROM swap_requests 
    WHERE id = request_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Swap request not found';
    END IF;

    IF v_request.status NOT IN ('pending_manager', 'pending_employee') THEN
        RAISE EXCEPTION 'Swap request is not pending';
    END IF;

    IF reason IS NULL OR trim(reason) = '' THEN
        RAISE EXCEPTION 'Rejection reason is required';
    END IF;

    -- 2. Update Status
    UPDATE swap_requests
    SET status = 'rejected',
        rejection_reason = reason,
        updated_at = now()
    WHERE id = request_id;

    -- 3. Log Audit
    INSERT INTO swap_audit_logs (swap_request_id, actor_id, previous_status, new_status, reason)
    VALUES (request_id, v_actor_id, v_request.status, 'rejected', reason);

    -- 4. Log Approval (Rejection)
    INSERT INTO swap_approvals (swap_request_id, approver_id, action, comments, actioned_at)
    VALUES (request_id, v_actor_id, 'rejected', reason, now());

END;
$$;
