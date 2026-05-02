create table if not exists public.predicted_labor_demand (
    id              uuid primary key default gen_random_uuid(),
    -- HARDENED: FK to venueops_events added (parent integration)
    event_id        text NOT NULL REFERENCES venueops_events(event_id) ON DELETE CASCADE,
    role            text not null,
    time_slot       integer not null,
    predicted_count integer not null default 0,
    corrected_count integer not null default 0,
    model_version   text not null default 'v1.0',
    created_at      timestamptz not null default now()
);

create index if not exists predicted_labor_demand_event_id_idx on public.predicted_labor_demand (event_id);
create index if not exists predicted_labor_demand_role_idx on public.predicted_labor_demand (role);

alter table public.predicted_labor_demand enable row level security;

create policy "authenticated_read_predicted_labor_demand"
    on public.predicted_labor_demand
    for select
    to authenticated
    using (true);

create policy "authenticated_insert_predicted_labor_demand"
    on public.predicted_labor_demand
    for insert
    to authenticated
    with check (true);
