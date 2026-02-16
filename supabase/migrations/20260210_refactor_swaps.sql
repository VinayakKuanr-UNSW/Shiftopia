-- Migration: Refactor Swaps to 1-to-Many Model
-- Date: 2026-02-10

BEGIN;

-- 1. Create Enums
CREATE TYPE public.swap_request_status AS ENUM (
    'OPEN',
    'OFFER_SELECTED',
    'MANAGER_PENDING',
    'APPROVED',
    'REJECTED',
    'CANCELLED',
    'EXPIRED'
);

CREATE TYPE public.swap_offer_status AS ENUM (
    'SUBMITTED',
    'SELECTED',
    'REJECTED',
    'WITHDRAWN',
    'EXPIRED'
);

-- 2. Create swap_offers table
CREATE TABLE public.swap_offers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    swap_request_id UUID NOT NULL REFERENCES public.shift_swaps(id) ON DELETE CASCADE,
    offerer_id UUID NOT NULL REFERENCES public.profiles(id),
    offered_shift_id UUID REFERENCES public.shifts(id), -- Optional (if picking up a shift)
    status public.swap_offer_status NOT NULL DEFAULT 'SUBMITTED',
    compliance_snapshot JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Data Migration: Move existing offers from shift_swaps to swap_offers
INSERT INTO public.swap_offers (swap_request_id, offerer_id, offered_shift_id, status, created_at)
SELECT 
    id,
    target_id,
    target_shift_id,
    CASE 
        WHEN status = 'approved' THEN 'SELECTED'::public.swap_offer_status
        WHEN status = 'pending_employee' THEN 'SUBMITTED'::public.swap_offer_status
        ELSE 'SUBMITTED'::public.swap_offer_status
    END,
    updated_at
FROM public.shift_swaps
WHERE target_id IS NOT NULL;

-- 4. Update shift_swaps to use new status enum (Conceptual Step - see note below)
-- NOTE: We cannot easily change the type of an existing column if it's used by views/RPCs directly without downtime.
-- For this migration, we will ADD a new column `request_status` and sync it, then eventually deprecate `status`.

ALTER TABLE public.shift_swaps ADD COLUMN request_status public.swap_request_status DEFAULT 'OPEN';

-- Sync status
UPDATE public.shift_swaps
SET request_status = CASE
    WHEN status = 'approved' THEN 'APPROVED'::public.swap_request_status
    WHEN status = 'cancelled' THEN 'CANCELLED'::public.swap_request_status
    WHEN status = 'rejected' THEN 'REJECTED'::public.swap_request_status
    WHEN status = 'pending_manager' THEN 'MANAGER_PENDING'::public.swap_request_status
    WHEN target_id IS NOT NULL THEN 'OFFER_SELECTED'::public.swap_request_status -- Logic assumption: if target set on old model, it was "selected" in a way
    ELSE 'OPEN'::public.swap_request_status
END;

-- 5. Add RLS Policies for swap_offers
ALTER TABLE public.swap_offers ENABLE ROW LEVEL SECURITY;

-- Policy: Request owner can view offers
CREATE POLICY "Request owner can view offers" ON public.swap_offers
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.shift_swaps 
            WHERE shift_swaps.id = swap_offers.swap_request_id 
            AND shift_swaps.requester_id = auth.uid()
        )
    );

-- Policy: Offerer can view their own offers
CREATE POLICY "Offerer can view own offers" ON public.swap_offers
    FOR SELECT
    USING (offerer_id = auth.uid());

-- Policy: Offerer can insert
CREATE POLICY "Employees can make offers" ON public.swap_offers
    FOR INSERT
    WITH CHECK (offerer_id = auth.uid());

-- Policy: Offerer can update own offers (withdraw)
CREATE POLICY "Employees can update own offers" ON public.swap_offers
    FOR UPDATE
    USING (offerer_id = auth.uid());

-- Policy: Manager can view all (via organization checks usually, simple for now)
-- Assuming managers have access to all swaps in their org. 
-- For simplicity in this step, we allow authenticated view if not strict. 
-- But strictly:
CREATE POLICY "Managers can view offers" ON public.swap_offers
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND (profiles.legacy_system_role = 'manager' OR profiles.legacy_system_role = 'admin')
        )
    );

COMMIT;
