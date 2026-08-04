-- ============================================================================
-- AutoPilot RDT engine — manager-facing queue status view.
--
-- One unified, security-invoker view over both queues that surfaces the LIVE
-- RDT (recomputed via the helpers so a shift-time edit moves the deadline), the
-- disposition, and the derived queue_state label for the AutoPilot control UI.
--
-- bid_review_queue had no manager-read policy (service_role only); add a gamma+
-- read policy mirroring the swap queue so the invoker view returns rows for
-- managers. Writes stay service_role-only (no authenticated write policy = deny).
-- ============================================================================

-- ── Symmetric gamma+ read policy on the bid queue (swap queue already has one) ─
DROP POLICY IF EXISTS bid_review_queue_manager_read ON public.bid_review_queue;
CREATE POLICY bid_review_queue_manager_read ON public.bid_review_queue
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.app_access_certificates c
      WHERE c.user_id = auth.uid() AND c.is_active = true
        AND c.access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
    )
  );

GRANT SELECT ON public.bid_review_queue  TO authenticated;
GRANT SELECT ON public.swap_review_queue TO authenticated;

-- ── Unified queue status view (security_invoker: respects the per-table RLS). ─
CREATE OR REPLACE VIEW public.autopilot_queue_status_v
  WITH (security_invoker = true) AS
WITH rows AS (
  SELECT 'bids'::text AS domain, q.id AS queue_id, q.shift_id AS entity_id,
         q.status::text AS raw_status, q.owner, q.returned_reason, q.attempts,
         q.last_error, q.updated_at,
         public.autopilot_bid_rdt(q.shift_id) AS rdt
  FROM public.bid_review_queue q
  UNION ALL
  SELECT 'swaps'::text, q.id, q.swap_id,
         q.status::text, q.owner, q.returned_reason, q.attempts,
         q.last_error, q.updated_at,
         public.autopilot_swap_rdt(q.swap_id) AS rdt
  FROM public.swap_review_queue q
)
SELECT
  r.domain, r.queue_id, r.entity_id, r.raw_status, r.owner, r.rdt,
  r.returned_reason, r.attempts, r.last_error, r.updated_at,
  public.autopilot_queue_disposition(r.rdt, now()) AS disposition,
  CASE
    WHEN r.raw_status = 'DONE'                       THEN 'RESOLVED'
    WHEN r.raw_status = 'DLQ'                        THEN 'FAILED_MANUAL'
    WHEN r.raw_status = 'RETURNED'                   THEN 'RETURNED_TO_MANAGER'
    WHEN r.raw_status = 'CLAIMED' AND r.owner = 'AUTOPILOT' THEN 'AUTO_RESOLVING'
    WHEN r.raw_status = 'PENDING'
         AND public.autopilot_queue_disposition(r.rdt, now()) = 'ACT_NOW' THEN 'QUEUED'
    ELSE 'WAITING_FOR_RDT'
  END AS queue_state
FROM rows r;

GRANT SELECT ON public.autopilot_queue_status_v TO authenticated;
REVOKE ALL  ON public.autopilot_queue_status_v FROM anon;

COMMENT ON VIEW public.autopilot_queue_status_v IS
  'Manager-facing AutoPilot queue: live RDT + disposition + queue_state for bids and swaps. security_invoker; gamma+ read.';
