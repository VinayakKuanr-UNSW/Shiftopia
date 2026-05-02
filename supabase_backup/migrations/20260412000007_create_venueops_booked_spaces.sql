-- room bookings per event — which room, when, how many people
-- from: Momentous Elite API > Book Spaces > Query Filtered Book Spaces
create table if not exists public.venueops_booked_spaces (
    id              text primary key,
    event_id        text not null references public.venueops_events (event_id) on delete cascade,
    description     text,
    room_id         text references public.venueops_rooms (id) on delete set null,
    room_name       text,
    room_setup      text,                   -- layout e.g. 'Theatre', 'Banquet'
    venue_id        text,
    attendance      integer not null default 0,
    room_capacity   integer,
    square_footage  integer,                -- used as ML feature (total_sqm)
    option_number   integer,
    start_date      date,
    end_date        date,
    is_all_day      boolean not null default false,
    start_time      time,
    end_time        time,
    booked_status   text not null default 'definite' check (booked_status in ('tentative', 'definite', 'prospect')),
    space_usage_id  text,
    space_usage_name text,
    usage_type      text check (usage_type in ('moveIn', 'moveOut', 'event', 'dark')),
    number_of_hours numeric(6, 2) not null default 0,
    is_invoiced     boolean not null default false,
    created_at      timestamptz not null default now()
);

create index if not exists venueops_booked_spaces_event_id_idx   on public.venueops_booked_spaces (event_id);
create index if not exists venueops_booked_spaces_room_id_idx    on public.venueops_booked_spaces (room_id);
create index if not exists venueops_booked_spaces_start_date_idx on public.venueops_booked_spaces (start_date);

alter table public.venueops_booked_spaces enable row level security;

create policy "authenticated_read_venueops_booked_spaces"
    on public.venueops_booked_spaces
    for select
    to authenticated
    using (true);

comment on table public.venueops_booked_spaces is
    'Room bookings within VenueOps events. '
    'Mirrors Momentous Elite BookedSpaces schema. Provides room_count, total_sqm, room_capacity for ML features.';
