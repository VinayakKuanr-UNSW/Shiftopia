# Pay-engine EBA Phase-3 close-out

**Scope:** ICC Sydney EA 2025 award-**cost estimator** (not a payroll engine).
**Location:** `src/modules/rosters/domain/projections/utils/cost/`
**Status:** Phases 1–3 complete. Standard + Security cost tests green (31 tests in
`src/modules/rosters/domain/__tests__/cost/`).

> This is an **estimator**, not payroll. Its output must always be surfaced as an
> estimate (`COST_ESTIMATE_LABEL` / `COST_ESTIMATE_TITLE` / `COST_ESTIMATE_DISCLAIMER`
> in `constants.ts`). The module is **worker-safe**: no React, no DOM, no Supabase,
> no network, synchronous, zero allocations in the hot loop.

This document is a factual close-out for future maintainers. It records what the
estimator models, the interpretation choices made where the EA is ambiguous, the
timezone/DST boundary, and the known limitations for anyone extending it. It does
**not** invent CPI numbers or future rate values.

---

## 1. What the estimator now models correctly

### 1.1 Effective-dated rates and allowances (`rate-schedule.ts`)
Rates and allowances are no longer a flat, undated snapshot. `resolveRateSet(shiftDate)`
returns the `RateSet` in force on the shift's own date — the entry with the latest
`effectiveFrom` on or before that date (lexicographic `YYYY-MM-DD` compare, no `Date`
allocation). Both engines resolve their rates this way per shift.

- Wage rates, allowances, and the security annualised/ordinary maps all live in the
  resolved `RateSet`, so a **historical shift is priced at the rate that applied on
  its own date**, and future cl 25.1 CPI+0.5% increases become a **data** change, not
  a code change.
- `applyCpiIncrease(base, cpiPercent, effectiveFrom, label)` derives the next period's
  `RateSet` by multiplying every rate/allowance by `1 + (cpiPercent + 0.5)/100`
  (cl 25.1), rounded to cents. It is pure (never mutates `base`).
- Today `RATE_SCHEDULE` holds a single row — `EA_2025` (commencement, `2025-01-01`).
  The 1 Jul 2026/27/28 increases are intentionally **not** present: the ABS
  March-quarter Sydney All-Groups CPI (cl 25.2) is unpublished, and the schedule
  header explicitly says do not invent the figure.

### 1.2 Overnight midnight penalty split (`standard.ts`)
An overnight shift's ordinary hours can fall on two calendar days with different
weekend / public-holiday penalties. The ordinary span `[startMins, endMins)` is split
at midnight (`splitOrdinaryAtMidnight`, at most two segments given the 12h ordinary
cap) and **each calendar-day segment is priced on its own day-of-week + public-holiday
status**. This fixes the prior engine, which priced the whole shift at the *start*
date's day — under-penalising e.g. the Sunday-morning half of a Saturday-night shift
and missing a crossing into/out of a public holiday. The next calendar day is derived
via `addOneDay`, which builds the date from **local** parts (never `toISOString()`).

`penaltyLoading(day, isHoliday)` returns the cl 41 loading **over** the ordinary rate,
excluding the permanent 25% casual loading (carried separately by `baseMult`):
Saturday +25%, Sunday +50%, public holiday +150%.

### 1.3 cl 41.4 night-allowance MAX (not cumulative)
Where a night hour (22:00–06:00, integer window overlap via `fastNightMinutes`) also
attracts a weekend / public-holiday penalty, only the **greater** of the two loadings
is paid — not their sum. Implemented per segment as
`Math.max(0, nightLoad − segPenaltyLoad)`:

- weekday night ⇒ full night allowance (day penalty is 0);
- Saturday/Sunday ⇒ the higher of night-allowance vs weekend loading;
- public holiday ⇒ the +150% PH penalty always exceeds the night allowance, so the
  allowance falls away (0) there.

Night-allowance multipliers (`getNightAllowanceMultiplier`) are keyed off casual vs
permanent and the day: Mon–Thu / Fri / weekend tiers.

### 1.4 Leave pay
Leave-flagged shifts are not worked: no overtime, no fixed allowances, no minimum-
engagement top-up.

