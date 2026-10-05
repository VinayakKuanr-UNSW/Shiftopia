-- ─────────────────────────────────────────────────────────────────────────────
-- APPLIED TO PROD 2026-10-05 via the Supabase MCP (ledger version
-- 20261005065925). Do not re-run against production. Rollback-only dry-run
-- beforehand: 108 columns / 37 indexes after, both remaining dependent views
-- (v_performance_data_quality_alerts, v_shift_assignment_episodes) still read,
-- get_roster_planner_stats unchanged, computed field still resolves.
--
-- Table hygiene, step 1 of the 2026-10-04 column audit. Every object below was
-- verified dead in prod on 2026-10-05: no function, trigger, policy or
-- app/edge/Python reference, and no non-empty value in any row. Indexes: zero
-- scans since stats began 2025-12-08.
-- ─────────────────────────────────────────────────────────────────────────────

-- Pure passthrough view over shifts with zero callers anywhere (SQL, app, edge,
-- Python). It is also the only object pinning the dead columns below.
DROP VIEW public.v_shifts_grouped;

ALTER TABLE public.shifts
  DROP COLUMN required_certifications,  -- never read or written; kept alive only by a GIN index
  DROP COLUMN cost_center_id,           -- declared on the TS entity, never read or written
  DROP COLUMN lock_reason_text,         -- declared on the TS entity, never read or written
  DROP COLUMN is_recurring,             -- TS hits were availability RULES, not shifts
  DROP COLUMN recurrence_rule;          -- ditto (availabilities has its own column of this name)

-- Duplicate of idx_shifts_roster_shift_id_unique: that index adds
-- `AND deleted_at IS NULL`, which is always true (CHECK shifts_no_soft_delete).
DROP INDEX public.idx_shifts_roster_shift_id;
-- Never scanned. Each one is rewritten on almost every UPDATE (HOT updates are
-- 2.6% of the total), so dropping them makes every status change cheaper.
DROP INDEX public.idx_shifts_is_draft;
DROP INDEX public.idx_shifts_event_tags;
DROP INDEX public.idx_shifts_required_skills;

NOTIFY pgrst, 'reload schema';
