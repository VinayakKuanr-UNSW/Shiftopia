# Database baseline: rebuilding production locally

`supabase start` (or `supabase db reset`) builds a local database that matches production: same tables, functions, RLS policies, triggers, views, enums and grants. `scripts/db/verify-baseline.sh` proves it by comparing every object against production.

This matters for any test of who can do what. Without the grants supplement below, a database rebuilt from the dump lets `anon` execute every SECURITY DEFINER RPC, which production refuses.

## What builds the database

| File | What it is |
|---|---|
| `supabase/migrations/20251015000000_baseline_schema.sql` | Schema-only dump of production (all app schemas: `public`, `hr`, `diag`, `internal`, `sim_seed`). Generated; don't hand-edit. |
| `…000001_auth_user_created_trigger.sql` | The `auth.users` signup trigger. The dump skips the `auth` schema. |
| `…000002_baseline_storage_supplement.sql` | The `broadcast-attachments` bucket and its two `storage.objects` policies. The dump skips `storage`. |
| `…000003_baseline_acl_from_prod.sql` | Production's exact grants on every app function, table, view and sequence. Generated. Without it, Supabase's default privileges re-grant everything production revoked. |
| `supabase/seeds/reference.sql` | Reference data with no personal data: org structure, roles, `rbac_*` permission matrix, EBA rates, public holidays, catalogues, config. Generated. |
| `supabase/seed.sql` | Venue-ops sample data. |
| `supabase/migrations_archive_pre_baseline_<date>/` | The migrations each baseline replaced. Kept for history; never replayed. |

Not reproduced locally, on purpose:

- **Production's 11 `pg_cron` jobs.** Scheduling them would change test data mid-run. Call the job's function directly in a test.
- **People and transactional data.** There are no users, contracts, shifts or timesheets. Tests create their own.

## Adding a migration

Same as before: apply it to production through the MCP, then add the file under `supabase/migrations/` using **the version production recorded**. Check it with `select version, name from supabase_migrations.schema_migrations order by version desc limit 5`. It sorts after the baseline and replays on top of it.

On the PR, the **Database drift check** workflow rebuilds the database from the repo and compares it with production. A file that doesn't match what ran fails it.

**A migration production already ran before the baseline was taken must not go in `supabase/migrations/`.** The baseline already contains it, so replaying it again fails. Put it in that baseline's archive folder instead. This applies to `toil_ledger` and `toil_fmt_hours` (both applied 2026-10-10).

## Drift check

`.github/workflows/db-drift.yml` runs `scripts/db/verify-baseline.sh` in CI:
- daily at 05:00 AEDT;
- on demand (Actions → Database drift check → Run workflow);
- on PRs that touch `supabase/migrations/`, `supabase/seeds/` or `scripts/db/`.

It's read-only against production and uses the `SUPABASE_DB_URL` secret the RLS guard already uses. A failure lists every object that differs. Usually the cause is a migration applied without its repo file, or a file that doesn't match what ran. Add or fix the file. If the drift is wide, re-baseline.

## Re-baselining

Do this when `verify-baseline.sh` reports differences that the newer migration files don't explain. That's the same drift as before: migrations applied to production whose files are missing or differ.

```sh
# Needs Docker, the supabase CLI, and SUPABASE_DB_PASSWORD in .env.local
# (or SUPABASE_DB_URL in the environment — the form CI uses)
scripts/db/rebaseline-from-prod.sh   # read-only against production
scripts/db/verify-baseline.sh        # must end "schema: matches production"
```

Commit the new baseline, supplements, seed and archive folder together. Production's migration history is never touched.

If verification reports a definition that differs only in how Postgres prints it, compare the two definitions by hand before adding the hash pair to `scripts/db/fingerprint-equivalent.tsv`. For example, a CHECK constraint can lose a redundant pair of parentheses when it is re-parsed. Each entry matches exact hashes, so a real change later still fails.

## Password notes

- The scripts connect through the session pooler (`aws-1-ap-southeast-1.pooler.supabase.com`). The direct host is IPv6-only.
- After you reset the database password, the pooler can take a few minutes to accept the new one.
- A reset also invalidates the `SUPABASE_DB_URL` repo secret, which CI's RLS guard uses. Update the secret at the same time, writing `@` in the password as `%40`.
