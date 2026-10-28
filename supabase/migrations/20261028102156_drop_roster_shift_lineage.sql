-- Drop the legacy roster_shifts lineage. Its tables are gone, but two triggers
-- on shifts still pointed at it.
--
-- public.roster_shifts and public.roster_days no longer exist. What was left:
--   * trigger_sync_live_state_to_roster        AFTER UPDATE ON shifts
--     trigger_sync_live_state_to_roster_insert AFTER INSERT ON shifts
--       -> sync_live_state_to_roster(), which UPDATEs roster_shifts and inserts
--       into roster_shift_assignments. It returns early only while
--       NEW.roster_shift_id IS NULL, so the first shift to carry one would
--       have failed every write ("relation roster_shifts does not exist").
--   * roster_shift_assignments: 0 rows, 0 writes since stats reset 2025-12-08.
--     Its lock trigger, prevent_locked_roster_modification(), reads roster_days
--     and roster_shifts.
--   * unpublish_roster_shift(uuid,uuid,text): joins roster_shifts on its first
--     query, so it can only fail, yet anon could EXECUTE it. It is the only
--     user of the type publish_shift_result.
--   * shifts.roster_shift_id: NULL on every row; only the insert trigger above
--     and idx_shifts_roster_shift_id_unique depend on it.
--
-- Nothing in src/, supabase/functions/, optimizer-service/, ml/ or scripts/
-- names any of these, no cron job or view does, and no other function in any
-- schema references them (cancel_shift mentions roster_shifts in a comment).
-- Definitions were exported first to
-- ~/Documents/superman-db-exports/2026-10-28/roster-shift-lineage/.
--
-- Plain DROPs, no CASCADE: an unexpected dependent aborts the migration.

DROP TRIGGER trigger_sync_live_state_to_roster ON public.shifts;
DROP TRIGGER trigger_sync_live_state_to_roster_insert ON public.shifts;
DROP FUNCTION public.sync_live_state_to_roster();

DROP FUNCTION public.unpublish_roster_shift(uuid, uuid, text);
DROP TYPE public.publish_shift_result;

DROP TABLE public.roster_shift_assignments;
DROP FUNCTION public.prevent_locked_roster_modification();

DROP INDEX public.idx_shifts_roster_shift_id_unique;
ALTER TABLE public.shifts DROP COLUMN roster_shift_id;
