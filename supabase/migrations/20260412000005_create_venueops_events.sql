-- ICC events e.g. Salesforce World Tour 2025, AnimeCon 2024
-- from: Momentous Elite API > Events > Get Events (ML-relevant fields only, no financials)
create table if not exists public.venueops_events (
    event_id                    text primary key,
    name                        text not null,
    start_date_time             timestamptz not null,
    end_date_time               timestamptz not null,
    number_of_event_days        integer not null default 1,
    event_type_id               text references public.venueops_event_types (id) on delete set null,
    event_type_name             text,
    estimated_total_attendance  integer not null default 0, -- ML feature
    actual_total_attendance     integer,
    series_id                   text references public.venueops_series (series_id) on delete set null,
    is_tentative                boolean not null default false,
    is_definite                 boolean not null default false,
    is_prospect                 boolean not null default false,
    is_canceled                 boolean not null default false,
    room_ids                    text,
    room_names                  text,
    venue_ids                   text,
    venue_names                 text,
    created_at                  timestamptz not null default now()
);

create index if not exists venueops_events_event_type_id_idx    on public.venueops_events (event_type_id);
create index if not exists venueops_events_series_id_idx        on public.venueops_events (series_id);
create index if not exists venueops_events_start_date_time_idx  on public.venueops_events (start_date_time);
create index if not exists venueops_events_end_date_time_idx    on public.venueops_events (end_date_time);

alter table public.venueops_events enable row level security;

create policy "authenticated_read_venueops_events"
    on public.venueops_events
    for select
    to authenticated
    using (true);

comment on table public.venueops_events is
    'VenueOps events (conferences, concerts, exhibitions, etc.) at ICC. '
    'Mirrors Momentous Elite Events schema. Core input for ML demand prediction.';
