-- Bulk Publish Shifts RPC (Set-Based)
-- Replaces iterative loop with set-based update logic.

CREATE OR REPLACE FUNCTION public.sm_bulk_publish_shifts(
    p_shift_ids uuid[],
    p_actor_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total_count int;
    v_success_count int;
    v_actor_name text;
    v_actor_role text;
    v_audit_role text;
BEGIN
    v_total_count := array_length(p_shift_ids, 1);

    -- Get actor details for audit
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

    -- Map role for strict audit constraint
    CASE v_actor_role
        WHEN 'team_member' THEN v_audit_role := 'employee';
        WHEN 'employee' THEN v_audit_role := 'employee';
        WHEN 'admin' THEN v_audit_role := 'admin';
        WHEN 'manager' THEN v_audit_role := 'manager';
        WHEN 'system_automation' THEN v_audit_role := 'system_automation';
        ELSE v_audit_role := 'system_automation';
    END CASE;

    -- 1. Determine Target States for all requested shifts
    -- We calculate new state and fields based on current state and time category
    WITH shift_calculations AS (
        SELECT 
            s.id,
            s.assigned_employee_id,
            get_shift_state_id(s.id) as current_state,
            get_time_category(s.start_time) as time_cat, -- Assuming start_time is the col, or uses get_time_category logic
            s.start_time
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
                -- S1: Draft + Unassigned
                WHEN current_state = 'S1' AND time_cat = 'URGENT' THEN 'S6'
                WHEN current_state = 'S1' AND time_cat = 'NORMAL' THEN 'S5'
                -- S2: Draft + Assigned
                WHEN current_state = 'S2' AND time_cat = 'EMERGENCY' THEN 'S7'
                WHEN current_state = 'S2' THEN 'S3' -- Normal/Urgent assigned -> Offered
                ELSE NULL -- Invalid transition (e.g. Past, Emergency Unassigned, or already published)
            END as new_state_id
        FROM shift_calculations
        WHERE current_state IN ('S1', 'S2') 
          AND time_cat != 'PAST'
          -- Exclude Emergency Unassigned explicitly if logic dictates failure
          AND NOT (current_state = 'S1' AND time_cat = 'EMERGENCY')
    ),
    -- 2. Update Shifts
    updated_rows AS (
        UPDATE shifts s
        SET 
            lifecycle_status = 'Published',
            published_at = NOW(),
            last_modified_by = p_actor_id,
            updated_at = NOW(),
            
            -- Set specific fields based on new state
            bidding_status = CASE 
                WHEN vt.new_state_id = 'S6' THEN 'on_bidding_urgent'
                WHEN vt.new_state_id = 'S5' THEN 'on_bidding_normal'
                ELSE s.bidding_status 
            END,
            
            is_on_bidding = CASE 
                WHEN vt.new_state_id IN ('S5', 'S6') THEN TRUE 
                ELSE s.is_on_bidding 
            END,
            
            bidding_opened_at = CASE 
                WHEN vt.new_state_id IN ('S5', 'S6') THEN NOW() 
                ELSE s.bidding_opened_at 
            END,
            
            fulfillment_status = CASE 
                WHEN vt.new_state_id IN ('S5', 'S6') THEN 'bidding'::shift_fulfillment_status
                WHEN vt.new_state_id = 'S7' THEN 'scheduled'::shift_fulfillment_status
                WHEN vt.new_state_id = 'S3' THEN 'offered'::shift_fulfillment_status
                ELSE s.fulfillment_status
            END,
            
            assignment_outcome = CASE 
                WHEN vt.new_state_id = 'S7' THEN 'emergency_assigned'
                WHEN vt.new_state_id = 'S3' THEN 'offered'
                ELSE s.assignment_outcome
            END,

            confirmed_at = CASE
                WHEN vt.new_state_id = 'S7' THEN NOW()
                ELSE s.confirmed_at
            END

        FROM valid_transitions vt
        WHERE s.id = vt.id
        RETURNING s.id, vt.current_state, vt.new_state_id
    ),
    -- 3. Insert Audit Logs
    audit_inserts AS (
        INSERT INTO shift_audit_events (
            shift_id, event_type, event_category,
            performed_by_id, performed_by_name, performed_by_role,
            old_value, new_value, field_changed, metadata
        )
        SELECT 
            ur.id,
            'shift_published',
            'status',
            p_actor_id,
            COALESCE(v_actor_name, 'System'),
            v_audit_role,
            ur.current_state,
            ur.new_state_id,
            'lifecycle_status',
            jsonb_build_object(
                'reason', 'Bulk Publish', 
                'from_status', ur.current_state, 
                'to_status', ur.new_state_id,
                'bulk_operation', true
            )
        FROM updated_rows ur
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
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$;
