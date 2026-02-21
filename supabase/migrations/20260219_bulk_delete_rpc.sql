-- Bulk Delete Shifts RPC (Set-Based)
-- Replaces client-side looping with efficient database-side processing.

CREATE OR REPLACE FUNCTION public.sm_bulk_delete_shifts(
    p_shift_ids uuid[],
    p_deleted_by uuid DEFAULT auth.uid(),
    p_reason text DEFAULT NULL
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
BEGIN
    v_total_count := array_length(p_shift_ids, 1);
    
    -- Get user details once for the audit logs
    SELECT 
        COALESCE(first_name || ' ' || COALESCE(last_name, ''), 'System'),
        COALESCE(system_role::text, 'manager')
    INTO v_user_name, v_user_role
    FROM profiles WHERE id = p_deleted_by;

    -- 1. Perform Deletion and capture deleted rows
    WITH deleted_rows AS (
        DELETE FROM shifts
        WHERE id = ANY(p_shift_ids)
        RETURNING *
    ),
    -- 2. Archive to deleted_shifts
    archived_rows AS (
        INSERT INTO deleted_shifts (
            id, template_id, organization_id, department_id, 
            snapshot_data, deleted_by, deleted_reason, deleted_at
        )
        SELECT 
            id, template_id, organization_id, department_id,
            to_jsonb(deleted_rows.*), p_deleted_by, p_reason, now()
        FROM deleted_rows
        ON CONFLICT (id) DO UPDATE SET
            snapshot_data = EXCLUDED.snapshot_data,
            deleted_by = EXCLUDED.deleted_by,
            deleted_reason = EXCLUDED.deleted_reason,
            deleted_at = EXCLUDED.deleted_at
        RETURNING id
    ),
    -- 3. Audit Logging
    audit_logs AS (
        INSERT INTO shift_audit_events (
            shift_id, event_type, event_category,
            performed_by_id, performed_by_name, performed_by_role,
            old_data, metadata
        )
        SELECT
            d.id, 'shift_deleted', 'modification',
            p_deleted_by,
            COALESCE(v_user_name, 'System'),
            COALESCE(v_user_role, 'manager'),
            to_jsonb(d.*),
            jsonb_build_object('reason', p_reason, 'bulk_operation', true)
        FROM deleted_rows d
        RETURNING shift_id
    )
    SELECT count(*) INTO v_success_count FROM deleted_rows;

    -- Log operation summary
    RAISE NOTICE 'Bulk Deleted: Requested %, Deleted %', v_total_count, v_success_count;

    RETURN jsonb_build_object(
        'success', true,
        'total_requested', v_total_count,
        'success_count', v_success_count
    );

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error in sm_bulk_delete_shifts: %', SQLERRM;
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$;
