
-- Remediation: Fix assign_shift_rpc to enforce invariants and set correct status
-- Date: 2026-01-25

CREATE OR REPLACE FUNCTION assign_shift_rpc(
    p_shift_id UUID,
    p_employee_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_shift RECORD;
    v_new_assignment_status public.shift_assignment_status;
    v_new_assignment_outcome public.shift_assignment_outcome;
    v_new_fulfillment_status public.shift_fulfillment_status;
BEGIN
    -- Validate shift exists
    SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift not found';
    END IF;
    
    -- Prevent assignment after shift has started
    IF (v_shift.shift_date || ' ' || v_shift.start_time)::TIMESTAMP AT TIME ZONE COALESCE(v_shift.timezone, 'Australia/Sydney') <= NOW() THEN
        RAISE EXCEPTION 'Cannot assign shift after it has started';
    END IF;
    
    -- Check for strict re-assignment blocking
    IF v_shift.assignment_outcome = 'confirmed' AND p_employee_id IS NOT NULL THEN
        -- Allow re-assignment only if it's the SAME employee (idempotency)
        IF v_shift.assigned_employee_id = p_employee_id THEN
             RETURN jsonb_build_object(
                'success', true,
                'message', 'Employee already assigned and confirmed'
             );
        END IF;
        
        RAISE EXCEPTION 'Cannot overwrite a confirmed assignment. Cancel the current assignment first.';
    END IF;

    -- Determine new states
    IF p_employee_id IS NOT NULL THEN
        v_new_assignment_status := 'assigned';
        v_new_assignment_outcome := 'confirmed'; -- Direct assignment implies confirmation
        v_new_fulfillment_status := 'scheduled';
    ELSE
        v_new_assignment_status := 'unassigned';
        v_new_assignment_outcome := NULL;
        v_new_fulfillment_status := NULL;
    END IF;

    -- Perform assignment
    UPDATE public.shifts SET
        assigned_employee_id = p_employee_id,
        employee_id = p_employee_id, -- Legacy sync
        
        -- Modern State Columns
        assignment_status = v_new_assignment_status,
        assignment_outcome = v_new_assignment_outcome,
        fulfillment_status = v_new_fulfillment_status,
        
        -- Legacy Text Columns
        assignment_status_text = CASE WHEN p_employee_id IS NOT NULL THEN 'assigned' ELSE 'unassigned' END,
        
        assigned_at = CASE 
            WHEN p_employee_id IS NOT NULL THEN NOW() 
            ELSE NULL 
        END,
        updated_at = NOW()
    WHERE id = p_shift_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'employee_id', p_employee_id,
        'message', CASE 
            WHEN p_employee_id IS NOT NULL THEN 'Shift assigned successfully'
            ELSE 'Shift unassigned successfully'
        END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
