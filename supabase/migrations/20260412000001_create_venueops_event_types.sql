-- event type lookup e.g. Concert, Conference
-- from: Momentous Elite API > Event Setup > Get Event Types
create table if not exists public.venueops_event_types (
    id          text primary key,  -- e.g. 'et-001'
    name        text not null       -- e.g. 'Concert'
);

alter table public.venueops_event_types enable row level security;

create policy "authenticated_read_venueops_event_types"
    on public.venueops_event_types
    for select
    to authenticated
    using (true);

comment on table public.venueops_event_types is
    'Lookup table of VenueOps event types (e.g. Conference, Concert). '
    'Mirrors Momentous Elite EventSetup/Get Event Types schema.';
