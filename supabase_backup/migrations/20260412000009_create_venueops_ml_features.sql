-- ML training table — one row per (event, function, role, 30-min slot)
-- not from the API, we built this based on PRD Appendix A
-- populated by the INSERT...SELECT in seed.sql
create table if not exists public.venueops_ml_features (
    id                              uuid primary key default gen_random_uuid(),
    event_id                        text references public.venueops_events (event_id) on delete cascade,
    function_id                     text references public.venueops_functions (function_id) on delete cascade,
    time_slice_index                integer not null,               -- 0 = first 30-min slot
    entry_peak_flag                 boolean not null default false, -- true for first 2 slots (people arriving)
    exit_peak_flag                  boolean not null default false, -- true for last 2 slots (people leaving)
    meal_window_flag                boolean not null default false, -- true if function is Dinner or Reception
    day_of_week                     integer not null check (day_of_week between 0 and 6),
    month                           integer not null check (month between 1 and 12),
    simultaneous_event_count        integer not null default 1,     -- how many events overlap at this time
    total_venue_attendance_same_time integer not null default 0,    -- total people at ICC at this time
    event_type                      text,
    expected_attendance             integer not null default 0,
    function_type                   text,
    function_start_datetime         timestamptz not null,
    function_end_datetime           timestamptz not null,
    room_count                      integer not null default 0,
    total_sqm                       integer not null default 0,
    room_capacity                   integer not null default 0,
    target_staff_count              integer not null default 0,     -- what the ML model learns to predict
    target_role                     text not null,                  -- e.g. 'Security', 'Usher'
    created_at                      timestamptz not null default now()
);

create index if not exists venueops_ml_features_event_id_idx        on public.venueops_ml_features (event_id);
create index if not exists venueops_ml_features_function_id_idx     on public.venueops_ml_features (function_id);
create index if not exists venueops_ml_features_event_type_idx      on public.venueops_ml_features (event_type);
create index if not exists venueops_ml_features_function_type_idx   on public.venueops_ml_features (function_type);
create index if not exists venueops_ml_features_target_role_idx     on public.venueops_ml_features (target_role);
create index if not exists venueops_ml_features_created_at_idx      on public.venueops_ml_features (created_at desc);

alter table public.venueops_ml_features enable row level security;

create policy "authenticated_read_venueops_ml_features"
    on public.venueops_ml_features
    for select
    to authenticated
    using (true);

comment on table public.venueops_ml_features is
    'ML feature table for predictive labour engine. '
    'Each row = one (event, function, role, time_slice). '
    'target_staff_count is the training label.';
