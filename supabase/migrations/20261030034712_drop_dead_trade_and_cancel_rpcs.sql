-- sm_request_trade and sm_manager_cancel: nothing calls them.
--
-- Their only client was the planner's People mode, which never invoked the
-- bid / swap / cancel handlers wired to it; the app code is removed with them
-- (useRequestTrade, useCancelShift, shiftsCommands.requestTrade / cancelShift).
-- No function, trigger, policy or cron job references either one. Trades go
-- through sm_create_swap_request; the shift gateway has no cancel op.
--
-- Test: supabase/tests/dead_trade_cancel_rpcs_dropped.sql.
-- Rollback: ~/Documents/superman-db-exports/2026-10-30/dead-trade-cancel-rpcs/.

DROP FUNCTION public.sm_request_trade(uuid, uuid, uuid);
DROP FUNCTION public.sm_manager_cancel(uuid, uuid, text);
