# Runbook — FT availability removal (`20260817120000`)

Applying this migration **deletes 17 availability rules and 1,533 slots** of
employee-entered data in production. It is recoverable, and the restore below has
been rehearsed against production data (round-tripped with zero differing rows) —
but the ordering constraint in §1 is not optional.

| | |
|---|---|
| Migration | `supabase/migrations/20260817120000_ft_availability_removal.sql` |
| Blast radius | every profile holding an Active `%full%` contract — **17 of 122** at time of writing |
| Reversible | yes, via `public.availability_rules_archive` / `availability_slots_archive` |
| Status | **NOT APPLIED** |

---

## 1. Ordering — deploy the frontend FIRST

**Apply this migration only after the build containing `feat/ft-availability-contract-model` is live.**

The migration removes the rows the availability calendar renders. Apply it while
the old frontend is still serving and a full-timer opens `/my-availabilities` to
an empty editor with an "Add Availability" button that now fails on a raw
Postgres error — because the client-side guard and the contract card that replaces
the editor ship in the same deploy.

The reverse order is safe: the new frontend copes with the rows still being there.
FT are already excluded from the solver payload by `RosterFetcher`, and the manual
surfaces read `availability_mode` rather than row presence. The only visible
artefact pre-migration is that surviving rows still *narrow* a date on the manual
warning path and on Team Availability, which is a cosmetic false warning, not a
block. So: **deploy → verify → migrate.** Never migrate → deploy.

## 2. Pre-flight

Record these numbers before applying; §5 checks against them.

```sql
SELECT
  (SELECT count(*) FROM public.availability_rules) AS rules_total,
  (SELECT count(*) FROM public.availability_slots) AS slots_total,
  (SELECT count(*) FROM public.availability_rules r
    WHERE public.sm_holds_active_ft_contract(r.profile_id)) AS ft_rules,
  (SELECT count(*) FROM public.availability_slots s
    WHERE public.sm_holds_active_ft_contract(s.profile_id)) AS ft_slots;
```

`sm_holds_active_ft_contract` does not exist until the migration's step 0 runs, so
before applying, substitute the predicate inline:

```sql
EXISTS (SELECT 1 FROM hr.user_contracts uc
         WHERE uc.user_id = r.profile_id AND uc.status = 'Active'
           AND LOWER(COALESCE(uc.employment_status::text,'')) LIKE '%full%')
```

Expected at time of writing: `107 / 7035 / 17 / 1533`.

**Sanity-check the 17 before proceeding.** The purge is keyed entirely on that
predicate, so one contract miskeyed as Full-Time takes that person's availability
with it:

```sql
SELECT uc.user_id, p.email, uc.employment_status, uc.contracted_weekly_hours
  FROM hr.user_contracts uc JOIN public.profiles p ON p.id = uc.user_id
 WHERE uc.status = 'Active'
   AND LOWER(COALESCE(uc.employment_status::text,'')) LIKE '%full%'
 ORDER BY p.email;
```

## 3. Apply — ONE FILE ONLY. Never `supabase db push`.

> ### ⛔ `supabase db push` WILL DAMAGE PRODUCTION
>
> The repo holds **124 migration files; 82 carry version numbers absent from
> production's `schema_migrations`** — because production applied most of them
> under its own timestamps during an earlier reconciliation. The CLI cannot tell
> "already applied under a different version" from "never applied", so a push
> re-runs all 82. Among them:
>
> * `20260811000000_seed_realistic_availabilities` — **re-seeds availability
>   rows**, i.e. re-creates the FT data this migration exists to remove, and
>   duplicates casual/PT declarations.
> * `20260812000000_baseline_ft_schedule` and `20260813000000_baseline_ft_template_merge`
>   — **re-create the baseline FT roster and templates that were deliberately
>   withdrawn** (they generated a 56-shift roster that fails `SHAPE_FT_MIN_DAY`).
> * `20260710120000_leave_module` and other `CREATE TABLE` migrations — will error
>   on objects that already exist, aborting mid-push in an unpredictable place.
>
> This drift is pre-existing and is **not** resolved by this change set. Verify it
> yourself before believing any tooling that claims the database is behind:
>
> ```sql
> SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
> ```

Apply the single file, then record it in history so the CLI does not offer it
again. Both statements, in this order:

```sql
-- 1. Paste the whole of
--    supabase/migrations/20260817120000_ft_availability_removal.sql
--    into the SQL editor and run it. It is one transaction.

-- 2. Record it.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260817120000', 'ft_availability_removal')
ON CONFLICT (version) DO NOTHING;
```

