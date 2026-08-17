# Fairness & Fatigue — Production Readiness / Architecture Audit

**Date:** 2026-08-04
**Branch:** `feat/autopilot-uniform-onoff`
**Scope:** every fairness, fatigue, load-balancing, scoring, ranking and prioritisation code path in
`src/`, `optimizer-service/`, `supabase/functions/`, `supabase/migrations/`.
**Method:** full lineage trace + cross-referencing. Two findings (F-01 mechanism, F-03) were verified
by executing the real production functions under vitest, not by reading alone.

---

## 1. Executive Summary

The fairness and fatigue systems are individually thoughtful but **collectively unintegrated**. The
audit found five independent, mutually-inconsistent definitions of "fairness" and two
mutually-inconsistent models of "fatigue", bridged by ad-hoc constants that were never calibrated
against each other. The result is a system that *appears* to balance work but, in production, largely
does not.

The five most consequential findings:

1. **The optimizer never learns which shifts are Sundays or public holidays.** `is_sunday` and
   `is_public_holiday` are declared on the wire type and read by the solver, but no producer ever
   sets them. Every fairness balancing term that keys off "undesirable" work therefore collapses to
   *night shifts only*, and the `public_holiday_shifts` debt — the highest-weighted metric in the
   ledger (500¢/unit) — is **structurally unreachable**. The same flags drive the EBA cl 41 penalty
   rate table, so Sunday and PH shifts are also priced at ordinary rates.

2. **The fairness ledger's incremental write path records 100% of every committed shift as
   overtime.** Verified: a plain Mon 09:00–17:00 shift produces `overtime_minutes: 480` on the
   incremental path and `overtime_minutes: 0` on the authoritative path. Every auto-scheduler commit
   permanently inflates the overtime debt of the employees it assigned.

3. **Fatigue never decays after an employee's last shift.** Verified: an 8h night shift that ended
   *today* and the same shift that ended *six days ago* both report `current: 26`. The
   `initial_fatigue_score` handed to the solver is "fatigue at the instant your last shift ended",
   not "fatigue now" — so rested employees are penalised as if they had just clocked off.

4. **The ledger is effectively never populated.** Debts are keyed by `window_end = today` and the
   only writer of a fresh window is a fire-and-forget client-side call in the *publish* mutation.
   On any day nobody publishes, `getEmployeeDebts` returns `[]`, every `fairness_debts` map is `{}`,
   and all longitudinal fairness silently no-ops. The feature fails open and silently.

5. **Employees with zero shifts in the window are invisible to fairness.** They get no ledger row, so
   `fairness_debts` is `{}`, so both solver blocks `continue` past them. The person who has worked
   *least* receives *no* fairness bonus, while someone who worked slightly below average does. This
   is non-monotonic and produces starvation.

Beyond these, two of the four fairness scorers in the codebase (`bidding/scorer.ts`,
and the F1/F3 half of `conflict-resolver/scorer.ts`) have **zero reachable callers**, and the greedy
fallback contains a copy-paste duplication that doubles one bonus term.

**Production readiness verdict:** not ready. Fairness decisions that affect people's rosters and pay
are currently driven by a ledger that is usually empty, sometimes wrong, and never audited. The
system should be treated as *off* until F-01 … F-05 are closed.

---

## 2. Prioritised Findings

> **Status 2026-08-04:** ALL 25 findings are addressed. Gates: 1725 vitest (119 files) ·
> 112 pytest · build ✓ · no type errors in any touched file.
>
> **Migrations are NOT applied to prod** — five `20260804*` files, all validated by
> execution against a throwaway PostgreSQL 15. Held for review.
>
> **Discovered during remediation (not in the original audit):** `npm run type-check`
> was a **no-op**. The root `tsconfig.json` has `"files": []` and only project
> references, so `tsc --noEmit` compiled nothing; and `vite build` transpiles without
> type-checking. The repo had **no working type gate**. The script now points at
> `tsconfig.app.json` — and the 29 pre-existing errors it surfaced are **all fixed**
> (see Appendix C). `npm run verify` now passes with a real type gate for the first
> time.

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| F-01 | **Critical** | `is_sunday` / `is_public_holiday` never populated → Sunday + PH fairness and penalty rates dead | **FIXED** |
| F-02 | **Critical** | Incremental ledger update books every committed minute as overtime | **FIXED** |
| F-03 | **Critical** | Fatigue does not decay after the last shift | **FIXED** |
| F-04 | **Critical** | Ledger has no scheduled recompute; `window_end = today` keying makes it usually empty | **FIXED** |
| F-05 | **High** | Zero-shift employees are excluded from the ledger → starvation, non-monotonic fairness | **FIXED** |
| F-06 | **High** | Future-dated commits are written to a trailing window, then silently erased (lost update) | **FIXED** (deleted) |
| F-07 | **High** | `initial_fatigue_score × 60` bridge is miscalibrated ~2.2× and saturates the SC-7 bands | **FIXED** |
| F-08 | **High** | Edge function reads `fairness_ledger` with no `window_end` filter → arbitrary historical row | **FIXED** (via F-04) |
| F-09 | **High** | `conflict-resolver` never passes `fairness_debts` → F1/F3 blocks unreachable | **FIXED** |
| F-10 | **High** | Greedy fallback double-counts the negative weekend debt bonus | **FIXED** |
| F-11 | **High** | Three disagreeing night-shift classifiers; two disagreeing weekend classifiers | **FIXED** |
| F-12 | **Medium** | Five incompatible definitions of "fairness"; `bidding/scorer.ts` entirely unwired | **FIXED** |
| F-13 | **Medium** | Debt→coefficient table triplicated; `debtToObjectiveCoeff` has no production caller | **FIXED** |
| F-14 | **Medium** | Bid-preview fairness is department-scoped; the persisted ledger is org-scoped | **FIXED** |
| F-15 | **Medium** | `fetchContractedHours` is a hardcoded 38h stub despite `hr.user_contracts` existing | **FIXED** |
| F-16 | **Medium** | Conflict-resolver load penalty measures total load, not over-ceiling, and saturates | **FIXED** |
| F-17 | **Medium** | Ledger penalties/bonuses multiply by the number of `schedule_changes` in an operation | **FIXED** |
| F-18 | **Medium** | `initial_fatigue_score` silently reads 0 for future-dated rosters | **FIXED** |
| F-19 | **Medium** | `O(E·S²)` scan in SC-11 — the exact pattern the file elsewhere documents as fixed | **FIXED** |
| F-20 | **Medium** | Ledger read-modify-write has no concurrency control; rows grow unbounded | **FIXED** (deleted) |
| F-21 | **Medium** | Ledger public-holiday set is a hardcoded 2026-only literal, diverging from `core/lib/holidays.ts` | **FIXED** |
| F-22 | **Low** | `computePeakFatigue` history argument omitted at 2 of 3 call sites | **FIXED** |
| F-23 | **Low** | Fatigue thresholds 20/35 vs 15 vs 1200/1800 — three unrelated band systems | **FIXED** |
| F-24 | **Low** | `fairness_ledger` RLS is gamma+ only — employee-facing surfaces degrade silently | **FIXED** |
| F-25 | **Low** | Reserve List documents fatigue screening the v8 engine does not implement | **FIXED** |

---

## 3. Detailed Findings

### F-01 — Optimizer never receives Sunday / public-holiday flags

**Severity:** Critical · **Status: FIXED 2026-08-04**

> **Resolution**
> - `auto-scheduler.controller.ts` — the payload builder now sets `is_sunday` and
>   `is_public_holiday` from `getShiftDayType()` (`core/lib/holidays.ts`), the app-wide
>   NSW calendar the compliance adapters already use. No new literal set, and no
>   `new Date(dateStr)` (which parses as UTC midnight and rolls the day west of UTC).
> - `model_builder.py` `ShiftInput.__post_init__` — now derives **both** `is_saturday`
>   and `is_sunday` from `shift_date`, extending the existing Saturday precedent, so
>   no future client can disable award pricing by omission. `is_public_holiday` still
>   crosses the wire (this service has no holiday calendar) and is pinned by the TS
>   producer test.
> - `undesirable_shift_ids` — now admits `is_saturday`, making SC-11's Saturday branch
>   reachable for the first time.
> - SC-11 — the per-pair `strptime` weekday derivation (and its bare `except:`) is
>   replaced by `s.is_saturday or s.is_sunday`, and the `next(...)` scan by
>   `shift_by_id[s_id]`. This also closes **F-19** for this block.
>
> **Tests** — `optimizer-service/tests/test_solver_regressions.py`:
> `test_shiftinput_derives_weekend_flags_without_wire_flags`,
> `test_penalty_day_charges_sunday_without_wire_flag`,
> `test_sc11_weekend_debt_applies_to_saturday_day_shift`,
> `test_sc11_public_holiday_debt_biases_assignment`;
> `src/modules/scheduling/__tests__/optimizer-day-type-flags.test.ts` (4 producer tests —
> verified to fail against the pre-fix payload builder).
>
> **Not covered by this fix:** the greedy fallback still uses its own weekend/night
> classifiers (**F-11**), so a fallback run classifies these shifts differently.

**Location**
- `src/modules/scheduling/auto-scheduler.controller.ts:694-707` (the only `OptimizerShift[]` producer)
- `src/modules/scheduling/types.ts:26-27` (declares `is_sunday?`, `is_public_holiday?`)
- `optimizer-service/model_builder.py:102-111` (`_penalty_day`)
- `optimizer-service/model_builder.py:2118-2121` (`undesirable_shift_ids`)
- `optimizer-service/model_builder.py:2214-2216` (PH debt branch)

**Explanation**
`OptimizerShift` declares `is_sunday` and `is_public_holiday`, and `ShiftInput.__post_init__`
explicitly documents them as *"client-supplied wire flags"* — deriving only `is_saturday`
server-side. But the sole payload builder sets neither field:

```ts
const optimizerShifts: OptimizerShift[] = futureShifts.map(s => ({
    id, shift_date, start_time, end_time, duration_minutes, role_id,
    priority, demand_source, target_employment_type, level,
    is_training, unpaid_break_minutes,          // ← no is_sunday, no is_public_holiday
}));
```

A repo-wide grep confirms no other producer exists: the only assignments to `is_public_holiday` live
in the v8 compliance adapters (`v1-to-v8.ts`, `v2-to-v8.ts`), a completely different pipeline.

**Evidence — what breaks downstream**

```python
undesirable_shift_ids = {
    s.id for s in self.data.shifts
    if s.is_sunday or s.is_public_holiday or _is_night(s)   # → _is_night(s) only
}
```

Both SC-10 (`undesirable_balance`) and SC-11 (longitudinal fairness) iterate *only* this set. So:

