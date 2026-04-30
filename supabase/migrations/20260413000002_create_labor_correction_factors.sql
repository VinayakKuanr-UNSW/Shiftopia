create table if not exists public.labor_correction_factors (
    id                uuid primary key default gen_random_uuid(),
    event_type        text not null,
    role              text not null,
    correction_factor numeric not null default 1.0,
    last_updated      timestamptz not null default now(),
    unique (event_type, role)
);

alter table public.labor_correction_factors enable row level security;

create policy "authenticated_read_labor_correction_factors"
    on public.labor_correction_factors
    for select
    to authenticated
    using (true);

create policy "authenticated_update_labor_correction_factors"
    on public.labor_correction_factors
    for update
    to authenticated
    using (true);
