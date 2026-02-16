-- Migration: Implement Shift Cancellation Logic and Fix Bidding Schema
-- Date: 2026-01-12
-- Author: Antigravity

BEGIN;

-------------------------------------------------------------------------------
-- 1. Schema Repairs: Align Bidding Tables & Add Missing Shift Columns
-------------------------------------------------------------------------------

-- Add missing columns to shifts table to support cancellation logic
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS cancellation_type_text TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS bidding_priority_text TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS bidding_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- We need to drop these tables to recreate them with correct FKs to 'profiles'
DROP TABLE IF EXISTS public.bid_allocation_log CASCADE;
DROP TABLE IF EXISTS public.bid_eligibility_checks CASCADE;
DROP TABLE IF EXISTS public.shift_bids CASCADE;
DROP TABLE IF EXISTS public.shift_bid_windows CASCADE;

-- Recreate: shift_bid_windows
CREATE TABLE public.shift_bid_windows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID UNIQUE NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    opens_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closes_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'allocated')),
    total_bids INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recreate: shift_bids (referencing profiles)
CREATE TABLE public.shift_bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
    bid_priority INTEGER DEFAULT 1,
    suitability_score DECIMAL(5,2) DEFAULT 100.00,
    skill_match_percentage DECIMAL(5,2) DEFAULT 0.00,
    rest_period_valid BOOLEAN DEFAULT true,
    hours_limit_valid BOOLEAN DEFAULT true,
    bid_rank INTEGER,
    allocation_reason TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES public.profiles(id),
    
    UNIQUE(shift_id, employee_id)
);

-- Recreate: bid_eligibility_checks
CREATE TABLE public.bid_eligibility_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bid_id UUID NOT NULL REFERENCES public.shift_bids(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    skills_check BOOLEAN DEFAULT false,
    availability_check BOOLEAN DEFAULT false,
    hours_limit_check BOOLEAN DEFAULT false,
    rest_period_check BOOLEAN DEFAULT false,
    eligibility_errors JSONB DEFAULT '{}',
    is_eligible BOOLEAN DEFAULT false,
    checked_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recreate: bid_allocation_log
CREATE TABLE public.bid_allocation_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    allocated_to_employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    allocation_algorithm TEXT DEFAULT 'sss_based',
    algorithm_version TEXT DEFAULT '1.0',
    total_bids_received INTEGER DEFAULT 0,
    allocation_date TIMESTAMPTZ DEFAULT NOW()
);

-- Updated_at trigger for shift_bids
CREATE OR REPLACE FUNCTION update_shift_bids_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_shift_bids_updated_at ON public.shift_bids;
CREATE TRIGGER trigger_shift_bids_updated_at
    BEFORE UPDATE ON public.shift_bids
    FOR EACH ROW
    EXECUTE FUNCTION update_shift_bids_updated_at();

-- RLS Policies
ALTER TABLE public.shift_bids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Access" ON public.shift_bids FOR ALL USING (true);
ALTER TABLE public.shift_bid_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Access" ON public.shift_bid_windows FOR ALL USING (true);
ALTER TABLE public.bid_eligibility_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Access" ON public.bid_eligibility_checks FOR ALL USING (true);
ALTER TABLE public.bid_allocation_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Access" ON public.bid_allocation_log FOR ALL USING (true);


