-- sm_request_trade, sm_manager_cancel and sm_close_bidding are gone: nothing called them.
--
-- Their only client was the planner's People mode, which never invoked the
-- bid / swap / cancel handlers wired to it (removed with the app code). Trades
-- go through sm_create_swap_request; the gateway has no cancel op. sm_close_bidding's
-- only client was shiftsCommands.withdrawShiftFromBidding, which nothing called.
-- Checks:
--   A. neither function exists, in any overload
--   B. no function body calls either one
-- Ends by raising, so nothing persists.
--
-- Expected output (as the error text):  PASSED (rolled back): A B
-- Last run: 2026-10-30 against Supabase dev — FAILED before the migration, PASSED after.

DO $$
DECLARE
  v_names  text;
  v_passed text := '';
BEGIN
  -- A
  SELECT string_agg(oid::regprocedure::text, ', ') INTO v_names
  FROM pg_proc WHERE proname IN ('sm_request_trade', 'sm_manager_cancel', 'sm_close_bidding');
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): A — still defined: %', v_names;
  END IF;
  v_passed := v_passed || 'A ';

  -- B
  SELECT string_agg(oid::regprocedure::text, ', ') INTO v_names
  FROM pg_proc WHERE prosrc ~ '\m(sm_request_trade|sm_manager_cancel|sm_close_bidding)\(';
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — still called by: %', v_names;
  END IF;
  v_passed := v_passed || 'B';

  RAISE EXCEPTION 'PASSED (rolled back): %', v_passed;
END
$$;
