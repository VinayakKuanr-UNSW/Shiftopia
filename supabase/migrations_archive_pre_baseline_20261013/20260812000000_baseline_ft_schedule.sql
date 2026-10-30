-- ============================================================================
-- SUPERSEDED — the Baseline FT feature was removed in full.
--
--   20260813000300  dropped the generator and its five tables
--   20260813000600  removed the concept entirely (seeded templates, triggers,
--                   guards, leave_mode)
--
-- Nothing this migration created still exists. It is retained only as applied
-- history. `docs/design/baseline-ft-schedule.md`, referenced below, was deleted
-- with the feature.
-- ============================================================================
-- ============================================================================
-- Baseline FT Schedule
--
-- ✅ APPLIED TO PRODUCTION 2026-08-12 (project srfozdlphoempdattvtx "Shiftopia")
--    as migration version 20260812000000 / name 20260812000000_baseline_ft_schedule.
--    Verified after apply: RLS on + 1 policy on all five tables, ZERO anon/PUBLIC
--    grants, non-manager JWT reads 0 rows and is refused on INSERT (42501),
--    manager JWT reads normally, the one-live partial unique index rejects a
--    second concurrent 'proposed' run. Security advisors: 0 findings naming
--    baseline_ft_*.
--
-- Adds the proposal layer for generating a rules-validated baseline roster for
-- FULL-TIME employees in one sub-department, plus the `leave_mode`
-- discriminator that resolves the cl 55 / cl 58 paid-or-unpaid ambiguity.
--
-- Design + full clause traceability: docs/design/baseline-ft-schedule.md
--
-- ── What this migration is careful NOT to do ────────────────────────────────
-- Nothing here touches `shifts`, `rosters`, `user_contracts`, or any existing
-- leave row's meaning. Generation writes only to the new `baseline_ft_*`
-- tables; shifts appear on the live roster only when a manager explicitly
-- applies a proposal, through the existing shift-creation path.
--
-- ── Naming ──────────────────────────────────────────────────────────────────
-- Everything is prefixed `baseline_ft_`. `roles.is_baseline_eligible` already
-- exists and means something unrelated (baseline LABOUR DEMAND, in the
-- forecasting module). The prefix keeps the two apart.
--
-- ── Rollback ────────────────────────────────────────────────────────────────
--   drop table if exists public.baseline_ft_findings cascade;
--   drop table if exists public.baseline_ft_proposed_shifts cascade;
--   drop table if exists public.baseline_ft_run_employees cascade;
--   drop table if exists public.baseline_ft_runs cascade;
--   drop table if exists public.baseline_ft_patterns cascade;
--   alter table public.leave_requests drop column if exists leave_mode;
--   drop type if exists public.leave_mode;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. leave_mode — resolves decision N6
--
-- cl 55.1 (Religious, Cultural and Ceremonial Leave, p.44) and cl 58.2 (Gender
-- Affirmation Leave, p.46) each expressly permit the Team Member to use EITHER
-- accrued paid annual leave OR unpaid leave. Which one was used is not
-- recoverable from `leave_type`, and guessing it mis-states the employee's
-- contracted-hours reconciliation in one direction or the other.
--
-- NULL is a real, meaningful state here: "not yet recorded". The baseline
-- generator treats it as unresolved — credits nothing, blocks the dates, and
-- asks the manager — rather than falling back to a default.
-- ----------------------------------------------------------------------------
do $$
begin
    if not exists (select 1 from pg_type where typname = 'leave_mode') then
        create type public.leave_mode as enum ('paid', 'unpaid');
    end if;
end $$;

alter table public.leave_requests
    add column if not exists leave_mode public.leave_mode;

comment on column public.leave_requests.leave_mode is
    'Whether this leave is paid or unpaid. NULL = not recorded. Required for '
    'cl 55 (religious/cultural) and cl 58 (gender affirmation) leave, which the '
    'EBA permits to be taken as EITHER accrued annual leave or unpaid — the '
    'leave type alone cannot answer it.';

