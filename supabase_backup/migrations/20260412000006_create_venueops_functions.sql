-- sessions within an event e.g. Dinner, Opening Ceremony, Setup
-- one event has multiple functions
-- from: Momentous Elite API > Functions
create table if not exists public.venueops_functions (
    function_id             text primary key,
    event_id                text not null references public.venueops_events (event_id) on delete cascade,
    name                    text not null,
    date                    date not null,
    start_time              time,
    end_time                time,
    start_date_time         timestamptz not null,
    end_date_time           timestamptz not null,
    number_of_hours         numeric(5, 2) not null default 0, -- used to calculate time slices for ML
    expected_attendance     integer not null default 0,       -- ML feature
    is_performance          boolean not null default false,
    is_canceled             boolean not null default false,
    function_type_id        text references public.venueops_function_types (id) on delete set null,
    function_type_name      text,
    room_id                 text references public.venueops_rooms (id) on delete set null,
    room_name               text,
    venue_id                text,
    venue_name              text,
    event_type_name         text,
    created_at              timestamptz not null default now()
);

create index if not exists venueops_functions_event_id_idx          on public.venueops_functions (event_id);
create index if not exists venueops_functions_function_type_id_idx  on public.venueops_functions (function_type_id);
create index if not exists venueops_functions_room_id_idx           on public.venueops_functions (room_id);
create index if not exists venueops_functions_start_date_time_idx   on public.venueops_functions (start_date_time);

alter table public.venueops_functions enable row level security;

create policy "authenticated_read_venueops_functions"
    on public.venueops_functions
    for select
    to authenticated
    using (true);

comment on table public.venueops_functions is
    'Individual functions (sessions) within a VenueOps event. '
    'Mirrors Momentous Elite Functions schema. Provides function timing and type for ML features.';
