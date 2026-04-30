-- function type lookup e.g. Dinner, Reception, Setup
-- from: Momentous Elite API > Event Setup > Get Function Types
create table if not exists public.venueops_function_types (
    id                  text primary key,
    name                text not null,
    room_setup          text,                       -- default room layout e.g. 'Banquet'
    show_on_calendar    boolean not null default true,
    is_performance      boolean not null default false
);

alter table public.venueops_function_types enable row level security;

create policy "authenticated_read_venueops_function_types"
    on public.venueops_function_types
    for select
    to authenticated
    using (true);

comment on table public.venueops_function_types is
    'Lookup table of VenueOps function types (e.g. Reception, Dinner, Setup). '
    'Mirrors Momentous Elite EventSetup/Get Function Types schema.';
