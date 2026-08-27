-- Baseline FT Schedule — the proposal layer.
--
-- WHY A RUN TABLE AT ALL. Generation must be read-only with respect to live
-- shifts, and Apply must be able to revalidate against a roster that may have
-- moved underneath it. Both need somewhere to hold a proposal that is not the
-- roster. The precedent is `synthesis_runs`, which is the applied, working
-- model in this database for a shift-CREATING operation with rollback and
-- per-row provenance — not `autoschedule_sessions`, which is an ASSIGNMENT
-- model keyed on shift_id and therefore cannot represent a shift that does not
-- exist yet.
--
-- WHY ONLY TWO TABLES. The design under review proposed five
-- (patterns / runs / run_employees / proposed_shifts / findings). Three of
-- those are recomputable from the run's inputs plus a roster snapshot, and a
-- stored copy of a derived fact is a second source of truth that drifts from
-- the engine that produced it — the failure mode that gave this codebase three
-- rival clock formatters and five rival fairness definitions. Patterns are
-- `roster_templates`, which already exist. Per-employee ledgers and findings
-- live inside `proposal` as computed, frozen output.
--
-- Rows here never move a shift. The only write to `shifts` happens at Apply,
-- through `sm_create_shift` via `shiftsCommands.createShift`, so the shape gate
-- runs on the way past exactly as it does for every other creation path.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Runs
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.baseline_ft_runs (
    id                  uuid primary key default gen_random_uuid(),

    organization_id     uuid not null references public.organizations(id) on delete cascade,
    department_id       uuid not null,
    sub_department_id   uuid not null,

    -- The pattern. A template, not a copy of one: duplicating the shape here
    -- would let a proposal and the template it came from disagree.
    template_id         uuid not null references public.roster_templates(id) on delete restrict,

    period_start        date not null,
    period_end          date not null,

    -- Concurrency. A digest of (shift.id, shift.version) over the read window.
    -- Apply recomputes it and compares; any change between Generate and Apply
    -- is detectable without diffing rows. Same contract as
    -- autoschedule_sessions.snapshot_version.
    snapshot_version    text not null,

    -- Determinism. A digest of the resolved INPUTS (contracts, pattern, config,
    -- period). Two runs sharing an input_digest MUST have produced identical
    -- proposals; comparing digests is how "generate twice" is asserted, and it
    -- is far cheaper than diffing two proposals.
    input_digest        text not null,

    -- The computed proposal, frozen: per-employee ledger, findings, and every
    -- rejected candidate with its reason. Stored rather than recomputed on read
    -- because the review screen must show what was DECIDED, not what today's
    -- engine would decide — an audit trail has to be frozen to be one.
    proposal            jsonb not null,

    status              text not null default 'generated'
                        check (status in ('generated','applied','partially_applied',
                                          'superseded','discarded')),

    created_by          uuid not null references auth.users(id),
    created_at          timestamptz not null default now(),
    applied_at          timestamptz,
    applied_by          uuid references auth.users(id),
    applied_count       integer not null default 0,
    skipped_count       integer not null default 0,

    constraint baseline_ft_runs_period_valid check (period_end >= period_start)
);

-- ONE live proposal per scope.
--
-- This is the whole of the "two managers generate simultaneously" guarantee:
-- the second insert raises a unique violation, which is a deterministic
-- conflict the UI can explain, rather than two rival proposals over the same
-- dates that a human has to reconcile. Partial, so applied and discarded runs
-- accumulate freely as history.
create unique index if not exists baseline_ft_runs_one_live
    on public.baseline_ft_runs (sub_department_id, period_start, period_end)
    where status = 'generated';

create index if not exists baseline_ft_runs_scope
    on public.baseline_ft_runs (organization_id, sub_department_id, period_start desc);

comment on table public.baseline_ft_runs is
    'Baseline FT proposals. Read-only with respect to shifts until Apply.';
comment on column public.baseline_ft_runs.snapshot_version is
    'Digest of (shift.id, shift.version) at Generate. Apply revalidates against it.';
comment on column public.baseline_ft_runs.input_digest is
    'Digest of the resolved inputs. Equal digests must imply identical proposals.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Proposed shifts
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Row-level identity is needed HERE and only here: Apply consumes these one at
-- a time, and idempotency needs a stable per-candidate key.
create table if not exists public.baseline_ft_proposed_shifts (
    id                      uuid primary key default gen_random_uuid(),
    run_id                  uuid not null references public.baseline_ft_runs(id) on delete cascade,

    employee_id             uuid not null references public.profiles(id) on delete cascade,
    -- Which engagement this discharges. An employee may hold several active
    -- contracts (30 of 103 in production do), and the hours belong to one.
    user_contract_id        uuid not null,
    -- Which pattern slot produced it — the traceability the design requires:
    -- proposed shift -> run -> employee -> contract -> pattern.
    template_shift_id       uuid not null,

    shift_date              date not null,
    start_time              time not null,
    end_time                time not null,
    unpaid_break_minutes    integer not null default 0,
    paid_break_minutes      integer not null default 0,
    net_minutes             integer not null,
    role_id                 uuid not null,
    target_employment_type  text not null default 'FT',

    -- The natural key for idempotency. Deliberately NOT a uuid and NOT a hash:
    -- it must be REBUILDABLE from the candidate alone so a second run produces
    -- the same key for the same shift, and readable from a row so a duplicate
    -- can be diagnosed. It excludes run_id for exactly that reason — keying on
    -- the run would let Generate -> Apply -> Generate -> Apply write the same
    -- shift twice.
    idempotency_key         text not null,

    status                  text not null default 'proposed'
                            check (status in ('proposed','applied',
                                              'skipped_conflict','skipped_invalid')),
    created_shift_id        uuid references public.shifts(id) on delete set null,
    skip_reason             text,

    created_at              timestamptz not null default now(),

    constraint baseline_ft_proposed_net_positive check (net_minutes > 0)
);

