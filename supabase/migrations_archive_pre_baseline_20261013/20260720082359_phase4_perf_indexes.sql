-- =============================================================================
-- Phase 4 (M4) — Add missing indexes on hot self-service filter paths.
--
-- swap_offers.swap_request_id: the FK filtered by getSwapOffers/ViewOffersModal
--   and embedded per-swap in the manager list. Only a PARTIAL unique index
--   (WHERE status='SELECTED') existed, so all-status lookups did a seq scan.
-- leave_requests(status, start_date): getTeamLeaveRequests filters status='pending'
--   and range-filters/orders by date; no supporting index existed.
-- =============================================================================
CREATE INDEX IF NOT EXISTS "idx_swap_offers_swap_request_id"
  ON "public"."swap_offers" ("swap_request_id");

CREATE INDEX IF NOT EXISTS "idx_leave_requests_status_start"
  ON "public"."leave_requests" ("status", "start_date");