-- Backfill ONLY where the EBA is unambiguous. cl 55 / cl 58 are deliberately
-- left NULL: they are the entire reason this column exists.
update public.leave_requests
   set leave_mode = 'paid'
 where leave_mode is null
   and leave_type in ('annual', 'personal', 'carer', 'compassionate', 'parental',
                      'supporting_carer', 'fdv', 'jury_duty', 'long_service');

update public.leave_requests
   set leave_mode = 'unpaid'
 where leave_mode is null
   and leave_type in ('unpaid', 'community_service');

-- ----------------------------------------------------------------------------
-- 2. baseline_ft_patterns — the reusable pattern
--
-- Thin by design: the day/time SHAPES live in `roster_templates` /
-- `template_shifts`, which already exist and already carry `sub_department_id`
-- and `day_of_week`. This table adds only what a baseline needs on top — the
-- work-cycle anchor and the operating window, both of which the EBA leaves open
-- and which therefore have to be stated explicitly rather than assumed.
-- ----------------------------------------------------------------------------
create table if not exists public.baseline_ft_patterns (
    id                   uuid primary key default gen_random_uuid(),
    organization_id      uuid not null,
    department_id        uuid references public.departments(id),
    sub_department_id    uuid not null references public.sub_departments(id) on delete cascade,
    name                 text not null,
    description          text,

    -- Supplies the day/time shapes. NULL ⇒ derive from the employee's history.
    roster_template_id   uuid references public.roster_templates(id) on delete set null,

    -- N3 (NOT-IN-EBA): cl 35.1(a) permits a work cycle of "up to four (4)
    -- weeks" but never says where a cycle starts. The 152h ceiling is
    -- meaningless without a boundary, so the anchor is explicit and required —
    -- never inferred from the calendar month.
    cycle_weeks          smallint not null default 4 check (cycle_weeks between 1 and 4),
    cycle_anchor_date    date not null,

    -- N1 (NOT-IN-EBA): the sub-department's operating window. cl 35.1(b)
    -- permits ordinary hours on any day Mon–Sun with NO time-of-day
    -- restriction, and cl 43 only attaches an allowance to 22:00–06:00. These
    -- are therefore a business boundary, and are labelled as such wherever they
    -- cause a shift to be rejected.
    earliest_start       time not null,
    latest_finish        time not null,

    -- N5: cl 56.4 pays a non-worked public holiday only where the employee
    -- "would ordinarily be rostered" — circular for a generator that is
    -- deciding the roster. Resolved by crediting only where the pattern places
    -- a shift on that weekday.
    ph_credits_hours     boolean not null default true,

    is_active            boolean not null default true,
    created_by           uuid references public.profiles(id),
    created_at           timestamptz not null default now(),
    updated_by           uuid references public.profiles(id),
    updated_at           timestamptz not null default now()
);

create index if not exists baseline_ft_patterns_subdept_idx
    on public.baseline_ft_patterns (sub_department_id) where is_active;

-- ----------------------------------------------------------------------------
-- 3. baseline_ft_runs — one generation, as a proposal
-- ----------------------------------------------------------------------------
create table if not exists public.baseline_ft_runs (
    id                 uuid primary key default gen_random_uuid(),
    organization_id    uuid not null,
    sub_department_id  uuid not null references public.sub_departments(id) on delete cascade,
    pattern_id         uuid references public.baseline_ft_patterns(id) on delete set null,
    roster_id          uuid references public.rosters(id) on delete set null,
    period_start       date not null,
    period_end         date not null,
    status             text not null default 'proposed'
                       check (status in ('proposed', 'applied', 'discarded', 'superseded')),

    -- Frozen inputs, so a proposal stays reproducible and auditable even after
    -- the underlying contracts, leave or config have moved on.
    config_snapshot    jsonb not null default '{}'::jsonb,
    summary            jsonb not null default '{}'::jsonb,

    generated_by       uuid references public.profiles(id),
    generated_at       timestamptz not null default now(),
    applied_by         uuid references public.profiles(id),
    applied_at         timestamptz,

    constraint baseline_ft_runs_period_valid check (period_end >= period_start)
);

