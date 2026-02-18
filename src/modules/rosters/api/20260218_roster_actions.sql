-- Migration: Roster Locking and Publishing RPCs
-- Date: 2026-02-18
-- Authors: Antigravity

-- 1. Ensure `is_locked` column exists on `rosters` table
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rosters' AND column_name = 'is_locked') THEN
        ALTER TABLE rosters ADD COLUMN is_locked boolean DEFAULT false;
    END IF;
END $$;

-- 2. Create RPC to toggle roster lock for a range
CREATE OR REPLACE FUNCTION toggle_roster_lock_for_range(
    p_org_id uuid,
    p_dept_id uuid,
    p_sub_dept_id uuid,
    p_start_date date,
    p_end_date date,
    p_lock_status boolean,
    p_user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE(updated_count int)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count int;
BEGIN
    -- Update rosters in range matching scope
    WITH updated AS (
        UPDATE rosters r
        SET 
            is_locked = p_lock_status,
            updated_at = now()
        WHERE 
            r.organization_id = p_org_id
            AND r.department_id = p_dept_id
            AND (p_sub_dept_id IS NULL OR r.sub_department_id = p_sub_dept_id)
            AND r.date >= p_start_date
            AND r.date <= p_end_date
        RETURNING r.id
    )
    SELECT count(*) INTO v_count FROM updated;

    -- Return count of updated rosters
    RETURN QUERY SELECT v_count;
END;
$$;

-- 3. Create RPC to publish roster for a range
-- This sets `rosters.status` to 'published' AND publishes all Draft shifts within that roster
CREATE OR REPLACE FUNCTION publish_roster_for_range(
    p_org_id uuid,
    p_dept_id uuid,
    p_sub_dept_id uuid,
    p_start_date date,
    p_end_date date,
    p_user_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_roster_count int;
    v_shift_results jsonb;
    v_shift_ids uuid[];
BEGIN
    -- A. Mark Rosters as Published
    WITH updated_rosters AS (
        UPDATE rosters r
        SET 
            status = 'published',
            updated_at = now()
        WHERE 
            r.organization_id = p_org_id
            AND r.department_id = p_dept_id
            AND (p_sub_dept_id IS NULL OR r.sub_department_id = p_sub_dept_id)
            AND r.date >= p_start_date
            AND r.date <= p_end_date
            AND r.is_locked = false -- Cannot publish locked rosters? Or publishing should be independent? Let's allow publishing regardless of lock for now, or maybe only if unlocked. Let's assume unlocked.
        RETURNING r.id
    )
    SELECT count(*) INTO v_roster_count FROM updated_rosters;

    -- B. Find all Draft/Unpublished shifts in this range/scope that need publishing
    -- We'll use the existing `sm_bulk_publish_shifts` RPC logic, but call it internally or re-implement
    -- To keep it clean, let's collect IDs and call the bulk publish function.
    
    SELECT array_agg(s.id) INTO v_shift_ids
    FROM shifts s
    WHERE 
        s.organization_id = p_org_id
        AND s.department_id = p_dept_id
        AND (p_sub_dept_id IS NULL OR s.sub_department_id = p_sub_dept_id)
        AND s.shift_date >= p_start_date
        AND s.shift_date <= p_end_date
        AND s.lifecycle_status = 'Draft'
        AND s.deleted_at IS NULL;

    -- C. Publish Shifts
    IF v_shift_ids IS NOT NULL AND array_length(v_shift_ids, 1) > 0 THEN
        -- Call existing bulk publish RPC
        v_shift_results := sm_bulk_publish_shifts(v_shift_ids, p_user_id);
    ELSE
        v_shift_results := '{}'::jsonb;
    END IF;

    RETURN json_build_object(
        'rosters_published', v_roster_count,
        'shifts_published', coalesce(array_length(v_shift_ids, 1), 0),
        'shift_results', v_shift_results
    );
END;
$$;
