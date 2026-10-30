# `shifts` table — redesign plan

**Status: PROPOSED 2026-10-30 — nothing applied.** Each phase below needs its own go-ahead.

## Where it stands

Measured live on 2026-10-30: **108 columns, 36 indexes, 31 triggers, 17 CHECK constraints, 20 rows.**

Earlier passes already removed the plainly dead columns:

- 6 on 2026-06-19 (`20260619050000`);
- 5 more plus 4 indexes on 2026-10-05 (`20261005065925`);
- `roster_shift_id` (`20261028102156`) and `baseline_run_id` (`20261029060304`).

The history is in the `shifts-table-redundant-columns` note and in Ch.17 of the rulebook.

**How the evidence works.** 20 rows cannot prove a column "is always empty", so every claim below rests on **who reads and writes the column**. Readers are checked across:

- database functions, triggers (`NEW.col`) and views;
- the app (`src/`), the Python solver and ML (`optimizer-service/`, `ml/`), and edge functions (`supabase/functions/`).

Same-named fields on other tables inflate the code counts. Each column is re-checked by hand before it is touched.

## Goal and non-goals

**Goal:** every fact about a shift is stored once, in one column, and nothing stores what can be computed.

**Not proposed:**

- **A big-bang split of the table.** `shift_compliance_snapshots` and `shift_payroll_records` are already 1:1 side tables fed by triggers; finishing those is enough.
- **Renaming core columns for style.**

## Phases

Every phase follows the same routine:

1. Export the column data and the definitions it touches.
2. Change every function from its **live** definition (`pg_get_functiondef`), because hand-edited migrations have lost guards before.
3. Dry-run in a transaction that always rolls back.
4. Write a regression test that fails before the change.
5. Apply only on your OK, verify, and prune the generated types.

Each phase gets its own branch.

### Phase 1 — columns nothing uses (low risk)

| Column | Database readers | Code | Note |
|---|---|---|---|
| `deleted_by` | 0 | 0 | Dead: `deleted_at` can never be set (see Phase 2). |
| `roster_template_id` | 1 function, 1 trigger | 0 | Duplicate of `template_id`. Repoint the one function first. |
| `compliance_override_reason` | 1 trigger | 0 | Nothing writes it. |
| `compliance_checked_at`, `compliance_override` | 1–2 | 0 | The compliance side table holds the real record (Phase 4). |
| `workflow_status` | 0 | 1 file | Was ~24 files in June. Check the remaining one. |
| `bidding_enabled` | 2 writers, 1 index | 0 | Written, never read. |
| `actual_hourly_rate`, `remuneration_rate`, `currency` | 0 | some, possibly other tables' fields | Cost-path question: does anything price off them? Check, then drop or keep. |
| `synthesis_run_id`, `demand_source`, `demand_group_id` | 0 | the demand engine sets them on new rows | Probably **live metadata** from the shift synthesiser. Keep unless a reader is missing. |
| `is_draft` (generated) | 0 | some, possibly other tables | Drop if no shift reader. |

The expected outcome is roughly 8–12 columns and 2–4 indexes. Each column is dropped only after a full writer and reader check, including inserts made from the app.

**Progress (2026-10-30).**

- **1a APPLIED** `20261029224806`: `deleted_by`, `workflow_status`, `roster_template_id`, `bidding_enabled` (108 → 104 columns).
- **1b, code half DONE** on `refactor/duplicate-implementations`. Nothing in the app or `get-roster-view` reads `currency` or `actual_hourly_rate` any more. Neither column is ever written: no app code or DB function sets them, every row is NULL or the default `AUD`.
- **1b, drop PENDING.** Apply it only after that code is live **and** `get-roster-view` has been redeployed. The version of the app deployed now still selects both, and PostgREST fails the whole select on a missing column:

  ```sql
  ALTER TABLE public.shifts DROP COLUMN currency, DROP COLUMN actual_hourly_rate, DROP COLUMN remuneration_rate;
  ```

