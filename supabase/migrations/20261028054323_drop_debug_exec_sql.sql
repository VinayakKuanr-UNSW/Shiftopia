-- debug_exec_sql: an arbitrary-SQL executor open to every signed-in user.
--
-- SECURITY DEFINER, owned by postgres, and EXECUTE granted to authenticated
-- (baseline ACL, re-baselined from prod on 2026-10-13). Its body ran the
-- caller's string through EXECUTE with no check of any kind, so any account,
-- and sign-up is open, could read, change or drop anything in the database
-- as postgres via /rest/v1/rpc/debug_exec_sql.
--
-- Nothing calls it: no app code, edge function, service, trigger, cron job,
-- policy or other function. It only ever appeared in the generated types.
-- Dropped rather than guarded, because a debug back door has no legitimate
-- caller to protect.

REVOKE ALL ON FUNCTION public.debug_exec_sql(text) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.debug_exec_sql(text);
