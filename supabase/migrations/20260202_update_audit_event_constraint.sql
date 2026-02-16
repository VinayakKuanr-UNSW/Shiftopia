-- Migration: Add bid_winner_selected to shift_audit_events valid_event_type check constraint

-- 1. Drop the existing constraint
ALTER TABLE shift_audit_events DROP CONSTRAINT IF EXISTS valid_event_type;

-- 2. Re-add the constraint with 'bid_winner_selected' included
ALTER TABLE shift_audit_events ADD CONSTRAINT valid_event_type CHECK (event_type IN (
  'shift_created_draft', 'shift_created_published',
  'field_updated', 'bulk_update', 'manual_adjustment',
  'status_changed', 'published', 'unpublished',
  'pushed_to_bidding', 'removed_from_bidding',
  'bid_submitted', 'bid_withdrawn', 'bid_accepted', 'bid_rejected',
  'bid_winner_selected', -- Added new event type
  'employee_assigned', 'employee_unassigned', 'assignment_swapped',
  'checked_in', 'checked_out', 'no_show_recorded',
  'shift_completed', 'shift_cancelled', 'shift_deleted'
));
