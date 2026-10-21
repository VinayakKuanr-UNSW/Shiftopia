-- Full-time shifts may only be created by Baseline FT.
--
-- WHY. A full-time employee's hours are capped over a DECLARED multi-week cycle
-- (ICC EBA cl 35.1(a)). Whether one more full-time shift is lawful therefore
-- depends on everything else that cycle already holds — existing shifts across
-- every sub-department, credited leave, public holidays. A single-shift form
-- cannot ask that question, so adding full-time shifts one at a time is how a
-- roster goes over the ceiling with nothing ever reporting a breach. That is
-- not hypothetical: production carried 160h against a 152h cap on every
-- full-time employee, and no screen said so.
--
-- Baseline FT does the reconciliation before it proposes anything, so it
-- becomes the only way in.
--
-- WHY A TRIGGER, NOT A CHECK INSIDE sm_create_shift. There is more than one
-- write path into `shifts`, and only one of them is the gateway:
-- `apply_template_to_date_range_v2` INSERTs directly, passing the template
-- row's `target_employment_type` through with `creation_source = 'template'`.
-- Guarding the RPC would have left the template path wide open — the same shape
-- as the shift-shape layer being enforced where only two of its callers passed.
-- The table is the one place every path must go through.
--
-- WHY creation_source AND NOT baseline_run_id. Apply stamps `baseline_run_id`
-- in a second UPDATE after the row exists, so it is NULL at INSERT time.
-- `creation_source` is set by the inserting statement itself and is the only
-- provenance available when the decision has to be made.
--
-- THIS IS A GUARDRAIL, NOT A SECURITY BOUNDARY. Anything that sets
-- `creation_source = 'baseline_ft'` by hand gets through, and that is the
-- intended strength: it stops the routine paths — the Add Shift modal, cloning
-- a shift card, applying a template — from quietly producing full-time shifts
-- that never met the contract, while leaving a deliberate act possible.
--
-- KNOWN CONSEQUENCE, FLAGGED RATHER THAN SOLVED HERE: Baseline FT writes only
-- into DRAFT, unlocked rosters (cl 38.2 gives 48 hours' notice of a change), so
-- once a roster is published there is now no way to add a full-time shift to it
-- at all — including cover when someone calls in sick. If that needs an escape
-- hatch it should be an explicit, recorded one (its own `creation_source`), not
-- a hole in this trigger.

begin;

create or replace function public.enforce_ft_shifts_are_baseline_only()
returns trigger
language plpgsql
as $$
begin
    -- Only rows that ARE full-time are of interest.
    if new.target_employment_type is distinct from 'FT' then
        return new;
    end if;

    -- On UPDATE, only when the row is BECOMING full-time. Re-saving one of the
    -- full-time shifts that already exist must keep working, or every edit to
    -- them would start failing.
    if tg_op = 'UPDATE' and old.target_employment_type is not distinct from 'FT' then
        return new;
    end if;

    if new.creation_source is distinct from 'baseline_ft' then
        raise exception using
            errcode = 'check_violation',
            message = 'Full-time shifts are created by Baseline FT, not here.',
            detail  = format(
                'A shift targeting FT was written with creation_source=%L. Full-time hours are '
                || 'reconciled against the employee''s contracted cycle (ICC EBA cl 35.1(a)) before '
                || 'any shift is proposed, so they cannot be added one at a time.',
                coalesce(new.creation_source, '(null)')),
            hint    = 'Open Baseline FT, set the employee''s working pattern, and apply it to this period.';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_ft_shifts_are_baseline_only on public.shifts;
create trigger trg_ft_shifts_are_baseline_only
    before insert or update of target_employment_type, creation_source
    on public.shifts
    for each row
    execute function public.enforce_ft_shifts_are_baseline_only();

comment on function public.enforce_ft_shifts_are_baseline_only() is
    'Full-time shifts may only be created with creation_source = ''baseline_ft''. '
    'Enforced on the table because apply_template_to_date_range_v2 inserts directly, '
    'bypassing sm_create_shift.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Templates cannot hold full-time rows at all
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Blocked at the template rather than only when it is applied, so an author
-- finds out while building it instead of weeks later when a roster silently
-- comes up short.
--
-- Deliberately a trigger on new writes rather than a table CHECK: a CHECK would
-- be validated against existing rows and fail on the five full-time template
-- rows already stored. Those stay readable; they simply cannot be added to.
create or replace function public.enforce_no_ft_template_shifts()
returns trigger
language plpgsql
as $$
begin
    if new.target_employment_type is distinct from 'FT' then
        return new;
    end if;
    if tg_op = 'UPDATE' and old.target_employment_type is not distinct from 'FT' then
        return new;
    end if;

    raise exception using
        errcode = 'check_violation',
        message = 'Templates cannot contain full-time shifts.',
        detail  = 'Full-time hours come from an employee''s contracted pattern in Baseline FT, '
               || 'which reconciles them against the cycle ceiling. A template stamps the same '
               || 'shape on everyone and cannot do that.',
        hint    = 'Use Baseline FT for full-time. Templates remain for part-time and casual.';
end;
$$;

drop trigger if exists trg_no_ft_template_shifts on public.template_shifts;
create trigger trg_no_ft_template_shifts
    before insert or update of target_employment_type
    on public.template_shifts
    for each row
    execute function public.enforce_no_ft_template_shifts();

commit;
