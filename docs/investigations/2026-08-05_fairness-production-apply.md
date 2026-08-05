# Fairness Engine — Production Apply Record

**Date:** 2026-08-05
**Project:** Shiftopia (`srfozdlphoempdattvtx`), PostgreSQL 17.6
**Status:** APPLIED. Frontend deploy is the remaining step.

---

## Pre-apply audit: three blockers, all found by checking prod rather than trusting notes

### 1. `public_holidays` already existed with an incompatible schema — HARD BLOCKER

Production carried a `public_holidays` table from the Oct-2025 baseline:

```
id uuid PK · holiday_date · holiday_name NOT NULL
applies_to_state (default 'NSW') · is_national · created_at
```

**No `jurisdiction` column.** Migration `20260804030000` used `CREATE TABLE IF NOT
EXISTS`, so it would have **silently no-opped** and left every downstream
`JOIN ... ON ph.jurisdiction = ...` referencing a column that does not exist —
breaking `recompute_fairness_ledger`, `jurisdiction_is_known()` and the
`organizations.jurisdiction` CHECK.

**Why the earlier validation missed it.** The throwaway container was seeded from
a fixture I wrote, which had no `public_holidays` — so `IF NOT EXISTS` created the
*new* shape and everything passed. The baseline in the container was not the
baseline in production. Same lesson as the 2026-08-02 migration reconciliation:
verify against what prod actually has.

**Fix.** The migration now detects a pre-existing table and adapts it in place,
non-destructively: adds `jurisdiction` (back-filled `'AU-' || applies_to_state`),
adds `name` (back-filled from `holiday_name`), relaxes the legacy `NOT NULL`, adds
the unique key `ON CONFLICT` needs, then keeps the legacy columns coherent and
enforces `name NOT NULL`. Nothing is dropped.

The legacy table was also **incomplete** — missing Anzac Day 2026-04-25, both
Labour Days, both Easter Sundays and Boxing Day 2026-12-26 — and named 2026-06-08
"Queen's Birthday". The authoritative seed corrected and completed it: 108 rows,
zero nulls, coverage to 2032-12-28.

### 2. The frontend is a coupled change — and the safe order is the opposite of what the plan said

Production runs `main`; none of the fairness work was deployed. `main`'s `getDebts`
filters `.eq('window_end', <today>)` while the newest generation was **2026-07-03**
— so prod's fairness reads had been returning empty every day. Fairness was already
inert, silently.

The remediation plan implied migrations-first. That is **wrong**, and this record
corrects it: the new frontend degrades gracefully against the old schema (the read
path reports `unavailable`, which the code handles explicitly) and no longer writes
to the ledger at all. The old frontend against the new schema still runs the
deleted-in-branch client-side writer, which would reintroduce F-02 rows.

Migrations were applied anyway because they are strictly an improvement over an
inert ledger, and an immediate recompute was run so prod is correct now rather than
at the next cron tick. **The frontend should be deployed promptly** to retire the
old writer.

### 3. Turning fairness on would have activated a known-unfair behaviour

Fairness being inert meant the leave/new-starter defect (Q4) had never bitten.
Applying these migrations makes it live. Checking the data settled it:

- `leave_requests` is empty — the leave half had no live exposure.
- **137 of 140 active contracts start inside the current window** (earliest
  2026-05-03, latest 2026-07-10).

So partial availability is not a corner case on this dataset, it is the dominant
property, and unscaled debts would have measured **tenure rather than burden** —
funnelling work at the newest employees. The availability denominator (Q4) was
therefore implemented before applying, not deferred to a later phase.

---

## Applied objects

