# The Pay Cost Engine

**Status:** SQL port applied to prod 2026-08-07 · gates green (type-check, 1860 vitest, build)
**Scope:** every figure in the app that says what a shift or a roster costs

---

## 1. Why there are two engines

There is **one set of award rules** and **two implementations of them**:

| | Where | Answers |
|---|---|---|
| **TypeScript** | `rosters/domain/projections/utils/cost/standard.ts` | What does **this shift** cost? (every card, tooltip, timesheet row) |
| **SQL** | `public.fn_eba_estimate_shift_cost` | What does **this whole view** cost? (planner footer, insights, coverage) |

This duplication is deliberate and load-bearing. The Roster Planner's default
Bucket View **fetches no raw shifts at all** — that is the whole point of the
millions-of-shifts design; the grid renders from `get_roster_summary` aggregates.
A client-side total is therefore impossible in the view where the total matters
most. The alternative — shipping every shift to the browser just to sum it —
is the design this codebase explicitly rejected.

The TypeScript engine remains **authoritative**. The SQL port exists to aggregate,
and is held to it by a differential test (§4).

---

## 2. Rate resolution

```
shift.actual_hourly_rate            explicit override wins
  ↓ else
shift.remuneration_rate             explicit override wins
  ↓ else
public.eba_rate                     effective-dated, by (classification, basis)
```

`public.fn_eba_resolve_shift_rate` is the only implementation of this chain.

**`eba_rate.paid_hourly_rate` already includes the 25% casual loading.** The engine
de-loads it internally (`base / 1.25`) exactly as `standard.ts` does. Reading
`eba_rate.ordinary_hourly_rate` instead looks equivalent but is not: `34.64 / 1.25
= 27.712` versus a stored `27.71`, which drifts cents across a shift.

### Do not use `hr.remuneration_levels` for pay

It holds the **permanent, unloaded** rate and it is **stale** — Level 2 reads
`26.37` where the current EBA rate is `27.71`. Pricing a casual off it under-reads
by both the loading and the CPI step. Every cost RPC that used to read it has been
repointed; nothing should read it for money again.

---

## 3. What the SQL port applies

| Clause | Rule |
|---|---|
| cl 41 | Saturday +25%, Sunday +50%, public holiday +150%, over the de-loaded ordinary rate |
| cl 41.4 | Loadings are **not** cumulative — the night allowance pays only its *excess* over the day's weekend/PH loading |
| cl 42 | Daily overtime (past rostered hours for FT/PT, past the 12h cap for everyone), tiered 1.5× for the first 3h then 2.0×, with a **2.5× floor** on public-holiday hours |
| cl 43 | Night allowance across 22:00–06:00, keyed off the day the shift **concludes**, casual rates de-loaded so the 25% is never paid twice |
| cl 28.1 | Meal allowance — **automatic** on 2h+ past the rostered finish |
| cl 12 / 56.2 | Minimum paid engagement: 3h, 4h Sunday/PH, 2h training, none for full-time |
| — | Overnight **midnight split**, so each calendar day is priced on its own day-of-week and holiday status |

Public holidays come from `public_holidays` (`jurisdiction = 'AU-NSW'`, seeded
through 2032). This is the same source the compliance engine uses.

### Deliberately not ported

Each of these is a conscious omission, not an oversight:

- **Weekly (>38h) overtime** — needs a member's prior ordinary hours for the ISO
  week, and an *unassigned* shift has no member to accumulate against. The TS
  engine also defaults this off when `priorOrdinaryHoursThisWeek` is absent, so
  the two agree.
- **Opt-in allowances** (first-aid, protein-spill, split-shift; cl 28.2–28.4) —
  per-shift flags nothing sets today. The cl 28.1 meal allowance is *not* in this
  list; it triggers off overtime and is ported.
- **The Security engine** (Schedule 3) and the **trainee / apprentice / SWS**
  matrices (Schedules 4–6) — these re-derive the *base rate*, not the loadings.
- **Leave-flagged shifts** (cl 44.7 / NES) and **higher duties** (cl 29).

A shift hitting any of these is priced on its ordinary classification in
aggregates and may differ from its card. Nothing on the roster hits them today.

---

## 4. The parity contract

Two engines computing pay is a divergence risk, so it is pinned by test.

`rosters/domain/__tests__/cost/sql-port-parity.test.ts` holds **21 golden cases**
covering weekday / Saturday / Sunday / public holiday, night allowance (casual and
permanent, plus the cl 41.4 cap against a weekend penalty), 2h / 5h / 13h overtime,
public-holiday overtime, all five minimum-engagement branches, and two overnight
shifts crossing into a different day type.

Measured against the live SQL function on 2026-08-07: **19 of 21 exact, 2 within
$0.01, none worse.**

> **If that test fails, the SQL port must be updated before the change ships** —
> otherwise the footer and the cards silently disagree.

