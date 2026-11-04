-- Trading T2 (docs/design/shift-trading/01-trading-fsm.md §3): an offer is
-- SUBMITTED or SELECTED only while its request is live; every way a request
-- ends moves its offers to a terminal status. Approval needs ACCEPTED and
-- cancellation needs CANCELLED. Own migration: a new enum value must commit
-- before any function uses it.
ALTER TYPE public.swap_offer_status ADD VALUE IF NOT EXISTS 'ACCEPTED';
ALTER TYPE public.swap_offer_status ADD VALUE IF NOT EXISTS 'CANCELLED';
