-- =============================================================================
-- Phase 2b (corrective) — Revoke EXECUTE on the new swap RPCs from `anon`.
--
-- Supabase default privileges auto-GRANT EXECUTE to the `anon` role whenever a
-- function is created in schema public. The prior migration used
-- `REVOKE ... FROM PUBLIC`, which does NOT remove that role-specific grant, so
-- sm_create_swap_request / sm_cancel_swap_request were briefly anon-executable
-- (and sm_cancel_swap_request treats a NULL caller as service_role-trusted).
-- This revokes the anon grant so both match every other definer swap/bid RPC.
-- =============================================================================
REVOKE EXECUTE ON FUNCTION "public"."sm_create_swap_request"("uuid", "uuid", "text") FROM "anon";
REVOKE EXECUTE ON FUNCTION "public"."sm_cancel_swap_request"("uuid") FROM "anon";