### The one-cent cases

Both are rounding, not rules. The TS engine rounds each cost **component** with
`Math.round()`, and IEEE-754 places `275.315 * 100` at `27531.499999999996`, so TS
rounds that component **down**. The SQL sums exact `numeric` and rounds once at the
end. **SQL is the arithmetically correct side**, and rounding once is also the right
choice for an aggregate — rounding per component then summing accumulates error
across hundreds of shifts. The bound is one cent per shift.

---

## 5. Cost surfaces

Every one of these now routes through `public.fn_eba_shift_cost(shifts)`:

| Surface | RPC | Filter |
|---|---|---|
| Planner footer — Scheduled | `get_roster_planner_stats.scheduled_cost` | all live shifts, **filled or not** |
| Planner footer — Actual | `get_roster_planner_stats.actual_cost` | only shifts with a worked window |
| Insights top-line KPI | `get_insights_summary` | assigned only |
| Insights cost breakdown | `get_dept_insights_breakdown` | assigned only |
| Insights trend | `get_insights_trend` | assigned only |
| Labour-cost drilldown | `get_metric_detailed_analysis` | assigned only |
| Coverage stats | `rpc_shift_coverage_stats` | all live shifts |

To check nothing has drifted back out:

```sql
select proname, prosrc like '%fn_eba_%' as uses_engine
from pg_proc
where proname in ('get_roster_planner_stats','get_dept_insights_breakdown',
                  'get_insights_trend','rpc_shift_coverage_stats',
                  'get_insights_summary','get_metric_detailed_analysis');
-- every row must be true
```

**Scheduled vs assigned-only is a real distinction, not an inconsistency.** The
planner footer answers *what will this plan cost* — an unfilled shift still has to
be paid for once someone fills it, so it counts. Insights answers *what did this
period cost* — an unfilled shift cost nothing, so it does not. Getting this
backwards is what produced the original bug: `est_cost` was assigned-only, so a
fully-planned 156-shift roster reported **$0.00**.

### Denominators are part of the number

Each footer panel shows what its total is *over* — "156 shifts", "none worked yet",
or an amber "N of 156 priced" when some shift fails to resolve a rate. A bare
`$0.00` cannot distinguish *nothing worked yet* from *nothing could be priced* from
*genuinely free*, and that ambiguity is exactly how the original $0.00 hid for so
long.

---

## 6. Bugs this replaced

All measured against prod, all now fixed:

| Where | Was | Effect |
|---|---|---|
| `get_roster_planner_stats.est_cost` | `FILTER (… assigned_employee_id IS NOT NULL)` | 156 planned shifts → **$0.00** |
| `get_insights_summary`, `get_dept_insights_breakdown`, `get_insights_trend`, `get_metric_detailed_analysis` | `COALESCE(remuneration_rate, 0)` | that column is NULL on every prod shift → **$0.00 across the entire Insights module** |
| `rpc_shift_coverage_stats` | `COALESCE(remuneration_rate, **25**)` | a hardcoded $25/h with no award basis |
| all of the above | flat `rate × hours` | no penalties, no overtime, no night, no minimum engagement |
| `estimateDetailedCostFromShift` | dropped `unpaid_break_minutes` | the **unpaid meal break was paid** — +$16.85/shift (~7%) |
| both TS entry points | ignored `remuneration_level` | classification guessed from the role *name*; `"Team Member"` matched nothing → default Level 1 casual |

Net effect on the live August roster (156 shifts): **$37,838.45 → $41,477.14**
(+9.6%). The difference is the cl 41 weekend loading a flat calculation cannot see:

```
weekday   $1,455.33 / day
Saturday  $1,758.56 / day    +25%
Sunday    $2,061.74 / day    +50%
```

---

## 7. Prerequisites this rests on

The engine can only price a shift because two things are now guaranteed:

- **`shifts.target_employment_type` is `NOT NULL`** (migration `20260806120100`).
  Before it, all 156 shifts were NULL and the TS engine defaulted them to
  `'Casual'` — every shift in the system carried a phantom 25% loading on nothing
  but an absent field.
- **`shifts.remuneration_level` is inherited from the template row**
  (same migration). Before it, `apply_template_to_date_range_v2` dropped the
  column, so pricing fell through to keyword-matching the role name.

Because `trg_shift_employment_target_2_enforce` also guarantees an assigned
member's contract matches the shift's target, pricing an *assigned* shift off the
target is equivalent to pricing it off the person.

---

## 8. Adding a rule

1. Change `standard.ts` — it is authoritative.
2. Run the parity test. It will fail.
3. Mirror the change in `fn_eba_estimate_shift_cost` (`20260807100000`).
4. Re-run both sides and update the golden figures **only** once they agree.

Never update the golden figures to make a red test green without changing the SQL
port too — that is precisely the silent divergence the test exists to prevent.
