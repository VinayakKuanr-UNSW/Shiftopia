-- 1. Add bidding iteration tracking to shifts
ALTER TABLE public.shifts 
ADD COLUMN IF NOT EXISTS bidding_iteration INT DEFAULT 1,
ADD COLUMN IF NOT EXISTS last_dropped_by UUID REFERENCES public.profiles(id);

-- 2. Add bidding iteration to bids
ALTER TABLE public.shift_bids 
ADD COLUMN IF NOT EXISTS bidding_iteration INT DEFAULT 1;

-- 3. Update uniqueness constraint for shift_bids
-- We drop the old unique index (if it exists) and create a new one that includes iteration
DO $$ 
BEGIN 
    -- Try to drop common index names for (shift_id, employee_id)
    DROP INDEX IF EXISTS public.shift_bids_shift_id_employee_id_key;
    DROP INDEX IF EXISTS public.shift_bids_shift_id_employee_id_idx;
    DROP INDEX IF EXISTS public.shift_bids_unique_idx;
EXCEPTION WHEN OTHERS THEN 
    RAISE NOTICE 'Index drop failed, proceeding...';
END $$;

-- Create the new iteration-aware unique index
CREATE UNIQUE INDEX IF NOT EXISTS shift_bids_iteration_unique_idx 
ON public.shift_bids (shift_id, employee_id, bidding_iteration);

-- 4. Redefine sm_employee_drop_shift to handle iterations
DROP FUNCTION IF EXISTS public.sm_employee_drop_shift(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.sm_employee_drop_shift(
    p_shift_id UUID,
    p_employee_id UUID,
    p_reason TEXT DEFAULT 'Employee dropped shift'
) RETURNS JSONB AS $$
DECLARE
    v_shift RECORD;
    v_new_status public.shift_bidding_status;
    v_tts INTERVAL;
BEGIN
    -- Get shift details
    SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
    END IF;

    -- Calculate Time To Start (using start_time if start_at is null)
    v_tts := COALESCE(v_shift.start_at, (v_shift.shift_date || ' ' || v_shift.start_time)::timestamp) - now();

    -- Check drop rules
    IF v_tts < INTERVAL '4 hours' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Too late to drop: shift starts in less than 4 hours');
    ELSIF v_tts < INTERVAL '24 hours' THEN
        v_new_status := 'on_bidding_urgent'::public.shift_bidding_status;
    ELSE
        v_new_status := 'on_bidding_normal'::public.shift_bidding_status;
    END IF;

    -- Execute the drop: reset assignment, increment iteration, set dropper
    UPDATE public.shifts
    SET 
        assigned_employee_id = NULL,
        assignment_status = 'unassigned'::public.shift_assignment_status,
        assignment_outcome = 'pending'::public.shift_assignment_outcome,
        bidding_status = v_new_status,
        is_on_bidding = true,
        fulfillment_status = 'bidding'::public.shift_fulfillment_status,
        bidding_iteration = COALESCE(bidding_iteration, 1) + 1,
        last_dropped_by = p_employee_id,
        updated_at = now()
    WHERE id = p_shift_id;

    -- Log the drop in audit
    INSERT INTO public.shift_audit_log (
        shift_id, 
        action, 
        actor_id,
        from_state,
        to_state,
        reason,
        metadata
    ) VALUES (
        p_shift_id,
        'UNASSIGN',
        p_employee_id,
        v_shift.bidding_status::TEXT,
        v_new_status::TEXT,
        p_reason,
        jsonb_build_object('iteration', COALESCE(v_shift.bidding_iteration, 1) + 1, 'drop_reason', p_reason)
    );

    RETURN jsonb_build_object(
        'success', true, 
        'new_status', v_new_status, 
        'iteration', COALESCE(v_shift.bidding_iteration, 1) + 1
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Redefine sm_select_bid_winner to handle iterations
DROP FUNCTION IF EXISTS public.sm_select_bid_winner(UUID, UUID, UUID);
CREATE OR REPLACE FUNCTION public.sm_select_bid_winner(
    p_shift_id UUID,
    p_winner_id UUID,
    p_user_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_iteration INT;
BEGIN
    -- Get current shift iteration
    SELECT bidding_iteration INTO v_iteration FROM public.shifts WHERE id = p_shift_id;
    
    -- 1. Mark the winner for THIS iteration
    UPDATE public.shift_bids
    SET status = 'accepted', updated_at = now()
    WHERE shift_id = p_shift_id 
      AND employee_id = p_winner_id
      AND bidding_iteration = v_iteration;

    -- 2. Reject all other bids for THIS iteration
    UPDATE public.shift_bids
    SET status = 'rejected', updated_at = now()
    WHERE shift_id = p_shift_id 
      AND employee_id != p_winner_id
      AND bidding_iteration = v_iteration
      AND status = 'pending';

    -- 3. Finalize the shift assignment
    UPDATE public.shifts
    SET 
        assigned_employee_id = p_winner_id,
        assignment_status = 'assigned'::public.shift_assignment_status,
        assignment_outcome = 'confirmed'::public.shift_assignment_outcome,
        bidding_status = 'not_on_bidding'::public.shift_bidding_status,
        is_on_bidding = false,
        fulfillment_status = 'scheduled'::public.shift_fulfillment_status,
        updated_at = now()
    WHERE id = p_shift_id;

    -- 4. Log the selection in audit
    INSERT INTO public.shift_audit_log (
        shift_id, 
        action, 
        actor_id,
        target_id,
        to_state,
        metadata
    ) VALUES (
        p_shift_id,
        'BID_SELECTED',
        p_user_id,
        p_winner_id,
        'assigned',
        jsonb_build_object('iteration', v_iteration)
    );

    RETURN jsonb_build_object('success', true, 'iteration', v_iteration);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Initialize existing data
UPDATE public.shifts SET bidding_iteration = 1 WHERE bidding_iteration IS NULL;
UPDATE public.shift_bids SET bidding_iteration = 1 WHERE bidding_iteration IS NULL;
