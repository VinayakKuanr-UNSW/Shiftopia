-- Migration: 20260813000000_baseline_ft_template_merge.sql
-- Description: Folds the Baseline FT pattern layer into the existing roster
--              template system. `baseline_ft_patterns` is dropped and replaced
--              by a 1:1 config side table on `roster_templates`, and every
--              sub-department is seeded with a "Baseline FT" template.
--
-- WHY THIS EXISTS
--
-- 20260812000000 introduced `baseline_ft_patterns` as its own configuration
-- surface. That was a mistake: `roster_templates` already carries
-- `sub_department_id`, `is_base_template`, `status`, `version`, `is_active`
-- and the full audit trail, and `template_shifts` already carries the day/time
-- shapes. Roughly seventy percent of `baseline_ft_patterns` was a second copy
-- of columns that already existed, and it gave managers two places to
-- configure one idea.
--
-- The genuine delta is five fields — the work-cycle anchor and the operating
-- window — none of which the EBA specifies. Those move onto the template as a
-- 1:1 side table rather than as columns on `roster_templates` itself, because
-- almost no template is a baseline and the rest should not carry five NULLs.
--
-- A template IS a Baseline FT template exactly when it has a config row here.
-- No separate flag: one fact, one place.
--
-- SAFE TO RUN: `baseline_ft_patterns`, `baseline_ft_runs`,
-- `baseline_ft_run_employees` and `baseline_ft_proposed_shifts` were all
-- verified empty in production immediately before this was written, so the
-- drop and the column swap lose nothing.
--
-- ROLLBACK:
--   drop trigger if exists trigger_seed_baseline_ft_template on public.sub_departments;
--   drop function if exists public.fn_seed_baseline_ft_template();
--   delete from public.roster_templates where created_from = 'baseline_ft_seed';
--   alter table public.roster_templates drop constraint if exists chk_created_from;
--   alter table public.roster_templates add constraint chk_created_from
--       check (created_from = any (array['capture','manual','import']));
--   drop table if exists public.roster_template_baseline_config;
--   alter table public.baseline_ft_runs drop column if exists roster_template_id;
--   -- then re-run section 2 of 20260812000000 to restore baseline_ft_patterns.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. roster_template_baseline_config — the five fields the EBA leaves open
--
-- Every one of these is NOT-IN-EBA and therefore has to be stated by a human.
-- `cycle_anchor_date`, `earliest_start` and `latest_finish` are deliberately
-- NULLABLE: a seeded-but-unconfigured template is a real and expected state,
-- and the generator refuses to run against it with a BLOCKING finding naming
-- the missing fields. Defaulting them would be inventing a rule.
-- ----------------------------------------------------------------------------
create table if not exists public.roster_template_baseline_config (
    roster_template_id uuid primary key
                       references public.roster_templates(id) on delete cascade,

    -- N3: cl 35.1(a) permits a work cycle of "up to four (4) weeks" but never
    -- says where a cycle starts. The 152h ceiling is meaningless without a
    -- boundary, so the anchor is explicit — never inferred from the calendar.
    cycle_weeks        smallint not null default 4 check (cycle_weeks between 1 and 4),
    cycle_anchor_date  date,

    -- N1: cl 35.1(b) permits ordinary hours on any day Mon–Sun with NO
    -- time-of-day restriction, and cl 43 only attaches an allowance to
    -- 22:00–06:00. An operating window is therefore a business boundary, and is
    -- labelled as such wherever it causes a candidate shift to be rejected.
    earliest_start     time,
    latest_finish      time,

    -- N5: cl 56.4 pays a non-worked public holiday only where the employee
    -- "would ordinarily be rostered" — circular for a generator that is
    -- deciding the roster. Resolved by crediting only where the template places
    -- a slot on that weekday.
    ph_credits_hours   boolean not null default true,

    created_at         timestamptz not null default now(),
    updated_by         uuid references public.profiles(id),
    updated_at         timestamptz not null default now()
);

comment on table public.roster_template_baseline_config is
    'Baseline FT settings for a roster template. A template with a row here is '
    'a Baseline FT template. Holds only what the ICC Sydney EBA does not '
    'specify — the work-cycle anchor (N3) and the operating window (N1). NULLs '
    'mean "not yet configured" and block generation rather than defaulting.';

comment on column public.roster_template_baseline_config.cycle_anchor_date is
    'Where the cl 35.1(a) work cycle starts. NULL = not configured; the '
    'generator emits BASELINE_PATTERN_UNCONFIGURED rather than assuming.';

-- ----------------------------------------------------------------------------
-- 2. Repoint baseline_ft_runs at the template
-- ----------------------------------------------------------------------------
alter table public.baseline_ft_runs
    add column if not exists roster_template_id uuid
        references public.roster_templates(id) on delete set null;

comment on column public.baseline_ft_runs.roster_template_id is
    'The Baseline FT template this run was generated from. ON DELETE SET NULL: '
    'deleting a template must not erase the audit trail of rosters it produced.';

alter table public.baseline_ft_runs drop column if exists pattern_id;

-- ----------------------------------------------------------------------------
-- 3. Drop the parallel table
-- ----------------------------------------------------------------------------
drop table if exists public.baseline_ft_patterns;

-- ----------------------------------------------------------------------------
-- 4. RLS — identical predicate to the other baseline tables
--
-- `anon` is revoked explicitly. Supabase grants table privileges to `anon` and
-- `authenticated` by default and enabling RLS does not remove the grant — that
-- is exactly how `availability_slots` ended up anon-readable.
-- ----------------------------------------------------------------------------
alter table public.roster_template_baseline_config enable row level security;

drop policy if exists roster_template_baseline_config_manager_all
    on public.roster_template_baseline_config;

