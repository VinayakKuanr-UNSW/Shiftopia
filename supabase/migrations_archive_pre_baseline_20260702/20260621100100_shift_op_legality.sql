-- Shift mutation gateway — part 2/3: op x state legality matrix.
--
-- fsm_op_is_legal(p_state, p_op) is the single source of truth for whether a
-- requested operation is permitted from a given canonical FSM state. p_state is
-- a label produced by public.get_shift_fsm_state(...) — NEVER recompute from raw
-- columns; always pass the canonical label in.
--
-- Canonical state labels (from 20260610040949_canonical_get_shift_fsm_state.sql):
--   S1  Draft       + unassigned
--   S2  Draft       + assigned
--   S3  Published   + assigned + (pending/offered)  — awaiting decision
--   S4  Published   + assigned + confirmed
--   S5  Published   + unassigned + on_bidding        — bidding OPEN
--   S6  Published   + unassigned + on_bidding_urgent — bidding OPEN (legacy/urgent)
--   S7  Published   + emergency_assigned             — (legacy tombstone)
--   S8  Published   + unassigned + bidding_closed_no_winner — bidding CLOSED (legacy)
--   S9  Published   + TradeRequested                 — trade PENDING
--   S10 Published   + TradeAccepted                  — trade pending APPROVAL
--   S11 InProgress                                   — STARTED
--   S12 InProgress + emergency                       — STARTED
--   S13 Completed                                    — terminal
--   S14 Completed + emergency                        — terminal
--   S15 Cancelled                                    — terminal
--   UNKNOWN                                           — unrecognized
--
-- Conservative default: any unrecognized op OR unrecognized state => false.

CREATE OR REPLACE FUNCTION public.fsm_op_is_legal(p_state text, p_op text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE p_op
    -- select_winner: legal only while bidding is OPEN (unified on_bidding => S5;
    -- legacy urgent => S6). S8 = bidding_closed_no_winner is CLOSED => not legal.
    WHEN 'select_winner' THEN p_state IN ('S5', 'S6')

    -- publish: legal only from an unpublished/draft state, before start.
    -- S1 (Draft+unassigned) and S2 (Draft+assigned) only.
    WHEN 'publish' THEN p_state IN ('S1', 'S2')

    -- unpublish: legal only from Published + before start. Mirrors prod
    -- sm_unpublish_shift (S3/S4/S5). S6 (urgent open bidding) also pre-start +
    -- published, but prod sm_unpublish_shift only admits S3/S4/S5, so be
    -- conservative and admit the same set. Trade-pending (S9/S10) is NOT
    -- unpublishable while a trade is in flight.
    WHEN 'unpublish' THEN p_state IN ('S3', 'S4', 'S5')

    -- assign: legal when unassigned (S1/S5/S6/S8) OR a reassign is allowed on an
    -- assigned-but-not-yet-started shift (S2/S3/S4). NOT legal once in progress
    -- (S11/S12), completed (S13/S14), cancelled (S15), or under a pending trade
    -- (S9/S10 — resolve the trade first). S7 = legacy emergency_assigned, treat
    -- as already assigned & pre-start => reassign allowed.
    WHEN 'assign' THEN p_state IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8')

    -- approve_trade / reject_trade: a manager acts only at S10 = TradeAccepted,
    -- which corresponds to the authoritative shift_swaps.status = 'MANAGER_PENDING'
    -- (the only state swaps.api lets a manager approve OR reject). Acting at S9
    -- (TradeRequested / peer not yet accepted) is premature — the swap is not yet
    -- MANAGER_PENDING, so the gateway would find no swap to act on.
    WHEN 'approve_trade' THEN p_state IN ('S10')
    WHEN 'reject_trade'  THEN p_state IN ('S10')

    -- delete: legal unless completed or already started. Excludes S11/S12
    -- (InProgress), S13/S14 (Completed), and S15 (already terminal/cancelled).
    WHEN 'delete' THEN p_state IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10')

    -- edit: legal unless completed/started. Same admissible set as delete.
    WHEN 'edit' THEN p_state IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10')

    -- Unknown op => not legal (conservative).
    ELSE false
  END;
$function$;

COMMENT ON FUNCTION public.fsm_op_is_legal(text, text) IS
  'Op x canonical-FSM-state legality matrix for the shift mutation gateway. p_state must be a get_shift_fsm_state(...) label. Unknown op/state => false.';

GRANT EXECUTE ON FUNCTION public.fsm_op_is_legal(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fsm_op_is_legal(text, text) TO service_role;
