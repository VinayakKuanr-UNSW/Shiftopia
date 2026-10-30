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
- **1b, drop APPLIED** `20261030014859`, with Phase 2c, after the code was live on Vercel production and `get-roster-view` was redeployed (v17): `currency`, `actual_hourly_rate` and `remuneration_rate` are gone.
- **Moved.** The compliance trio goes to Phase 4, because `_sync_compliance_snapshot` copies them. `is_draft` goes with Phase 5's flags, because screens read it.
- **Kept.** `synthesis_run_id`, `demand_source` and `demand_group_id` are provenance the shift synthesiser writes on purpose.
- **`remuneration_rate`, code half DONE 2026-10-30.** You chose to drop it: it is never written, so the per-shift rate fallbacks (Gross Pay's last resort, the "priceable" check, labour-demand and timesheet reads) could never fire. A shift is priced from its `remuneration_level` only. It is in the pending drop above.

### Phase 2 — `deleted_at` (mechanical, wide)

**Progress (2026-10-30).**

- **2a APPLIED** `20261029232549`: 36 functions lost their no-op filters. The live hash equals the file for every one; `plpgsql_check` is unchanged; four SQL tests pass.
- **2b, database half APPLIED** `20261029233740`: the always-false `deleted_at IS NOT NULL` checks are gone from `fn_shift_not_started`, `fn_shift_office_is_ft_only`, `fn_shift_shape_day_typed_guard` and `internal.trg_shift_eba_compliance`; the `'shift_deleted'` outcome is gone from `sm_refresh_shift_snapshots` and `v_shift_assignment_episodes` (still `security_invoker`); `idx_shifts_deleted_at` is dropped and the five partial indexes are rebuilt without the predicate. Live definitions equal the file. In a rolled-back dry run the view returned the same 20 rows before and after, and `plpgsql_check` was clean. Test: `supabase/tests/shifts_deleted_at_logic_removed.sql` (failed before, passes now).
- **2b, app half DONE** on `refactor/duplicate-implementations`: no app file or deployed edge function names `deleted_at` (guard: `no-shifts-deleted-at.test.ts`, which failed on the 22 files). The delta sync patches rows and no longer looks for deleted ones.
- **2c APPLIED** `20261030014859` (2026-10-30), after the release (PR #27 → `main`, deployed to https://shiftopia.vercel.app; no served chunk names the column) and the `get-roster-view` redeploy. `get_shift_delta` was recreated without `deleted_at` (still SECURITY INVOKER, EXECUTE for authenticated and service_role only). Two trigger *definitions* also named the column, which a function-body search misses: the EBA check's `UPDATE OF` list and TOIL's `WHEN` clause; both were recreated without it. Then `shifts_no_soft_delete` and the column were dropped. The migration first asserts that no row holds data in any dropped column. `shifts`: 100 columns. Test: `supabase/tests/shifts_phase2c_columns_dropped.sql` (failed before, passes now); every shift SQL test passes live, and the app's three shift selects, the delta RPC and `get-roster-view` answer 200.
- **Phase 2 is complete.**

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

**Inventory (2026-10-30, live).** Stored and computed values agree on all 20 rows for every column below (20 rows prove nothing on their own; the writers decide). Two BEFORE triggers own them:

- `shift_compute_trigger` → `compute_shift_fields()` re-derives `is_overnight`, `scheduled_length_minutes`, `net_length_minutes` and `break_minutes` on **every** insert and update, so any value another writer puts there is overwritten. It sets `roster_date` **only when it is NULL**.
- `tr_compute_scheduled_timestamps` → `compute_scheduled_timestamps()` derives `scheduled_start` / `scheduled_end` from `shift_date` + times in `'Australia/Melbourne'` (same offsets and DST as Sydney, so the values match `start_at` / `end_at` today, but it is a second, divergent copy).

**Steps:**

1. **3a `roster_date` — dead and drifting.** No reader anywhere (app, edge functions, solver, views, functions): only `idx_shifts_roster_date` and three writers (`compute_shift_fields`, `sm_create_shift`, `sm_move_shift`). Because the trigger only fills it when NULL, moving a shift to another day leaves it on the old date — proven by a rolled-back probe (shift_date 2026-11-03 → 2026-11-04, roster_date stayed 2026-11-03). **Code half DONE** on `refactor/shifts-phase3` (the app and `get-roster-view` no longer select or insert it; guard test extended). **After deploy + `get-roster-view` redeploy:** one migration removes it from the three writers and drops the index and the column.
2. **3b `scheduled_start` / `scheduled_end`** duplicate `start_at` / `end_at`. Readers to repoint first: `get_manager_scorecard`, `get_marketplace_kpis`, `get_quarterly_performance_report`, `sm_bulk_publish_shifts`, `sm_refresh_shift_snapshots`, `sm_select_bid_winner`, the view `v_shift_assignment_episodes`, and any app select. Then drop the trigger and both columns.
3. **3c `is_overnight`, `scheduled_length_minutes`, `net_length_minutes`, `break_minutes`** become `GENERATED ALWAYS` (immutable expressions of the times and break minutes), so readers (pay, compliance, insights, leave accrual) need no change. First stop the explicit writers (`_apply_shift_op_write` and `sm_create_shift` set `break_minutes`; app inserts must not send any of them), then a parity test over sample shapes (overnight, breaks, midnight end), then the switch and the trigger simplification.

**3b + 3c APPLIED 2026-10-30** (`20261030091129_shifts_phase3_computed_columns.sql`; test `supabase/tests/shifts_phase3_computed_columns.sql` failed before, passes after). The deployed app never named `scheduled_*` in a select or insert, and sends `break_minutes` only inside the `sm_create_shift` payload, which now ignores it, so neither half had to wait for a deploy. `get_quarterly_performance_report` needed no change: its `snap.scheduled_start` is `assignment_snapshots`' own column.
- **Bug fixed on the way:** `recalc_shift_utc_timestamps` added `'1 day'` to a timestamptz in the session zone (UTC), so an overnight `end_at` was an hour out on both DST nights (22:00–06:00 on 2026-10-03 ended 20:00Z, not 19:00Z). The dropped Melbourne copy had it right. No overnight rows existed, so no stored data was wrong.
- `roster_date` now always follows `shift_date` (`compute_shift_fields`), which ends the drift until the column goes.

**3a column drop — PENDING until this branch is deployed and `get-roster-view` is redeployed** (the live app still selects and inserts `roster_date`). Dry-run passed 2026-10-30 (rolled back: no function names `roster_date` afterwards; create and update still work):

```sql
DO $$
DECLARE r record; v_def text; v_hits int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      (1, 'public.compute_shift_fields', '(\nBEGIN)\n\s+-- roster_date mirrors shift_date until the column is dropped \(Phase 3a\)\.\n\s+NEW\.roster_date := NEW\.shift_date;\n', '\1', 1),
      (2, 'public.sm_create_shift', 'shift_date, roster_date, start_time', 'shift_date, start_time', 1),
      (3, 'public.sm_create_shift', '\n\s+\(p_shift_data->>''roster_date''\)::date,', '', 1),
      (4, 'public.sm_move_shift',   '\n\s+roster_date\s+= COALESCE\(p_shift_date, roster_date\),', '', 1)
    ) AS t(ord, fn, pat, rep, expected) ORDER BY ord
  LOOP
    v_def := pg_get_functiondef(r.fn::regproc);
    SELECT count(*) INTO v_hits FROM regexp_matches(v_def, r.pat, 'g');
    IF v_hits <> r.expected THEN RAISE EXCEPTION 'patch % on %: % matches, expected %', r.ord, r.fn, v_hits, r.expected; END IF;
    EXECUTE regexp_replace(v_def, r.pat, r.rep, 'g');
  END LOOP;
END $$;
DROP INDEX public.idx_shifts_roster_date;
ALTER TABLE public.shifts DROP COLUMN roster_date;
```

Then prune `roster_date` from the shifts block of `types.ts`.

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
