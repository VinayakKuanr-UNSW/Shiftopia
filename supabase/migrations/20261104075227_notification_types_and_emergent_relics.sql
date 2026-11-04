-- ============================================================================
-- Notifications: one live breakage, three relics.
--   shift_dropped  sm_employee_drop_shift's trigger sends it, but the value was
--                  never in notification_type, so the 8-arg notify_user cast
--                  failed and every employee drop (with a manager to notify)
--                  rolled back. The app already renders it.
--   dropped triggers, none of which can fire correctly any more:
--     trg_emergency_assignment_notification  emergent-lane relic: still sent
--        "Emergency Shift Assignment" for any fill within 4h.
--     trg_offer_expired_notification  fires only on assignment_outcome
--        'offered', which the outcome CHECK forbids.
--     trg_bidding_expired_notification  built for the retired T-4h bidding
--        timeout; it now told managers "no winner" when they unpublished a
--        bidding shift.
-- ============================================================================
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'shift_dropped';

DROP TRIGGER trg_emergency_assignment_notification ON public.shifts;
DROP FUNCTION public.trg_emergency_assignment_notification_fn();
DROP TRIGGER trg_offer_expired_notification ON public.shifts;
DROP FUNCTION public.trg_offer_expired_notification_fn();
DROP TRIGGER trg_bidding_expired_notification ON public.shifts;
DROP FUNCTION public.trg_bidding_expired_notification_fn();