create policy roster_template_baseline_config_manager_all
    on public.roster_template_baseline_config
    for all to authenticated
    using (public.auth_can_manage_rosters())
    with check (public.auth_can_manage_rosters());

revoke all on public.roster_template_baseline_config from anon;
revoke all on public.roster_template_baseline_config from public;
grant select, insert, update, delete
    on public.roster_template_baseline_config to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Seed one "Baseline FT" template per sub-department
--
-- `created_from = 'baseline_ft_seed'` is what makes this identifiable and
-- reversible. Idempotent: re-running creates nothing.
--
-- Note the INSERT fires `trigger_seed_fixed_template_groups`, so each new
-- template arrives with its four standard groups already present and is
-- immediately editable in the normal template editor.
--
-- Status stays 'draft' (the column default). These are unconfigured skeletons,
-- not published templates, and they must not read as ready to apply.
--
-- `chk_created_from` is an allow-list ('capture', 'manual', 'import') and has
-- to admit the new provenance first. Widened rather than worked around:
-- `created_from` records where a template came from, and "seeded by the
-- Baseline FT migration" is a true and distinct answer. Reusing 'manual' would
-- make the column lie and leave nothing to key the rollback on. Additive — no
-- existing value is removed, and the column is nullable so historical rows with
-- NULL are unaffected.
-- ----------------------------------------------------------------------------
alter table public.roster_templates drop constraint if exists chk_created_from;
alter table public.roster_templates add constraint chk_created_from
    check (created_from = any (array['capture', 'manual', 'import', 'baseline_ft_seed']));

insert into public.roster_templates (
    name, description, organization_id, department_id, sub_department_id,
    is_base_template, is_active, created_from
)
select
    'Baseline FT',
    'Default full-time baseline for this sub-department. Add the weekly shift '
    'shapes here, then set the work-cycle anchor and operating hours before '
    'generating — the EBA does not specify either.',
    d.organization_id,
    sd.department_id,
    sd.id,
    true,
    true,
    'baseline_ft_seed'
from public.sub_departments sd
join public.departments d on d.id = sd.department_id
where not exists (
    select 1 from public.roster_templates rt
     where rt.sub_department_id = sd.id
       and rt.created_from = 'baseline_ft_seed'
);

insert into public.roster_template_baseline_config (roster_template_id)
select rt.id
  from public.roster_templates rt
 where rt.created_from = 'baseline_ft_seed'
   and not exists (
       select 1 from public.roster_template_baseline_config c
        where c.roster_template_id = rt.id
   );

-- ----------------------------------------------------------------------------
-- 6. Keep it true for sub-departments created later
--
-- "Default loaded under each sub-department" has to hold for sub-departments
-- that do not exist yet, otherwise the guarantee decays the first time someone
-- adds one.
--
-- SECURITY DEFINER because sub-departments are created by admins who may not
-- hold `auth_can_manage_rosters()`. No `current_user` guard: inside a SECURITY
-- DEFINER function `current_user` is always the owner, so such a guard would
-- silently disable the whole trigger.
-- ----------------------------------------------------------------------------
create or replace function public.fn_seed_baseline_ft_template()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
    v_template_id uuid;
    v_org_id      uuid;
begin
    select organization_id into v_org_id
      from public.departments
     where id = new.department_id;

    if v_org_id is null then
        return new;   -- orphan sub-department; nothing sensible to seed
    end if;

    insert into public.roster_templates (
        name, description, organization_id, department_id, sub_department_id,
        is_base_template, is_active, created_from
    )
    values (
        'Baseline FT',
        'Default full-time baseline for this sub-department. Add the weekly '
        'shift shapes here, then set the work-cycle anchor and operating hours '
        'before generating — the EBA does not specify either.',
        v_org_id, new.department_id, new.id, true, true, 'baseline_ft_seed'
    )
    returning id into v_template_id;

    insert into public.roster_template_baseline_config (roster_template_id)
    values (v_template_id);

    return new;
end;
$function$;

alter function public.fn_seed_baseline_ft_template() owner to postgres;

drop trigger if exists trigger_seed_baseline_ft_template on public.sub_departments;
create trigger trigger_seed_baseline_ft_template
    after insert on public.sub_departments
    for each row execute function public.fn_seed_baseline_ft_template();

-- Revoked AFTER the trigger is created, and from `authenticated` as well as
-- PUBLIC/anon. Supabase grants EXECUTE on every new function to both `anon` and
-- `authenticated` by default, which would expose this SECURITY DEFINER function
-- at /rest/v1/rpc/fn_seed_baseline_ft_template — a signed-in non-manager could
-- call it directly. Revoking EXECUTE does not affect the trigger: PostgreSQL
-- checks EXECUTE when the trigger is CREATED, not each time it fires.
revoke all on function public.fn_seed_baseline_ft_template() from public;
revoke all on function public.fn_seed_baseline_ft_template() from anon;
revoke all on function public.fn_seed_baseline_ft_template() from authenticated;

-- ============================================================================
-- Verification (run AFTER applying, under a real JWT — the MCP/service
-- connection is superuser and BYPASSRLS, so every policy appears to pass)
--
--   select count(*) from public.roster_templates
--    where created_from = 'baseline_ft_seed';           -- expect: one per sub-dept
--
--   select count(*) from public.roster_template_baseline_config
--    where cycle_anchor_date is null;                   -- expect: all of them
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<NON-manager profile id>"}';
--   select count(*) from public.roster_template_baseline_config;  -- expect: 0
--
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'roster_template_baseline_config'
--      and grantee in ('anon','PUBLIC');                -- expect: 0 rows
-- ============================================================================
