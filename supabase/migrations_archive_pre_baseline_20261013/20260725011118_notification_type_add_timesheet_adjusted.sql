-- ============================================================================
-- Notifications — add `timesheet_adjusted` enum value
--
-- Needed by the adjust-without-approve notification in 20260725100200. MUST be a
-- separate migration from the trigger that uses it: Postgres can't use a new enum
-- value in the same transaction it's added. See [[notification-system]].
-- ============================================================================
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'timesheet_adjusted';
