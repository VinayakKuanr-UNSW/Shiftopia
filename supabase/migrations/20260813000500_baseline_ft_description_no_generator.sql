-- Migration: 20260813000500_baseline_ft_description_no_generator.sql
-- Description: The seeded Baseline FT description no longer advertises the
--              removed generator, and neither does the seeding trigger.
--
-- The seed text said: "set the work-cycle anchor and operating hours before
-- generating". Both the settings and the generator were dropped in
-- 20260813000300, so it described a feature that does not exist. The trigger
-- also drops its `roster_template_baseline_config` insert — that table is gone.
-- ============================================================================

update public.roster_templates
   set description = 'Default full-time baseline for this sub-department. Add the weekly shift shapes here — each one is checked against the EBA as a full-time day.'
 where created_from = 'baseline_ft_seed';

create or replace function public.fn_seed_baseline_ft_template()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
    v_org_id uuid;
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
        'shift shapes here — each one is checked against the EBA as a '
        'full-time day.',
        v_org_id, new.department_id, new.id, true, true, 'baseline_ft_seed'
    );

    return new;
end;
$function$;

alter function public.fn_seed_baseline_ft_template() owner to postgres;

-- Supabase auto-grants EXECUTE on every new function to anon AND authenticated.
-- The trigger already exists, and PostgreSQL checks EXECUTE at trigger-CREATE
-- time rather than each firing, so revoking does not disable it.
revoke all on function public.fn_seed_baseline_ft_template() from public;
revoke all on function public.fn_seed_baseline_ft_template() from anon;
revoke all on function public.fn_seed_baseline_ft_template() from authenticated;
