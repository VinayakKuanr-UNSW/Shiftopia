create table if not exists public.actual_labor_attendance (
    id          uuid primary key default gen_random_uuid(),
    event_id    text not null,
    role        text not null,
    time_slot   integer not null,
    assigned    integer not null default 0,
    present     integer not null default 0,
    created_at  timestamptz not null default now()
);

create index if not exists actual_labor_attendance_event_id_idx on public.actual_labor_attendance (event_id);

alter table public.actual_labor_attendance enable row level security;

create policy "authenticated_read_actual_labor_attendance"
    on public.actual_labor_attendance
    for select
    to authenticated
    using (true);

create policy "authenticated_insert_actual_labor_attendance"
    on public.actual_labor_attendance
    for insert
    to authenticated
    with check (true);
