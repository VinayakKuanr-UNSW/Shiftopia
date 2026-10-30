-- get_shift_delta runs with the caller's rights.
--
-- It was SECURITY DEFINER with no caller check: any signed-in user could read
-- every shift of an organisation (dates, times, status, assignee) by passing
-- its id, whatever shifts' RLS allows them. Its only caller,
-- shiftsQueries.getShiftDelta, patches list caches the user loaded under RLS,
-- so running it as the caller returns every row those caches can hold.
-- The body is unchanged.
--
-- Test: supabase/tests/get_shift_delta_caller_rights.sql.
-- Rollback: ALTER FUNCTION ... SECURITY DEFINER.

ALTER FUNCTION public.get_shift_delta(uuid, timestamp with time zone, uuid[], date, date) SECURITY INVOKER;
