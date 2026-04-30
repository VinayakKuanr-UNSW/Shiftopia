-- recurring event series e.g. Salesforce World Tour runs every year
-- from: Momentous Elite API > Series
create table if not exists public.venueops_series (
    series_id           text primary key,
    name                text not null,
    unique_id           text,
    announce_date_time  timestamptz,
    on_sale_date_time   timestamptz
);

create index if not exists venueops_series_name_idx on public.venueops_series (name);

alter table public.venueops_series enable row level security;

create policy "authenticated_read_venueops_series"
    on public.venueops_series
    for select
    to authenticated
    using (true);

comment on table public.venueops_series is
    'Recurring event series (e.g. Salesforce World Tour, AnimeCon). '
    'Mirrors Momentous Elite Series schema. Used for time-series ML patterns.';
