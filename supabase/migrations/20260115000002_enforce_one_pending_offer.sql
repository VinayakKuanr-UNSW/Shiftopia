-- Create a unique partial index to prevent a shift from being offered multiple times simultaneously
-- Only one "pending" offer allowed per offered_shift_id
CREATE UNIQUE INDEX unique_pending_offer_per_shift
ON public.swap_offers (offered_shift_id)
WHERE status = 'pending';

COMMENT ON INDEX unique_pending_offer_per_shift IS 'Ensures a shift cannot be offered in multiple pending swap requests simultaneously.';
