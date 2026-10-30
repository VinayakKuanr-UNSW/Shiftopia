-- eba_check_assignment was executable by anon and PUBLIC.
--
-- 20261025130000 granted it to authenticated and service_role but never revoked
-- the default EXECUTE that every new function gives PUBLIC. It is SECURITY
-- DEFINER and reads any employee's shifts, leave, qualifications and visa
-- condition, so an anonymous caller with the public anon key could read them
-- for anyone (confirmed 2026-10-26 with a PostgREST call: HTTP 200).
--
-- Revoking closes the anonymous door. Signed-in callers keep EXECUTE because the
-- app's compliance service calls it directly; restricting WHICH employee a
-- signed-in caller may check is a separate change (an authorisation guard).

REVOKE ALL ON FUNCTION public.eba_check_assignment(uuid, uuid, date, time, time, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eba_check_assignment(uuid, uuid, date, time, time, integer, uuid) TO authenticated, service_role;
