-- =============================================================================
-- Phase 3 (H6/H7) — Part 2 of 2: notification triggers on the LIVE tables.
--
-- H6: the existing swap outcome/expiry triggers were attached to the vestigial
--     `swap_requests` table (legacy columns/statuses), so swaps on the live
--     `shift_swaps` table produced NO notification. This adds a trigger written
--     for the shift_swaps schema (requester_id, uppercase enum statuses).
-- H7: `leave_requests` had no notification trigger at all, so an employee was
--     never told their leave was approved/rejected. This adds one.
--
-- Both reuse the proven notify_user() 8-arg helper (rate-limited + dedup_key
-- idempotent), the same one trg_bid_outcome_notification uses.
-- =============================================================================

-- ── H6: swap outcome on shift_swaps ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."trg_shift_swap_outcome_notification"()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'APPROVED' THEN
    PERFORM notify_user(NEW.requester_id, 'swap_approved', 'Swap approved',
      'Your shift swap request has been approved by your manager. Check My Roster.',
      NEW.id, 'swap_request', '/my-swaps', 'swap_approved:' || NEW.id::text);
    IF NEW.target_id IS NOT NULL AND NEW.target_id <> NEW.requester_id THEN
      PERFORM notify_user(NEW.target_id, 'swap_approved', 'Swap completed',
        'A shift swap you offered on was approved by the manager. Check My Roster.',
        NEW.id, 'swap_request', '/my-swaps', 'swap_approved_offerer:' || NEW.id::text);
    END IF;

  ELSIF NEW.status = 'REJECTED' THEN
    PERFORM notify_user(NEW.requester_id, 'swap_rejected', 'Swap not approved',
      'Your shift swap request was not approved' ||
        CASE WHEN NEW.rejection_reason IS NOT NULL THEN ': ' || NEW.rejection_reason ELSE '.' END,
      NEW.id, 'swap_request', '/my-swaps', 'swap_rejected:' || NEW.id::text);

  ELSIF NEW.status = 'EXPIRED' THEN
    PERFORM notify_user(NEW.requester_id, 'swap_expired', 'Swap request expired',
      'Your swap request expired because the shift starts within 4 hours. No changes were made.',
      NEW.id, 'swap_request', '/my-swaps', 'swap_expired:' || NEW.id::text);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS "trg_shift_swap_outcome_notification" ON "public"."shift_swaps";
CREATE TRIGGER "trg_shift_swap_outcome_notification"
  AFTER UPDATE ON "public"."shift_swaps"
  FOR EACH ROW EXECUTE FUNCTION "public"."trg_shift_swap_outcome_notification"();

-- ── H7: leave outcome on leave_requests ─────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."trg_leave_request_outcome_notification"()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'approved' THEN
    PERFORM notify_user(NEW.employee_id, 'leave_approved', 'Leave approved',
      'Your ' || NEW.leave_type || ' leave (' || NEW.start_date::date || ' to ' || NEW.end_date::date || ') was approved.',
      NEW.id, 'leave_request', '/my-leave', 'leave_approved:' || NEW.id::text);

  ELSIF NEW.status = 'rejected' THEN
    PERFORM notify_user(NEW.employee_id, 'leave_rejected', 'Leave not approved',
      'Your ' || NEW.leave_type || ' leave (' || NEW.start_date::date || ' to ' || NEW.end_date::date || ') was not approved' ||
        CASE WHEN NEW.rejection_reason IS NOT NULL THEN ': ' || NEW.rejection_reason ELSE '.' END,
      NEW.id, 'leave_request', '/my-leave', 'leave_rejected:' || NEW.id::text);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS "trg_leave_request_outcome_notification" ON "public"."leave_requests";
CREATE TRIGGER "trg_leave_request_outcome_notification"
  AFTER UPDATE ON "public"."leave_requests"
  FOR EACH ROW EXECUTE FUNCTION "public"."trg_leave_request_outcome_notification"();
