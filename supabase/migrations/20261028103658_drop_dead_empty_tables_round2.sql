-- Drop four empty tables whose only writers are gone.
--
-- Triage of all 46 empty tables in public/hr/internal (exact counts): most are
-- live features emptied by the 2026-09-30 shifts wipe, or are read by live
-- functions, cron, or the app. Only these have no live reader or writer:
--
--   assignment_runs / assignment_events / assignment_decisions, plus the RPCs
--   sm_assignment_run_start / _finish / _rollback that are their only users.
--     Audit infra for auto-assign bids (2026-06-24). The sole caller was the
--     never-deployed auto-assign-bids edge function, deleted in 3d27e2e2. No
--     code, cron, trigger, or other function calls the RPCs; 0 writes on
--     record since stats reset 2025-12-08.
--   baseline_ft_proposed_shifts
--     Output of the withdrawn baseline-FT generator; the Office page was
--     removed 2026-10-25 (FT is rostered from templates). Nothing references
--     it; no foreign key points at it.
--
-- Kept on purpose:
--   autoschedule_sessions / autoschedule_assignments: only the retired edge
--     functions wrote them, but delete_user_entirely() (held groundwork)
--     deletes from autoschedule_assignments and would break.
--   shift_skills / shift_licenses: read by internal.eba_check_assignment.
--   Everything else: a live function, view, trigger, cron job, or app module
--   reads or writes it.
--
-- DDL exported first to ~/Documents/superman-db-exports/2026-10-28/empty-tables/.
-- Plain DROPs, children first, no CASCADE.

DROP FUNCTION public.sm_assignment_run_start(jsonb, text, integer, jsonb, boolean);
DROP FUNCTION public.sm_assignment_run_finish(uuid, text, jsonb, text);
DROP FUNCTION public.sm_assignment_run_rollback(uuid);
DROP TABLE public.assignment_decisions;
DROP TABLE public.assignment_events;
DROP TABLE public.assignment_runs;

DROP TABLE public.baseline_ft_proposed_shifts;
