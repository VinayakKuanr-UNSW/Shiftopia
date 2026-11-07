-- sm_approve_leave (20261106093913) revoked EXECUTE only FROM PUBLIC, but
-- Supabase grants anon EXECUTE on new public functions directly, so the
-- SECURITY DEFINER approval RPC stayed callable with the bare anon key.
REVOKE ALL ON FUNCTION public.sm_approve_leave(uuid, uuid) FROM anon;