- **Casual leave = zero.** Casuals accrue no paid leave; their 25% loading is paid in
  lieu (cl 11 / NES). A casual annual/personal/carer leave shift returns the zero
  result in **both** `standard.ts` and `security.ts`.
- **Annual leave (cl 38): greater-of.** `max(ordinaryRate × hours × (1 + 17.5%),
  the penalty/night loadings the shift would have earned if worked)` — the safe reading
  of the "17.5% loading OR shift penalties, whichever is greater" drafting
  (`ANNUAL_LEAVE_LOADING = 0.175`).
- **Personal / carer's leave (NES ss96–99): ordinary base rate** for the ordinary
  hours — no loading, no penalties (those attach to actual attendance).
- **Annualised / full-time security** is salaried (leave already inside the annual
  salary), so security leave falls through to normal pricing rather than being zeroed.

---

## 2. Documented interpretation ambiguities (and the safe reading chosen)

Each of these is a genuine EA drafting ambiguity. The conservative/safe reading was
chosen and documented inline; each is a small, localised change if the EA is later
read the other way.

| # | Ambiguity | Reading chosen | Alternative |
|---|-----------|----------------|-------------|
| A | **Night-allowance day-keying.** Is the night allowance rate set by the day each night *hour is worked*, or by the shift's *conclusion* day? | Pay-for-when-worked: keyed per midnight-split segment (more granular/safer). | Key the whole allowance off the conclusion day. |
| B | **Annual-leave loading vs penalties.** "17.5% or shift penalties, whichever is greater." | Greater-of the two (§1.4). | Flat 17.5%, no penalties — a one-line change at the `Math.max(...)`. |
| C | **cl 41.4 cumulation.** Night + weekend/PH loading. | MAX (greater of the two, not the sum, and not zero). | (Earlier over-conservative stance paid zero; corrected to MAX.) |
| D | **School-based apprentice loading.** | No +25% in-lieu-of-leave loading for school-based *apprentices* (that is a Sched 5 *Trainee* provision, §1.8.1, and opt-in). | Apply the loading (was over-paying). |
| E | **Minimum-engagement floor.** cl 12.3(e)/12.4(c)/12.5(c)/56.2. | Part-time/flexi/casual floored to 4h on Sunday/PH else 3h; full-time (weekly-salaried) excluded. The 2h training-on-a-non-event-day floor is **not** modelled (no `is_training` input) so the standard floor is used there. | Model the 2h training floor once an `is_training` input exists. |

---

## 3. Timezone / DST boundary (Part A of this phase)

The org runs at **ICC Sydney (Australia/Sydney, UTC+10/+11 with DST)**. Two things
matter, both handled in `award-context.ts`.

### 3.1 Calendar-day formatting — fixed
`toDateString()` previously formatted a `Date` object via `.toISOString().split('T')[0]`.
`toISOString()` renders the day in **UTC**, which in Sydney rolls the calendar day
**backwards** for any local time before ~10:00–11:00 (e.g. a `Date` at 1 Jul 08:00
Sydney serialises to `2025-06-30T22:00:00Z` → the wrong day, and therefore the wrong
day-of-week / public-holiday facts). This was corrected to derive `YYYY-MM-DD` from
**local** `getFullYear/getMonth/getDate` (helper `formatLocalYmd`) — the same local-parts
pattern already used by `addOneDay` in `standard.ts` and by the
`new Date(dateStr + 'T00:00:00')` construction used throughout.

Practical impact was narrow: the projection input is almost always a `YYYY-MM-DD`
**string** (untouched by this branch), so the only affected path was the `Date`-object
branch — an edge input. `buildAwardContext` / `getDateFacts` construct their dates from
local parts and read `.getDay()` locally, so they were already correct; the fix removes
the one remaining `toISOString()` day-shift risk.

### 3.2 DST wall-clock duration — deliberately out of scope (documented)
An overnight shift crossing a Sydney DST transition has a **real** wall-clock duration
of **7h (spring forward)** or **9h (fall back)** rather than the naive 8h. This engine
does **not** re-derive wall-clock duration across a DST transition — a documented,
deliberate boundary, captured in the "DST / duration boundary" block in
`award-context.ts` (plus the greppable no-op marker `dstNaiveMinutes`).

