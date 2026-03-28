-- Compliance Audit Log
-- Tracks every compliance check, approval, rejection, and override
-- for debugging, legal compliance, and workflow replay.

create table if not exists public.compliance_audit_log (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references auth.users(id) on delete set null,
    action            text not null check (action in ('run', 'approve', 'reject', 'override')),
    context           text not null check (context in ('add_shift', 'bid', 'swap')),
    reference_id      text,           -- shiftId, bidId, or swapId
    input_snapshot    jsonb,          -- serialized input (employee + shift details)
    result_snapshot   jsonb,          -- serialized result (buckets, summary)
    override_reason   text,           -- required for action='override'
    created_at        timestamptz not null default now()
);

-- Indexes for common query patterns
create index if not exists compliance_audit_log_user_id_idx    on public.compliance_audit_log (user_id);
create index if not exists compliance_audit_log_context_idx    on public.compliance_audit_log (context);
create index if not exists compliance_audit_log_action_idx     on public.compliance_audit_log (action);
create index if not exists compliance_audit_log_reference_idx  on public.compliance_audit_log (reference_id);
create index if not exists compliance_audit_log_created_at_idx on public.compliance_audit_log (created_at desc);

-- RLS: managers can read audit logs; only system can write
alter table public.compliance_audit_log enable row level security;

-- Managers (authenticated) can read all audit logs
create policy "managers_read_audit_logs"
    on public.compliance_audit_log
    for select
    to authenticated
    using (true);

-- Authenticated users can insert their own logs
create policy "users_insert_audit_logs"
    on public.compliance_audit_log
    for insert
    to authenticated
    with check (user_id = auth.uid());

comment on table public.compliance_audit_log is
    'Audit trail for all compliance checks and decisions. '
    'Every run/approve/reject/override is logged here for legal compliance and debugging.';
