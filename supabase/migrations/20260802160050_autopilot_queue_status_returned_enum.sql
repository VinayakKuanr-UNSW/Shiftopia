-- ============================================================================
-- AutoPilot RDT engine — add the RETURNED queue status to both queue enums.
--
-- Kept in its OWN migration (its own tx) so no statement in this file USES the
-- new value: ALTER TYPE ... ADD VALUE is committed here, then consumed by the
-- next migration (20260802160200). (See notification-system lesson: enum
-- add-value must be split from its first use.)
--
-- Two enums because the queues were built independently:
--   bid_review_queue.status  -> public.autopilot_queue_status
--   swap_review_queue.status -> public.swap_queue_status
-- ============================================================================

ALTER TYPE public.autopilot_queue_status ADD VALUE IF NOT EXISTS 'RETURNED';
ALTER TYPE public.swap_queue_status      ADD VALUE IF NOT EXISTS 'RETURNED';