-- At most one LIVE proposal per (sub-department, period). Two managers
-- generating the same baseline concurrently get a clean conflict rather than
-- two competing proposals that could both be applied.
create unique index if not exists baseline_ft_runs_one_live
    on public.baseline_ft_runs (sub_department_id, period_start, period_end)
    where status = 'proposed';

create index if not exists baseline_ft_runs_subdept_period_idx
    on public.baseline_ft_runs (sub_department_id, period_start desc);

-- ----------------------------------------------------------------------------
-- 4. baseline_ft_run_employees — the transparent per-employee arithmetic
--
-- Stored in MINUTES throughout. 7.6h does not survive repeated floating-point
-- addition intact; 456 minutes does.
-- ----------------------------------------------------------------------------
create table if not exists public.baseline_ft_run_employees (
    id                       uuid primary key default gen_random_uuid(),
    run_id                   uuid not null references public.baseline_ft_runs(id) on delete cascade,
    employee_id              uuid not null references public.profiles(id) on delete cascade,
    -- Deliberately NOT a foreign key. `public.user_contracts` is a VIEW over the
    -- `hr` schema, so it cannot be an FK target, and pointing at the underlying
    -- `hr` table instead would couple this proposal layer to HR schema
    -- internals. This is provenance ("which contract produced these numbers"),
    -- not a relational dependency — a superseded contract must not cascade a
    -- historical proposal away.
    user_contract_id         uuid,

    contracted_weekly_hours  numeric(6,2) not null,
    -- True when contracted_weekly_hours was NULL and cl 12.2(b)'s 38h was used.
    -- Recorded so the UI can say so rather than presenting a default as fact.
    used_default_weekly_hours boolean not null default false,

    required_minutes         integer not null default 0,
    existing_minutes         integer not null default 0,
    leave_credit_minutes     integer not null default 0,
    -- Unpaid (cl 57.3) or unresolved (cl 55/58) leave: blocks, credits nothing.
    leave_blocked_minutes    integer not null default 0,
    deficit_minutes          integer not null default 0,
    proposed_minutes         integer not null default 0,
    variance_minutes         integer not null default 0,

    status                   text not null
                             check (status in ('ok', 'warning', 'blocked', 'satisfied', 'excluded')),
    excluded_reason          text,
    calculation              jsonb not null default '{}'::jsonb,

    unique (run_id, employee_id)
);

create index if not exists baseline_ft_run_employees_run_idx
    on public.baseline_ft_run_employees (run_id);

-- ----------------------------------------------------------------------------
-- 5. baseline_ft_proposed_shifts — NOT shifts until applied
-- ----------------------------------------------------------------------------
create table if not exists public.baseline_ft_proposed_shifts (
    id                       uuid primary key default gen_random_uuid(),
    run_id                   uuid not null references public.baseline_ft_runs(id) on delete cascade,
    run_employee_id          uuid not null references public.baseline_ft_run_employees(id) on delete cascade,
    employee_id              uuid not null references public.profiles(id) on delete cascade,

    shift_date               date not null,
    start_time               time not null,
    end_time                 time not null,
    unpaid_break_minutes     integer not null default 0,
    paid_break_minutes       integer not null default 0,
    net_minutes              integer not null,

    role_id                  uuid,
    roster_subgroup_id       uuid,
    source_template_shift_id uuid,
    day_type                 text not null
                             check (day_type in ('weekday', 'saturday', 'sunday', 'public_holiday')),

    -- Set when the proposal is applied. Its presence is what makes a second
    -- Apply a no-op rather than a duplicate.
    created_shift_id         uuid references public.shifts(id) on delete set null,

    -- Deterministic natural key: employee|date|start|end|role. Two runs over
    -- the same period with the same inputs produce identical keys.
    dedupe_key               text not null,

    unique (run_id, dedupe_key)
);

