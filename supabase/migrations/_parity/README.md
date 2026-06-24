# Episode Metrics Parity Validation

## Migration Apply Order

Apply the migrations in this exact order:

1. **`20260624090000_shift_assignment_episodes.sql`** — Creates the `v_shift_assignment_episodes` view and supporting index.
2. **`20260624090100_episode_metrics_rewrite.sql`** — Rewrites `compute_employee_quarter_metrics` and `get_quarterly_performance_report` to source from the episodes view.
3. **`20260624090200_get_shift_lifecycle.sql`** — Creates the `get_shift_lifecycle` RPC for the timeline UI.

## Validation Steps

### 1. Run the Parity Script

After applying migrations 1 and 2, run `episode_metrics_parity.sql` against prod:

```sql
\i supabase/migrations/_parity/episode_metrics_parity.sql
```

### 2. Interpret the Results

- **Rows with deltas** indicate shifts that had multiple assignment episodes (re-offered, swapped, re-assigned after drops). The old logic only counted the last holder; the new logic correctly counts all episodes.
- **Late-cancel reclassification** deltas are expected because the threshold changed from 24h to 4h. Cancellations between 4h-24h before start are now classified as standard (previously late).
- **Zero-delta rows** are filtered out — if the query returns empty, old and new agree perfectly (unlikely if there's any shift reuse history).

### 3. Refresh Metrics

After validating parity, refresh all metrics:

```sql
SELECT refresh_all_performance_metrics();
```

### 4. Verify UI

Check the Performance page in the app — numbers should match the new episode-based calculations. Look specifically at:
- Employees who had shifts re-assigned (they should now show the dropped episodes in their cancellation counts)
- Late-cancel vs standard-cancel classifications (unified to 4h threshold)

## Key Changes

| Metric | Old Denominator | New Denominator |
|--------|----------------|-----------------|
| Cancellation rate | `assigned_employee_id` rows | Held episodes (accepted/assigned/emergency) |
| Late-cancel rate | 24h threshold | 4h threshold |
| No-show rate | `assigned_employee_id` rows | Held episodes |
| Swap rate | `shift_swaps` table | `swapped_out` episode outcome |
| Late clock-in | `timesheets` direct | Episode `late_in` flag (events + timesheets) |
| Reliability | `(assigned + emergency)` denominator | `held_episodes` denominator |

## Data Quality Notes

- Events before 2026-06-18 may be incomplete for IGNORED (except the 805 backfilled events).
- Attendance events (CHECKED_IN/LATE_IN/EARLY_OUT) are not reliably emitted by clock-in RPCs — the view falls back to timesheet JOIN for these.
- The `bidding_iteration` column exists in some legacy RPCs but is NOT in the generated types — episode derivation is purely from the event ledger.

## Correctness Fixes (post-initial-implementation review)

Two defects were found and fixed in `20260624090000_shift_assignment_episodes.sql` (and mirrored in the TS deriver) before deployment:

1. **Timesheet fan-out / mis-attribution.** The final `timesheets` LEFT JOIN matched on `(shift_id, employee_id)` only. If a (shift, employee) had >1 timesheet row it would **duplicate the episode row and double-count every metric**; it also stamped attendance onto *all* of that employee's episodes on the shift (e.g. a cancelled earlier attempt). Fixed by (a) pre-aggregating to one row per `(shift, employee)` via `ts_agg` (MIN clock_in / MAX clock_out), and (b) bounding the join to the episode window (`clock_in BETWEEN opened_at AND closed_at`), so attendance lands only on the episode that was open at clock-in.
2. **`fulfilled` over-attribution.** A closeless episode on a `Completed` shift was marked `fulfilled` regardless of whether it was later superseded by another episode — crediting a replaced holder as having worked the shift (inflating `shifts_worked`/`completed`/reliability). Fixed by gating `fulfilled` to the **final** episode only (`episode_seq = max(episode_seq)` per shift); superseded closeless episodes fall through to `open`. The TS `deriveEpisodes` mirrors this (a superseded open episode is finalized as `open`, never `fulfilled`). Regression test: "marks a superseded (replaced) episode as open, not fulfilled".

## Second-round fixes (all flagged items now closed)

3. **Boundary detection robustness.** Episode boundaries are now decided over
   opening/closing events only (`boundary_events` CTE), so an intra-episode event
   (ACCEPTED, CHECKED_IN, …) wedged between a close and a same-employee re-open can
   no longer merge two attempts. Matches the stateful TS deriver exactly.
4. **Timeline ↔ metrics attendance parity.** `get_shift_lifecycle` now synthesises
   CHECKED_IN/LATE_IN/EARLY_OUT from `timesheets` (only when the ledger lacks them),
   so the timeline shows the same attendance the metrics view counts. Synthetic rows
   are deterministic (`md5`-based id) and tagged `metadata->>'synthetic'=true`.
   The proper long-term fix remains making `sm_clock_in`/`sm_clock_out_shift` emit
   those events to the ledger; this RPC-side synthesis makes the surfaces consistent
   in the meantime without touching the prod clock write-path.
5. **Late-cancel TZ classification (timeline).** `ShiftDetailsDialog` now passes the
   TZ-aware `start_at` to the deriver instead of a naive `${date}T${time}`, so the
   timeline's standard-vs-late cancel boundary matches the DB `scheduled_start`.