- A **Sunday day shift** is not "undesirable" → excluded from both fairness terms.
- A **public-holiday day shift** is not "undesirable" → excluded.
- Inside SC-11, `if s.is_public_holiday and 'public_holiday_shifts' in debts:` is **unreachable
  code** — the guard can never be true. The 500¢ coefficient, the highest in the table, never fires.
- SC-11 derives `is_weekend = dt.weekday() in (5, 6)` correctly, but only for shifts already in
  `undesirable_shift_ids` — so a **Saturday debt only applies to a Saturday that is also a night
  shift**. The domain layer's deliberate extension of weekend fairness to Saturday
  (`fairness-ledger.ts:136-144`) is therefore inert.

The same flags gate the cost model:

```python
def _penalty_day(shift):
    if shift.is_public_holiday: return 'public_holiday'   # never
    if shift.is_sunday:         return 'sunday'           # never
    if shift.is_saturday:       return 'saturday'         # derived, works
    return None
```

A Sunday shift falls through every branch (Sunday is `weekday() == 6`, so the derived `is_saturday`
is also False) and returns `None` → **no penalty loading at all**. Sunday work is costed at the
ordinary rate; public-holiday work at the ordinary rate.

**Impact**
- Sunday and public-holiday work is never balanced across the team. The solver has no reason not to
  give the same person every Sunday for a quarter.
- The ledger dutifully *records* `public_holiday_shifts` debt, and the UI dutifully *shows* it, but
  no optimiser decision has ever consumed it. Managers see a fairness number the system ignores.
- Cost ranking under-prices Sunday by 50% and public holidays by 150% relative to the EBA, biasing
  the solver toward exactly the shifts it should be treating as expensive and scarce.

**Recommendation**
1. Populate both flags at the single payload builder, using the existing holiday helper rather than
   a new literal set:
   ```ts
   is_sunday: new Date(s.shift_date + 'T12:00:00').getDay() === 0,
   is_public_holiday: isPublicHoliday(parseLocalDateStr(s.shift_date)),
   ```
2. Better: mirror the `is_saturday` precedent and derive **all three** in `ShiftInput.__post_init__`,
   so the solver is self-sufficient and no future client can silently disable award pricing. Keep the
   wire fields as an override only.
3. Add `is_saturday` to `undesirable_shift_ids` so SC-11's Saturday branch becomes reachable.
4. Add a schema-contract test asserting that a Sunday date produces `is_sunday: true` end-to-end.

---

### F-02 — Incremental ledger update books every committed minute as overtime

**Severity:** Critical · **Status: FIXED 2026-08-04**

> **Resolution** — `fairnessLedger.service.ts` `updateAfterCommit`:
> - The delta is aggregated against the **real** rolling window (`windowDays / 7`) and
>   real contracted hours (`fetchContractedHours`, same call `recomputeLedger` makes),
>   not `windowWeeks = 0` with an empty map.
> - `overtime_minutes` is **excluded from the delta merge** and re-derived from the
>   employee's new window total via the now-exported `overtimeFromHours()` /
>   `contractedWindowMinutes()` — the same formula and helpers `recomputeLedger` and
>   `projectFairnessImpact` use, so the incremental, authoritative and preview paths
>   converge. Overtime is a threshold metric and can never be summed shift-by-shift.
> - Re-derivation is scoped to employees the commit actually touched; untouched rows
>   keep their persisted values.
> - `updateAfterCommit` now takes `windowDays` and forwards it to its
>   `recomputeLedger` fallback, so the two paths cannot use different thresholds.
>
> **Tests** — `src/modules/rosters/services/__tests__/fairnessLedger.overtime.test.ts`
> (5 tests; the two covering the under-contract regime were verified to fail against
> the pre-fix service). Note the buggy formula happened to agree with the correct one
> when an employee was *already* over contract for the whole delta — the regression
> only showed below and around the threshold, which is why the suite covers both.
>
> **Not covered by this fix:** existing rows already poisoned in prod are only repaired
> by the next full recompute — which per **F-04** may not run. Contracted hours are
> still the 38h stub (**F-15**), so the threshold is wrong for part-timers and casuals
> even though the formula is now right.

**Location**
- `src/modules/rosters/services/fairnessLedger.service.ts:222`
- `src/modules/rosters/domain/fairness-ledger.ts:212-239` (`aggregateShiftsToEntries`)

**Explanation**
`updateAfterCommit` calls the aggregator with `windowWeeks = 0`:

```ts
const deltaEntries = aggregateShiftsToEntries(classifiedNew, new Map(), 0, deniedPrefsCount);
```

Inside the aggregator:

```ts
const contractedWeekly = contractedHoursPerWeek?.get(employeeId) ?? 38;   // empty Map → 38
const contractedTotalMinutes = contractedWeekly * 60 * windowWeeks;       // 38 * 60 * 0 = 0
const overtimeMinutes = Math.max(0, agg.totalMinutes - contractedTotalMinutes);  // = agg.totalMinutes
```

The contracted threshold collapses to zero, so *every* minute of the committed shift is classified as
overtime. The deltas are then added to the persisted `rolling_value`.

**Evidence (executed against the real functions)**

```
INCREMENTAL delta values : {"weekend_shifts":0,"night_shifts":0,"public_holiday_shifts":0,
                            "overtime_minutes":480,"total_hours":8,"denied_preferences":0}
FULL recompute values    : {"weekend_shifts":0,"night_shifts":0,"public_holiday_shifts":0,
                            "overtime_minutes":0, "total_hours":8,"denied_preferences":0}
```

The in-code comment acknowledges the shortcut — *"we just add the raw hours and let the next full
recompute fix the OT threshold boundary"* — but it is adding raw hours to the **overtime** metric, not
just the hours metric, and (per F-04) the "next full recompute" frequently never happens.

**Impact**
- Every employee the auto-scheduler assigns accumulates a large false overtime debt. After one
  8-hour commit their `overtime_minutes` debt is 480 above an employee who was not assigned.
- SC-11b consumes this directly: `ot_debt × 0.05¢ × shift_hours`. At 480 debt-minutes and an 8h
  shift that is a 192¢ bias *against* assigning them again — self-reinforcing exclusion of whoever the
  solver picked last time. This is a textbook oscillation/starvation driver.
