-- Prints the database's answer to "what state is this shift in?" for every
-- combination of the state columns the write guard allows, as JSON. Read-only.
--
--   . scripts/db/prod-connection.sh
--   prod_psql -f - < scripts/db/fsm-parity-snapshot.sql \
--     > src/modules/rosters/domain/__tests__/fsm-db-snapshot.json
--
-- shift-fsm-db-parity.test.ts checks getShiftFSMState against it.
-- Allowed = the CHECK constraints on shifts (outcome is NULL/confirmed/no_show)
-- plus validate_shift_state_invariants (a cancelled shift skips its checks).
-- Bidding takes the two values anything writes; the inert tombstones
-- (on_bidding_urgent, bidding_closed_no_winner) have no writer and no row.

WITH combos AS (
  SELECT l, a, o, t, c, b
    FROM unnest(enum_range(NULL::shift_lifecycle)) l,
         unnest(enum_range(NULL::shift_assignment_status)) a,
         (VALUES (NULL::shift_assignment_outcome), ('confirmed'), ('no_show')) oo(o),
         unnest(enum_range(NULL::shift_trading)) t,
         unnest(ARRAY[false, true]) c,
         (VALUES ('not_on_bidding'::shift_bidding_status), ('on_bidding')) bb(b)
)
SELECT coalesce(jsonb_pretty(jsonb_agg(jsonb_build_object(
           'lifecycle', l, 'assignment', a, 'outcome', o, 'trading', t,
           'cancelled', c, 'bidding', b,
           'state', public.get_shift_fsm_state(l, a, o, t, c, b))
         ORDER BY l, a, o NULLS FIRST, t, c, b)), '[]')
  FROM combos
 WHERE c OR (
       NOT (a = 'unassigned' AND o IS NOT NULL)
   AND NOT (l IN ('Completed', 'InProgress') AND a <> 'assigned')
   AND NOT (l = 'Published' AND a = 'assigned' AND o IS NOT NULL AND o <> 'confirmed')
   AND NOT (l = 'Published' AND a = 'unassigned' AND b = 'not_on_bidding'));
