# AssignmentSnapshot Spine

`public.assignment_snapshots` is the KPI spine: **one row per published-active
assignment episode**, projected from `v_shift_assignment_episodes`. It exists so
KPI scoping (org / dept / sub-dept / date / employee) is a cheap indexed scan
instead of a re-derivation of the gaps-and-islands view.

## Migration apply order

Apply in this exact order (these slot in **after** the episode-metrics set in
`_parity/README.md`):

1. **`20260624090000_shift_assignment_episodes.sql`** — the episode view. This file
   was **edited** to append two trailing columns (`became_active_at`,
   `scheduled_start`). It still creates the same view via `CREATE OR REPLACE VIEW`;
   the two new columns are strictly at the end of the column list (no reorder/removal),
   which is what `CREATE OR REPLACE VIEW` requires.
2. **`20260625090000_assignment_snapshots_table.sql`** — the `assignment_snapshots`
   table, indexes, permissive RLS.
3. **`20260625090100_assignment_snapshots_projection.sql`** — the
   `sm_refresh_shift_snapshots(uuid)` projection function, the
   `trg_refresh_snapshots` AFTER-INSERT trigger on `shift_events`, and a backfill
   over all live shifts.

> The view edit (step 1) must be applied before steps 2–3 because the projection
> reads `became_active_at` and `scheduled_start` from the view.

## Published-active definition (what becomes a snapshot)

An episode is **published-active** — and therefore a snapshot — iff:

```
(had_accept OR had_emergency OR had_swap_in)
AND terminal_outcome <> 'shift_deleted'
```

i.e. the holder became a **confirmed owner** via offer-accept, bid-win, emergency
fill, or trade-approve.

**Intentionally excluded** (NOT snapshots):

- **S2 / Draft edits** — assigning on a Draft shift with no publish/confirm produces
  an `had_assign`-only episode; without an accept/emergency/swap-in it is excluded.
- **Offer-only** episodes (S3 offered, never accepted) — `had_offer` only.
- **Rejected** / **Ignored** episodes — terminal_outcome `rejected` / `ignored`; they
  are offer-funnel facts, not ownership facts.
- **Deleted-shift** episodes — `terminal_outcome = 'shift_deleted'`.

## `source` mapping (how the holder became confirmed)

Evaluated in priority order in `sm_refresh_shift_snapshots`:

| Condition (per episode)                                              | `source`          |
|---------------------------------------------------------------------|-------------------|
| `had_emergency` (EMERGENCY_ASSIGNED in episode)                     | `emergency`       |
| else `had_swap_in` (SWAPPED_IN in episode)                          | `trade_approve`   |
| else an `ASSIGNED` event with `metadata->>'op' = 'select_winner'` in the episode window | `bid_win` |
| else (default / offer-accept / undeterminable)                      | `publish_confirm` |

**Why `metadata.op = 'select_winner'` for `bid_win`:** the bidding gateway
(`sm_apply_shift_op` / `sm_select_bid_winner`) writes a neutral `ASSIGNED`
`shift_events` row and stamps the **true** op in `metadata.op`. There is no distinct
`event_type` for a bid win, so `metadata->>'op' = 'select_winner'` is the only
reliable ledger signal. The `EXISTS` is **bounded to the episode window**
(`event_time` between `opened_at` and `closed_at`) so an earlier/later attempt on the
same shift cannot leak its bid-win signal into a different episode. If no such marker
exists, the episode is treated as a normal offer-accept → `publish_confirm`.

## `end_reason` mapping (terminal_outcome → snapshot vocabulary)

| `terminal_outcome` (view) | `end_reason` (snapshot) |
|---------------------------|-------------------------|
| `fulfilled`               | `worked`                |
| `cancelled_standard`      | `dropped_std`           |
| `cancelled_late`          | `dropped_late`          |
| `no_show`                 | `no_show`               |
| `swapped_out`             | `traded_out`            |
| `unassigned`              | `reassigned`            |
| `open`                    | `NULL`                  |

