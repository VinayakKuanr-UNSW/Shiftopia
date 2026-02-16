-- Fix Cascade Delete for Shift Swaps and Offers
-- Problem: Deleting a shift (or template) leaves orphaned swap requests or is blocked by offers.
-- Solution: Add ON DELETE CASCADE to foreign keys referencing shifts in shift_swaps and swap_offers.

-- 1. shift_swaps.target_shift_id
-- Current: SET NULL (Leaves broken swap requests)
-- New: CASCADE (Deletes the swap request if the target shift is deleted)

ALTER TABLE public.shift_swaps
DROP CONSTRAINT IF EXISTS shift_swaps_target_shift_id_fkey;

ALTER TABLE public.shift_swaps
ADD CONSTRAINT shift_swaps_target_shift_id_fkey
FOREIGN KEY (target_shift_id)
REFERENCES public.shifts(id)
ON DELETE CASCADE;

-- 2. swap_offers.offered_shift_id
-- Current: NO ACTION (Blocks deletion of shift)
-- New: CASCADE (Deletes the offer if the offered shift is deleted)

ALTER TABLE public.swap_offers
DROP CONSTRAINT IF EXISTS swap_offers_offered_shift_id_fkey;

ALTER TABLE public.swap_offers
ADD CONSTRAINT swap_offers_offered_shift_id_fkey
FOREIGN KEY (offered_shift_id)
REFERENCES public.shifts(id)
ON DELETE CASCADE;
