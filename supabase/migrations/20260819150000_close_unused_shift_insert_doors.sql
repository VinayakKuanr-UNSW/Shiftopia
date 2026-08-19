-- Eleven functions in production INSERT INTO shifts. Exactly one of them
-- (`sm_create_shift`) sits behind the application's shape gate.
--
-- The two backstops now cover the other ten regardless — the CHECK constraints
-- from `20260818231137` for the eight row-decidable rules, and
-- `trg_shift_shape_3_day_typed` from `20260819120000` for the two day-typed
-- ones. That is the correct order of operations: make the rule unavoidable
-- first, then reduce the number of doors, so that removing a door is a tidying
-- exercise and not the thing the guarantee rests on.
--
-- Four of the eleven are also granted to `anon`, and `shifts` carries a
-- table-level INSERT grant to `anon` as well, so only RLS stands between an
-- unauthenticated caller and a write. That is defence-in-depth working, but a
-- shift-writing function callable by `anon` has no reason to exist.
--
--   create_test_shift          zero client callers, named for what it is
--   create_test_shift_v3       zero client callers, named for what it is
--   apply_template_to_date_range (v1)   zero client callers, superseded by v2
--   publish_roster_shift       zero client callers
--
-- The two test helpers are DROPPED. Test scaffolding in a production database
-- is a liability with no offsetting benefit, and both are unreferenced anywhere
-- in the repository.
--
-- The other two are KEPT and merely have their `anon` grant revoked. Unlike the
-- test helpers they are plausible things someone reaches for during an
-- incident, and neither is dangerous once authenticated: both predate
-- `target_employment_type` becoming NOT NULL, so `fn_shift_inherit_template_row`
-- raises 23502 on either of them today. Dropping working-looking functions
-- during a compliance change is a bigger surprise than leaving them narrowed.

DROP FUNCTION IF EXISTS public.create_test_shift(text, integer, uuid);
DROP FUNCTION IF EXISTS public.create_test_shift_v3(text, interval, uuid);

REVOKE ALL ON FUNCTION public.apply_template_to_date_range(uuid, date, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.publish_roster_shift(uuid, uuid, boolean) FROM PUBLIC, anon;
