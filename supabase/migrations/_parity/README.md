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
