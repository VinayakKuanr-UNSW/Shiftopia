-- Follow-up to 20260917114158_revoke_anon_from_unguarded_definer_rpcs.sql.
--
-- `REVOKE ... FROM anon` was a NO-OP for this one: its ACL carried `=X/postgres`
-- (empty grantee = PUBLIC), so `anon` reached EXECUTE through PUBLIC rather than
-- through a role-specific grant. Verified after the first migration — the anon
-- REST call still returned `false` instead of 42501.
--
-- This is the exact INVERSE of the note in
-- 20260720075804_phase2b_revoke_anon_from_swap_rpcs.sql, which recorded that
-- `REVOKE ... FROM PUBLIC` does not remove a role-specific `anon` grant.
-- Both directions are real: to close a definer RPC you must revoke BOTH, then
-- re-grant the roles that should keep it. Check `proacl` for a bare `=X/` entry.
--
-- `authenticated` and `service_role` hold explicit grants, so they are unaffected.
REVOKE EXECUTE ON FUNCTION "public"."is_shift_timesheet_reviewable"("uuid") FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."is_shift_timesheet_reviewable"("uuid") FROM "anon";
GRANT  EXECUTE ON FUNCTION "public"."is_shift_timesheet_reviewable"("uuid") TO "authenticated";
GRANT  EXECUTE ON FUNCTION "public"."is_shift_timesheet_reviewable"("uuid") TO "service_role";
