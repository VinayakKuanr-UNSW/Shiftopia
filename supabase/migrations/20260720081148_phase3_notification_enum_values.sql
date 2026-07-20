-- =============================================================================
-- Phase 3 (H6/H7) — Part 1 of 2: add the notification_type enum values.
--
-- notify_user() casts its text type to notification_type, so the values must
-- exist BEFORE any trigger uses them. New enum values cannot be added and used
-- in the same transaction, so this is split from the trigger migration
-- (20260720..._phase3_swap_leave_notification_triggers.sql) which follows.
-- =============================================================================
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'swap_expired';
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'leave_approved';
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'leave_rejected';
