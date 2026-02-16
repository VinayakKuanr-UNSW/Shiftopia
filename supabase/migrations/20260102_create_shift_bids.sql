-- Create shift_bids table for the bidding functionality
-- This table stores bids from employees on open shifts

CREATE TABLE IF NOT EXISTS public.shift_bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
    bid_priority INTEGER DEFAULT 1, -- Employee's preference order if bidding on multiple shifts
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES public.employees(id),
    
    -- Ensure an employee can only bid once per shift
    UNIQUE(shift_id, employee_id)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_shift_bids_shift_id ON public.shift_bids(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_bids_employee_id ON public.shift_bids(employee_id);
CREATE INDEX IF NOT EXISTS idx_shift_bids_status ON public.shift_bids(status);

-- Enable Row Level Security
ALTER TABLE public.shift_bids ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Employees can view their own bids
DROP POLICY IF EXISTS "Employees can view own bids" ON public.shift_bids;
CREATE POLICY "Employees can view own bids" ON public.shift_bids
    FOR SELECT
    USING (auth.uid()::text = employee_id::text);

-- Employees can create bids on open shifts
DROP POLICY IF EXISTS "Employees can create bids" ON public.shift_bids;
CREATE POLICY "Employees can create bids" ON public.shift_bids
    FOR INSERT
    WITH CHECK (auth.uid()::text = employee_id::text);

-- Employees can withdraw their own pending bids
DROP POLICY IF EXISTS "Employees can update own pending bids" ON public.shift_bids;
CREATE POLICY "Employees can update own pending bids" ON public.shift_bids
    FOR UPDATE
    USING (auth.uid()::text = employee_id::text AND status = 'pending');

-- Managers can view all bids (for their org - simplified for now to allow all)
DROP POLICY IF EXISTS "Managers can view all bids" ON public.shift_bids;
CREATE POLICY "Managers can view all bids" ON public.shift_bids
    FOR SELECT
    USING (true);

-- Managers can update bid status (approve/reject)
DROP POLICY IF EXISTS "Managers can update bids" ON public.shift_bids;
CREATE POLICY "Managers can update bids" ON public.shift_bids
    FOR UPDATE
    USING (true);

-- Add updated_at trigger
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

-- Also add a bidding_enabled column to shifts table if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shifts' AND column_name = 'bidding_enabled'
    ) THEN
        ALTER TABLE public.shifts ADD COLUMN bidding_enabled BOOLEAN DEFAULT FALSE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shifts' AND column_name = 'bidding_start_at'
    ) THEN
        ALTER TABLE public.shifts ADD COLUMN bidding_start_at TIMESTAMPTZ;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shifts' AND column_name = 'bidding_end_at'
    ) THEN
        ALTER TABLE public.shifts ADD COLUMN bidding_end_at TIMESTAMPTZ;
    END IF;
END $$;

-- Create index for bidding-enabled shifts
CREATE INDEX IF NOT EXISTS idx_shifts_bidding_enabled ON public.shifts(bidding_enabled) WHERE bidding_enabled = true;
