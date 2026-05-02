-- ==========================================
-- ALIGN SWAP SCHEMAS
-- ==========================================

-- 1. Shift Swaps
ALTER TABLE public.shift_swaps
ADD COLUMN IF NOT EXISTS swap_type text DEFAULT 'one_to_one',
ADD COLUMN IF NOT EXISTS reason text,
ADD COLUMN IF NOT EXISTS target_accepted boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS target_response_at timestamptz,
ADD COLUMN IF NOT EXISTS manager_approved boolean,
ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS approved_at timestamptz,
ADD COLUMN IF NOT EXISTS rejection_reason text,
ADD COLUMN IF NOT EXISTS expires_at timestamptz,
ADD COLUMN IF NOT EXISTS status_changed_at timestamptz DEFAULT now();

-- 2. Swap Offers (Already mostly aligned, but ensuring foreign keys)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'swap_offers_swap_request_id_fkey') THEN
        ALTER TABLE public.swap_offers ADD CONSTRAINT swap_offers_swap_request_id_fkey FOREIGN KEY (swap_request_id) REFERENCES public.shift_swaps(id);
    END IF;
END $$;