| Order | Migration | Effect |
| --- | --- | --- |
| 1 | `fairness_ledger_latest_window_read` | `get_fairness_debts_latest` + index (F-04) |
| 2 | `public_holidays_jurisdiction_reconcile` | legacy table adapted in place |
| 3 | `public_holidays_seed_au_nsw_2024_2032` | 108 rows, coverage guard |
| 4 | `organizations_jurisdiction` | column, `jurisdiction_is_known()`, CHECK (F-21) |
| 5 | `fairness_availability_denominator` | the final `recompute_fairness_ledger` |
| 6 | `fairness_ledger_scheduled_recompute` | `recompute_all`, gate, grants, nightly cron |
| 7 | `fairness_ledger_self_read` | employee self-read RLS (F-24) |
| 8 | `fairness_ledger_retention` | `prune_fairness_ledger` + weekly cron (F-20) |
| 9 | `fairness_eba_weighted_metrics_cleanup` | delete dead `weekend_shifts` / `denied_preferences` rows |
| 10 | `fairness_recompute_revoke_authenticated` | security fix, below |

Steps 5 and 6 are the net effect of repo migrations `20260804040000`, `050000`,
`20260805020000`, `030000` and `040000`, which each `CREATE OR REPLACE` the same
function. Only the final definition was applied rather than four superseded ones.
The repo files remain the linear history for a fresh database and produce the
identical end state — verified by applying all nine in order to a PostgreSQL 17
container.

---

## The security hole found after applying

`get_advisors` flagged `recompute_fairness_ledger` as executable by
`authenticated`. It is `SECURITY DEFINER` and takes an arbitrary org uuid, so **any
signed-in user could have rebuilt any organization's ledger**, bypassing the
certificate check in `request_fairness_ledger_recompute` entirely.

The migration revoked PUBLIC and anon. That was not enough: Supabase's default
privileges grant EXECUTE on new public-schema functions **directly to
`authenticated`**. The repo's known gotcha — *"new functions auto-grant to anon;
`REVOKE FROM PUBLIC` alone does not close it"* — has a second edge that had not
been written down.

Revoking it meant the gate could no longer reach the recompute as `SECURITY
INVOKER`, so the gate became `SECURITY DEFINER`. It still authorises first, and now
also rejects an absent `auth.uid()` rather than evaluating its predicate against a
NULL subject.

Verified under `SET LOCAL ROLE authenticated`:

| Function | definer | authenticated | anon |
| --- | --- | --- | --- |
| `recompute_fairness_ledger` | yes | **✗** | ✗ |
| `recompute_all_fairness_ledgers` | yes | ✗ | ✗ |
| `prune_fairness_ledger` | yes | ✗ | ✗ |
| `request_fairness_ledger_recompute` | yes | ✓ (gate) | ✗ |
| `get_fairness_debts_latest` | no (RLS) | ✓ | ✗ |

`get_advisors` reports **zero ERROR-level findings**. The 228 remaining WARNs are
pre-existing and systemic (211 `authenticated_security_definer_function_executable`
across the database, plus the leaked-password dashboard toggle) — none introduced
here, and worth a separate sweep.

---

## Post-apply state

- **721 ledger rows** written (103 employees × 7 metrics), every row stamped with a
  run id (Q9 — zero unstamped).
- `saturday_shifts` and `sunday_shifts` populate independently (Q6).
- `denial_rate` spans 0.01–0.23 with debts in ±0.15 — rates, not farmable counts (Q5).
- Debt magnitudes are small despite 137/140 contracts starting mid-window, which is
  the availability denominator working (Q4).
- `night_shifts` and `public_holiday_shifts` are 0 for everyone. **Verified genuine,
  not a silent join failure**: King's Birthday 2026-06-08 *is* in the calendar and
  *is* inside the window, but no shift was assigned that day, and no shift in the
  window starts before 06:00. Only 10 assigned shifts exist in the window.
- Cron: `nightly_fairness_recompute` (16:00 UTC daily) and
  `weekly_fairness_ledger_prune` (17:00 UTC Sundays), both active.

## Remaining

1. **Deploy the frontend** (branch `feat/autopilot-uniform-onoff`, pushed). Until
   then the old client-side ledger writer is still live and can reintroduce F-02
   rows between recomputes; the nightly cron overwrites them within 24h, and the new
   read path ignores the dead metrics, so it is untidy rather than dangerous.
2. Regenerate `src/platform/supabase/types.ts` — `public_holidays` and
   `organizations` both changed shape.
3. The 211 pre-existing definer-function WARNs deserve their own pass.
