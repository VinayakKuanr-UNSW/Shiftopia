-- =============================================================================
-- Fix RLS infinite recursion on public.shifts, public.shift_swaps, and public.swap_offers
--
-- The client SELECT policies introduced for self-service access control caused
-- a mutual recursion loop:
--   1. SELECT from shifts -> evaluates shifts_select_swap_offers_v2 -> queries swap_offers
--   2. SELECT from swap_offers -> evaluates "Request owner can view offers" -> queries shift_swaps
--   3. SELECT from shift_swaps -> evaluates swaps_select_scoped -> queries shifts
--
-- To break this recursion, this migration defines three SECURITY DEFINER helper
-- functions that run as the database owner (bypassing RLS on subqueries) and
-- recreates the policies to use these helpers.
-- =============================================================================

-- Helper 1: Check if user has access to a swap's organization (Security Definer)
CREATE OR REPLACE FUNCTION public.user_has_access_to_swap(_user_id uuid, _requester_shift_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.shifts s
    JOIN public.app_access_certificates aac ON aac.organization_id = s.organization_id
    WHERE s.id = _requester_shift_id
      AND aac.user_id = _user_id
      AND aac.is_active = true
  );
END;
$$;

-- Helper 2: Check if user has an offer on a swap request (Security Definer)
CREATE OR REPLACE FUNCTION public.user_has_swap_offer(_user_id uuid, _swap_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.swap_offers
    WHERE swap_request_id = _swap_request_id
      AND offerer_id = _user_id
  );
END;
$$;

-- Helper 3: Check if user owns the swap request for a given offer (Security Definer)
CREATE OR REPLACE FUNCTION public.user_owns_swap_request_for_offer(_user_id uuid, _swap_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.shift_swaps
    WHERE id = _swap_request_id
      AND requester_id = _user_id
  );
END;
$$;

-- Recreate swaps_select_scoped policy on public.shift_swaps
DROP POLICY IF EXISTS "swaps_select_scoped" ON "public"."shift_swaps";
CREATE POLICY "swaps_select_scoped" ON "public"."shift_swaps"
  FOR SELECT TO "authenticated"
  USING (
    ("requester_id" = ( SELECT "auth"."uid"() ))
    OR ("target_id" = ( SELECT "auth"."uid"() ))
    OR "public"."user_has_delta_access"(( SELECT "auth"."uid"() ))
    OR public.user_has_swap_offer(( SELECT "auth"."uid"() ), "shift_swaps"."id")
    OR public.user_has_access_to_swap(( SELECT "auth"."uid"() ), "shift_swaps"."requester_shift_id")
  );

-- Recreate "Request owner can view offers" policy on public.swap_offers
DROP POLICY IF EXISTS "Request owner can view offers" ON "public"."swap_offers";
CREATE POLICY "Request owner can view offers" ON "public"."swap_offers"
  FOR SELECT TO "authenticated"
  USING (
    public.user_owns_swap_request_for_offer(( SELECT "auth"."uid"() ), "swap_offers"."swap_request_id")
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Harden the helper grants: Supabase default privileges auto-GRANT EXECUTE to
-- `anon` on new functions. These are SECURITY DEFINER boolean oracles used only
-- inside RLS policies (invoked with a policy-supplied auth.uid()), so no client
-- should call them directly. Revoke anon/PUBLIC so an unauthenticated caller
-- cannot probe org-membership / offer / ownership with two known UUIDs.
-- (Same default-privilege gotcha addressed for the swap RPCs in Phase 2b.)
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.user_has_access_to_swap(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_has_swap_offer(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_owns_swap_request_for_offer(uuid, uuid) FROM anon, PUBLIC;
