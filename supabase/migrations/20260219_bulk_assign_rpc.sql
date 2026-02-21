-- Bulk Assign Shifts RPC (Set-Based)
-- Replaces iterative loop with set-based update logic.

CREATE OR REPLACE FUNCTION public.sm_bulk_assign(
    p_shift_ids uuid[],
    p_employee_id uuid,
    p_user_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total_count int;
    v_success_count int;
    v_user_name text;
    v_user_role text;
    v_audit_role text;
BEGIN
    v_total_count := array_length(p_shift_ids, 1);

    -- Get actor details for audit
    IF p_user_id IS NOT NULL THEN
        SELECT 
            COALESCE(first_name || ' ' || COALESCE(last_name, ''), email),
            left(lower(legacy_system_role::text), 50)
        INTO v_user_name, v_user_role
        FROM profiles 
        WHERE id = p_user_id;
    ELSE
        v_user_name := 'System';
        v_user_role := 'system_automation';
    END IF;

    -- Map role for strict audit constraint
    CASE v_user_role
        WHEN 'team_member' THEN v_audit_role := 'employee';
        WHEN 'employee' THEN v_audit_role := 'employee';
        WHEN 'admin' THEN v_audit_role := 'admin';
        WHEN 'manager' THEN v_audit_role := 'manager';
        WHEN 'system_automation' THEN v_audit_role := 'system_automation';
        ELSE v_audit_role := 'system_automation';
    END CASE;

    -- 1. Update Shifts
    WITH updated_rows AS (
        UPDATE shifts s
        SET 
            assigned_employee_id = p_employee_id,
            assignment_status = 'assigned',
            
            -- Logic to match previous RPC
            assignment_outcome = CASE 
                WHEN s.lifecycle_status = 'Published' THEN 'confirmed'::shift_assignment_outcome 
                ELSE s.assignment_outcome 
            END,
            
            -- If published, we arguably should set confirmed_at, but following previous logic strictly first.
            -- Actually, if assignment_outcome becomes confirmed, confirmed_at should be set.
            -- I'll improve this slightly:
            confirmed_at = CASE 
                WHEN s.lifecycle_status = 'Published' THEN NOW()
                ELSE s.confirmed_at 
            END,

            updated_at = NOW(),
            last_modified_by = p_user_id
        WHERE s.id = ANY(p_shift_ids)
          AND s.deleted_at IS NULL
        RETURNING s.id, s.lifecycle_status
    ),
    -- 2. Insert Audit Logs
    audit_inserts AS (
        INSERT INTO shift_audit_events (
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
                'reason', 'Bulk assignment', 
                'assigned_to', p_employee_id,
                'bulk_operation', true
            )
        FROM updated_rows ur
    )
    SELECT count(*) INTO v_success_count FROM updated_rows;

    -- Log operation summary
    RAISE NOTICE 'Bulk Assigned: Requested %, Assigned %', v_total_count, v_success_count;

    RETURN jsonb_build_object(
        'success', true,
        'total_requested', v_total_count,
        'success_count', v_success_count,
        'failure_count', v_total_count - v_success_count,
        'message', format('Successfully assigned %s of %s shifts', v_success_count, v_total_count)
    );

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error in sm_bulk_assign: %', SQLERRM;
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$;
