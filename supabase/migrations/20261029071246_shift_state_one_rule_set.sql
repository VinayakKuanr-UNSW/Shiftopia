-- One rule set for a shift's state in the database.
--
-- get_shift_fsm_state() is the reference: the write guard
-- (validate_shift_state_invariants) and 16 functions read state through it.
-- get_shift_state_id(uuid) kept its own copy of the rules, and two live
-- functions decide on it — sm_close_bidding (needs S5/S6) and
-- sm_manager_cancel (refuses S11–S15). The copies disagreed on shapes the
-- write guard allows: InProgress/Completed with no confirmed outcome read
-- INVALID (so manager cancel would accept a completed shift), and a shift
-- flagged is_cancelled read by its lifecycle instead of S15. No row has those
-- shapes today (checked 2026-10-29), so nothing changes for existing data.
--
-- get_shift_state_id(uuid) now delegates; signature, SECURITY DEFINER and
-- grants are unchanged, and it still returns NULL for an unknown id. Replaced
-- from the live definition (md5 9e2bfbd77592e22b9bbeb171410ed902).
--
-- Dropped, no caller in the database or the code:
--   - get_shift_state_id(5 args): every call site passes a shift id.
--   - sm_accept_trade(uuid, uuid): the app calls the 5-argument version.
--   - check_state_machine_invariants_v3(): a diagnostic over the old 15-state
--     model, executable by anon; the write guard enforces the invariants on
--     every write.
--
-- Test: supabase/tests/shift_state_one_rule_set.sql.
-- Rollback: ~/Documents/superman-db-exports/2026-10-29/state-derivers/
-- (functions.sql, grants.sql, SHA256SUMS) — re-run both as a new migration.

CREATE OR REPLACE FUNCTION public.get_shift_state_id(p_shift_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT public.get_shift_fsm_state(
               lifecycle_status, assignment_status, assignment_outcome,
               trading_status, is_cancelled, bidding_status)
      FROM public.shifts
     WHERE id = p_shift_id;
$function$;

DROP FUNCTION public.get_shift_state_id(shift_lifecycle, shift_assignment_status, shift_assignment_outcome, shift_bidding_status, shift_trading);
DROP FUNCTION public.sm_accept_trade(uuid, uuid);
DROP FUNCTION public.check_state_machine_invariants_v3();
