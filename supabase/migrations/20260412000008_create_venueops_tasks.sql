-- tasks linked to events e.g. "Brief security team", "Confirm catering"
-- from: Momentous Elite API > Tasks > Get Task
create table if not exists public.venueops_tasks (
    id              text primary key,
    title           text not null,
    description     text,
    task_type       text,                   -- e.g. 'Action', 'Reminder', 'Follow-up'
    due_date        date,
    is_completed    boolean not null default false,
    creation_date   timestamptz not null default now(),
    completion_date date,
    result          text,
    event_id        text references public.venueops_events (event_id) on delete set null,
    event_name      text,
    venue_ids       text[] not null default '{}',
    assigned_to     jsonb not null default '[]'  -- [{id, name, email}]
);

create index if not exists venueops_tasks_event_id_idx      on public.venueops_tasks (event_id);
create index if not exists venueops_tasks_due_date_idx      on public.venueops_tasks (due_date);
create index if not exists venueops_tasks_is_completed_idx  on public.venueops_tasks (is_completed);

alter table public.venueops_tasks enable row level security;

create policy "authenticated_read_venueops_tasks"
    on public.venueops_tasks
    for select
    to authenticated
    using (true);

comment on table public.venueops_tasks is
    'Operational tasks associated with VenueOps events. '
    'Mirrors Momentous Elite Tasks schema.';