create index if not exists baseline_ft_proposed_shifts_run_idx
    on public.baseline_ft_proposed_shifts (run_id, shift_date);

-- ----------------------------------------------------------------------------
-- 6. baseline_ft_findings — every BLOCKING / WARNING / INFO, traceable
--
-- `eba_clause` is NULL exactly when the finding comes from a product rule
-- rather than the agreement. That distinction is load-bearing: the UI presents
-- an EBA-derived finding as a legal constraint and a product-derived one as a
-- configurable business rule. Conflating them would misrepresent both.
-- ----------------------------------------------------------------------------
create table if not exists public.baseline_ft_findings (
    id                  uuid primary key default gen_random_uuid(),
    run_id              uuid not null references public.baseline_ft_runs(id) on delete cascade,
    run_employee_id     uuid references public.baseline_ft_run_employees(id) on delete cascade,
    proposed_shift_id   uuid references public.baseline_ft_proposed_shifts(id) on delete cascade,

    severity            text not null check (severity in ('BLOCKING', 'WARNING', 'INFO')),
    rule_id             text not null,
    eba_clause          text,
    employee_id         uuid references public.profiles(id) on delete cascade,
    shift_date          date,
    summary             text not null,
    details             text not null,
    calculation         jsonb
);

create index if not exists baseline_ft_findings_run_idx
    on public.baseline_ft_findings (run_id, severity);

-- ============================================================================
-- RLS
--
-- Every table is manager-scoped: reading or writing a baseline proposal is a
-- roster-management action, so all five reuse `auth_can_manage_rosters()` —
-- the single predicate the roster policies already agree on. Employees have no
-- business reading an unapplied proposal about themselves; they see the roster
-- once it is applied and published, through the existing shift policies.
--
-- `anon` is revoked explicitly on every table. Supabase grants table
-- privileges to `anon` and `authenticated` by default, and enabling RLS alone
-- does not remove the grant — that is exactly how `availability_slots` and
-- `shift_offers` ended up anon-readable.
-- ============================================================================
alter table public.baseline_ft_patterns        enable row level security;
alter table public.baseline_ft_runs            enable row level security;
alter table public.baseline_ft_run_employees   enable row level security;
alter table public.baseline_ft_proposed_shifts enable row level security;
alter table public.baseline_ft_findings        enable row level security;

do $$
declare
    t text;
begin
    foreach t in array array[
        'baseline_ft_patterns',
        'baseline_ft_runs',
        'baseline_ft_run_employees',
        'baseline_ft_proposed_shifts',
        'baseline_ft_findings'
    ] loop
        execute format(
            'drop policy if exists %I on public.%I',
            t || '_manager_all', t
        );
        execute format(
            'create policy %I on public.%I for all to authenticated '
            'using (public.auth_can_manage_rosters()) '
            'with check (public.auth_can_manage_rosters())',
            t || '_manager_all', t
        );
        execute format('revoke all on public.%I from anon', t);
        execute format('revoke all on public.%I from public', t);
        execute format(
            'grant select, insert, update, delete on public.%I to authenticated', t
        );
    end loop;
end $$;

-- ============================================================================
-- Verification (run in the Supabase SQL editor AFTER applying)
--
-- RLS must be verified under a real JWT. The MCP/service connection is
-- superuser and BYPASSRLS, so `auth.uid()` is null there and every policy
-- appears to pass:
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<a NON-manager profile id>"}';
--   select count(*) from public.baseline_ft_runs;   -- expect: 0 rows
--
--   set local request.jwt.claims = '{"sub":"<a MANAGER profile id>"}';
--   select count(*) from public.baseline_ft_runs;   -- expect: visible
--
-- And confirm anon holds nothing:
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_name like 'baseline_ft_%' and grantee in ('anon','public');
--   -- expect: 0 rows
--
-- New SECURITY DEFINER functions auto-grant EXECUTE to `authenticated`; there
-- are none in this migration, but run `get_advisors` after applying anyway.
-- ============================================================================