- **Moved.** The compliance trio goes to Phase 4, because `_sync_compliance_snapshot` copies them. `is_draft` goes with Phase 5's flags, because screens read it.
- **Kept.** `synthesis_run_id`, `demand_source` and `demand_group_id` are provenance the shift synthesiser writes on purpose.
- **`remuneration_rate`, code half DONE 2026-10-30.** You chose to drop it: it is never written, so the per-shift rate fallbacks (Gross Pay's last resort, the "priceable" check, labour-demand and timesheet reads) could never fire. A shift is priced from its `remuneration_level` only. It is in the pending drop above.

### Phase 2 — `deleted_at` (mechanical, wide)

**Progress (2026-10-30).**

- **2a APPLIED** `20261029232549`: 36 functions lost their no-op filters. The live hash equals the file for every one; `plpgsql_check` is unchanged; four SQL tests pass.
- **2b, database half APPLIED** `20261029233740`: the always-false `deleted_at IS NOT NULL` checks are gone from `fn_shift_not_started`, `fn_shift_office_is_ft_only`, `fn_shift_shape_day_typed_guard` and `internal.trg_shift_eba_compliance`; the `'shift_deleted'` outcome is gone from `sm_refresh_shift_snapshots` and `v_shift_assignment_episodes` (still `security_invoker`); `idx_shifts_deleted_at` is dropped and the five partial indexes are rebuilt without the predicate. Live definitions equal the file. In a rolled-back dry run the view returned the same 20 rows before and after, and `plpgsql_check` was clean. Test: `supabase/tests/shifts_deleted_at_logic_removed.sql` (failed before, passes now).
- **2b, app half DONE** on `refactor/duplicate-implementations`: no app file or deployed edge function names `deleted_at` (guard: `no-shifts-deleted-at.test.ts`, which failed on the 22 files). The delta sync patches rows and no longer looks for deleted ones.
- **2c, PENDING:** only after that code is live **and** `get-roster-view` is redeployed (the deployed app still filters on the column and reads it from `get_shift_delta`). One migration: recreate `get_shift_delta` without the `deleted_at` output column (a changed return type needs DROP + CREATE, then re-grant EXECUTE as it is today), then

  ```sql
  ALTER TABLE public.shifts DROP CONSTRAINT shifts_no_soft_delete, DROP COLUMN deleted_at;
  ```

  and prune `deleted_at` from the generated `types.ts`. The `_retired` edge functions still name it, but they are not deployed (only `get-roster-view` is).

`CHECK shifts_no_soft_delete` keeps `deleted_at` NULL on every row, so every `deleted_at IS NULL` filter is a no-op. Today it is named by:

- 43 database functions, 4 trigger functions and 1 view;
- 20 app files and 1 edge function;
- 2 indexes.

The plan:

1. Remove the filters, functions first, each from its live definition.
2. Drop the column, the CHECK and the indexes.

There is **no behaviour change**: every filter is already always true. The risk is the sheer number of functions edited, which is why each starts from `pg_get_functiondef`. The proof is a `plpgsql_check` pass plus the full test suite.

### Phase 3 — stored copies of computed values

| Stored | Can be computed from |
|---|---|
| `total_hours` | already a generated column, fine |
| `break_minutes` | `paid_break_minutes + unpaid_break_minutes` |
| `net_length_minutes` | `scheduled_length_minutes − unpaid_break_minutes` |
| `scheduled_length_minutes` | start / end |
| `roster_date` | `shift_date` (check that no overnight rule differs) |
| `scheduled_start` / `scheduled_end` | the same values as `start_at` / `end_at` |

A generated column **cannot be written**, so every writer must stop writing these first: the trigger `shift_compute_trigger`, template application and the `sm_*` functions. Some, such as `net_length_minutes`, are read by pay and compliance code. A parity test pins the old and new values across sample shifts before any switch.

### Phase 4 — side-table mirrors

`compliance_snapshot` / `compliance_checked_at` / `compliance_override` live in `shifts` **and** `shift_compliance_snapshots`. About 10 payroll fields are likewise stored twice, with `shift_payroll_records`. The plan:

1. Move every reader to the side table.
2. Stop the dual writes.
3. Drop the `shifts` copies.

This needs a reader inventory per field. The timesheet terminal gate reads `payroll_exported`, for example.

### Phase 5 — your June decision, to confirm again

On 2026-06-19 you **deliberately left** these alone. Both sides are read in many places, they never disagree, and there is no bug:

- `tz_identifier` ≡ `timezone`: the app reads the first (6 files now), the database the second (12 functions).
- `is_cancelled`, `is_on_bidding`, `is_published` duplicate `lifecycle_status` / `bidding_status`; `is_cancelled` alone is named by 33 functions and 39 files.

**Recommendation: keep that decision.** The work is large, and the only gain is tidiness. Phase 3 already removes `scheduled_start`/`scheduled_end`, the timestamp duplicates that matter.

## Recommended order

1. **Phase 1** now: small and checkable.
2. **Phase 2** next: mechanical and behaviour-neutral, and it removes a trap every future query falls into.
3. **Phases 3 and 4** only with a parity test each, because they touch pay and compliance reads.
4. **Phase 5:** leave, unless you decide otherwise.

Expected end state: roughly **85–90 columns**, every remaining one written by a known writer and read by a known reader.