Rationale: the estimator prices from the duration the **upstream caller** supplies —
`netMinutes` / `scheduled_length_minutes` when present, otherwise the naive start/end
string difference (`fastNetMinutes`, which treats a day as a flat 1440 minutes).
`fastNightMinutes` is likewise a flat wall-clock window overlap. Getting the true worked
minutes across a DST boundary is therefore the responsibility of the layer that owns
real instants (timesheet / roster). Pulling a full tz database into the worker to do
DST-offset correction in-process is out of scope: it would break worker-safety and add
a dependency. The naive-24h assumption is exact for every non-transition night and off
by at most ±60 min for the ≤2 overnight shifts per year that straddle a Sydney switch.

---

## 4. Remaining known limitations (for anyone extending this)

- **Weekly-averaged overtime is not computed here.** Overtime is per-shift: FT/PT beyond
  rostered hours or the 12h/day ordinary cap; casuals only past the 12h/day cap
  (`ORDINARY_HOURS_CAP = 12`). Cl 42 weekly-averaged / weekly-threshold overtime relies
  on **upstream weekly context** that a single-shift estimator does not have. The user
  disclaimer already states "Excludes … weekly-averaged overtime."
- **Higher-duties reading.** The estimator prices a shift at a single classification
  rate; a whole-shift-vs-partial higher-duties reading (part of a shift worked at a
  higher classification) is not split within a shift.
- **Two-source rate relationship (TS ↔ DB).** The worker engine reads the **embedded**
  `RATE_SCHEDULE` in `rate-schedule.ts` (it cannot query the DB synchronously). The
  durable, auditable copy is `public.eba_rate` / `public.eba_allowance`
  (migration `20260709000000_eba_rate_allowance_effective_dated.sql`). The two **must be
  kept in sync** when a new effective row is added; a sync test guards the relationship.
  The migration is **authored, additive, and idempotent** — apply it deliberately
  (do not rely on an unreviewed `db push`; version drift has bitten this repo before).
  Endgame (a later phase) is a generator that makes the DB the single source so there
  is one canonical interpreter.
- **cl 25.3 floor not auto-enforced.** Rates must stay ≥ 2% above the Amusement, Events
  & Recreation Award. The Award rate is not available to this module, so this is a
  **human check** when inserting a new `effective_from` row (noted in both the TS
  schedule header and the migration).
- **CPI rows are absent by design.** `RATE_SCHEDULE` and the DB seed hold only the
  `2025-01-01` commencement row. The 1 Jul 2026/27/28 rows must be added — as data,
  via `applyCpiIncrease` (TS) and the mirrored INSERT (DB) — **only once ABS publishes
  the March-quarter Sydney CPI**. Do not invent the figure.
- **Minimum-engagement 2h training floor** is not modelled (no `is_training` input); the
  standard 3h/4h floor is used in its place (§2, row E).
- **Cancelled shift = zero.** Both engines short-circuit `is_cancelled` to a frozen
  zero result before any rate maths (audit Phase 1). Unassigned shifts are skipped
  upstream via `ZERO_COST_BREAKDOWN` (cost is employee-dependent).

---

## 5. Key entry points

| Symbol | File | Purpose |
|--------|------|---------|
| `estimateDetailedShiftCost` / `estimateShiftCost` | `standard.ts` | General staff, apprentices (Sched 4), trainees (Sched 5), SWS (Sched 6). |
| `estimateDetailedShiftCost` / `estimateShiftCost` | `security.ts` | Building services / security (annualised + casual). |
| `resolveRateSet` / `applyCpiIncrease` / `RATE_SCHEDULE` | `rate-schedule.ts` | Effective-dated rate/allowance schedule (cl 25.1). |
| `buildAwardContext` / `getDateFacts` / `parseTimeToMinutes` / `fastNetMinutes` / `fastNightMinutes` | `award-context.ts` | Per-date fact cache + worker-safe integer time helpers. |
| `WAGE_RATES` / allowance + loading constants / `COST_ESTIMATE_*` labels | `constants.ts` | Baseline values and estimate-labelling strings. |
| `eba_rate` / `eba_allowance` tables | `supabase/migrations/20260709000000_eba_rate_allowance_effective_dated.sql` | Durable, effective-dated mirror of `RATE_SCHEDULE`. |
