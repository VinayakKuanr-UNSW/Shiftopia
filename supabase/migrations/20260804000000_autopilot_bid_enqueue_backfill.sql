-- ============================================================================
-- AutoPilot bid enqueue — ONE-TIME reconciliation backfill.
--
-- The live enqueue path (trg_enqueue_bid_on_bid, 20260802160500) fires on a bid
-- PLACEMENT. Shifts that already had a pending bid placed BEFORE that trigger
-- existed were therefore never enqueued. This backfills them: every shift that is
-- Published / on-bidding / unassigned, has a pending bid, sits under an ENABLED
-- bid_approval_rules policy, and whose RDT is still in the future gets a queue row
-- carrying the SAME sha256 idempotency key the trigger would mint (shift_id :
-- shift.version : 'on_bidding' : policy_version) so a later placement dedups
-- against it — plus its RDT and an ENQUEUED audit row.
--
-- Idempotent (ON CONFLICT DO NOTHING) and self-limiting: on a fresh/empty DB it is
-- a no-op. Past-RDT shifts are intentionally excluded (the bot can no longer act;
-- managers own them). Mirrors 20260802160500 + 20260802160000 (autopilot_bid_rdt).
-- Applied to prod srfozdlphoempdattvtx 2026-08-04 (123 rows enqueued).
-- ============================================================================

WITH eligible AS (
  SELECT s.id AS shift_id, COALESCE(s.version, 0) AS ver,
         public.autopilot_bid_rdt(s.id) AS rdt,
         (SELECT r.version FROM public.bid_approval_rules r
           WHERE r.organization_id = s.organization_id
             AND (r.department_id = s.department_id OR r.department_id IS NULL)
             AND r.enabled = true
           ORDER BY r.department_id NULLS LAST LIMIT 1) AS pol_ver
  FROM public.shifts s
  WHERE s.lifecycle_status = 'Published'
    AND s.bidding_status IN ('on_bidding', 'on_bidding_normal', 'on_bidding_urgent')
    AND s.assignment_status = 'unassigned'
    AND s.is_cancelled = false AND s.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.shift_bids b WHERE b.shift_id = s.id AND b.status = 'pending')
),
keyed AS (
  SELECT shift_id, rdt, pol_ver,
         encode(extensions.digest(
           shift_id::text || ':' || ver::text || ':' || 'on_bidding:' || pol_ver::text,
           'sha256'), 'hex') AS idem
  FROM eligible
  WHERE pol_ver IS NOT NULL AND rdt > now()
),
ins AS (
  INSERT INTO public.bid_review_queue (shift_id, idempotency_key, rdt)
  SELECT shift_id, idem, rdt FROM keyed
  ON CONFLICT (shift_id, idempotency_key) DO NOTHING
  RETURNING shift_id, idempotency_key, rdt
)
INSERT INTO public.bid_audit_log (shift_id, event_type, actor, detail)
SELECT i.shift_id, 'ENQUEUED', 'system',
       jsonb_build_object('idempotency_key', i.idempotency_key, 'rdt', i.rdt, 'via', 'backfill_20260804')
FROM ins i;
