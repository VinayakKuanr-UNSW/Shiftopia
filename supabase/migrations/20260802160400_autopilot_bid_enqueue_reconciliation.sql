-- ============================================================================
-- AutoPilot RDT engine — bid-enqueue reconciliation metric.
--
-- WHY: the bid AutoPilot queue's sole entry point is the enqueue trigger, which
-- fires on shifts.bidding_status = 'bidding_closed_no_winner'. A static audit of
-- every committed migration shows NO live code writes that status (it is a dead
-- S8 state — see the archived 20260618140310_remove_s8_bidding_closed_no_winner),
-- so the queue can silently never fill and no bid is ever auto-assigned.
--
-- This view makes that class of bug observable: it lists every shift that SHOULD
-- be a candidate for autonomous auto-assign (published, on-bidding, unassigned,
-- has a pending bid, an ENABLED policy, and whose RDT is still in the future) and
-- flags whether a LIVE queue row exists for it. A persistent non-zero
-- `count(*) FILTER (WHERE NOT enqueued)` means an enqueue path is broken.
--
-- (Reframes the original "bids in bidding_closed_no_winner vs in queue" idea,
--  which would be trivially 0/0 precisely because that status is dead.)
-- ============================================================================

CREATE OR REPLACE VIEW public.autopilot_bid_enqueue_gap_v
  WITH (security_invoker = true) AS
SELECT
  s.id                        AS shift_id,
  s.organization_id,
  s.department_id,
  public.autopilot_bid_rdt(s.id) AS rdt,
  EXISTS (
    SELECT 1 FROM public.bid_review_queue q
     WHERE q.shift_id = s.id
       AND q.status NOT IN ('DONE', 'DLQ', 'RETURNED')  -- a LIVE queue row
  ) AS enqueued
FROM public.shifts s
WHERE s.lifecycle_status = 'Published'
  AND s.bidding_status IN ('on_bidding', 'on_bidding_normal', 'on_bidding_urgent')
  AND s.assignment_status = 'unassigned'
  AND s.is_cancelled = false
  AND s.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.shift_bids b
     WHERE b.shift_id = s.id AND b.status = 'pending'
  )
  AND EXISTS (
    SELECT 1 FROM public.bid_approval_rules r
     WHERE r.organization_id = s.organization_id
       AND (r.department_id = s.department_id OR r.department_id IS NULL)
       AND r.enabled = true
  )
  -- Only shifts the bot could still act on (past-RDT ones are a different alarm).
  AND public.autopilot_bid_rdt(s.id) > now();

GRANT SELECT ON public.autopilot_bid_enqueue_gap_v TO authenticated;
REVOKE ALL  ON public.autopilot_bid_enqueue_gap_v FROM anon;

COMMENT ON VIEW public.autopilot_bid_enqueue_gap_v IS
  'AutoPilot bid-enqueue health: eligible-for-auto-assign shifts and whether a live queue row exists. count(*) FILTER (WHERE NOT enqueued) should trend to 0; a persistent non-zero value means an enqueue path is broken.';