`is_current = (terminal_outcome = 'open')`. A partial unique index
(`one_current_owner_per_shift`) enforces at most one current owner per shift.

`rejected` / `ignored` / `shift_deleted` never reach the mapping — they are filtered
out by the published-active predicate before INSERT.

## `became_active_at`

Sourced from the view's new `became_active_at` (MIN of the first
`ACCEPTED` / `EMERGENCY_ASSIGNED` / `SWAPPED_IN` event in the episode). The column is
`NOT NULL` on the table; the projection uses `COALESCE(became_active_at, opened_at)`
as a defensive fallback. In practice a published-active episode always has a
confirming event, so the fallback should not fire — but if a future event-emission
gap produced (say) an `EMERGENCY_ASSIGNED`-flagged episode whose timestamps were
incomplete, the episode `opened_at` keeps the NOT NULL constraint satisfied.

## Refresh model

`trg_refresh_snapshots` fires `AFTER INSERT` on `shift_events` and calls
`sm_refresh_shift_snapshots(NEW.shift_id)` (guarding NULL `shift_id`). Refresh is a
full per-shift `DELETE`-then-`INSERT`, so it is idempotent and can never drift from
the view. Per-shift cost is small (a shift has a handful of episodes).

## Validation

After applying all three steps, run by hand against prod (do **not** add to the apply
path):

```sql
-- 1. Snapshot count must equal the count of published-active, non-deleted episodes.
SELECT
  (SELECT count(*) FROM public.assignment_snapshots) AS snapshots,
  (SELECT count(*) FROM public.v_shift_assignment_episodes
     WHERE (had_accept OR had_emergency OR had_swap_in)
       AND terminal_outcome <> 'shift_deleted')        AS published_active_episodes;
-- → the two numbers must match exactly.

-- 2. Exactly one current owner per shift (must return ZERO rows).
SELECT shift_id, count(*)
FROM public.assignment_snapshots
WHERE is_current
GROUP BY shift_id
HAVING count(*) > 1;

-- 3. source distribution sanity check.
SELECT source, count(*) FROM public.assignment_snapshots GROUP BY source ORDER BY 2 DESC;

-- 4. end_reason distribution (NULL = current/open).
SELECT end_reason, count(*) FROM public.assignment_snapshots GROUP BY end_reason ORDER BY 2 DESC;

-- 5. Spot-check a multi-episode shift: pick a shift_id with >1 snapshot and confirm
--    the episode_seq / source / became_active_at / end_reason chain reads sensibly
--    (e.g. seq 1 traded_out → seq 2 open is_current, or seq 1 reassigned → seq 2 worked).
SELECT shift_id, episode_seq, employee_id, source, became_active_at, ended_at,
       end_reason, is_current
FROM public.assignment_snapshots
WHERE shift_id IN (
    SELECT shift_id FROM public.assignment_snapshots
    GROUP BY shift_id HAVING count(*) > 1
)
ORDER BY shift_id, episode_seq;
```

If query (1) matches and (2) returns zero rows, the projection is consistent with the
view.

## Notes / assumptions

- The snapshot count can be **lower** than total episodes: offer-only / rejected /
  ignored / Draft-only episodes are excluded by design.
- `bid_win` vs `publish_confirm` relies on the gateway `metadata.op` marker. Pre-gateway
  historical assigns (or assigns that never went through `sm_apply_shift_op` /
  `sm_select_bid_winner`) will be classified `publish_confirm` even if they were
  conceptually bid wins — the ledger carries no other distinguishing signal.
- Permissive RLS mirrors `shift_events` / `employee_performance_metrics` (GRANT ALL to
  anon/authenticated/service_role; SELECT/INSERT/UPDATE/DELETE policies with
  `USING/WITH CHECK (true)`). The canonical writer is the SECURITY DEFINER projection
  function; tightening RLS is a separate security change (see the perf_hygiene NOTE).
```