- The bid-review preview (`projectFairnessImpact`) reads these poisoned values for *other* employees
  (it only recomputes the bidder's own OT), so the "team average" the manager sees is inflated.

**Recommendation**
Overtime is not decomposable into a per-shift delta — it depends on the window total crossing a
threshold. Do not attempt a delta. Either:
- **(preferred)** recompute `overtime_minutes` for the touched employees from their window total after
  applying the hours delta (`overtimeFromHours(newTotalHours, contractedTotalMinutes)` — the helper
  already exists at `fairness-ledger.ts:311`), or
- drop `overtime_minutes` from the incremental path entirely and mark it stale until the next
  authoritative recompute.

Pass the real `windowWeeks` (`DEFAULT_WINDOW_DAYS / 7`) in either case, and add a regression test
asserting `incremental(shift) == recompute(historyPlusShift)` for the OT metric.

---

### F-03 — Fatigue does not decay after the last shift

**Severity:** Critical

**Location** `src/modules/rosters/domain/projections/utils/fatigue.ts:169-199`

**Explanation**
`calculateFatigueWithRecovery` applies rest recovery *between* consecutive shifts, but never between
the final shift and `referenceDate`:

```ts
for (const shift of shiftsWithinWindow) {
    if (previousEndTimeHours !== null) {
        const restHours = shift.startHours - previousEndTimeHours;
        fatigue = Math.max(0, fatigue - restHours);      // decay before each shift
    }
    fatigue += calculateFatigueAccumulation(shift);
    previousEndTimeHours = shift.endHours;
}
const current = Math.round(fatigue * 10) / 10;           // ← no final decay to referenceDate
```

The `projected` branch immediately below *does* apply the decay before the candidate shift — so
`current` and `projected` are measured at two different instants.

**Evidence (executed)**

```
finished TODAY 08:00      -> {"current":26,"projected":26}
finished 6 DAYS ago 08:00 -> {"current":26,"projected":26}
```

144 hours of rest changes nothing. The only way a shift stops contributing is by falling out of the
7-day window entirely — i.e. fatigue is a step function, not a decay curve, despite the module being
named "…WithRecovery".

**Impact**
- `initial_fatigue_score` (`auto-scheduler.controller.ts:801-807`) means "fatigue at the end of your
  last shift within 7 days". Someone who worked one night shift last Tuesday and rested since is fed
  into the solver as equally fatigued as someone who clocked off an hour ago.
- Combined with F-07's amplification, a well-rested employee can be effectively excluded from an
  entire week's roster.
- The Health-Mode FTG badge and the bid-review fatigue panel display the same overstated value to
  managers, who will make manual decisions on it.
- The 7-day boundary produces a cliff: fatigue drops from 26 to 0 the instant the shift ages out.

**Recommendation**
Apply the final decay before returning:

```ts
if (previousEndTimeHours !== null) {
    fatigue = Math.max(0, fatigue - (windowEndHours - previousEndTimeHours));
}
```
…and make the reference instant explicit (`referenceDate` end-of-day is what the window already
uses). Note `computePeakFatigue` intentionally samples at each shift's own date, so it is unaffected
by design — but re-baseline `FATIGUE_BANDS` (F-23) once decay is live, because the current 20/35
bands were calibrated against undecayed scores.

---

### F-04 — The ledger is usually empty: no scheduled recompute, `window_end = today` keying

**Severity:** Critical · **Status: FIXED 2026-08-04**

> **Resolution** — three migrations (written, validated, *not yet applied to prod*):
>
> `20260804020000_fairness_ledger_latest_window_read.sql`
> - `get_fairness_debts_latest(org, employee_ids, as_of)` — `DISTINCT ON
>   (employee_id, metric) … window_end <= as_of ORDER BY window_end DESC`. Reads
>   resolve to the most recent available window instead of demanding today's.
>   Deliberately SECURITY **INVOKER** so `fairness_ledger_org_scoped` RLS stays
>   the single access-control source rather than a restated copy that can drift.
> - Supporting index `(organization_id, employee_id, metric, window_end DESC)` —
>   the existing lookup index doesn't lead with `employee_id`.
>
> `20260804030000_public_holidays_table.sql`
> - Shared `public_holidays` table keyed by jurisdiction, seeded 2024–2032 from
>   the app's own `date-holidays` AU-NSW instance (generated, not hand-typed).
>   Required because SQL had no calendar to classify against — and it closes the
>   *data* half of **F-21**. Includes an apply-time coverage guard that raises if
>   the seed doesn't extend a year past today, so it cannot expire silently the
>   way the 2026-only literal was going to.
>
> `20260804040000_fairness_ledger_scheduled_recompute.sql`
> - `recompute_fairness_ledger(org, as_of, window_days, dept, jurisdiction)` —
>   the authoritative rebuild, one statement (aggregate → `AVG() OVER` debts →
>   `INSERT … ON CONFLICT DO UPDATE`).
> - `recompute_all_fairness_ledgers()` — per-org sweep; one failing org is logged
>   and skipped rather than aborting the run (pg_cron discards return values).
> - `request_fairness_ledger_recompute(org, as_of)` — SECURITY INVOKER gate that
>   authorises the caller against the RLS predicate before delegating, so an
>   authenticated user can't rebuild another org's ledger by passing its uuid.
> - `cron.schedule('nightly_fairness_recompute', '0 16 * * *', …)`, guarded on
>   `pg_extension`, mirroring `nightly_leave_accrual` / `dead_shift_cleanup`.
>
> **TS**
> - `getEmployeeDebtsWithStatus` returns `{ debts, status, windowEnd, ageDays }`
>   with `status: 'ok' | 'stale' | 'unavailable'`. Stale debts are still applied
>   (stale beats nothing) but reported. `getEmployeeDebts` is now a thin wrapper.
> - `AutoSchedulerResult.fairnessLedger` carries a `FairnessLedgerRunStatus`, so
>   every run records whether longitudinal fairness was applied and why not.
> - `recomputeLedger` is now a thin RPC call — the browser-side classify /
>   aggregate / upsert is **deleted**, not duplicated, so there is exactly one
>   write implementation.
> - The AutoPilot edge function's `loadFairnessDebts` now calls the same RPC,
>   which closes **F-08** (it had no `window_end` filter at all).
>
> **Tests**
> - `fairnessLedger.staleness.test.ts` (8) — unavailable vs stale vs ok, ageing
>   against the freshest window, threshold boundary; green in UTC, Sydney,
>   New York and Singapore.
> - `fairnessLedger.sqlParity.test.ts` (15) + `supabase/tests/fairness_ledger_parity.sql`
>   — one shared fixture asserted from both sides. Verified equal on PostgreSQL
>   15: all 12 rows matched exactly on value, team average and debt. The SQL
>   harness was confirmed to FAIL when an expected value is perturbed.
>
> **Deliberately NOT changed:** the cohort is still "employees with a shift or a
> denied preference", matching the TS behaviour it replaces. Including zero-shift
> employees is a one-line `RIGHT JOIN` in the new function but moves every team
> average, so it stays with **F-05** rather than being smuggled in here.
> Contracted hours remain the hardcoded 38h stub (**F-15**).

**Location**
- `src/modules/rosters/services/fairnessLedger.service.ts:44-65` (`getEmployeeDebts`)
- `src/modules/rosters/api/fairnessLedger.queries.ts:46-66` (`.eq('window_end', windowEnd)`)
- `src/modules/rosters/state/useRosterMutations.ts:343-358` (the only recompute trigger)
- `supabase/migrations/` — no `cron.schedule` entry for fairness

**Explanation**
Reads are keyed to an exact `window_end` equal to *today's* date. Rows for today exist only if a
recompute ran today. The only recompute trigger in the codebase is a fire-and-forget call inside the
`usePublishRoster` success handler — client-side, best-effort, and dependent on a human clicking
Publish. There is no pg_cron job (`nightly_leave_accrual` and `dead_shift_cleanup` exist; fairness
has none), no edge function, and no server-side scheduler.

The service itself documents the gap and chooses to fail open:

```ts
// If no rows exist for this window (e.g. feature just turned on or new day),
// we should ideally trigger a background rebuild. For now, we return zero debts.
```

**Impact**
- On any day with no publish, every `fairness_debts` map is `{}`. Both solver blocks begin
  `if not debts: continue` — the entire longitudinal fairness system silently no-ops.
- There is no signal anywhere that this happened. The run completes, the pillars render, and the
  scorecard shows a fairness score computed purely from intra-run peak-load balancing.
- The failure is *silent and intermittent* — the hardest possible class to debug, and it means
  fairness quality depends on publishing cadence rather than on policy.
- If the publish-triggered recompute throws (RLS, network), it is swallowed into `console.error`.

**Recommendation**
1. Move the recompute server-side and schedule it: a pg_cron job or edge function at ~02:00
   Australia/Sydney, following the `nightly_leave_accrual` precedent.
2. Make the read resilient: `SELECT … WHERE window_end <= $today ORDER BY window_end DESC LIMIT 1`
   per `(employee, metric)`, rather than requiring an exact match on today.
3. Return an explicit `ledgerAvailable: boolean` from `getEmployeeDebts` and surface it in the
   auto-scheduler result and the Insights panel — degraded fairness must be visible, not inferred.
   The `f3Degraded` flag in `auto-assign-bids/index.ts` is the right pattern; adopt it everywhere.

---

### F-05 — Zero-shift employees are excluded from the ledger entirely

**Severity:** High

**Location**
- `src/modules/rosters/domain/fairness-ledger.ts:212-274` (`aggregateShiftsToEntries`)
- `src/modules/rosters/domain/fairness-ledger.ts:179-202` (`computeDebts`)
- `optimizer-service/model_builder.py:2176-2178`, `2245-2247` (`if not debts: continue`)

**Explanation**
`aggregateShiftsToEntries` builds `byEmployee` by iterating shifts. An employee with no shifts in the
window never enters the map, so they get no entry, no debt rows, and nothing in `fairness_debts`.
(The one exception is the `deniedPreferencesCount` back-fill at lines 254-271, which covers only
employees with rejected bids.)

Two compounding consequences:

1. **The team average is computed over the wrong population.** `computeDebts` divides by
   `entries.length` — the count of employees *who worked*, not the count of employees *on the team*.
   With 20 staff of whom 12 worked, the "team average" is 1.67× too high, and every worker's debt is
   correspondingly understated.

2. **The least-worked employee gets no bonus.** Both solver blocks short-circuit on empty debts:
   ```python
   debts = getattr(emp, 'fairness_debts', {})
   if not debts:
       continue
   ```
   An employee with 1 shift has a negative `total_hours` debt → SC-11b gives them a bonus. An
   employee with **0** shifts has no debts at all → no bonus. The fairness incentive is
   non-monotonic: it rewards working slightly-below-average but not working nothing.

**Impact**
Classic starvation. An employee who has been overlooked for a quarter is precisely the one the
longitudinal ledger exists to rescue, and is precisely the one it cannot see. Once someone falls out,
nothing pulls them back in — the system has no restoring force at the boundary.

**Recommendation**
- Pass the full roster population into `recomputeLedger` (it already resolves `employeeIds`; extend
  it to the org's active employees, not just those appearing in shifts) and emit zero-valued entries
  for everyone. This fixes both the denominator and the missing-bonus problem in one change.
- Replace `if not debts: continue` with an explicit zero-default so an absent ledger row and a
  genuine zero are distinguishable at the call site.
- Add a test: *"an employee with zero shifts receives a strictly larger assignment bonus than an
  employee with one shift."*

---

### F-06 — Future-dated commits are written to a trailing window, then erased

**Severity:** High

**Location**
- `src/modules/rosters/services/fairnessLedger.service.ts:82-99` (`recomputeLedger` window)
- `src/modules/rosters/services/fairnessLedger.service.ts:166-263` (`updateAfterCommit`)
- `src/modules/scheduling/auto-scheduler.controller.ts:1284-1313` (write-back)

**Explanation**
`recomputeLedger` builds the window as `[windowEnd − 90, windowEnd]` with `windowEnd = today` — a
purely **trailing** window. But the auto-scheduler assigns **future** shifts, and its write-back calls
`updateAfterCommit`, which adds those future shifts into that trailing window's `rolling_value`.

The next authoritative recompute re-reads `shifts` for `[today−90, today]`, does not find the future
shifts, and overwrites the row. Every incremental contribution is discarded.

The same applies to `denied_preferences`: `updateAfterCommit` deliberately widens its bid query to
±365 days (line 211-213) while `recomputeLedger` restricts to the trailing window — so denied
preferences on future shifts are counted incrementally and dropped on recompute.

**Impact**
- Between commit and recompute the ledger asserts that employees have worked hours they have not yet
  worked — and those hours may never be worked (the shift can be cancelled, swapped or reassigned;
  nothing decrements the ledger).
- After recompute the credit vanishes, so two auto-scheduler runs a week apart see completely
  different debt landscapes for the same underlying roster. Runs are not reproducible.
- There is no compensating decrement anywhere: `updateAfterCommit` only ever *adds*. Unassignment,
  cancellation and swap-away are invisible to the ledger.

**Recommendation**
Decide explicitly whether the ledger measures **worked** or **rostered** load, and document it:
- *Worked* (recommended, matches the "longitudinal fairness" intent): drop the incremental write-back
  entirely and rely on the scheduled recompute. Simpler, and removes an entire class of drift.
- *Rostered*: extend the window to `[today−90, horizonEnd]`, make `window_end` a stable window
  identifier rather than "today", and add decrement paths for cancel/unassign/swap.

Either way the incremental and authoritative paths must produce identical output for identical input;
today they demonstrably do not (see F-02).

---

### F-07 — `initial_fatigue_score × 60` is miscalibrated and saturates the SC-7 bands

**Severity:** High

**Location**
- `src/modules/scheduling/auto-scheduler.controller.ts:227-235` (`MAX_INITIAL_FATIGUE_SCORE = 60`)
- `optimizer-service/model_builder.py:2015-2020` (`init_eff_mins = int(emp.initial_fatigue_score * 60)`)
- `optimizer-service/model_builder.py:2049-2057` (amber/critical bands)

**Explanation**
Two incompatible fatigue models are bridged by a single unvalidated constant.

The **circadian weighting** in both engines agrees exactly — TS penalties
`[0.25, 0.5, 0.25, 0, −0.25, 0, 0.25]` are precisely `python_weight − 1`, and the break handling is
algebraically identical. That part is sound.

What diverges is everything after:
- **TS** applies a saturating log transform `−76·ln(1 − effHours/38)` and then linear rest recovery.
- **Python** sums raw effective minutes per ISO week against flat 1200/1800 thresholds, with no
  recovery model at all.

The bridge asserts *"1 fatigue unit ≈ 60 effective minutes"*. Check it against the module's own
documented anchors:

| Shift | TS score | `score × 60` | Actual effective minutes |
|---|---|---|---|
| 8h day (09:00–17:00) | ~14.3 | 858 | 390 |
| 8h night (00:00–08:00) | ~26 | 1560 | 672 |

The conversion overstates by **~2.2–2.3×**, and it is not a constant factor — the log transform is
convex, so the error grows with fatigue.

The consequence at the bands is severe. `eff_total_week == Σ(terms) + week_init`, and:
```python
amber_mins    = max(0, eff_total_week - 1200)   # $5.00/min
critical_mins = max(0, eff_total_week - 1800)   # + $45.00/min
```
A single prior night shift injects `init = 1560`, already past amber. At the
`MAX_INITIAL_FATIGUE_SCORE = 60` clamp, `init = 3600` — past *critical* before a single minute is
assigned. Both `max()` terms then become affine in the decision sum, so the **marginal** cost of one
more effective minute is a flat `500 + 4500 = 5000¢ = $50/minute` — roughly $24,000 for an 8-hour
shift, against a labour cost of ~$25/shift.

**Impact**
- The fatigue penalty is bang-bang, not graduated: below the threshold an employee is free, above it
  they are effectively **hard-excluded** — a hard constraint wearing a soft constraint's clothing,
  applied on the basis of an overstated, never-decayed (F-03) input.
- The exclusion is invisible: it appears as "the solver preferred someone else", with no binding
  constraint reported and no entry in `WhyThisPerson`.
- `init_eff_mins` is loaded entirely into `earliest_week`, so a month-long horizon concentrates all
  prior fatigue into week 1 and leaves weeks 2-4 with none — a discontinuity with no physical basis.

**Recommendation**
1. Delete the `× 60` constant. Convert on the TS side instead by computing prior-week **effective
   minutes** directly — the same quantity the solver uses — and ship that as
   `initial_effective_minutes`. The circadian weighting already matches, so this is a faithful
   conversion rather than a guess.
2. Amortise prior load across the recovery horizon instead of dumping it in `earliest_week`, or drop
   it for horizons that begin more than 7 days out (where it has physically decayed).
3. Add a graduated band below 1200 so the penalty has a gradient rather than a cliff.
4. Regression-test the marginal cost per effective minute at several `initial_fatigue_score` values;
   assert it never exceeds the labour-cost scale.

---

### F-08 — Edge function reads the ledger with no `window_end` filter

**Severity:** High

**Location** `supabase/functions/auto-assign-bids/index.ts:838-859` (`loadFairnessDebts`)

**Explanation**
```ts
const { data, error } = await service
  .from('fairness_ledger')
  .select('employee_id, debt')
  .eq('organization_id', orgId)
  .eq('metric', 'denied_preferences')
  .in('employee_id', empIds);          // ← no window_end predicate, no ORDER BY, no LIMIT
…
for (const r of data ?? []) debts.set(r.employee_id, Number(r.debt) || 0);
```

The unique index is `(organization_id, employee_id, metric, window_end)` — one row **per day** per
employee per metric. The query returns all of them and the `Map` keeps whichever arrives last in
unspecified physical order.

The client-side twin of this feature (`OpenBidsView/index.tsx:1174` → `getEmployeeDebts`) *does*
filter on `window_end = today`.

**Impact**
- AutoPilot's F3 bid ordering ranks bidders by a **randomly chosen historical** debt value. It can
  reverse relative to the manual path for the same bidders at the same instant.
- The result is non-deterministic across identical inputs — the two orderings are not reproducible
  and cannot be explained to an employee who asks why they lost a shift.
- The bug worsens over time as rows accumulate (F-20): more history, more possible answers.

**Recommendation**
Filter to the current window, matching `getEmployeeDebts`, and add `ORDER BY window_end DESC` with a
per-employee pick so a missing "today" row degrades to the most recent rather than to noise. Better:
extract one shared `latestDebts(orgId, empIds, metric?)` query used by both TS and the edge function
— today they are two independent implementations of the same read.

---

### F-09 — `conflict-resolver` never passes `fairness_debts`; its F1/F3 blocks are unreachable

**Severity:** High

**Location**
- `src/modules/compliance/v8/orchestrator/conflict-resolver/index.ts:125-132` (call site)
- `src/modules/compliance/v8/orchestrator/conflict-resolver/scorer.ts:111-202` (signature + dead blocks)

**Explanation**
`scoreOperations` takes seven parameters; the sole call site passes six:

```ts
const scored = scoreOperations(
    input.operations, shift_catalog, employee_catalog, existing_shifts_map, config,
    input.base_state.employee_hours_28d,    // optional fairness data
);                                          // ← 7th arg `fairness_debts` never supplied
```

`fairness_debts` is therefore always `undefined`, making both of these unreachable:
- lines 169-185 — the F1 longitudinal ledger penalty
- lines 189-202 — the F3 preference-equity bonus

Independently, `DEFAULT_CONFLICT_RESOLVER_CONFIG.fairness_weight = 0`
(`conflict-resolver/types.ts:166`), so even the *reachable* 28-day load penalty is off by default.

**Impact**
Every swap-conflict and batch-assignment resolution — the paths that decide which of two competing
operations wins — runs with fairness fully disabled. Because the code exists, reads plausibly, and is
type-correct, a future engineer will reasonably assume fairness is applied here.

**Recommendation**
Either wire it (`input.base_state.fairness_debts`, populated from `getEmployeeDebts`, plus a non-zero
default weight) or delete both blocks and the parameter. Leaving unreachable business logic in a
scorer is worse than having no fairness there at all. If wiring it, fix F-16 and F-17 at the same
time.

---

### F-10 — Greedy fallback double-counts the negative weekend-debt bonus

**Severity:** High

**Location** `src/modules/scheduling/auto-scheduler.controller.ts:383-393`

**Explanation**
```ts
if (shift_is_weekend) {
    if (debts.weekend_shifts < 0) debtBonus += Math.abs(debts.weekend_shifts) * 50; // owed weekend off -> bonus for this shift? No, wait.
    // If they are owed a weekend off (positive debt), we want to PENALIZE assigning them this weekend shift.
    // If they owe a weekend shift (negative debt), we want to BONUS assigning them.
    if (debts.weekend_shifts > 0) debtBonus -= debts.weekend_shifts * 50;
    if (debts.weekend_shifts < 0) debtBonus += Math.abs(debts.weekend_shifts) * 50;   // ← duplicate of line 384
}
if (shift_is_night) {
    if (debts.night_shifts > 0) debtBonus -= debts.night_shifts * 50;
    if (debts.night_shifts < 0) debtBonus += Math.abs(debts.night_shifts) * 50;       // single, correct
}
```

Line 384 is a leftover first attempt — the trailing *"No, wait."* comment is the author reasoning
mid-edit — and it was never removed when the corrected pair was written below it.

**Impact**
- Under-worked employees receive **2× the intended weekend bonus** but **1× the night bonus**, so the
  fallback over-prefers weekend assignment relative to night by a factor of two.
- Asymmetric within the metric: the negative branch is doubled, the positive (penalty) branch is not,
  so the fallback is biased toward *adding* weekend work rather than balancing it.
- The greedy fallback runs whenever the optimizer is unavailable, times out, or returns INFEASIBLE —
  i.e. exactly under load, when nobody is scrutinising the output.

**Recommendation**
Delete line 384 and its stale comment. Then replace the whole block with the shared
`debtToObjectiveCoeff` helper (see F-13) so the fallback cannot drift from the solver again. Add a
test asserting the greedy fallback and the solver rank two candidates identically for a given debt
vector.

---

### F-11 — Divergent weekend and night classifiers

**Severity:** High

**Location**
- `src/modules/rosters/domain/fairness-ledger.ts:141-165` (`isWeekendShift`, `isNightShift`)
- `src/modules/scheduling/auto-scheduler.controller.ts:322-327` (greedy fallback)
- `optimizer-service/model_builder.py:2104-2116` (`_is_night`)

**Explanation**

*Night.* The domain classifier and the Python solver agree exactly (both do an interval overlap
against `[0, 360]` and `[1440, 1800]`). The greedy fallback does not:

```ts
const isCrossMidnight = endH <= startH;
const shift_is_night = startH < 6 || isCrossMidnight;   // "cross-midnight" ⇒ night
```

Any shift ending at exactly `00:00` satisfies `endH <= startH` and is classified as night, even
though it never enters the night zone:

| Shift | ledger / solver | greedy fallback |
|---|---|---|
| 18:00–00:00 | not night | **night** |
| 20:00–00:00 | not night | **night** |
| 12:00–00:00 | not night | **night** |
| 22:00–06:00 | night | night |
| 05:00–13:00 | night | night |

Shifts ending at midnight are among the most common close shifts in hospitality/venue rostering, so
this is not an edge case.

*Weekend.* The domain classifier is timezone-hardened; the greedy fallback is not:

```ts
// fairness-ledger.ts — parses at local noon, TZ-safe
new Date(shiftDate + 'T12:00:00').getDay()

// auto-scheduler.controller.ts — parses as UTC midnight, reads in local time
new Date(shift.shift_date).getDay()
```

`new Date('2026-08-08')` is UTC midnight. Read from any timezone west of UTC it resolves to the
*previous* day, so a Saturday shift classifies as Friday. This directly contradicts the project's
established rule that all date/time logic must resolve in Australia/Sydney regardless of browser
timezone.

**Impact**
The same shift receives different fairness treatment depending on which engine ran, and — for the
weekend case — on where the manager's browser is. Since the fallback fires precisely when the
optimizer is unhealthy, the divergence is correlated with degraded operation.

**Recommendation**
Delete both local implementations. Import `isWeekendShift` / `isNightShift` from
`domain/fairness-ledger.ts` in the controller, and have the Python service derive its flags from the
same specification (already true for `_is_night`; extend to weekend per F-01). Add a shared
cross-engine fixture table of ~20 shifts with expected `(isWeekend, isNight, isPH)` and assert it in
both the vitest and pytest suites.

---

### F-12 — Five incompatible definitions of "fairness"; one scorer entirely unwired

**Severity:** Medium

**Location**
| # | Definition | File | Status |
|---|---|---|---|
| 1 | Longitudinal debt vs team average across 6 metrics | `rosters/domain/fairness-ledger.ts` | wired (partially — F-01/F-04) |
| 2 | Utilisation vs contracted hours; MAD dispersion | `rosters/domain/projections/utils/fairness.ts` | wired (display) |
| 3 | Intra-run min-max peak-load balancing | `model_builder.py` SC-10 / B2 | wired |
| 4 | Anti-bulk-bidder: penalise employees who bid on many shifts | `compliance/v8/orchestrator/bidding/scorer.ts` | **unwired — zero callers** |
| 5 | 28-day contracted-hours load ratio | `compliance/v8/orchestrator/conflict-resolver/scorer.ts` | wired but off by default |

**Explanation**
These are not layers of one concept; they are five different concepts sharing a word. Definition 4 in
particular is in tension with the others — it penalises *engagement* (bidding often), whereas 1, 3
and 5 penalise *allocation* (receiving much). An employee who bids on ten shifts and wins none is
"unfair" under definition 4 and "owed" under definition 1.

`scoreAllBids` and `runBidSelection` have no callers anywhere in `src/` or `supabase/` — confirmed by
repo-wide grep. `src/modules/planning/index.ts:7` re-exports a *different* `./bidding` (the planning
UI module), not the v8 orchestrator.

**Impact**
- Nobody can answer "is this roster fair?" without asking "by which of the five definitions?"
- Two subsystems (F-09, and definition 4 here) contain fairness logic that has never executed in
  production but reads as authoritative to anyone auditing the code.
- Each definition uses a different scale (cents / percent / 0-1 / 0-100 points), so they cannot be
  compared or combined.

**Recommendation**
Establish a single **Fairness Policy** module owning: metric definitions, coefficients, thresholds,
and the debt→penalty conversion — with every engine (solver, greedy, conflict resolver, bid ordering)
consuming it rather than restating it. Then either wire or delete definition 4; if the intent is
anti-spam bid throttling, name it that and move it out of "fairness".

---

### F-13 — Debt→coefficient table triplicated; the canonical helper has no production caller

**Severity:** Medium

**Location**
- `src/modules/rosters/domain/fairness-ledger.ts:387-415` (`DEFAULT_COEFFICIENTS`, `debtToObjectiveCoeff`)
- `optimizer-service/model_builder.py:2198-2216`, `2241-2260` (hardcoded literals)
- `src/modules/scheduling/auto-scheduler.controller.ts:383-403` (different literals again)

**Explanation**

| Metric | TS `DEFAULT_COEFFICIENTS` | Python solver | Greedy fallback |
|---|---|---|---|
| `weekend_shifts` | 300 | 300 | **50** |
| `night_shifts` | 300 | 300 | **50** |
| `public_holiday_shifts` | 500 | 500 | *absent* |
| `total_hours` | 10 | **2.0 × shift-hours** | *absent* |
| `overtime_minutes` | 2 | **0.05 × shift-hours** | *absent* |
| `denied_preferences` | 200 | 200 | **20** |

`debtToObjectiveCoeff` — the function whose docstring positions it as the canonical conversion — is
imported only by its own test file. The Python source records the confusion in-line:

```python
# Debt coefficient conversion happens in TS, but we are passing raw debts?
# We need to convert debt -> penalty here, OR convert it in TS.
# Wait, in the TS code I added `debtsToMap(rawDebts)`.
```

**Impact**
The greedy fallback weights weekend/night fairness **6× weaker** and preference equity **10× weaker**
than the solver, so switching engines materially changes who gets assigned. Any future coefficient
tuning must be applied in three places, in two languages, or the engines silently diverge further.

**Recommendation**
Make the coefficient table the wire contract: have TS convert debts to penalties via
`debtToObjectiveCoeff` and send **pre-converted coefficients** to the solver, so Python holds no
fairness constants. Failing that, generate the Python table from the TS source at build time and
assert equality in `test_schema_contract.py` (which already guards the field-level contract).

---

### F-14 — Bid preview is department-scoped; the persisted ledger is org-scoped

**Severity:** Medium

**Location** `src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx:371-404`

**Explanation**
The preview has two branches. If ledger rows exist for today it uses them (org-scoped, since
`recomputeLedger` is called with no `departmentId`). If not, it recomputes locally **with** a
department filter:

```ts
const raw = await fairnessLedgerQueries.fetchAssignedShifts(
    orgId, /* start */, /* end */,
    expandedShift.departmentId || undefined,      // ← department-scoped
);
entries = aggregateShiftsToEntries(classified);
```

`computeDebts` averages over whatever population it is handed, so the two branches produce different
team averages — hence different `debt` values — for the same employee on the same day.

**Impact**
A manager reviewing the same bid sees different fairness numbers depending on whether a recompute has
run, with no indication which basis is in play. The preview's "after" state cannot be reconciled
against what the solver will actually do.

**Recommendation**
Pick one scope and enforce it everywhere. Department-scoped is arguably the more meaningful fairness
peer group (people compare themselves to their own team), but it must then be the scope used by
`recomputeLedger`, the solver read, and the preview alike — and `window_start`/`window_end` should be
joined by an explicit `scope_id` column so scopes cannot collide in one table.

---

### F-15 — Contracted hours are a hardcoded stub

**Severity:** Medium

**Location** `src/modules/rosters/services/fairnessLedger.service.ts:24-32`

```ts
// TODO: In a production app, fetch from employees table.
// For now, we mock a flat 38h contract for everyone to enable OT calculation.
async function fetchContractedHours(orgId, employeeIds) {
    for (const id of employeeIds) map.set(id, 38);
}
```

**Explanation**
Every employee is treated as full-time 38h/week for overtime-debt purposes. The `hr.user_contracts`
schema is in production and the auto-scheduler already reads real contract minutes
(`det?.min_contract_minutes`, `contracted_weekly_hours`) a few files away.

**Impact**
- A 20h/week part-timer must work 494 hours in the quarter before registering any overtime debt —
  nearly double their contract. Their overtime is systematically invisible.
- Casuals (no contracted hours) are held to a 38h standard they never agreed to.
- The distortion is *regressive*: it under-counts overtime precisely for the lowest-hours,
  least-protected cohort.

**Recommendation**
Read from `hr.user_contracts` (the same source the auto-scheduler already uses) and fall back to
employment-type defaults — FT 38h, PT actual, Casual 0 with overtime measured against a statutory
rather than contractual baseline. Note that the same 38h default is hardcoded a second time in
`aggregateShiftsToEntries` (`?? 38`) and a third in `projectFairnessImpact`
(`opts?.contractedWeekly ?? 38`) — all three need the same fix.

---

### F-16 — Conflict-resolver load penalty measures total load, not over-ceiling, and saturates

**Severity:** Medium

**Location** `src/modules/compliance/v8/orchestrator/conflict-resolver/scorer.ts:139-166`

**Explanation**
The comment says *"employees who are already at or above their 28-day contracted hours ceiling"* and
*"proportional to how over-ceiling"*. The code says otherwise:

```ts
const ratio = current_hours / ceiling_28d;        // total load, not excess
max_load_ratio = Math.max(max_load_ratio, ratio);
const penalty = Math.min(1, max_load_ratio) * config.fairness_weight * 100;
```

Two defects: an employee at 50% of ceiling is penalised (half the maximum), and the `Math.min(1, …)`
clamp makes 100% and 300% of ceiling indistinguishable — the penalty flatlines exactly where
over-work becomes a real compliance concern.

**Impact**
Inverted incentive at the boundary that matters: the scorer stops differentiating precisely once
employees exceed contract, so a badly-over-ceiling operation scores identically to a marginally-over
one. Meanwhile normally-loaded employees carry a penalty they should not.

**Recommendation**
`const excess = Math.max(0, ratio - 1);` and scale the penalty on `excess` (unclamped, or clamped far
higher). If the *intent* was load-balancing rather than over-ceiling protection, keep `ratio` but fix
the comment and remove the clamp.

---

### F-17 — Ledger penalty and preference bonus multiply by operation size

**Severity:** Medium

**Location** `src/modules/compliance/v8/orchestrator/conflict-resolver/scorer.ts:169-202`

**Explanation**
Both blocks subtract/add **inside** a `for (const change of op.schedule_changes)` loop, mutating the
running `composite_score` each iteration. An operation touching three employees applies the ledger
penalty three times.

The clamps are also asymmetric — penalties clamp at `Math.max(0, …)`, the bonus clamps at
`Math.min(100, …)` and is applied *after*. An operation floored at 0 by penalties can be lifted back
to 50 by a single preference bonus, erasing the penalty entirely.

**Impact**
Multi-employee operations (exactly the swaps and batch assignments this resolver exists to
arbitrate) are scored on a different scale from single-employee ones, so the greedy ordering
systematically favours smaller operations. Order-dependence makes the score non-reproducible under
reordering of `schedule_changes`.

**Recommendation**
Aggregate first, apply once: compute `maxDebt`/`maxDeniedPrefs` across all changes, derive a single
adjustment, then clamp once at the end. Or divide by `schedule_changes.length` for a mean. Whichever
— it must be documented, and the clamp applied exactly once after all terms.

---

### F-18 — `initial_fatigue_score` silently reads 0 for future-dated rosters

**Severity:** Medium

**Location**
- `src/modules/scheduling/auto-scheduler.controller.ts:801-807`
- `src/modules/scheduling/data/roster-fetcher.ts:100-103`

**Explanation**
`fetchExistingRoster` fetches `[firstShiftDate − 28, lastShiftDate + 1]`. Initial fatigue is then
computed with `referenceDate = today`:

```ts
initial_fatigue_score: Math.min(MAX_INITIAL_FATIGUE_SCORE,
    calculateFatigueWithRecovery(existingRoster.get(e.id) ?? [],
        formatInTimezone(new Date(), SYDNEY_TZ, 'yyyy-MM-dd')).current)
```

`calculateFatigueWithRecovery` filters to `[referenceDate − 7d, referenceDate + 1d]`. If the roster
window starts more than 28 days out, the fetched context does not overlap the last 7 days at all and
the score is silently 0 for everyone.

**Impact**
Fatigue carry-in is applied to near-term rosters and silently skipped for forward-planned ones, with
no warning. Two runs over the same shifts, scheduled at different lead times, produce different
rosters for reasons no user can see. Combined with F-07's saturation, the difference is not marginal.

**Recommendation**
Fetch the fatigue-context window explicitly (`[today − 7, today]`) rather than relying on incidental
overlap with the compliance lookback, and make the semantics deliberate: prior fatigue relative to
*today* is only meaningful for a horizon starting within the recovery period. For horizons beyond it,
pass 0 explicitly and record that in the run metadata.

---

### F-19 — `O(E·S²)` scan in SC-11

**Severity:** Medium

**Location** `optimizer-service/model_builder.py:2189`

```python
for emp in self.data.employees:
    for s_id in undesirable_shift_ids:
        s = next(x for x in self.data.shifts if x.id == s_id)     # O(S) inside O(E·S)
```

**Explanation**
The same file, ~250 lines earlier, documents this exact anti-pattern as already fixed:

> *"Pre-build dict lookups so we don't do `next(e for e in ...)` for every (employee, shift) pair —
> that pattern is `O(E·S·(E+S))` which blows up at scale (~6M comparisons for 64k vars / 100
> employees)."*

`shift_by_id` is already built at line ~1913 and is in scope.

**Impact**
At the documented 2000-shift / 100-employee ceiling with, say, 400 undesirable shifts, this is 80M
attribute comparisons during model construction — time taken directly from the solve budget, which
the codebase already identifies as the constraint that starves the fairness and cost tiers. The
fairness feature degrades its own solve quality.

**Recommendation**
`s = shift_by_id[s_id]`. Also hoist the `is_weekend` weekday derivation out of the employee loop — it
depends only on the shift, so it is currently recomputed (with a `datetime.strptime` and a bare
`except:`) once per employee per shift.

---

### F-20 — Ledger writes have no concurrency control; rows grow unbounded

**Severity:** Medium

**Location**
- `src/modules/rosters/services/fairnessLedger.service.ts:177-262` (read-modify-write)
- `src/modules/rosters/api/fairnessLedger.queries.ts:94-109` (`upsertBatch`)

**Explanation**
`updateAfterCommit` performs `getAllForWindow` → mutate in memory → `upsertBatch` with no version
column, no `SELECT … FOR UPDATE`, and no transaction. Two concurrent commits — two managers, or the
auto-scheduler racing the AutoPilot worker — both read the same baseline and the second write wins,
losing the first's delta entirely.

This is the same lost-update class the project already solved for shifts via `sm_apply_shift_op`'s
version-CAS, but the ledger does not use that gateway.

Separately, `window_end` is part of the unique index and advances daily, so rows accumulate forever:
`employees × 6 metrics × days`. At 200 employees that is ~438k rows/year with no retention policy —
`deleteForWindow` only ever clears the current day.

**Impact**
- Silent, unattributable fairness drift under concurrency — the ledger is a monotonic accumulator, so
  a lost update is never self-correcting.
- Unbounded growth is what makes F-08 progressively worse and will eventually degrade the
  `idx_fairness_ledger_lookup` index.

**Recommendation**
Move the read-modify-write into a `SECURITY DEFINER` RPC that does the aggregation server-side in one
transaction (`INSERT … ON CONFLICT DO UPDATE SET rolling_value = fairness_ledger.rolling_value + EXCLUDED.delta`),
following the `sm_apply_shift_op` precedent. Add a retention job dropping windows older than ~2×
`DEFAULT_WINDOW_DAYS`.

---

### F-21 — Hardcoded 2026-only public-holiday set diverging from the shared helper

**Severity:** Medium

**Location** `src/modules/rosters/domain/fairness-ledger.ts:84-96`

**Explanation**
```ts
// In production this would come from a Supabase lookup. For now, a small static set…
const AU_PUBLIC_HOLIDAYS_2026: ReadonlySet<string> = new Set(['2026-01-01', …]);
```

The repo already has `src/modules/core/lib/holidays.ts` and `anz-holidays.ts`, which the v8
compliance adapters use (`isPublicHoliday(parseLocalDateStr(dateStr))`). The ledger ignores them.

**Impact**
- **The set expires on 2027-01-01.** From that date `isPublicHoliday` returns false for every date,
  the `public_holiday_shifts` metric silently reads 0 forever, and nothing errors.
- Today it disagrees with the compliance engine, so a shift can be a public holiday for compliance
  and pay purposes but not for fairness purposes.
- NSW-only, while the schema is multi-org and `organization` has no timezone/jurisdiction column.

**Recommendation**
Delete the literal and inject `isPublicHoliday` from `core/lib/holidays.ts` as the default argument
to `classifyShift`. Longer term this belongs in a `public_holidays` table keyed by jurisdiction, which
also unblocks multi-state orgs.

---

### F-22 — `computePeakFatigue` history omitted at 2 of 3 call sites

**Severity:** Low

**Location**
- `src/modules/rosters/domain/projections/projectors/people.projector.ts:250` — no history
- `src/modules/rosters/domain/projections/worker/projection.worker.pool.ts:172` — no history
- `src/modules/rosters/hooks/useRosterProjections.ts:298` — history passed ✓

**Explanation**
The function's own docstring explains why history is required — *"it makes each visible day's 7-day
trailing window complete regardless of the view zoom (Day/3D would otherwise be starved of
prior-week shifts and under-count fatigue)"* — yet two of three callers omit it.

In practice the hook re-refines the worker's output, so the rendered value is usually correct. But
the refinement is guarded by `if (!fatigueHistory || fatigueHistory.size === 0) return workerPeople;`
— so if the history query is slow, empty, or fails, the UI silently keeps the zoom-dependent value.

**Impact**
A transient window in which the FTG badge under-reports in Day/3D views, and a permanent one if
history loading fails. The `people.projector` path (non-worker) has no refinement at all.

**Recommendation**
Make `history` a required parameter so omission is a compile error, and thread it through the worker
protocol rather than patching after the fact.

---

### F-23 — Three unrelated fatigue threshold systems

**Severity:** Low

**Location**
- `fatigue.ts:17` — `FATIGUE_BANDS = { OK_MAX: 20, RISK_MAX: 35 }` (UI bands)
- `auto-scheduler.controller.ts:373` — `health.projected > 15` (greedy penalty knee)
- `model_builder.py:2049-2057` — 1200 / 1800 effective minutes (solver bands)

**Explanation**
Three sets of thresholds on two different scales, none derived from the others. The greedy fallback's
knee at 15 sits *below* the UI's "ok" ceiling of 20 — so the fallback starts penalising employees the
UI still shows as green.

The `FATIGUE_BANDS` comment is candid that the numbers are *"a HEURISTIC recalibration (pending
validation), not a regulatory threshold"*.

**Impact**
A manager sees a green FTG badge for an employee the fallback engine is actively avoiding, with no
way to reconcile the two. Any future recalibration must touch three places in two languages.

**Recommendation**
Derive all thresholds from one exported constant set, and express the solver's bands in the same
units once F-07's conversion is fixed. Then run the validation the comment defers: sample real
rosters, and calibrate the bands against actual incident/absence data rather than intuition.

---

### F-24 — `fairness_ledger` RLS is gamma+ only

**Severity:** Low

**Location** `supabase/migrations/20251015000000_baseline_schema.sql:26406-26418`

**Explanation**
The policy restricts both `USING` and `WITH CHECK` to users holding an active `gamma`/`delta`/
`epsilon`/`zeta` certificate. Employees cannot read even their own row. All current callers are
manager surfaces or `service_role`, so nothing is broken today — but every read path degrades to
"empty ledger" rather than "permission denied", which is indistinguishable from F-04's normal
emptiness.

**Recommendation**
Add a self-read policy (`employee_id = auth.uid()`) before building any employee-facing fairness
transparency, and make the client distinguish *empty* from *forbidden* so degraded mode is visible.

---

### F-25 — Reserve List documents fatigue screening that does not exist

**Severity:** Low

**Location** `src/modules/reserve-list/api/reserveList.api.ts:16, 60, 145`

**Explanation**
The module documents its eligibility search as running *"the same engine (fatigue, EBA, visa, leave,
overlap, qualifications)"* and returning *"ONLY employees who pass compliance/fatigue/EBA/visa"*.

