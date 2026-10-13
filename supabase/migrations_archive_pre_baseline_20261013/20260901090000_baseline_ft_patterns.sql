-- Baseline FT — the standing pattern, per EMPLOYEE.
--
-- WHY THIS TABLE EXISTS AT ALL. The first cut of Baseline FT read its pattern
-- from a `roster_templates` row: one template per sub-department, applied to
-- everyone on the team. That model cannot represent production. The four
-- full-time employees in this database hold THREE different roles (Manager,
-- Supervisor ×2, Assistant Manager), and `validatePattern` raises
-- BFT_PATTERN_ROLE_MISMATCH as BLOCKING when a pattern's role is not the one
-- the contract authorises. A pattern-level failure aborts the whole run, so a
-- single shared template generated exactly nothing for anybody.
--
-- A working pattern is a fact about a PERSON — their days, their start time,
-- their role — not about a team. Hence one row per employee per working day.
--
-- WHY A NEW TABLE, HAVING ARGUED AGAINST NEW TABLES. The original design was
-- cut from five tables to two on the grounds that a stored copy of a DERIVED
-- fact is a second source of truth that drifts from the engine producing it.
-- That argument does not reach here: a standing pattern is DECLARED by a human
-- and exists nowhere else in the schema. `net_minutes` is the one derived
-- value, and it is pinned to its inputs by a CHECK rather than trusted.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The pattern
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.baseline_ft_patterns (
    id                      uuid primary key default gen_random_uuid(),

    organization_id         uuid not null references public.organizations(id) on delete cascade,
    department_id           uuid not null,
    sub_department_id       uuid not null,

    employee_id             uuid not null references public.profiles(id) on delete cascade,

    -- Which engagement this pattern discharges. A person may hold several
    -- active contracts, and the hours belong to exactly one of them.
    --
    -- REFERENCES hr, NOT public. `public.user_contracts` and `public.roles` are
    -- VIEWS over the `hr` schema, and a view cannot be the target of a foreign
    -- key ("referenced relation is not a table", 42809). `public.shifts` already
    -- points at `hr.user_contracts` and `hr.roles` for exactly this reason, and
    -- a pattern line is the thing that produces a shift, so it follows the same
    -- references its output does.
    user_contract_id        uuid not null references hr.user_contracts(id) on delete cascade,

    -- Which week of the declared cycle this line belongs to.
    --
    -- v1 writes 1 for everything: one repeating week, which is what every
    -- full-time arrangement in this database actually is. The column ships now
    -- because it is part of the uniqueness key, and retrofitting a dimension
    -- into a unique index later means rewriting every row that uses it.
    week_in_cycle           smallint not null default 1
                            check (week_in_cycle between 1 and 4),

    -- ISO 8601: 1 = Monday … 7 = Sunday.
    --
    -- DELIBERATELY NOT NAMED `day_of_week`. `template_shifts.day_of_week` is
    -- 0 = Sunday (JavaScript's `getDay()`), and this is ISO, because every
    -- ordinary-hours cycle boundary in this system is anchored to a Monday.
    -- Two columns with the same name and different origins is how a silent
    -- off-by-one gets copied from one to the other; the distinct name makes
    -- that copy impossible to make by accident.
    iso_day_of_week         smallint not null
                            check (iso_day_of_week between 1 and 7),

    start_time              time not null,
    end_time                time not null,
    unpaid_break_minutes    integer not null default 0 check (unpaid_break_minutes >= 0),
    -- cl 37.1 / 37.2. A consequence of the day's length, never a free choice —
    -- the application derives it and stores the answer.
    paid_break_minutes      integer not null default 0 check (paid_break_minutes >= 0),
    net_minutes             integer not null,

    -- Also `hr`, matching `public.shifts.role_id`. See user_contract_id above.
    role_id                 uuid not null references hr.roles(id),

    created_by              uuid references auth.users(id),
    created_at              timestamptz not null default now(),
    updated_by              uuid references auth.users(id),
    updated_at              timestamptz not null default now(),

    -- `net_minutes` is DERIVED — gross span minus the unpaid break — and a
    -- stored derived value that nothing checks is the drift this codebase has
    -- been bitten by repeatedly. It is pinned here instead of trusted.
    --
    -- The `(d + 1439) % 1440 + 1` form maps a same-time start/end to a full
    -- 1440-minute day rather than to zero, and carries a negative difference
    -- (a shift crossing midnight) into the correct positive span.
    --
    -- Every function used is IMMUTABLE — `date_part(text, time)` is
    -- provolatile 'i' — which is what a CHECK constraint requires.
    constraint baseline_ft_patterns_net_derived check (
        net_minutes = (
            (
                (
                    (extract(hour from end_time)::int * 60 + extract(minute from end_time)::int)
                  - (extract(hour from start_time)::int * 60 + extract(minute from start_time)::int)
                  + 1439
                ) % 1440
            ) + 1
        ) - unpaid_break_minutes
    ),

    -- A shift of zero or negative length is not a shift. The daily FLOOR and
    -- CEILING (cl 35.1(c)/(d)) are deliberately NOT enforced here: the shape
    -- backstop in this database is intentionally weaker than the application
    -- layer, so that one engine owns the clause and the database owns only
    -- what is structurally impossible.
    constraint baseline_ft_patterns_net_positive check (net_minutes > 0)
);

-- ONE line per employee per day of the cycle.
--
-- This is cl 39.1 expressed as a constraint: split shifts are available to
-- part-time and flexible part-time Team Members only, so a full-time employee
-- cannot hold two pattern lines on the same day. The application says so too
-- (BFT_PATTERN_SPLIT_SHIFT), and the schema makes it unrepresentable.
create unique index if not exists baseline_ft_patterns_one_per_day
    on public.baseline_ft_patterns (employee_id, week_in_cycle, iso_day_of_week);

create index if not exists baseline_ft_patterns_scope
    on public.baseline_ft_patterns (sub_department_id, employee_id);

comment on table public.baseline_ft_patterns is
    'A full-time employee''s standing weekly pattern. One row per working day. '
    'Replaces the shared roster_templates pattern, which could not carry per-employee roles.';
comment on column public.baseline_ft_patterns.iso_day_of_week is
    'ISO weekday: 1 = Monday … 7 = Sunday. NOT the same encoding as template_shifts.day_of_week (0 = Sunday).';
comment on column public.baseline_ft_patterns.net_minutes is
    'Gross span minus the unpaid break. Derived, and pinned to its inputs by baseline_ft_patterns_net_derived.';
comment on column public.baseline_ft_patterns.week_in_cycle is
    'Week of the declared ordinary-hours cycle. v1 writes 1; the column exists because it is part of the uniqueness key.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Runs no longer require a template
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The FK stays so historical rows keep their meaning; only the NOT NULL goes.
-- Safe with respect to `baseline_ft_runs_one_live`, which keys on
-- (sub_department_id, period_start, period_end) and never reads template_id.
alter table public.baseline_ft_runs
    alter column template_id drop not null;

comment on column public.baseline_ft_runs.template_id is
    'Legacy: the roster_templates pattern a pre-2026-09 run was generated from. '
    'NULL for runs built from baseline_ft_patterns.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Proposed shifts point at a pattern line, not a template shift
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The column never had a foreign key, so it was already just a provenance
-- reference — but leaving it named `template_shift_id` while it holds a
-- `baseline_ft_patterns.id` is the same trap the ISO weekday naming avoids.
-- Free to rename: the table holds zero rows.
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name   = 'baseline_ft_proposed_shifts'
          and column_name  = 'template_shift_id'
    ) then
        alter table public.baseline_ft_proposed_shifts
            rename column template_shift_id to source_slot_id;
    end if;
