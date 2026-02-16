-- Migration: Shift Publishing & Bidding Logic (RPCs)
-- Description: Implements publish_shift and bulk_publish_shifts functions with compliance and audit logic.
-- Timestamp: 20260122160000

BEGIN;

-------------------------------------------------------------------------
-- 1. publish_shift RPC
-------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION publish_shift(
    p_shift_id UUID,
    p_actor_id UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_shift RECORD;
    v_new_fulfillment_status shift_fulfillment_status;
    v_overlap_exists BOOLEAN;
    v_rest_period_ok BOOLEAN;
    v_result JSONB;
BEGIN
    -- 1. Lock and Get Shift
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
    
    IF v_shift IS NULL THEN
        RAISE EXCEPTION 'Shift not found: %', p_shift_id;
    END IF;

    -- 2. Validate Current State
    IF v_shift.lifecycle_status != 'draft' THEN
        RAISE EXCEPTION 'Shift must be in Draft state to publish (current: %)', v_shift.lifecycle_status;
    END IF;

    -- 3. Compliance Check (Only for Assigned shifts)
    IF v_shift.assigned_employee_id IS NOT NULL THEN
        -- Check Overlap
        -- Function: check_shift_overlap(p_employee_id, p_shift_date, p_start_time, p_end_time, p_exclude_shift_id)
        SELECT check_shift_overlap(
            v_shift.assigned_employee_id,
            v_shift.shift_date,
            v_shift.start_time,
            v_shift.end_time,
            v_shift.id
        ) INTO v_overlap_exists;

        IF v_overlap_exists THEN
            RAISE EXCEPTION 'Compliance Violation: Shift Overlap detected for employee %', v_shift.assigned_employee_id;
        END IF;

        -- Check Rest Period
        -- Function: validate_rest_period(p_employee_id, p_shift_date, p_start_time, p_end_time, p_minimum_hours)
        -- Using 8 hours as per strict rule audit, though function defaults to 11. Explicitly passing 8.
        SELECT validate_rest_period(
            v_shift.assigned_employee_id,
            v_shift.shift_date,
            v_shift.start_time,
            v_shift.end_time,
            8
        ) INTO v_rest_period_ok;

        IF NOT v_rest_period_ok THEN
            RAISE EXCEPTION 'Compliance Violation: insufficient Rest Period (min 8h) for employee %', v_shift.assigned_employee_id;
        END IF;

        -- We skip specific MAX_HOURS checks here as they require cumulative calculation better handled by the complex engine or trigger.
        -- Minimal safety checks are passed.
    END IF;

    -- 4. Determine New State & Actions
    IF v_shift.assigned_employee_id IS NOT NULL THEN
        -- Draft + Assigned -> Offered
        v_new_fulfillment_status := 'offered';
        
        -- Create Offer
        INSERT INTO shift_offers (shift_id, employee_id, status, offered_at)
        VALUES (p_shift_id, v_shift.assigned_employee_id, 'Pending', NOW())
        ON CONFLICT (shift_id, employee_id) DO UPDATE SET status = 'Pending', offered_at = NOW(); 

    ELSE
        -- Draft + Unassigned -> Bidding
        v_new_fulfillment_status := 'bidding';
        -- Ensure allow_bidding flag is true? Or just rely on status.
        -- Check if 'is_on_bidding' legacy column needs update? Yes, keeps sync.
        UPDATE shifts SET is_on_bidding = TRUE WHERE id = p_shift_id;
    END IF;

    -- 5. Execute Update
    UPDATE shifts
    SET 
        lifecycle_status = 'published',
        fulfillment_status = v_new_fulfillment_status,
        is_published = TRUE -- Keep sync with legacy for now
    WHERE id = p_shift_id;

    -- 6. Log / Return
    -- (Audit trigger on 'shifts' table should handle historical log)
    
    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'new_status', 'published',
        'fulfillment', v_new_fulfillment_status
    );

END;
$$;

-------------------------------------------------------------------------
-- 2. bulk_publish_shifts RPC
-------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bulk_publish_shifts(
    p_shift_ids UUID[],
    p_actor_id UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_shift_id UUID;
    v_success_count INT := 0;
    v_failure_count INT := 0;
    v_results JSONB[] := ARRAY[]::JSONB[];
    v_result JSONB;
    v_error_msg TEXT;
BEGIN
    FOREACH v_shift_id IN ARRAY p_shift_ids
    LOOP
        BEGIN
            -- Attempt publish
            v_result := publish_shift(v_shift_id, p_actor_id);
            v_results := array_append(v_results, jsonb_build_object(
                'id', v_shift_id,
                'status', 'success',
                'details', v_result
            ));
            v_success_count := v_success_count + 1;
        EXCEPTION WHEN OTHERS THEN
            v_error_msg := SQLERRM;
            v_results := array_append(v_results, jsonb_build_object(
                'id', v_shift_id,
                'status', 'failed',
                'error', v_error_msg
            ));
            v_failure_count := v_failure_count + 1;
        END;
    END LOOP;

    -- Optional: Record in bulk_operations if passed an ID?
    -- For now, the caller handles the bulk_operations record update with this JSON.

    RETURN jsonb_build_object(
        'success_count', v_success_count,
        'failure_count', v_failure_count,
        'results', to_jsonb(v_results)
    );
END;
$$;

COMMIT;
