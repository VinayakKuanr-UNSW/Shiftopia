-- Migration: Create sm_employee_drop_shift RPC
-- Purpose: Allow employees to drop their assigned shifts with time-based bidding logic
-- Rules:
--   >24h before start → on_bidding_normal (S5)
--   4-24h before start → on_bidding_urgent (S6)
--   <4h before start → Blocked (cannot drop)

CREATE OR REPLACE FUNCTION sm_employee_drop_shift(
    p_shift_id UUID,
    p_employee_id UUID,
    p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_shift RECORD;
    v_shift_start TIMESTAMP;
    v_hours_to_start DECIMAL;
    v_new_bidding_status TEXT;
BEGIN
    -- Get shift details
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id AND deleted_at IS NULL;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
    END IF;

    -- Verify the employee is currently assigned to this shift
    IF v_shift.assigned_employee_id IS NULL OR v_shift.assigned_employee_id != p_employee_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You are not assigned to this shift');
    END IF;
    
    -- Verify shift is in a droppable state (Published and Assigned)
    IF v_shift.lifecycle_status != 'Published' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift is not in a droppable state');
    END IF;

    -- Calculate hours until shift starts
    v_shift_start := v_shift.shift_date + v_shift.start_time;
    v_hours_to_start := EXTRACT(EPOCH FROM (v_shift_start - NOW())) / 3600;

    -- Apply time-based rules
    IF v_hours_to_start < 4 THEN
        -- Within 4 hours - cannot drop
        RETURN jsonb_build_object(
            'success', false, 
            'error', 'Cannot drop shift within 4 hours of start time. Please contact your manager.',
            'hours_to_start', ROUND(v_hours_to_start::numeric, 1)
        );
    ELSIF v_hours_to_start < 24 THEN
        -- 4-24 hours - urgent bidding
        v_new_bidding_status := 'on_bidding_urgent';
    ELSE
        -- >24 hours - normal bidding
        v_new_bidding_status := 'on_bidding_normal';
    END IF;

    -- Update shift: unassign employee + push to bidding
    UPDATE shifts SET
        assigned_employee_id = NULL,
        assigned_at = NULL,
        assigned_by_user_id = NULL,
        assignment_status = 'Unassigned',
        assignment_outcome = NULL,
        bidding_status = v_new_bidding_status,
        is_on_bidding = TRUE,
        bidding_opened_at = NOW(),
        cancellation_reason = COALESCE(p_reason, 'Employee dropped shift'),
        updated_at = NOW()
    WHERE id = p_shift_id;

    -- Log audit event
    INSERT INTO shift_audit_events (shift_id, event_type, details)
    VALUES (p_shift_id, 'employee_unassigned', jsonb_build_object(
        'previous_employee_id', p_employee_id,
        'reason', COALESCE(p_reason, 'Employee dropped shift'),
        'action', 'employee_drop',
        'pushed_to_bidding', v_new_bidding_status,
        'hours_to_start', ROUND(v_hours_to_start::numeric, 1)
    ));

    RETURN jsonb_build_object(
        'success', true,
        'new_bidding_status', v_new_bidding_status,
        'hours_to_start', ROUND(v_hours_to_start::numeric, 1),
        'message', CASE 
            WHEN v_new_bidding_status = 'on_bidding_urgent' THEN 'Shift dropped and marked as URGENT for bidding'
            ELSE 'Shift dropped and pushed to normal bidding'
        END
    );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION sm_employee_drop_shift(UUID, UUID, TEXT) TO authenticated;
