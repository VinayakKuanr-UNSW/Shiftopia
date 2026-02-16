-- Migration: Fix withdraw_shift_from_bidding RPC to set is_draft = TRUE
-- Description: Ensures that when a shift is withdrawn from bidding, it is explicitly marked as a draft.
-- Timestamp: 20260123014500

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

    -- 2. Update to Draft State
    UPDATE shifts 
    SET 
        lifecycle_status = 'draft',
        fulfillment_status = 'unassigned',
        assignment_status = 'unassigned',
        is_published = FALSE,
        is_draft = TRUE, -- Explicitly set back to draft
        is_on_bidding = FALSE,
        bidding_enabled = FALSE
    WHERE id = p_shift_id;

    -- 3. Return Success
    RETURN jsonb_build_object(
        'success', true,
        'shift_id', p_shift_id,
        'new_status', 'draft',
        'is_draft', true
    );

END;
$$;

COMMIT;
