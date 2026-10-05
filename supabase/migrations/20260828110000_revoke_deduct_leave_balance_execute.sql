-- `deduct_leave_balance_on_approval` is a TRIGGER function, so no client has
-- any reason to reach it over `/rest/v1/rpc/`. It nevertheless carried
-- PUBLIC + anon + authenticated EXECUTE, unlike its two siblings
-- (`accrue_leave_balances`, `seed_leave_balances_for_new_contract`) which are
-- correctly limited to postgres + service_role.
--
-- The exposure PREDATES the cl 55.1/58.2 correction: CREATE OR REPLACE
-- preserves an existing ACL, and the two siblings staying locked through the
-- same replacement is the proof. Closed here because this is the change that
-- touched the function, and a known hole left open next to work that walked
-- past it is how holes become permanent.
--
-- Practical risk was low -- calling a trigger function outside a trigger raises
-- "trigger functions can only be called as triggers" -- but it is SECURITY
-- DEFINER and it writes leave balances, so posture matters more than current
-- exploitability.
--
-- NOTE the standing landmine: revoking from PUBLIC and anon is NOT enough on
-- this project, because Supabase grants EXECUTE to `authenticated` separately.
-- All three are revoked explicitly.

revoke execute on function public.deduct_leave_balance_on_approval() from public;
revoke execute on function public.deduct_leave_balance_on_approval() from anon;
revoke execute on function public.deduct_leave_balance_on_approval() from authenticated;
