-- ============================================================================
-- Revoke anon EXECUTE on get_employee_quarterly_performance()
-- ============================================================================
-- Supabase auto-grants EXECUTE to the `anon` role on newly created functions
-- in the exposed API schema, separate from the PUBLIC pseudo-role —
-- `REVOKE ALL ... FROM PUBLIC` in the migration that created this function
-- did not close it. Caught immediately by get_advisors after applying that
-- migration (WARN: "Public Can Execute SECURITY DEFINER Function").
-- Internal logic already rejected anon callers (auth.uid() is NULL for
-- unauthenticated requests, so neither the self-match nor
-- is_manager_or_above() branch can pass), but the function shouldn't be
-- reachable at the grant level in the first place.
-- ============================================================================

REVOKE ALL ON FUNCTION "public"."get_employee_quarterly_performance"("uuid", integer, integer) FROM "anon";
