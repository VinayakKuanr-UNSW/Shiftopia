-- Migration: Add withdraw_shift_from_bidding RPC
-- Description: Allows moving a shift from 'published/bidding' back to 'draft/unassigned', effectively stopping the bidding process.
-- Timestamp: 20260123013000

BEGIN;

CREATE OR REPLACE FUNCTION withdraw_shift_from_bidding(
    p_shift_id UUID,
    p_actor_id UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_shift RECORD;
BEGIN
    -- 1. Lock and Get Shift
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
    
    IF v_shift IS NULL THEN
        RAISE EXCEPTION 'Shift not found: %', p_shift_id;
    END IF;

    -- 2. Verify current state (optional strictness, but good for sanity)
    -- We generally allow withdrawing if it's currently on bidding or published.
    
    -- 3. Perform Updates
    UPDATE shifts 
    SET 
        lifecycle_status = 'draft',
        fulfillment_status = 'unassigned',
        assignment_status = 'unassigned',
        is_published = FALSE,
        is_on_bidding = FALSE,
        bidding_enabled = FALSE
        -- We optionally clear bidding timestamps, or leave them for history/next publish
        -- bidding_open_at = NULL,
        -- bidding_close_at = NULL
    WHERE id = p_shift_id;

    -- 4. Log the action (Audit Trail - using existing pattern if any, otherwise simple return)
    -- Assuming an audit log trigger exists on 'shifts' table update.

    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'new_status', 'draft',
        'fulfillment', 'unassigned'
    );

END;
$$;

COMMIT;