A grep for `fatigue` across `src/modules/compliance/v8/` returns **no matches**. The v8 engine has no
fatigue rule. Fatigue lives only in `rosters/domain/projections/utils/fatigue.ts` (display + solver
input) and in the Python SC-7 objective — neither of which the Reserve List invokes.

**Impact**
Documentation asserts a safety control that is not implemented. Anyone auditing fatigue coverage from
the comments will conclude the Reserve List is protected when it is not — the more dangerous
direction of error.

**Recommendation**
Correct the comments now, and separately decide whether emergency reserve-list assignment *should*
carry a fatigue gate. Given it is the path used for urgent same-day fills — the highest-fatigue-risk
assignments in the system — it probably should.

---

## 4. Dependency Map

```
                        ┌──────────────────────────────────┐
                        │  shifts / shift_bids  (Postgres) │
                        └───────────────┬──────────────────┘
                                        │ fetchAssignedShifts / fetchDeniedPreferences
                                        ▼
   ┌─────────────────────── fairnessLedger.service.ts ────────────────────────┐
   │  recomputeLedger()            updateAfterCommit()        getEmployeeDebts()│
   │   ▲ trailing [today-90,today]  ▲ delta, windowWeeks=0      ▲ window_end=today
   └───┼───────────────────────────┼──────────────────────────┼───────────────┘
       │ F-04: only trigger        │ F-02 / F-06              │ F-04 fails open
       │                           │                          │
  usePublishRoster            autoScheduler.commit()          │
  (client, fire-and-forget)   (client, fire-and-forget)       │
                                        │                     │
                        ┌───────────────┴─────────────────────┴────────────┐
                        │              fairness_ledger  (table)             │
                        │   PK (org, employee, metric, window_end)  F-20    │
                        └────┬──────────────────┬──────────────────┬───────┘
                             │                  │                  │
              getEmployeeDebts│      getAllForWindow│    raw select (NO window_end) F-08
                             │                  │                  │
                             ▼                  ▼                  ▼
                     debtsToMap()        OpenBidsView       auto-assign-bids
                             │           preview F-14        edge fn (F3 order)
        ┌────────────────────┴────────────────────┐
        ▼                                         ▼
  OptimizerEmployee.fairness_debts          greedyFallback()
        │                                    coeff 50/50/20  F-13
        ▼                                    dup bonus       F-10
  ═══ optimizer-service/model_builder.py ═══  own classifiers F-11
   SC-10  undesirable_balance ──┐
   SC-11  longitudinal_fairness ┤── gated on undesirable_shift_ids
   SC-11b hours_fairness        │   = {is_sunday | is_public_holiday | _is_night}
   B2     peak-load min-max     │        ▲
                                │        └── F-01: first two flags NEVER SET
                                └── coeff 300/300/500  F-13, O(E·S²) F-19

  ── FATIGUE (separate lineage, meets fairness only inside the solver) ──

   shifts ──▶ calculateFatigueAccumulation()   (circadian, −76·ln curve)
                        │
                        ▼
              calculateFatigueWithRecovery()   ── F-03: no terminal decay
                        │
        ┌───────────────┼────────────────────────┬──────────────────┐
        ▼               ▼                        ▼                  ▼
  computePeakFatigue  initial_fatigue_score   OpenBidsView    AutoSchedulerPanel
   (F-22 history)      (F-18 reads 0)          preview           display
        │                    │
        ▼                    ▼  × 60  ── F-07 miscalibrated ~2.2×
  PeopleModeGrid       model_builder.py SC-7
  getFatigueBand         amber 1200 / crit 1800
   20 / 35  F-23          (no recovery model)

  ── ORPHANED (zero reachable callers) ──
   compliance/v8/orchestrator/bidding/scorer.ts        scoreAllBids       F-12
   compliance/v8/orchestrator/conflict-resolver/
        scorer.ts lines 169-202 (F1 + F3 blocks)                          F-09
   rosters/domain/fairness-ledger.ts debtToObjectiveCoeff                 F-13
```

