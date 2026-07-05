-- Shift mutation gateway — neutral audit event type.
--
-- sm_apply_shift_op appends an actor-stamped audit row for EVERY applied op. The
-- non-subject ops (publish / edit / approve_trade / reject_trade, and delete of an
-- UNASSIGNED shift) have no worker to name and are NOT assignment/cancellation
-- events, so they must NOT reuse 'ASSIGNED' — that both trips fn_validate_shift_event
-- (which demands a subject) and inflates employee_daily_metrics, which counts
-- event_type = 'ASSIGNED' directly. Mint ONE neutral 'OP_APPLIED' value; the true
-- op always stays in shift_events.metadata.op.
--
-- NOTE: `ALTER TYPE ... ADD VALUE` must be COMMITTED in its own transaction before
-- any later migration references it (fn_validate_shift_event / sm_apply_shift_op).
-- This standalone migration is that committed transaction. Idempotent.

ALTER TYPE public.shift_event_type ADD VALUE IF NOT EXISTS 'OP_APPLIED';
