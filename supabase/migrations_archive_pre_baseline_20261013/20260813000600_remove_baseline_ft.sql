-- Migration: 20260813000600_remove_baseline_ft.sql
-- Description: Removes the Baseline FT concept entirely.
--
-- WHAT GOES
--
--   * the 25 seeded "Baseline FT" templates (one per sub-department)
--   * `trigger_seed_baseline_ft_template` + `fn_seed_baseline_ft_template`
--   * `trigger_protect_baseline_ft_delete` / `..._archive` + their function
--   * the `'baseline_ft_seed'` value in `roster_templates.chk_created_from`
--   * `leave_requests.leave_mode` + the `leave_mode` enum
--
-- The generator and its five tables were already dropped by 20260813000300;
-- this removes what was left.
--
-- ONE TEMPLATE IS KEPT, DELIBERATELY.
--
-- Event Delivery ▸ Set-up's Baseline FT template holds a subgroup and a shift a
-- manager created by hand. Deleting a seeded fixture is housekeeping; deleting
-- someone's work because a feature was cancelled is not. It is converted to an
-- ORDINARY template instead — `created_from = 'manual'`, `is_base_template =
-- false` — so it behaves like any other: renameable, archivable, deletable.
-- The 24 empty ones are removed outright.
--
-- The same rule is expressed generally rather than by id: any seeded template
-- that has shifts is kept and converted. Re-running is therefore safe, and a
-- second environment with different data gets the same treatment.
--
-- ROLLBACK: re-run 20260813000000 (seeding + trigger), 20260813000200
--           (protection triggers) and the leave_mode section of 20260812000000.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Drop the guards FIRST — they refuse the deletes below
-- ----------------------------------------------------------------------------
drop trigger if exists trigger_protect_baseline_ft_delete  on public.roster_templates;
drop trigger if exists trigger_protect_baseline_ft_archive on public.roster_templates;
drop function if exists public.fn_protect_baseline_ft_template();

drop trigger if exists trigger_seed_baseline_ft_template on public.sub_departments;
drop function if exists public.fn_seed_baseline_ft_template();

-- ----------------------------------------------------------------------------
-- 2. Keep any seeded template a human has actually built on
-- ----------------------------------------------------------------------------
update public.roster_templates rt
   set created_from     = 'manual',
       is_base_template = false
 where rt.created_from = 'baseline_ft_seed'
   and exists (
       select 1
         from public.template_shifts ts
         join public.template_subgroups tsg on tsg.id = ts.subgroup_id
         join public.template_groups tg     on tg.id  = tsg.group_id
        where tg.template_id = rt.id
   );

-- ----------------------------------------------------------------------------
-- 3. Delete the rest. Groups/subgroups/shifts cascade from roster_templates.
-- ----------------------------------------------------------------------------
delete from public.roster_templates where created_from = 'baseline_ft_seed';

-- ----------------------------------------------------------------------------
-- 4. Narrow chk_created_from back to its original allow-list
--
-- Safe only because step 2 rewrote every surviving row and step 3 removed the
-- others, so nothing holds the value any more.
-- ----------------------------------------------------------------------------
alter table public.roster_templates drop constraint if exists chk_created_from;
alter table public.roster_templates add constraint chk_created_from
    check (created_from = any (array['capture', 'manual', 'import']));

-- ----------------------------------------------------------------------------
-- 5. leave_requests.leave_mode
--
-- Added by 20260812000000 purely to feed the Baseline FT leave-credit
-- calculation. It models something real — cl 55.1 and cl 58.2 each let a Team
-- Member take that leave as EITHER accrued annual leave or unpaid — but no code
-- reads or writes it now, and it holds no data (`leave_requests` is empty in
-- production, so the original backfill touched zero rows).
--
-- Dropped rather than left as an orphan column nothing populates. If the
-- paid/unpaid distinction is wanted later it should arrive with the leave
-- feature that needs it, not as a leftover.
-- ----------------------------------------------------------------------------
alter table public.leave_requests drop column if exists leave_mode;
drop type if exists public.leave_mode;

-- ============================================================================
-- Verification (run AFTER applying)
--
--   -- expect: 0
--   select count(*) from public.roster_templates where created_from = 'baseline_ft_seed';
--
--   -- expect: 0 rows
--   select proname from pg_proc where proname like '%baseline_ft%';
--   select tgname  from pg_trigger where tgname like '%baseline_ft%';
--
--   -- expect: capture, manual, import only
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'chk_created_from';
--
--   -- expect: 0 rows
--   select column_name from information_schema.columns
--    where table_name = 'leave_requests' and column_name = 'leave_mode';
-- ============================================================================
