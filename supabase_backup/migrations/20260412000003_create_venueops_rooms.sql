-- ICC bookable rooms — NOT synthetic, Shri will provide the real list
-- from: Momentous Elite API > General Setup > Get Rooms
create table if not exists public.venueops_rooms (
    id                      text primary key,
    name                    text not null,
    max_capacity            integer,
    square_footage          integer,
    venue_id                text,
    venue_name              text,
    room_group              text,
    item_code               text,
    sub_room_ids            text[] not null default '{}',   -- rooms inside this room if combo
    is_combo_room           boolean not null default false,
    is_active               boolean not null default true,
    conflicting_room_ids    text[] not null default '{}'    -- can't be booked at same time
);

create index if not exists venueops_rooms_venue_id_idx  on public.venueops_rooms (venue_id);
create index if not exists venueops_rooms_is_active_idx on public.venueops_rooms (is_active);

alter table public.venueops_rooms enable row level security;

create policy "authenticated_read_venueops_rooms"
    on public.venueops_rooms
    for select
    to authenticated
    using (true);

comment on table public.venueops_rooms is
    'ICC bookable rooms from VenueOps. Schema mirrors Momentous Elite GeneralSetup/Get Rooms. '
    'Room data provided by client (Shri Kumaran) — cannot be synthetic.';
