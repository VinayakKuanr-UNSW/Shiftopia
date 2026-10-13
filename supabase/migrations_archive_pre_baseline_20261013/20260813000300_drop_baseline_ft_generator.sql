-- Migration: 20260813000300_drop_baseline_ft_generator.sql
-- Description: Removes the Baseline FT generator. What remains is the template
--              and its EBA constraint check.
--
-- WHY
--
-- The feature briefly reconciled each full-time employee's contracted hours
-- against the live roster and approved leave, proposed shifts, and applied them
-- after review. That was cut: a Baseline FT template now describes the standard
-- full-time week and says whether that pattern is lawful, and nothing more.
--
-- Everything dropped here existed only to serve generation:
--
--   baseline_ft_runs / _run_employees / _proposed_shifts / _findings
--       The proposal envelope and its contents. All four verified EMPTY in
--       production immediately before this ran — no run was ever generated, so
--       no audit history is lost.
--
--   roster_template_baseline_config
--       The work-cycle anchor and operating window. Both were inputs to the
--       generator's arithmetic and have no meaning to a pattern check: a
--       template's shapes are lawful or not regardless of where a four-week
--       cycle happens to start. 25 rows, of which one carried values a manager
--       had entered — that configuration is now meaningless rather than lost.
--
-- KEPT DELIBERATELY:
--
--   leave_requests.leave_mode
--       Added by 20260812000000 for the leave-credit calculation, but it is a
--       real fact about a leave request, not a generator artefact: cl 55.1 and
--       cl 58.2 each let a Team Member take the leave as EITHER accrued annual
--       leave or unpaid, and `leave_type` alone cannot answer which.
--
--       It holds no data — `leave_requests` is empty in production, so the
--       backfill in 20260812000000 touched zero rows. Kept on the modelling
--       argument alone: the distinction is one the agreement draws, the column
--       is nullable and costs nothing, and re-adding it later would mean
--       reconstructing paid-vs-unpaid for leave already taken.
--
--   created_from = 'baseline_ft_seed'
--       Now the ONLY discriminator for a Baseline FT template — it is what the
--       UI, the delete guard and the archive guard all key off.
--
-- ROLLBACK: re-run sections 2–6 of 20260812000000 and section 1 of
--           20260813000000. Nothing to restore into them.
-- ============================================================================

-- Child tables first — the FKs cascade, but being explicit documents the shape.
drop table if exists public.baseline_ft_findings;
drop table if exists public.baseline_ft_proposed_shifts;
drop table if exists public.baseline_ft_run_employees;
drop table if exists public.baseline_ft_runs;

drop table if exists public.roster_template_baseline_config;

-- ============================================================================
-- Verification (run AFTER applying)
--
--   -- expect: 0 rows
--   select tablename from pg_tables
--    where schemaname = 'public'
--      and (tablename like 'baseline_ft_%'
--           or tablename = 'roster_template_baseline_config');
--
--   -- expect: 25, one per sub-department, still protected from delete/archive
--   select count(*) from public.roster_templates
--    where created_from = 'baseline_ft_seed';
--
--   -- expect: still populated
--   select count(*) from public.leave_requests where leave_mode is not null;
-- ============================================================================