---

## 5. Current Architecture

**Fairness** is a five-headed concept with no owner. The nominal core is a *ledger*: a rolling
91-day, per-employee, per-metric accumulator (`weekend_shifts`, `night_shifts`,
`public_holiday_shifts`, `overtime_minutes`, `total_hours`, `denied_preferences`) with debt defined as
deviation from the team mean. The domain layer (`fairness-ledger.ts`) is genuinely good: pure,
deterministic, well-tested, dependency-free.

Everything around it is not. The service layer mixes orchestration with a hardcoded contract stub;
the write path is triggered from two React mutation callbacks as fire-and-forget side effects; there
is no server-side scheduler, no transaction boundary, and no observability. Consumers each
reimplement the debt→penalty conversion in their own units. The Python solver holds its own copy of
the coefficients and its own shift classifiers, connected to TS by a wire contract that omits two
fields the solver depends on.

**Fatigue** is a second, unrelated lineage. A per-shift circadian model feeds a saturating log curve
and a linear rest-recovery accumulator over a 7-day trailing window. This produces one number used
for three purposes at three scales: a UI band (20/35), a greedy penalty knee (15), and — after
multiplication by an uncalibrated constant — the solver's per-ISO-week effective-minute budget
(1200/1800). The two fatigue models share only their circadian weights; their integration, decay
semantics, and thresholds are all independent.

