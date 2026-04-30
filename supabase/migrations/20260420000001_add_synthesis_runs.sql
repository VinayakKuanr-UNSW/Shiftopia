-- HARDENED FOR PARENT INTEGRATION:
--   - synthesis_runs RLS scoped via user_has_action_in_scope('shift.create', ...)
--   - cancellation_history RLS scoped via shifts FK and user_has_action_in_scope('shift.edit', ...)

-- ============================================================
-- Phase 5: shift synthesis audit + rollback support
--
-- 1. synthesis_runs  — one row per "Generate Shifts" click.
--    Stores scope, inputs, result counts. Enables rollback + history.
-- 2. shifts.synthesis_run_id  — back-reference so rollback can find
--    exactly the shifts a run created.
-- ============================================================

create table if not exists public.synthesis_runs (
    id                  uuid primary key default gen_random_uuid(),
    organization_id     uuid not null,
    department_id       uuid not null,
    sub_department_id   uuid,
    roster_id           uuid not null,
    shift_date          date not null,
    created_by          uuid not null,
    created_at          timestamptz not null default now(),
    -- Count of shifts the orchestrator tried to insert (before DB errors)
    attempted_count     integer not null default 0,
    -- Count that actually landed in the DB
    created_count       integer not null default 0,
    -- Option values at the time of the run (for audit / retry)
    options             jsonb not null default '{}'::jsonb,
    -- When set, the run has been rolled back; shifts with matching synthesis_run_id
    -- have been deleted. We keep the row for audit history.
    rolled_back_at      timestamptz,
    rolled_back_by      uuid,
    rolled_back_count   integer
);

create index if not exists synthesis_runs_org_date_idx
    on public.synthesis_runs (organization_id, shift_date desc);
create index if not exists synthesis_runs_scope_idx
    on public.synthesis_runs (department_id, sub_department_id, shift_date desc);

alter table public.synthesis_runs enable row level security;

create policy "authenticated_read_synthesis_runs"
    on public.synthesis_runs for select
    to authenticated
    using (user_has_action_in_scope('shift.create', organization_id, department_id, sub_department_id));

create policy "authenticated_write_synthesis_runs"
    on public.synthesis_runs for insert
    to authenticated
    with check (user_has_action_in_scope('shift.create', organization_id, department_id, sub_department_id));

create policy "authenticated_update_synthesis_runs"
    on public.synthesis_runs for update
    to authenticated
    using (user_has_action_in_scope('shift.create', organization_id, department_id, sub_department_id))
    with check (user_has_action_in_scope('shift.create', organization_id, department_id, sub_department_id));

-- ------------------------------------------------------------
-- Back-reference column on shifts. Nullable: manual / template /
-- autoscheduler shifts never have a run id.
-- ------------------------------------------------------------
alter table public.shifts
    add column if not exists synthesis_run_id uuid
        references public.synthesis_runs(id) on delete set null;

create index if not exists shifts_synthesis_run_id_idx
    on public.shifts (synthesis_run_id)
    where synthesis_run_id is not null;

comment on column public.shifts.synthesis_run_id is
    'Set when a shift was created by the Phase 5 shift synthesizer. '
    'Rollback of a run deletes all shifts with this id that are still unassigned.';

comment on table public.synthesis_runs is
    'Audit row per Generate Shifts invocation. Enables rollback, history, and retry.';

create table if not exists public.cancellation_history (
    id                  uuid primary key default gen_random_uuid(),
    shift_id            uuid not null references public.shifts(id),
    employee_id         uuid not null,
    cancelled_at        timestamptz default now(),
    notice_period_hours integer,
    reason              text,
    penalty_applied     numeric,
    created_at          timestamptz default now()
);

alter table public.cancellation_history enable row level security;

create policy "authenticated_read_cancellation_history"
    on public.cancellation_history for select
    to authenticated
    using (EXISTS (
        SELECT 1 FROM shifts s
        WHERE s.id = cancellation_history.shift_id
          AND user_has_action_in_scope('shift.edit', s.organization_id, s.department_id, s.sub_department_id)
    ));

create policy "authenticated_write_cancellation_history"
    on public.cancellation_history for insert
    to authenticated
    with check (EXISTS (
        SELECT 1 FROM shifts s
        WHERE s.id = cancellation_history.shift_id
          AND user_has_action_in_scope('shift.edit', s.organization_id, s.department_id, s.sub_department_id)
    ));
