-- Migration: Fix DnD shift moves (v3 - Type Casting Fix)
-- ============================================================
-- Problem: 
-- 1) notify_user() missing (Fixed in v2)
-- 2) Type mismatch: group_type column is an ENUM (template_group_type),
--    but RPC parameter was TEXT.
--
-- Solution:
-- 1) Create/Fix no-op notify_user.
-- 2) Update sm_move_shift with explicit type casting.
-- ============================================================

-- Step 1: Create no-op notify_user
CREATE OR REPLACE FUNCTION public.notify_user(
    VARIADIC args TEXT[] DEFAULT '{}'
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_user(
    p_user_id UUID,
    p_arg2 TEXT DEFAULT NULL,
    p_arg3 TEXT DEFAULT NULL,
    p_text1 TEXT DEFAULT NULL,
    p_arg5 TEXT DEFAULT NULL,
    p_arg6 TEXT DEFAULT NULL,
    p_text2 TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    NULL;
END;
$$;

-- Step 2: Create sm_move_shift RPC with explicit casting for ENUM types
CREATE OR REPLACE FUNCTION public.sm_move_shift(
    p_shift_id UUID,
    p_group_type TEXT DEFAULT NULL,
    p_sub_group_name TEXT DEFAULT NULL,
    p_shift_group_id UUID DEFAULT NULL,
    p_roster_subgroup_id UUID DEFAULT NULL,
    p_shift_date DATE DEFAULT NULL,
    p_user_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_status TEXT;
    v_is_cancelled   BOOLEAN;
    v_found          BOOLEAN;
BEGIN
    -- 1. HARDEN STATUS CHECK (Safety Gate)
    SELECT lifecycle_status, is_cancelled 
    INTO v_current_status, v_is_cancelled 
    FROM shifts 
    WHERE id = p_shift_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
    END IF;

    IF v_current_status != 'Draft' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only Draft shifts can be moved. (Current: ' || v_current_status || ')');
    END IF;

    IF v_is_cancelled THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot move cancelled shifts');
    END IF;

    -- 2. UPDATE POSITION
    UPDATE shifts SET
        -- Cast TEXT parameter to the ENUM type required by the table
        group_type         = CASE 
                                WHEN p_group_type IS NULL THEN group_type 
                                ELSE p_group_type::template_group_type 
                             END,
        sub_group_name     = COALESCE(p_sub_group_name, sub_group_name),
        shift_group_id     = p_shift_group_id,
        roster_subgroup_id = p_roster_subgroup_id,
        shift_date         = COALESCE(p_shift_date, shift_date),
        roster_date        = COALESCE(p_shift_date, roster_date),
        updated_at         = NOW(),
        last_modified_by   = p_user_id
    WHERE id = p_shift_id
      AND deleted_at IS NULL;

    v_found := FOUND;

    IF NOT v_found THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found or already deleted');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;