end $$;

comment on column public.baseline_ft_proposed_shifts.source_slot_id is
    'The baseline_ft_patterns row that produced this candidate. Provenance only; no FK, so a pattern edit never orphans an applied shift.';

comment on column public.baseline_ft_proposed_shifts.idempotency_key is
    'Rebuildable natural key: bft:<sub_dept>:<employee>:<date>:<times>:<role>. '
    'Carries NEITHER the run nor the roster period — a shift''s identity does not depend on '
    'which window a manager happened to be looking at when they applied it.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Same permission that governs creating a shift, because a pattern is the
-- instruction that creates them. Mirrors baseline_ft_runs rather than
-- autoschedule_sessions, whose single `USING (true)` policy grants every
-- authenticated user every row.
alter table public.baseline_ft_patterns enable row level security;

drop policy if exists baseline_ft_patterns_read on public.baseline_ft_patterns;
create policy baseline_ft_patterns_read on public.baseline_ft_patterns
    for select to authenticated
    using (user_has_action_in_scope('shift.create', organization_id, department_id, sub_department_id));

drop policy if exists baseline_ft_patterns_insert on public.baseline_ft_patterns;
create policy baseline_ft_patterns_insert on public.baseline_ft_patterns
    for insert to authenticated
    with check (user_has_action_in_scope('shift.create', organization_id, department_id, sub_department_id));

drop policy if exists baseline_ft_patterns_update on public.baseline_ft_patterns;
create policy baseline_ft_patterns_update on public.baseline_ft_patterns
    for update to authenticated
    using (user_has_action_in_scope('shift.create', organization_id, department_id, sub_department_id))
    with check (user_has_action_in_scope('shift.create', organization_id, department_id, sub_department_id));

-- Unlike a run, a pattern is editable configuration and not an audit record:
-- removing a working day from someone's week has to actually remove the row,
-- so this table DOES get a delete policy.
drop policy if exists baseline_ft_patterns_delete on public.baseline_ft_patterns;
create policy baseline_ft_patterns_delete on public.baseline_ft_patterns
    for delete to authenticated
    using (user_has_action_in_scope('shift.create', organization_id, department_id, sub_department_id));

commit;
