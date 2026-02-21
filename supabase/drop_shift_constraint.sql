-- Drop the valid_shift_state_combination constraint
-- This constraint is overly restrictive and prevents valid state transitions during swap approval (e.g. TradeApproved).
-- Per skills/state-stable.md, this is a known issue and the constraint should be removed.

ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS valid_shift_state_combination;
