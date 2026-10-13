-- ============================================================================
-- Timesheets — notification enum value (F19), part 1 of 2
--
-- `timesheet_approved` / `timesheet_rejected` already exist. Add `timesheet_adjusted`
-- for the "a manager changed your billable times" notice. MUST be a separate
-- migration from the trigger that uses it: a new enum value can't be used in the
-- same transaction it's added in (Postgres), and each migration file is its own
-- transaction. See [[notification-system]].
-- ============================================================================

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'timesheet_adjusted';
