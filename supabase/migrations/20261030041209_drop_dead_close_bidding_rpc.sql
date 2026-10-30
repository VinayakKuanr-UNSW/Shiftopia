-- sm_close_bidding: nothing calls it.
--
-- Its only client was shiftsCommands.withdrawShiftFromBidding, which nothing
-- called (removed with the app code). No function, trigger, policy or cron job
-- references it. get_shift_state_id stays: sm_bulk_publish_shifts uses it.
--
-- Test: supabase/tests/dead_trade_cancel_rpcs_dropped.sql.
-- Rollback: ~/Documents/superman-db-exports/2026-10-30/dead-trade-cancel-rpcs/sm_close_bidding.sql.

DROP FUNCTION public.sm_close_bidding(uuid, uuid, text);