The two systems meet in exactly one place: the `OptimizerEmployee` payload, where
`fairness_debts` and `initial_fatigue_score` sit side by side as opaque numbers.

**Layering violations observed:**
- Business logic in React mutation callbacks (`useRosterMutations.ts:343-358` decides ledger refresh
  cadence — a policy decision living in a UI success handler).
- Business logic in a UI view (`OpenBidsView/index.tsx:371-404` implements a *second* ledger
  aggregation path with a different scope from the service).
- Domain constants duplicated into the solver (`model_builder.py` literals).
- Persistence concerns in the domain (`window_end = today` keying leaks a storage decision into every
  read).
- A stubbed data dependency (`fetchContractedHours`) inside the service rather than injected.

---

## 6. Proposed Architecture

```
┌── POLICY (pure, versioned, no I/O) ─────────────────────────────────────────┐
│  fairness-policy/                                                           │
│    metrics.ts        metric definitions + shift classifiers (SINGLE source) │
│    coefficients.ts   debt → penalty, ONE table, exported to Python at build │
│    thresholds.ts     fatigue bands, knees, solver bands — one scale         │
│    fatigue-model.ts  accumulation + decay + effective-minutes conversion    │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ imported by every consumer; no one restates it
┌── DOMAIN (pure) ─────────────┴──────────────────────────────────────────────┐
│  computeDebts · aggregateEntries · projectImpact · classifyShift            │
│  (today's fairness-ledger.ts, minus the holiday literal and 38h defaults)   │
└──────────────────────────────┬──────────────────────────────────────────────┘
┌── PERSISTENCE (server-owned, transactional) ───────────────────────────────┐
│  RPC  fairness_ledger_recompute(org, scope, window_end)   SECURITY DEFINER │
│  RPC  fairness_ledger_apply_delta(...)  INSERT…ON CONFLICT DO UPDATE (CAS) │
│  RPC  fairness_ledger_latest(org, emps) → most recent window per (e,m)     │
│  pg_cron  nightly_fairness_recompute  02:00 Australia/Sydney               │
│  retention job: drop windows older than 2 × DEFAULT_WINDOW_DAYS            │
└──────────────────────────────┬─────────────────────────────────────────────┘
┌── CONSUMERS (read-only; never restate policy) ─────────────────────────────┐
│  auto-scheduler ──▶ sends PRE-CONVERTED coefficients + effective-minutes    │
│  greedy fallback ─▶ same coefficients via debtToObjectiveCoeff              │
│  conflict resolver ▶ same coefficients (wired, non-zero default)            │
│  bid ordering (client + edge) ▶ ONE shared latestDebts() query              │
│  UI previews ────▶ read-only; never compute a second aggregation            │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key moves**
1. **Ownership inversion.** Persistence and scheduling move server-side. The client reads debts; it
   never decides when to recompute and never writes.
2. **The wire carries penalties, not raw debts.** TS converts once via the policy module; Python
   holds zero fairness constants. This structurally eliminates F-13 and half of F-11.
3. **`is_sunday` / `is_public_holiday` / `is_saturday` derived in `ShiftInput.__post_init__`.** The
   solver becomes self-sufficient; no client can silently disable award pricing again (F-01).
4. **One fatigue quantity.** TS computes *effective minutes* — the unit the solver already uses — and
   ships that. The `× 60` bridge disappears (F-07).
5. **Explicit degradation.** `getEmployeeDebts` returns `{ debts, available, reason }`. Every
   consumer surfaces it. Adopt the existing `f3Degraded` pattern universally (F-04).
6. **Scope as data.** Add `scope_id` to `fairness_ledger`; department vs org becomes a stored
   dimension rather than an accidental argument (F-14).

---

## 7. Duplicated Logic → Consolidation Targets

| Duplicated concept | Locations | Target |
|---|---|---|
| Night-shift classification | `fairness-ledger.ts:150`, `auto-scheduler.controller.ts:327`, `model_builder.py:2104` | `policy/metrics.ts` + derived server-side |
| Weekend classification | `fairness-ledger.ts:141`, `auto-scheduler.controller.ts:322`, `model_builder.py:2190-2195` | same |
| Public-holiday set | `fairness-ledger.ts:84`, `core/lib/holidays.ts`, `anz-holidays.ts` | `core/lib/holidays.ts`, injected |
| Debt→penalty coefficients | `fairness-ledger.ts:387`, `model_builder.py:2198/2241`, `auto-scheduler.controller.ts:383` | `policy/coefficients.ts`, generated to Python |
| `_strategy_mult` | `fairness-ledger.ts:412`, `auto-scheduler.controller.ts:367`, `model_builder.py` | `policy/coefficients.ts` |
| Circadian interval table | `fatigue.ts:102-104`, `model_builder.py:566-574` | `policy/fatigue-model.ts`, generated |
| 38h contract default | `fairnessLedger.service.ts:30`, `fairness-ledger.ts:237`, `fairness-ledger.ts:343` | injected contract resolver |
| Ledger aggregation | `fairnessLedger.service.ts:103-138`, `OpenBidsView/index.tsx:385-396` | domain only; UI reads |
| Ledger debt read | `fairnessLedger.queries.ts:46`, `auto-assign-bids/index.ts:838` | one shared `latestDebts()` |
| Compliance→score mapping | `bidding/scorer.ts:44`, `conflict-resolver/scorer.ts:99` | shared helper |
| Fatigue thresholds | `fatigue.ts:17`, `auto-scheduler.controller.ts:373`, `model_builder.py:2062` | `policy/thresholds.ts` |

---

## 8. Business Rules That Should Be Centralised

1. What makes a shift "undesirable" (weekend / night / PH) — and whether Saturday counts.
2. The rolling window length and whether it is trailing, centred, or forward-looking.
3. Whether the ledger measures **worked** or **rostered** load.
4. The fairness peer group: org, department, sub-department, or role.
5. Whether employees with zero shifts are in the average denominator (F-05).
6. Debt→penalty coefficients and their relative ordering against labour cost.
7. The contracted-hours baseline per employment type, including casuals.
8. Fatigue decay semantics and the recovery rate (currently an undocumented 1 unit/hour).
9. Fatigue band edges and their relationship to the solver's effective-minute budget.
10. Precedence when fairness and fatigue disagree (today: implicit, decided by relative magnitudes).
11. What "denied preference" means — losing a bid, or an explicit manager rejection, or both.
12. Retention: how long ledger history is kept and whether debts ever reset.

---

## 9. Missing Tests

**Critical (would have caught the top findings)**
1. End-to-end wire contract: a Sunday shift produces `is_sunday: true` in the optimizer payload; a
   public holiday produces `is_public_holiday: true`. *(F-01)*
2. `updateAfterCommit(shift)` and `recomputeLedger(historyPlusShift)` converge on identical
   `rolling_value` for every metric. *(F-02, F-06)*
3. Fatigue decays monotonically with elapsed rest: `f(shift ended 6d ago) < f(shift ended 1h ago)`.
   *(F-03)*
4. `getEmployeeDebts` on a day with no recompute returns an explicit unavailable signal, not silent
   zeros. *(F-04)*
5. Zero-shift employee receives a strictly larger assignment bonus than a one-shift employee. *(F-05)*
6. Solver: `assert 'public_holiday_shifts' penalty fires` for a PH shift with PH debt. *(F-01)*

**Cross-engine consistency**
7. Shared fixture table of ~20 shifts asserted identically in vitest and pytest for
   `(isWeekend, isNight, isPH)`. *(F-11)*
8. Greedy fallback and CP-SAT rank the same two candidates identically for a given debt vector.
   *(F-10, F-13)*
9. Marginal solver penalty per effective minute stays within the labour-cost scale across the full
   `initial_fatigue_score` range. *(F-07)*

**Edge cases (none currently covered)**
10. Empty roster / single employee / all employees identical → no division by zero, no `NaN` debts.
11. All employees above the fatigue critical band → solver still returns a feasible roster.
12. Employee with partial history (< 91 days tenure) → not penalised for the absence.
13. Duplicate ledger rows for one `(employee, metric)` → deterministic resolution. *(F-08)*
14. Concurrent `updateAfterCommit` calls → no lost delta. *(F-20)*
15. Shift cancelled after ledger write-back → debt is decremented (currently: never). *(F-06)*
16. DST boundary: a shift on the Sydney DST transition classifies and durations correctly.
17. Year rollover past 2026-12-31 → public-holiday classification still works. *(F-21)*
18. Browser in `America/New_York` classifies Saturday shifts as weekend. *(F-11)*
19. 2000-shift × 100-employee model build stays within the solve budget. *(F-19)*

---

## 10. Open Questions for Stakeholders

> **STATUS 2026-08-05 — ALL NINE CLOSED.** Decided under delegation and recorded in
> [2026-08-05_fairness-stakeholder-decisions.md](2026-08-05_fairness-stakeholder-decisions.md),
> which gives the reasoning, the alternatives rejected, and how to overturn each one.
> Q5, Q6, Q8 and Q9 are **implemented** (they were schema-shaped, and the migrations were
> still unapplied — the cheapest moment to change the metric set). Q1, Q3, Q4 and Q7 are
> sequenced into the remediation plan; Q2 confirms current behaviour and needs no change.
>
> The questions are left below as originally written, since the decision record answers
> them point by point.

1. **Is fairness meant to be binding or advisory?** Today it is a soft objective term that any cost
   difference can override, but F-07 makes fatigue an accidental hard constraint. The intended
   strength of each should be a stated policy, not an emergent property of coefficient sizing.
2. **Worked or rostered?** Should an employee who is *rostered* three Sundays next month already be
   "in debt", or only once worked? This determines the entire windowing design (F-06).
3. **What is the peer group?** Employees compare themselves to their immediate team, but the ledger
   averages org-wide. Cross-department averaging can make a whole department look "owed".
4. **Do debts ever reset or age out?** A 91-day rolling window implies natural decay, but nothing
   handles tenure changes, extended leave, or role transfers. Should leave suppress debt accrual?
5. **Is `denied_preferences` fair to count?** It rewards bidding volume — an employee who bids on
   everything accrues denials fastest. This may be the intended equity mechanism or an exploitable
   one; it should be a deliberate choice.
6. **Should Saturday count as "undesirable"?** The domain layer says yes, the solver's gate says no
   (F-01). The EBA prices Saturday at ×1.25 vs Sunday ×1.5, suggesting partial weighting rather than
   a binary.
7. **Should fatigue gate emergency assignment?** Reserve List currently documents a fatigue check it
   does not perform (F-25), on the highest-risk assignment path in the system.
8. **What is the fatigue recovery rate?** "1 hour of rest removes 1 unit" is an undocumented constant
   with no cited basis, and it drives who is considered available.
9. **Is fairness auditable to employees?** If a roster decision is challenged, the current system
   cannot reproduce the debts that produced it — window keying, silent emptiness (F-04) and lost
   updates (F-20) all destroy reproducibility. This is likely an industrial-relations requirement,
   not just an engineering one.

---

## Appendix — Verification Method

Findings F-02 and F-03 were confirmed by executing the production functions directly under the repo's
vitest config, not by inspection:

```
A. incremental OT (fairnessLedger.service.updateAfterCommit's exact arguments)
   INCREMENTAL delta values : {…,"overtime_minutes":480,"total_hours":8,…}
   FULL recompute values    : {…,"overtime_minutes":0,  "total_hours":8,…}

B. fatigue decay (calculateFatigueWithRecovery, identical 8h night shift)
   finished TODAY 08:00      -> {"current":26,"projected":26}
   finished 6 DAYS ago 08:00 -> {"current":26,"projected":26}
```

F-01, F-09 and F-12 were confirmed by exhaustive repo-wide grep for producers and callers.
The remainder were established by direct code reading with cross-referencing; each cites the
file and line ranges supporting it.

---

## Appendix B — Remediation log (2026-08-04)

All 25 findings addressed in one pass. Grouped by the change that closed them.

### Deletions (the strongest fixes)
- **F-02 / F-06 / F-20** — the client-side incremental ledger write is **gone**.
  `updateAfterCommit` now just re-runs the authoritative recompute. Phantom
  overtime, the future-shift/trailing-window mismatch, and the lost-update race
  were three symptoms of one thing: a read-modify-write in the browser. Removing
  it makes all three structurally impossible rather than merely fixed, and
  settles the semantics — the ledger measures **worked** load, so a shift counts
  when its date arrives, not when it is assigned.
- **F-19** — the `O(E·S²)` `next(...)` scan and its bare `except:` deleted in
  favour of the `shift_by_id` dict already in scope.

### One classifier, one coefficient table
- **F-11 / F-13 / F-10** — the greedy fallback's private classifiers and 50/50/20
  coefficients are replaced by `classifyShift` and a new shared scoring kernel,
  `shiftFairnessPenaltyCents`, so it and CP-SAT rank candidates identically. The
  duplicated weekend-bonus line (with its `// No, wait.` comment) is gone.
  `debtToObjectiveCoeff` and `strategyMult` now have real callers.
- **F-21** — `classifyShift` reads the shared `date-holidays` AU-NSW calendar.
  The 2026-only literal that would have silently zeroed the PH metric on
  2027-01-01 is deleted.

### Fatigue
- **F-03** — rest now decays from the last shift to the reference instant.
  `current` and `peak` are separated: `current` is "as of now" (decayed), `peak`
  is "worst point in the window" (what the FTG badge wants). They were the same
  number, which is why a shift from six days ago read as freshly-worked.
- **F-07 / F-18** — the `× 60` guess is replaced by `initial_effective_minutes`,
  measured with `effectiveMinutes()` in the solver's own unit and anchored to the
  **horizon's** ISO week rather than to "today". No conversion constant remains.
- **F-23** — the greedy knee is `FATIGUE_BANDS.OK_MAX`, so the fallback stops
  penalising people the UI still shows green. `RECOVERY_UNITS_PER_HOUR` and the
  circadian interval table are named and exported instead of inlined.
- **F-22** — `computePeakFatigue`'s `history` is required; both omitting call
  sites now pass `[]` explicitly with a note on why.

### Ledger correctness
- **F-05 / F-15** — `recompute_fairness_ledger` drives off every active-contract
  employee (zero-filled), so a zero-shift employee is in the average denominator
  AND visible to the solver. Verified: zero-shift debt −10.67 vs one-shift −2.67,
  i.e. monotonic. Overtime is measured against
  `hr.user_contracts.contracted_weekly_hours`, not a flat 38.
- **F-14** — the bid preview's fallback is org-wide, matching the solver.
- **F-24** — `fairness_ledger_self_read` lets an employee read their own row.

### v8 orchestrators
- **F-09** — `fairness_debts` is threaded through `base_state` into
  `scoreOperations`; the F1 and F3 blocks can now execute.
- **F-16** — the load penalty measures `ratio - 1` (excess over ceiling), not
  total load, and no longer flatlines above 100%.
- **F-17** — all fairness terms aggregate across `schedule_changes` and apply
  **once**, inside a single clamp, so multi-employee operations are on the same
  scale as single-employee ones and the bonus can't resurrect a floored score.
- **F-12** — bidding's `fairness_weight` is documented and aliased as
  `bid_volume_equity_weight`: it measures how often you *asked*, the ledger
  measures what you *received*, and they can point opposite ways.
- **F-25** — the Reserve List no longer documents a fatigue check that does not
  exist; whether it *should* have one is flagged as an open question.

### Migrations (validated by execution, NOT applied to prod)
| File | Purpose |
|---|---|
| `20260804020000_..._latest_window_read.sql` | `get_fairness_debts_latest` (F-04, F-08) |
| `20260804030000_public_holidays_table.sql` | shared calendar + coverage guard (F-21) |
| `20260804040000_..._scheduled_recompute.sql` | authoritative recompute + pg_cron (F-04) |
| `20260804050000_..._cohort_and_contracts.sql` | full cohort + real contracts (F-05, F-15) |
| `20260804060000_..._self_read.sql` | employee self-read policy (F-24) |

Each was applied to a throwaway PostgreSQL 15 with a schema fixture. SQL↔TS
classification parity is pinned from both sides
(`supabase/tests/fairness_ledger_parity.sql` + `fairnessLedger.sqlParity.test.ts`)
and the SQL harness was confirmed to fail when an expected value is perturbed.

### Still open (deliberately)
Only §10 "Open Questions for Stakeholders" — those are policy decisions for the
business, not code. Everything else in this document is closed.

---

## Appendix C — Follow-through (2026-08-05)

Three items were left open at the end of Appendix B. All are now closed.

### C-1. The restored type gate's backlog — 29 → 0

`npm run type-check` pointed at the root `tsconfig.json`, which has `"files": []`
and only project references, so it compiled nothing. Repointing it at
`tsconfig.app.json` surfaced 29 real errors. Fixing them turned up **four latent
runtime bugs** that the vacuous gate had been hiding:

| Bug | Effect |
|---|---|
| `shift.employees` in 3 my-roster components | The relation is `assigned_profiles`; no query has ever returned `employees`. The branch always fell through to the `user` fallback, so a manager viewing someone else's shift saw **their own name**. |
| `toSwapEngineContractType` omitted `FLEXI_PART_TIME` | Flexi part-timers hit `default: return null` and reached the swap evaluator with **no contract type**, silently skipping every contract-specific rule for the cohort with the most variable hours. |
| `compliance.service` local fallback read `hv.violations` / `hv.warnings` | `HardValidationResult` has `passed` + `errors`. Both fields were `undefined`, so any consumer calling `.length` / `.map()` crashed — on the **offline** path, i.e. when the edge function was already unreachable. Now maps `errors` → `violations`. |
| `ShiftCard` imported `utils/cost` | Resolves to `cost.ts` (legacy positional args), not `cost/index.ts` (object form) — the call could never have worked. |

The rest were genuine type-narrowing gaps: `adjusted_*_source` omitted the real
`'auto'` value; `ReserveListCandidate.complianceStatus` couldn't narrow through a
guard; `preferences` needed a `Json` cast; `getEmployeeAvailabilityForDate` takes
a `Date` and was handed a string; two test files had an undeclared property and
an unchecked optional.

**`npm run verify` (type-check + test + build) now passes end to end.**

### C-2. `fairness_ledger` retention — `20260805010000`

`prune_fairness_ledger(p_retain_days = 182)`, scheduled weekly (Sun 17:00 UTC ≈
Mon 03:00 AEST), an hour clear of the nightly recompute. 182 days is 2 ×
`DEFAULT_WINDOW_DAYS`, so any as-of date inside the reporting window plus a full
window of slack still resolves.

The **newest generation per (org, employee, metric) is never pruned**, however
old. Without that, an org that stopped recomputing would have its ledger deleted
out from under the reads — converting a stale-but-usable answer back into
"unavailable", which is the exact failure F-04 existed to remove.

Verified: 27 rows → 21 deleted → 6 remain and reads still resolve; and with
*only* ancient generations present (400d + 300d), the 300d row survives and the
read still returns it.

### C-3. `organizations.jurisdiction` — `20260805020000`

`public_holidays` was keyed by `(holiday_date, jurisdiction)` specifically to
support more than one calendar, but nothing ever set a jurisdiction — every
caller took the `'AU-NSW'` default. Multi-jurisdiction in shape,
single-jurisdiction in practice.

- `organizations.jurisdiction text NOT NULL DEFAULT 'AU-NSW'`.
- `recompute_fairness_ledger`'s `p_jurisdiction` now defaults to `NULL` meaning
  "resolve from the organization"; an explicit value still overrides (tests,
  backfills). An unknown org returns 0 rather than inventing a jurisdiction and
  classifying every public holiday as an ordinary day.
- `CHECK (jurisdiction_is_known(jurisdiction))` so a typo can't silently produce
  an org with no holidays at all.

No behaviour changes today — every row is AU-NSW. What changes is that adding a
second jurisdiction becomes a data change rather than a code change.

Verified: the default backfills; a public holiday is detected through the org's
jurisdiction with **no** explicit argument; and `UPDATE ... SET jurisdiction =
'AU-XYZ'` is rejected by the constraint.

**Still single-jurisdiction per org.** An organisation operating across state
lines would need per-department or per-venue jurisdiction — not modelled, and
not needed until a second venue exists.

### Migration set (7 files, validated, NOT applied to prod)

All seven apply cleanly in order against a throwaway PostgreSQL 15, and the
SQL↔TS parity harness passes after the full sequence.

| File | Purpose |
|---|---|
| `20260804020000` | `get_fairness_debts_latest` (F-04, F-08) |
| `20260804030000` | `public_holidays` + coverage guard (F-21) |
| `20260804040000` | authoritative recompute + pg_cron (F-04) |
| `20260804050000` | full cohort + real contracts (F-05, F-15) |
| `20260804060000` | employee self-read policy (F-24) |
| `20260805010000` | retention + weekly prune (F-20 growth) |
| `20260805020000` | `organizations.jurisdiction` (F-21 remainder) |
