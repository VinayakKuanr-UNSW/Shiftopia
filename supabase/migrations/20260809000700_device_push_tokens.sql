-- Device push tokens for FCM remote notifications (feature/notification).
-- One row per FCM token. Written by the native client via register_push_token()
-- and read by the send-push Edge Function (service role, bypasses RLS).

create table if not exists public.device_push_tokens (
    id           uuid        primary key default gen_random_uuid(),
    profile_id   uuid        not null references public.profiles (id) on delete cascade,
    token        text        not null unique,
    platform     text        not null default 'android',
    created_at   timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    disabled_at  timestamptz
);

create index if not exists device_push_tokens_active_profile_idx
    on public.device_push_tokens (profile_id)
    where disabled_at is null;

alter table public.device_push_tokens enable row level security;

-- Owner-only: a user may read/manage only their own device tokens. The
-- send-push Edge Function uses the service role and is not subject to this.
--
-- `to authenticated` is explicit: an unqualified CREATE POLICY defaults to role
-- `public`, which includes anon. The qualifier would still evaluate to false
-- for an anonymous caller (auth.uid() is null), so this is defence in depth
-- rather than a live hole — but a table full of `{public}` policies is exactly
-- how shift_offers and shift_bid_windows ended up anon-writable.
create policy "device_push_tokens_owner_only" on public.device_push_tokens
    for all to authenticated
    using (profile_id = (select auth.uid()))
    with check (profile_id = (select auth.uid()));

-- Push tokens are device identifiers tied to a person; anon has no business
-- holding table grants on them.
revoke all on public.device_push_tokens from anon;

-- Upsert a token for the calling user. SECURITY DEFINER so that a device which
-- re-registers under a different account reassigns ownership cleanly (a direct
-- client upsert would be blocked by the owner-only policy on the existing row).
create or replace function public.register_push_token(
    p_token    text,
    p_platform text default 'android'
)
returns void
language plpgsql
security definer
-- Pinned search_path with pg_catalog first, matching the convention used by
-- is_admin()/is_manager_or_above(). `set search_path = public` alone leaves a
-- SECURITY DEFINER function open to resolution hijacking via a schema earlier
-- on the caller's path.
set search_path to 'pg_catalog', 'public'
as $$
begin
    if auth.uid() is null then
        raise exception 'not authenticated';
    end if;

    insert into public.device_push_tokens (profile_id, token, platform, last_seen_at, disabled_at)
    values (auth.uid(), p_token, p_platform, now(), null)
    on conflict (token) do update
        set profile_id   = auth.uid(),
            platform     = excluded.platform,
            last_seen_at = now(),
            disabled_at  = null;
end;
$$;

-- Supabase grants EXECUTE on new functions to PUBLIC (which includes anon) and
-- implicitly to authenticated, so granting to `authenticated` alone does not
-- restrict anything. Revoke first, then grant the one role that should hold it.
-- The body raises on a null auth.uid(), so an anon call was never useful — but
-- an exposed SECURITY DEFINER entry point is not something to leave lying
-- around. See the 211-definer-function finding in the 2026-07-19 audit.
revoke all on function public.register_push_token(text, text) from public;
revoke all on function public.register_push_token(text, text) from anon;
grant execute on function public.register_push_token(text, text) to authenticated;

-- ── Verification (after applying) ───────────────────────────────────────────
--   select proname, proacl from pg_proc
--   where proname = 'register_push_token';
--   -- expect authenticated=X/postgres only; no anon, no PUBLIC entry.