-- Global, not per-run. Two runs over the same scope must not both write the
-- same shift, which is what makes "generate, partially apply, generate again"
-- propose only the remainder.
create unique index if not exists baseline_ft_proposed_idem
    on public.baseline_ft_proposed_shifts (idempotency_key);

create index if not exists baseline_ft_proposed_run
    on public.baseline_ft_proposed_shifts (run_id, status);

create index if not exists baseline_ft_proposed_employee
    on public.baseline_ft_proposed_shifts (employee_id, shift_date);

comment on column public.baseline_ft_proposed_shifts.idempotency_key is
    'Rebuildable natural key: bft:<sub_dept>:<period>:<template>:<employee>:<date>:<times>:<role>.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Provenance on the shift itself
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Mirrors shifts.synthesis_run_id exactly. Nullable and unconstrained by
-- default so no existing write path has to know about it.
alter table public.shifts
    add column if not exists baseline_run_id uuid references public.baseline_ft_runs(id) on delete set null;

create index if not exists shifts_baseline_run
    on public.shifts (baseline_run_id) where baseline_run_id is not null;

comment on column public.shifts.baseline_run_id is
    'The Baseline FT run that created this shift, if any. Mirrors synthesis_run_id.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Scoped to the same permission that governs creating a shift, because that is
-- what applying a run does. Copied from synthesis_runs rather than from
-- autoschedule_sessions, whose single `USING (true)` policy grants every
-- authenticated user every row and is not a pattern worth spreading.
alter table public.baseline_ft_runs enable row level security;
alter table public.baseline_ft_proposed_shifts enable row level security;

drop policy if exists baseline_ft_runs_read on public.baseline_ft_runs;
create policy baseline_ft_runs_read on public.baseline_ft_runs
    for select to authenticated
    using (user_has_action_in_scope('shift.create', organization_id, department_id, sub_department_id));

drop policy if exists baseline_ft_runs_write on public.baseline_ft_runs;
create policy baseline_ft_runs_write on public.baseline_ft_runs
    for insert to authenticated
    with check (user_has_action_in_scope('shift.create', organization_id, department_id, sub_department_id));

drop policy if exists baseline_ft_runs_update on public.baseline_ft_runs;
create policy baseline_ft_runs_update on public.baseline_ft_runs
    for update to authenticated
    using (user_has_action_in_scope('shift.create', organization_id, department_id, sub_department_id))
    with check (user_has_action_in_scope('shift.create', organization_id, department_id, sub_department_id));

-- Proposed shifts inherit their parent's scope. The subquery is on
-- baseline_ft_runs.id, a column that certainly exists — the correlated-subquery
-- bug class in this database is a reference to a MISSING column on an outer
-- alias, which silently evaluates to no-op and disables the check.
drop policy if exists baseline_ft_proposed_read on public.baseline_ft_proposed_shifts;
create policy baseline_ft_proposed_read on public.baseline_ft_proposed_shifts
    for select to authenticated
    using (exists (
        select 1 from public.baseline_ft_runs r
        where r.id = baseline_ft_proposed_shifts.run_id
          and user_has_action_in_scope('shift.create', r.organization_id, r.department_id, r.sub_department_id)
    ));

drop policy if exists baseline_ft_proposed_write on public.baseline_ft_proposed_shifts;
create policy baseline_ft_proposed_write on public.baseline_ft_proposed_shifts
    for insert to authenticated
    with check (exists (
        select 1 from public.baseline_ft_runs r
        where r.id = baseline_ft_proposed_shifts.run_id
          and user_has_action_in_scope('shift.create', r.organization_id, r.department_id, r.sub_department_id)
    ));

drop policy if exists baseline_ft_proposed_update on public.baseline_ft_proposed_shifts;
create policy baseline_ft_proposed_update on public.baseline_ft_proposed_shifts
    for update to authenticated
    using (exists (
        select 1 from public.baseline_ft_runs r
        where r.id = baseline_ft_proposed_shifts.run_id
          and user_has_action_in_scope('shift.create', r.organization_id, r.department_id, r.sub_department_id)
    ))
    with check (exists (
        select 1 from public.baseline_ft_runs r
        where r.id = baseline_ft_proposed_shifts.run_id
          and user_has_action_in_scope('shift.create', r.organization_id, r.department_id, r.sub_department_id)
    ));

-- No DELETE policy on either table, deliberately. A proposal is an audit
-- record; superseding it is a status change, not a deletion.

commit;