The migration is self-verifying: it aborts if the archived row counts do not
survive its own deletes (`archive verification failed`). A failure there means
**nothing was committed** — investigate before retrying, and do not run step 2.

## 4. Post-apply verification

```sql
-- 4a. No FT rows remain live.
SELECT count(*) AS should_be_zero FROM public.availability_slots s
 WHERE public.sm_holds_active_ft_contract(s.profile_id);

-- 4b. Non-FT data is untouched: expect 90 rules / 5502 slots
--     (107-17 and 7035-1533).
SELECT (SELECT count(*) FROM public.availability_rules) AS rules_left,
       (SELECT count(*) FROM public.availability_slots) AS slots_left;

-- 4c. The archive holds everything that was removed: expect 17 / 1533.
SELECT (SELECT count(*) FROM public.availability_rules_archive
         WHERE archived_reason = 'ft_availability_removal_20260817120000') AS rules_archived,
       (SELECT count(*) FROM public.availability_slots_archive
         WHERE archived_reason = 'ft_availability_removal_20260817120000') AS slots_archived;

-- 4d. The write guard bites. Expect ERROR: Availability is contract based...
--     Use a real FT profile_id from §2.
INSERT INTO public.availability_rules
  (profile_id, start_date, start_time, end_time, repeat_type)
VALUES ('<an-ft-profile-id>', CURRENT_DATE, '09:00', '17:00', 'none');

-- 4e. The archive is not reachable by the app roles. Expect false for both.
SELECT has_table_privilege('authenticated','public.availability_rules_archive','SELECT') AS authed,
       has_table_privilege('anon','public.availability_slots_archive','SELECT')          AS anon;
```

Then in the app, as a full-timer: `/my-availabilities` shows the contract card with
a working **Go to Leave Management** link, and no "Add Availability" button. As a
manager: Team Availability shows those staff as **Contract based**, not *Not
declared*, and they count toward Available.

Run one AutoScheduler pass over a window containing FT-targeted shifts and confirm
the log line reads `Availability: N/M non-FT employees have declared records`
with the FT count in the contract-available half — and that FT actually receive
assignments. A `0/144`-shaped fill is the signature of the HC-5d regression this
whole change set exists to prevent.

## 5. Rollback

### 5a. Restore the data

Exactly as rehearsed (zero differing rows against the live tables). Column lists
are explicit because the archive carries two extra trailing columns:

```sql
BEGIN;

INSERT INTO public.availability_rules
SELECT id, profile_id, start_date, start_time, end_time, repeat_type,
       repeat_days, repeat_end_date, created_at, updated_at
  FROM public.availability_rules_archive
 WHERE archived_reason = 'ft_availability_removal_20260817120000'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.availability_slots
SELECT id, rule_id, profile_id, slot_date, start_time, end_time, created_at, source
  FROM public.availability_slots_archive
 WHERE archived_reason = 'ft_availability_removal_20260817120000'
ON CONFLICT (id) DO NOTHING;

COMMIT;
```

> **The guard blocks its own restore.** `trg_prevent_ft_availability_rule` fires
> `BEFORE INSERT` on `availability_rules` and these rows are all FT by
> construction, so the rules insert **will fail** while the trigger is enabled.
> Drop it first (§5b), restore, then decide whether to re-create it.
>
> The slots insert is unaffected — the guard covers rules only.

### 5b. Revert the schema

```sql
DROP TRIGGER IF EXISTS trg_prevent_ft_availability_rule ON public.availability_rules;
DROP FUNCTION IF EXISTS public.trg_prevent_ft_availability_rule();
```

To restore the previous `sm_materialize_contract_envelope`, re-run the body from
`supabase/migrations/20260817000000_contract_ordinary_hours_envelope.sql` — it is
the same function minus the FT exclusion. Do **not** hand-edit a replacement:
diff against `pg_get_functiondef('public.sm_materialize_contract_envelope(date,date,uuid[])'::regprocedure)`
first. Writing this function from an older copy of its own migration is exactly
how the `_env_scope` stale-slot reclaim got dropped once already.

Leave `sm_holds_active_ft_contract` in place; it is inert without callers.

Do **not** drop the archive tables as part of a rollback — they are the evidence.

## 6. Retention

The archive is cold storage, not a live table. Once the change has held for a
release and §4 is green, it can be dropped deliberately:

```sql
DELETE FROM public.availability_rules_archive
 WHERE archived_reason = 'ft_availability_removal_20260817120000';
DELETE FROM public.availability_slots_archive
 WHERE archived_reason = 'ft_availability_removal_20260817120000';
```

Keep the tables themselves — they are reusable by any future availability
data-hygiene job, which is why `archived_reason` exists.
