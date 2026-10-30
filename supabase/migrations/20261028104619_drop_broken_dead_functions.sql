-- Drop five functions that plpgsql_check proves can only fail, or that are a
-- trigger function attached to nothing, and that nothing calls.
--
-- Found by running plpgsql_check over all 242 PL/pgSQL functions in
-- public/hr/internal inside a rolled-back transaction (the extension was never
-- left installed). No caller in any schema's functions, cron, policies, or the
-- app/edge/test code, except where noted.
--
--   check_daily_hours_limit(uuid,date,numeric)
--   check_monthly_hours_limit(uuid,date,numeric)
--     Read shifts.net_length, which no longer exists. anon could EXECUTE both.
--   sm_request_trade(uuid,uuid)
--     Writes shifts.is_trade_requested, which no longer exists. The app calls
--     the 3-argument overload (p_target_employee_id), which stays.
--   sm_decline_offer(uuid,uuid)
--     Reads and writes shifts.bidding_iteration, which no longer exists, so
--     every call raised. Its only caller, shiftsQueries.declineOffer(), was
--     itself never called: employees decline offers through sm_reject_offer
--     (rosters) and rejectTrade (swaps). The method is removed in the same
--     commit.
--   set_updated_at()
--     Trigger function bound to no trigger.
--
-- sm_materialize_contract_envelope was also flagged, but only because it
-- creates its temp tables at run time; its nightly cron job succeeds. Kept.
--
-- Definitions exported first to
-- ~/Documents/superman-db-exports/2026-10-28/broken-functions/.

DROP FUNCTION public.check_daily_hours_limit(uuid, date, numeric);
DROP FUNCTION public.check_monthly_hours_limit(uuid, date, numeric);
DROP FUNCTION public.sm_request_trade(uuid, uuid);
DROP FUNCTION public.sm_decline_offer(uuid, uuid);
DROP FUNCTION public.set_updated_at();
