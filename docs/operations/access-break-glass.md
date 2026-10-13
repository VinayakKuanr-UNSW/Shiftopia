# Access break-glass: restoring a zeta

Use this when nobody who can sign in holds an active **zeta** certificate — the only level that can grant every other level. Examples: the zeta's owner has left, lost their account, or their certificate was removed outside the app.

## Why this should almost never happen

- The database refuses to deactivate, downgrade or delete the **last** active zeta certificate (trigger `trg_access_certificate_keep_last_zeta`). To retire a zeta account, grant the replacement zeta first, then revoke the old one.
- Keep **two** named people with zeta at all times.
- The old profile flag (`profiles.legacy_system_role`) no longer grants anything (retired 2026-10-11). It is not a way back in.

## Procedure

Two people: one runs the SQL in the Supabase SQL editor (project owner, no JWT, so the change is logged as a system action), the other reads it before it runs.

1. Find the recovery account's profile id.
   ```sql
   select id, email from public.profiles where email = '<recovery email>';
   ```
2. A person holds at most one active managerial (Type Y) certificate. If the recovery account has one, deactivate it.
   ```sql
   update public.app_access_certificates
      set is_active = false
    where user_id = '<id>' and certificate_type = 'Y' and is_active;
   ```
3. Grant zeta. A zeta certificate has no organization, department or sub-department.
   ```sql
   insert into public.app_access_certificates (user_id, certificate_type, access_level)
   values ('<id>', 'Y', 'zeta');
   ```
4. Check the history recorded it. `actor_id` is NULL for SQL-editor changes.
   ```sql
   select action, actor_id, occurred_at, after
     from public.access_certificate_events
    where subject_id = '<id>'
    order by occurred_at desc
    limit 3;
   ```
5. Have the recovery account sign in and open **Users**. Grant zeta to a second named person so there are two again.
6. Record who did this, why and when in the incident log.

## Afterwards

- Revoke the lost account's certificates from the Users page (revoking deactivates; it does not delete). The full history stays in `access_certificate_events`.
- Do not disable the last-zeta trigger to "tidy up". If it blocks you, a second zeta is missing.
