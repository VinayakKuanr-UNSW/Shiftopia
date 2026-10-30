-- Migration: 20260813000200_protect_baseline_ft_templates.sql
-- Description: A Baseline FT template cannot be deleted or archived.
--
-- WHY
--
-- Every sub-department has exactly one, created by 20260813000000 and kept in
-- step by `trigger_seed_baseline_ft_template`. It is a permanent fixture, not a
-- template someone made: deleting it would silently remove the sub-department's
-- ability to generate a baseline, and the seed is idempotent so it would never
-- come back. Archiving hides it from every list with the same effect.
--
-- Hiding the buttons is not enough. `roster_templates` is writable by any
-- manager through PostgREST, so the guarantee has to live where the write
-- lands. Renaming, editing shapes, editing settings and publishing all remain
-- allowed — only DELETE and a move to 'archived' are refused.
--
-- ROLLBACK:
--   drop trigger if exists trigger_protect_baseline_ft_delete on public.roster_templates;
--   drop trigger if exists trigger_protect_baseline_ft_archive on public.roster_templates;
--   drop function if exists public.fn_protect_baseline_ft_template();
-- ============================================================================

create or replace function public.fn_protect_baseline_ft_template()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
    if tg_op = 'DELETE' then
        if old.created_from = 'baseline_ft_seed' then
            raise exception
                'Baseline FT templates cannot be deleted. Every sub-department '
                'keeps exactly one; edit it or mark it ready instead.'
                using errcode = 'restrict_violation';
        end if;
        return old;
    end if;

    -- UPDATE: only the archive transition is refused. Everything else about a
    -- Baseline FT template stays editable, including draft ⇄ published.
    if new.created_from = 'baseline_ft_seed'
       and new.status = 'archived'
       and old.status is distinct from 'archived' then
        raise exception
            'Baseline FT templates cannot be archived. Every sub-department '
            'keeps exactly one; edit it or mark it ready instead.'
            using errcode = 'restrict_violation';
    end if;

    return new;
end;
$function$;

alter function public.fn_protect_baseline_ft_template() owner to postgres;

drop trigger if exists trigger_protect_baseline_ft_delete on public.roster_templates;
create trigger trigger_protect_baseline_ft_delete
    before delete on public.roster_templates
    for each row execute function public.fn_protect_baseline_ft_template();

drop trigger if exists trigger_protect_baseline_ft_archive on public.roster_templates;
create trigger trigger_protect_baseline_ft_archive
    before update of status on public.roster_templates
    for each row execute function public.fn_protect_baseline_ft_template();

-- Revoked AFTER the triggers exist. Supabase auto-grants EXECUTE on every new
-- function to anon and authenticated, which would expose this SECURITY DEFINER
-- function at /rest/v1/rpc/. PostgreSQL checks EXECUTE when a trigger is
-- CREATED, not each time it fires, so the triggers keep working.
revoke all on function public.fn_protect_baseline_ft_template() from public;
revoke all on function public.fn_protect_baseline_ft_template() from anon;
revoke all on function public.fn_protect_baseline_ft_template() from authenticated;

-- ============================================================================
-- Verification (run AFTER applying)
--
--   -- both must raise, and leave the row intact:
--   delete from public.roster_templates where created_from = 'baseline_ft_seed';
--   update public.roster_templates set status = 'archived'
--    where created_from = 'baseline_ft_seed';
--
--   -- these must still succeed:
--   update public.roster_templates set status = 'published'
--    where created_from = 'baseline_ft_seed';
--   update public.roster_templates set name = 'Baseline FT'
--    where created_from = 'baseline_ft_seed';
-- ============================================================================