-------------------------------------------------------------------------------
-- 2. Audit Event Helper
-------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.shift_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    previous_status TEXT,
    new_status TEXT,
    actor_id UUID REFERENCES public.profiles(id),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION log_shift_event(
    p_shift_id UUID,
    p_event_type TEXT,
    p_prev_status TEXT,
    p_new_status TEXT,
    p_metadata JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
    v_event_id UUID;
BEGIN
    INSERT INTO shift_events (shift_id, event_type, previous_status, new_status, actor_id, metadata)
    VALUES (p_shift_id, p_event_type, p_prev_status, p_new_status, auth.uid(), p_metadata)
    RETURNING id INTO v_event_id;
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-------------------------------------------------------------------------------
-- 3. Core Logic: Cancel Shift
-------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.cancel_shift(UUID, TEXT);

CREATE OR REPLACE FUNCTION cancel_shift(
    p_shift_id UUID,
    p_reason TEXT
) RETURNS JSONB AS $$
DECLARE
    v_shift RECORD;
    v_diff_hours NUMERIC;
    v_cancelled_at TIMESTAMPTZ;
    v_cancel_type TEXT;
    v_prev_status TEXT;
    v_new_status TEXT;
    v_closes_at TIMESTAMPTZ;
    v_window_id UUID;
    v_shift_start TIMESTAMPTZ;
    v_rows INTEGER;
BEGIN
    -- 1. Fetch Shift & Validate
    SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift not found';
    END IF;
    
    -- Construct start timestamp (handle case where start_time is just TIME or TIMETZ)
    v_shift_start := (v_shift.shift_date || ' ' || v_shift.start_time)::TIMESTAMPTZ;

    -- IF v_shift.is_cancelled THEN
    --     RAISE EXCEPTION 'Shift is already cancelled';
    -- END IF;
    
    IF v_shift_start < NOW() THEN
        RAISE EXCEPTION 'Cannot cancel a shift that has already started';
    END IF;

    -- 2. Calculate Time Difference
    v_cancelled_at := NOW();
    v_diff_hours := EXTRACT(EPOCH FROM (v_shift_start - v_cancelled_at)) / 3600;
    
    v_prev_status := v_shift.status;
    
    -- 3. Update Shift to Release Employee
    UPDATE public.shifts 
    SET 
        is_cancelled = FALSE, 
        assigned_employee_id = NULL,
        employee_id = NULL,
        updated_at = NOW(),
        assignment_status_text = 'unassigned', 
        assignment_method_text = NULL,
        assigned_at = NULL,
        cancellation_reason = p_reason
    WHERE id = p_shift_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RAISE EXCEPTION 'Shift update failed - Shift not found or access denied';
    END IF;

    -- 4. Logic Branching
    
    -- CASE A: Standard (> 24h)
    IF v_diff_hours > 24 THEN
        v_cancel_type := 'STANDARD';
        v_new_status := 'open';
        v_closes_at := v_shift_start - INTERVAL '4 hours';
        
        -- Clean up any existing window
        DELETE FROM public.shift_bid_windows WHERE shift_id = p_shift_id;
        
        -- Create Bidding Window
        INSERT INTO public.shift_bid_windows (shift_id, opens_at, closes_at, status)
        VALUES (p_shift_id, NOW(), v_closes_at, 'open')
        RETURNING id INTO v_window_id;
        
        -- Tag shift as bidding enabled
        UPDATE public.shifts SET 
            bidding_enabled = TRUE, 
            status = 'open',
            cancellation_type_text = 'standard'
        WHERE id = p_shift_id;
        
        PERFORM log_shift_event(p_shift_id, 'SHIFT_CANCELLED_STANDARD', v_prev_status, 'open', 
            jsonb_build_object('reason', p_reason, 'diff_hours', v_diff_hours, 'window_id', v_window_id));
            
        PERFORM log_shift_event(p_shift_id, 'SHIFT_PUSHED_TO_BIDDING', v_prev_status, 'open', NULL);

    -- CASE B: Late (4h < diff <= 24h)
    ELSIF v_diff_hours > 4 THEN
        v_cancel_type := 'LATE';
        v_new_status := 'open';
        v_closes_at := v_shift_start - INTERVAL '4 hours';
        
        DELETE FROM public.shift_bid_windows WHERE shift_id = p_shift_id;
        
        INSERT INTO public.shift_bid_windows (shift_id, opens_at, closes_at, status)
        VALUES (p_shift_id, NOW(), v_closes_at, 'open')
        RETURNING id INTO v_window_id;
        
        UPDATE public.shifts SET 
            bidding_enabled = TRUE, 
            status = 'open',
            cancellation_type_text = 'late',
            bidding_priority_text = 'urgent'
        WHERE id = p_shift_id;
        
        PERFORM log_shift_event(p_shift_id, 'SHIFT_CANCELLED_LATE', v_prev_status, 'open', 
            jsonb_build_object('reason', p_reason, 'diff_hours', v_diff_hours, 'urgency', 'URGENT'));
            
        PERFORM log_shift_event(p_shift_id, 'SHIFT_PUSHED_TO_BIDDING_URGENT', v_prev_status, 'open', NULL);

    -- CASE C: Manager Review (<= 4h)
    ELSE
        v_cancel_type := 'MANAGER_REVIEW';
        v_new_status := 'pending';
        
        UPDATE public.shifts SET 
            status = 'pending',
            cancellation_type_text = 'critical'
        WHERE id = p_shift_id;
        
        PERFORM log_shift_event(p_shift_id, 'SHIFT_CANCELLED_CRITICAL', v_prev_status, 'pending', 
           jsonb_build_object('reason', p_reason, 'diff_hours', v_diff_hours));
           
        PERFORM log_shift_event(p_shift_id, 'SHIFT_REQUIRES_MANAGER_REVIEW', v_prev_status, 'pending', NULL);
    END IF;
    
    RETURN jsonb_build_object(
        'success', true,
        'cancellation_type', v_cancel_type,
        'new_status', v_new_status,
        'window_id', v_window_id,
        'final_shift_state', (SELECT to_jsonb(s) FROM public.shifts s WHERE id = p_shift_id)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
