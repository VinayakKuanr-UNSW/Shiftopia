-- Supplement to the baseline schema: the storage objects production has.
--
-- `supabase db dump` skips Supabase-managed schemas, so the broadcast
-- attachment bucket and its two policies on storage.objects were in no
-- migration at all — every local database lacked them, and attachment upload
-- could not work locally. Definitions copied from production
-- (srfozdlphoempdattvtx) on 2026-10-13.
--
-- Deliberately NOT reproduced: production's 11 pg_cron jobs (shift-timer-sweep,
-- shift-state-processor, sweep_expired_offers, nightly_* …). Their functions
-- are in the baseline; scheduling them locally would mutate test data mid-run.
-- Call the job function directly when a test needs it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'broadcast-attachments',
  'broadcast-attachments',
  true,
  52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp'
  ]
)
on conflict (id) do nothing;

create policy "Authenticated users can upload broadcast attachments"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'broadcast-attachments'::text);

create policy "Authenticated users can delete broadcast attachments"
  on storage.objects for delete to authenticated
  using (bucket_id = 'broadcast-attachments'::text);
