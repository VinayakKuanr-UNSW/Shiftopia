-- =============================================================================
-- Phase 1 — Self-service (Bids / Swaps / Leaves) access-control hardening
--
-- Closes the access-control findings from the production-readiness audit
-- (2026-07-20). All changes are behavior-preserving for the current app
-- surfaces (verified read-only against prod srfozdlphoempdattvtx):
--   • Every user carries an active app_access_certificates row with an
--     organization_id → certs are the org-membership source (profiles has none).
--   • Employees only ever read their OWN bids (getMyBids); cross-user bid reads
--     (getShiftBids is dead code; OpenBidsView is the manager /management/bids
--     route). Managers satisfy user_has_delta_access().
--   • The swap "Available" marketplace needs org-wide visibility of OPEN swaps,
--     preserved by the app_access_certificates ⋈ shifts.organization_id clause.
--
-- Definer RPCs (sm_apply_shift_op, sm_accept_trade, sm_select_bid_winner,
-- sm_approve_peer_swap, withdraw_bid_rpc) run as owner and BYPASS RLS, so the
-- tightened client policies below do not affect the authoritative write paths.
--
-- Findings addressed: H1 (anon gateway grant), H3 (write-integrity WITH CHECK),
-- H4 (cross-tenant read scoping), M3 (dead decliner-exclusion → RESTRICTIVE).
--
-- Rollback statements are provided at the bottom (commented).
-- NOT YET APPLIED — pending review + JWT simulation sign-off.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- H1 — Revoke anon/public EXECUTE on the shift-mutation gateway.
-- The body's guard is `IF v_caller IS NOT NULL AND NOT (certified) THEN FORBIDDEN`,
-- so a NULL-uid caller (anon key) skips authorization while SECURITY DEFINER
-- bypasses RLS, and the VERSION_CONFLICT branch leaks the full shift row.
-- Revoking anon/public removes the unauthenticated attack surface entirely;
-- authenticated (cert-gated in-body) + service_role keep their explicit grants.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION "public"."sm_apply_shift_op"("uuid", integer, "text", "jsonb", "uuid") FROM "anon";
REVOKE EXECUTE ON FUNCTION "public"."sm_apply_shift_op"("uuid", integer, "text", "jsonb", "uuid") FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- H4 — Scope bid reads. Was USING(true): any authenticated user could read every
-- bid in every org (notes included). Employees see only their own; managers
-- (delta/epsilon/zeta cert or legacy admin/manager) see all — identical to today.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "bids_select_all" ON "public"."shift_bids";
CREATE POLICY "bids_select_scoped" ON "public"."shift_bids"
  FOR SELECT TO "authenticated"
  USING (
    ("employee_id" = ( SELECT "auth"."uid"() ))
    OR "public"."user_has_delta_access"(( SELECT "auth"."uid"() ))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- H4 — Scope swap reads. Was USING(true): any authenticated user could read every
-- swap in every org. New predicate preserves: requester/target, the offerer
-- (getMyActiveOffers), managers, and the org-wide "Available Swaps" marketplace
-- (getAvailableSwaps) via the caller's active org certificate ⋈ requester shift.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "swaps_select_all" ON "public"."shift_swaps";
CREATE POLICY "swaps_select_scoped" ON "public"."shift_swaps"
  FOR SELECT TO "authenticated"
  USING (
    ("requester_id" = ( SELECT "auth"."uid"() ))
    OR ("target_id" = ( SELECT "auth"."uid"() ))
    OR "public"."user_has_delta_access"(( SELECT "auth"."uid"() ))
    OR EXISTS (
      SELECT 1 FROM "public"."swap_offers" so
      WHERE so."swap_request_id" = "shift_swaps"."id"
        AND so."offerer_id" = ( SELECT "auth"."uid"() )
    )
    OR EXISTS (
      SELECT 1
      FROM "public"."shifts" s
      JOIN "public"."app_access_certificates" aac
        ON aac."organization_id" = s."organization_id"
      WHERE s."id" = "shift_swaps"."requester_shift_id"
        AND aac."user_id" = ( SELECT "auth"."uid"() )
        AND aac."is_active" = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- H3 — Write-integrity WITH CHECK on client UPDATE policies. Without WITH CHECK,
-- Postgres reuses USING for the new row, which only guards ownership columns —
-- so clients could forge `status`. Definer RPCs are unaffected (they bypass RLS).
-- ─────────────────────────────────────────────────────────────────────────────

-- Bids: employees may only leave their bid pending or withdraw it (never
-- self-'accepted'/'rejected'); managers (delta) retain full control
-- (updateBidStatus / updateBulkBidStatus). Employee withdraw uses withdraw_bid_rpc.
DROP POLICY IF EXISTS "bids_update_own" ON "public"."shift_bids";
CREATE POLICY "bids_update_own" ON "public"."shift_bids"
  FOR UPDATE TO "authenticated"
  USING (
    ("employee_id" = ( SELECT "auth"."uid"() ))
    OR "public"."user_has_delta_access"(( SELECT "auth"."uid"() ))
  )
  WITH CHECK (
    "public"."user_has_delta_access"(( SELECT "auth"."uid"() ))
    OR (
      "employee_id" = ( SELECT "auth"."uid"() )
      AND "status" = ANY (ARRAY['pending'::"text", 'withdrawn'::"text"])
    )
  );

-- Swaps: the only legitimate client UPDATE is the requester cancelling an OPEN
-- swap (cancelSwapRequest → status='CANCELLED'). Approve/reject/accept go through
-- definer RPCs. This blocks requester/target self-'APPROVED' forgery (H3).
DROP POLICY IF EXISTS "swaps_update_involved" ON "public"."shift_swaps";
CREATE POLICY "swaps_update_involved" ON "public"."shift_swaps"
  FOR UPDATE TO "authenticated"
  USING (
    ("requester_id" = ( SELECT "auth"."uid"() ))
    OR ("target_id" = ( SELECT "auth"."uid"() ))
    OR "public"."user_has_delta_access"(( SELECT "auth"."uid"() ))
  )
  WITH CHECK (
    "public"."user_has_delta_access"(( SELECT "auth"."uid"() ))
    OR (
      "requester_id" = ( SELECT "auth"."uid"() )
      AND "status" = 'CANCELLED'::"public"."swap_request_status"
    )
  );

-- Offers: an offerer may only WITHDRAW/REJECT their own offer, never self-'SELECTED'
-- (selection is the request owner's action, covered by the separate
-- "Request owner can update offer status" policy). declineOffer/rejectTrade sets
-- REJECTED; a bulk offer withdraw also lands here.
DROP POLICY IF EXISTS "Employees can update own offers" ON "public"."swap_offers";
CREATE POLICY "Employees can update own offers" ON "public"."swap_offers"
  FOR UPDATE TO "public"
  USING ("offerer_id" = ( SELECT "auth"."uid"() ))
  WITH CHECK (
    "offerer_id" = ( SELECT "auth"."uid"() )
    AND "status" = ANY (ARRAY['WITHDRAWN'::"public"."swap_offer_status", 'REJECTED'::"public"."swap_offer_status"])
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- M3 — Decliner exclusion was dead: the two "cannot bid on shifts they
-- dropped/rejected" policies were PERMISSIVE, so they OR-combined with
-- bids_insert_own (always true for own bids) and never blocked a re-bid.
-- Re-create them as RESTRICTIVE so they AND with the permissive insert.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Employees cannot bid on shifts they dropped" ON "public"."shift_bids";
DROP POLICY IF EXISTS "Employees cannot bid on shifts they rejected" ON "public"."shift_bids";

CREATE POLICY "bids_block_dropped_reinsert" ON "public"."shift_bids"
  AS RESTRICTIVE FOR INSERT TO "authenticated"
  WITH CHECK (NOT (EXISTS (
    SELECT 1 FROM "public"."shifts"
    WHERE "shifts"."id" = "shift_bids"."shift_id"
      AND "shifts"."last_dropped_by" = ( SELECT "auth"."uid"() )
  )));

CREATE POLICY "bids_block_rejected_reinsert" ON "public"."shift_bids"
  AS RESTRICTIVE FOR INSERT TO "authenticated"
  WITH CHECK (NOT (EXISTS (
    SELECT 1 FROM "public"."shifts"
    WHERE "shifts"."id" = "shift_bids"."shift_id"
      AND "shifts"."last_rejected_by" = ( SELECT "auth"."uid"() )
  )));

-- =============================================================================
-- ROLLBACK (run manually to revert this migration)
-- =============================================================================
-- GRANT EXECUTE ON FUNCTION "public"."sm_apply_shift_op"("uuid", integer, "text", "jsonb", "uuid") TO "anon";
-- DROP POLICY IF EXISTS "bids_select_scoped" ON "public"."shift_bids";
-- CREATE POLICY "bids_select_all" ON "public"."shift_bids" FOR SELECT TO "authenticated" USING (true);
-- DROP POLICY IF EXISTS "swaps_select_scoped" ON "public"."shift_swaps";
-- CREATE POLICY "swaps_select_all" ON "public"."shift_swaps" FOR SELECT TO "authenticated" USING (true);
-- DROP POLICY IF EXISTS "bids_update_own" ON "public"."shift_bids";
-- CREATE POLICY "bids_update_own" ON "public"."shift_bids" FOR UPDATE TO "authenticated"
--   USING (("employee_id" = ( SELECT "auth"."uid"() )) OR "public"."user_has_delta_access"(( SELECT "auth"."uid"() )));
-- DROP POLICY IF EXISTS "swaps_update_involved" ON "public"."shift_swaps";
-- CREATE POLICY "swaps_update_involved" ON "public"."shift_swaps" FOR UPDATE TO "authenticated"
--   USING (("requester_id" = ( SELECT "auth"."uid"() )) OR ("target_id" = ( SELECT "auth"."uid"() )) OR "public"."user_has_delta_access"(( SELECT "auth"."uid"() )));
-- DROP POLICY IF EXISTS "Employees can update own offers" ON "public"."swap_offers";
-- CREATE POLICY "Employees can update own offers" ON "public"."swap_offers" FOR UPDATE TO "public" USING ("offerer_id" = ( SELECT "auth"."uid"() ));
-- DROP POLICY IF EXISTS "bids_block_dropped_reinsert" ON "public"."shift_bids";
-- DROP POLICY IF EXISTS "bids_block_rejected_reinsert" ON "public"."shift_bids";
-- CREATE POLICY "Employees cannot bid on shifts they dropped" ON "public"."shift_bids" FOR INSERT
--   WITH CHECK (NOT (EXISTS (SELECT 1 FROM "public"."shifts" WHERE "shifts"."id" = "shift_bids"."shift_id" AND "shifts"."last_dropped_by" = ( SELECT "auth"."uid"() ))));
-- CREATE POLICY "Employees cannot bid on shifts they rejected" ON "public"."shift_bids" FOR INSERT
--   WITH CHECK (NOT (EXISTS (SELECT 1 FROM "public"."shifts" WHERE "shifts"."id" = "shift_bids"."shift_id" AND "shifts"."last_rejected_by" = ( SELECT "auth"."uid"() ))));
