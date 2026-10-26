-- ============================================================================
-- Drop six functions that assign people to shifts and that nothing calls
--
-- Each wrote shifts.assigned_employee_id outside the gateway. Checked
-- 2026-10-26: no reference in src/, supabase/functions/, optimizer-service/
-- or scripts/; no other SQL function calls them; no cron job runs them.
-- (sm_approve_peer_swap was on the same list and is KEPT: the gateway's
-- approve_trade op calls it.)
--
-- Plain DROP, no CASCADE: anything still depending on one of them stops this
-- migration instead of being dropped with it.
-- ============================================================================

DROP FUNCTION public.assign_shift_employee(uuid, uuid, uuid);
DROP FUNCTION public.emergency_assign_shift(uuid, uuid, uuid, text);
DROP FUNCTION public.select_bid_winner(uuid, uuid, uuid);
DROP FUNCTION public.select_bidding_winner(uuid, uuid, uuid);
DROP FUNCTION public.sm_approve_trade(uuid, uuid, uuid);
DROP FUNCTION public.sm_bulk_assign(uuid[], uuid, uuid);
