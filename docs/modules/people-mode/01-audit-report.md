# People Mode — Audit Report

> Audit date: 2026-07-07. Severity scale: **Critical** (data loss / wrong pay) ·
> **High** (visibly wrong data) · **Medium** (misleading but recoverable) ·
> **Low** (cosmetic / cleanup).

> **✅ Remediation landed 2026-07-08.** The headline findings **H1, H2, H3, M1,
> M2, M6** (plus **M3** and the **L1** cleanup) were fixed across three files
> sets. Verified green: `npx tsc --noEmit` (0 errors), `npm run build` (success),
> and **30 new Vitest regression tests** under
> `src/modules/rosters/domain/__tests__/projections/`
> (`workload.test.ts`, `fatigue.test.ts`, `people.projector.test.ts`). The
> per-finding **Status** column below records what shipped. Not committed — left
> for review. Still open: **M4, M5, L2, L3, L4, L5** (see
> [05-technical-debt.md](./05-technical-debt.md)).

## Summary

People Mode's **plumbing is solid** — the 60× utilization unit bug and the
"fatigue as of today reads 0 for future rosters" bug documented in project memory
are genuinely fixed, and the single-worker and worker-pool paths now share the
same `workload.ts` helpers so they can't drift. The remaining issues are at the
**edges**: a field that never renders, shifts that silently vanish under
pagination, and two health metrics (fatigue, utilization) whose **thresholds
don't match the math** so almost everyone shows amber/over.

| # | Severity | Area | One-line | Status |
| --- | --- | --- | --- | --- |
| H1 | High | Data/UI | Employee "ID:" line always renders blank (`employeeId` doesn't exist on the projection) | ✅ Fixed |
| H2 | High | Data | Assigned shifts silently disappear when the assignee isn't in the loaded employee page | ✅ Fixed |
| H3 | Medium-High | Data | Cancelled shifts inflate FTG but not hours/pay | ✅ Fixed |
| M1 | Medium | Fatigue | Fatigue scale mis-calibrated vs. badge thresholds — a normal shift is already "amber" | ✅ Fixed (recalibrated) |
| M2 | Medium | Utilization | Casuals measured against a fabricated 38h contract | ✅ Fixed |
| M6 | Medium | Utilization | Day / short-range views make UTL almost always read "over" | ✅ Fixed |
| M3 | Medium | UI | UTL tooltip icon uses a `bg-*` class where a `text-*` class was intended | ✅ Fixed |
| M4 | Medium | Arch | Most per-shift projected fields are computed in the worker but unused by the card | ⬜ Open |
| M5 | Medium | Arch | Duplicate utilization logic + inlined thresholds; `getUtilizationStatus` imported but unused | 🟡 Partial (`getUtilizationStatus` now used) |
| L1 | Low | Cleanup | Dead imports/vars in `PeopleModeGrid` | ✅ Fixed |
| L2 | Low | UX | No People-Mode empty state | ⬜ Open |
| L3 | Low | Consistency | `isUrgent` uses the deprecated `computeBiddingUrgency` alias (and is dead) | ⬜ Open |
| L4 | Low | Perf | Grid re-derives group color / past-lock that the projector already computed | ⬜ Open |
| L5 | Low | Perf | `computePeakFatigue` re-allocates a mapped array per reference date | ⬜ Open |

---

## H1 — Employee "ID:" line always renders blank

**Where:** [PeopleModeGrid.tsx:632-634](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L632-L634)

```tsx
<div className="text-[10px] ... text-muted-foreground/60 ...">
  ID: {employee.employeeId}
</div>
```

**Root cause:** The grid is typed against `PeopleModeEmployee`, which declares
`employeeId: string` ([people-mode.types.ts:33](../../src/modules/rosters/ui/modes/people-mode.types.ts#L33)).
But the objects actually passed in are `ProjectedEmployee`, cast to `any[]` at
[RostersPlannerPage.tsx:752-753](../../src/modules/rosters/pages/RostersPlannerPage.tsx#L752-L753):

```ts
return (projection.people?.employees || []) as any[];
```

`ProjectedEmployee` has **no `employeeId`** — only `id`
([types.ts:209-236](../../src/modules/rosters/domain/projections/types.ts#L209-L236)) — and
`makeEmployee` never sets one
([people.projector.ts:36-62](../../src/modules/rosters/domain/projections/projectors/people.projector.ts#L36-L62)).
The `as any[]` cast suppresses the type error, so `employee.employeeId` is
`undefined` and React renders nothing after "ID:".

**Failure scenario:** Every row in every roster shows the literal text `ID:`
with an empty value.

**Fix options (pick one):**
- Cheapest: render `employee.id` (the profile UUID) — ugly but non-empty.
- Better: surface a human-readable staff number. `ProfileSummary` has no employee
  number today; if one exists on `profiles`, thread it through `EmployeeRecord →
  WorkerEmployeeDTO → makeEmployee` as `employeeId`.
- Remove the line if a staff ID adds no value here.
- Regardless: **stop casting to `any[]`** — type `employeesWithShifts` as
  `ProjectedEmployee[]` (or a shared `PeopleModeEmployee = ProjectedEmployee`)
  so this class of bug is caught at compile time.

---

## H2 — Assigned shifts silently disappear under pagination / search

**Where:** [people.projector.ts:159-174](../../src/modules/rosters/domain/projections/projectors/people.projector.ts#L159-L174)

```ts
shifts.forEach(shift => {
  const targetId = shift.assignedEmployeeId ?? UNASSIGNED_BUCKET_ID;
  if (!empMap.has(targetId)) {
    if (targetId === UNASSIGNED_BUCKET_ID) { /* make Open Shifts bucket */ }
    else {
      // Skip shifts for employees not in the current paginated/filtered employee list
      return;
    }
  }
  ...
});
```

**Root cause:** `empMap` is seeded only from the `employees` list, which is the
**paginated** eligible-employee query (`EMPLOYEE_PAGE_SIZE = 200`
— [RostersPlannerPage.tsx:107](../../src/modules/rosters/pages/RostersPlannerPage.tsx#L107)) and is
**further narrowed by the People-Mode search box**
([RostersPlannerPage.tsx:395-401, 1140-1149](../../src/modules/rosters/pages/RostersPlannerPage.tsx#L395-L401)).
An assigned shift whose employee is not in that list is neither shown in a row
**nor** in "Open Shifts" (it has an assignee, so `targetId !== UNASSIGNED_BUCKET_ID`).
It is dropped entirely.

**Failure scenario:**
- Department has 250 contracted staff; employees 201-250 have assigned shifts.
  Those shifts never appear in People Mode, and their hours/cost are excluded
  from any per-employee aggregate.
- Manager searches "Sarah" to focus one person; every shift assigned to someone
  else vanishes (expected for a *people* filter) — **but so do unassigned-to-a-
  hidden-person shifts**, and there is no indicator that shifts were hidden.

**Why it matters:** Managers use People Mode to find and fix coverage gaps. A
silently-dropped assigned shift can't be seen, edited, unpublished, or counted.

**Fix options:**
- Route dropped assigned shifts into a synthetic "Other staff (not loaded)" or
  "Off-page assignments" bucket so they remain visible/auditable.
- Or raise/remove pagination for People Mode (it already virtualizes rows), and
  scope the search to *filter rows*, not *drop shifts*.
- At minimum, show a count: "N assigned shifts hidden (employee not in view)".

---

## H3 — Cancelled shifts inflate fatigue but not hours/pay

**Where:** [people.projector.ts:177-225](../../src/modules/rosters/domain/projections/projectors/people.projector.ts#L177-L225)

Every shift (including cancelled) is pushed into `emp.shifts[date]` and later
flattened into the fatigue input:

```ts
emp.shifts[shift.shiftDate].push(ps as any);          // cancelled included
if (!shift.isCancelled && shift.assignedEmployeeId) {  // hours/pay gated
  emp.currentHours += ps.hours; emp.estimatedPay += ps.pay; ...
}
...
const empShifts = Object.values(emp.shifts).flat();    // includes cancelled
emp.fatigueScore = computePeakFatigue(fatigueInput);   // counts cancelled
```

The merge path has the same shape
([projection.worker.pool.ts:160-168](../../src/modules/rosters/domain/projections/worker/projection.worker.pool.ts#L160-L168)).

**Root cause:** Fatigue is computed over *all* bucketed shifts; hours/pay are
gated on `!isCancelled`. The two disagree on whether a cancelled shift "counts."

**Failure scenario:** An employee with one cancelled overnight shift shows
`0.0h / 38h`, `UTL 0%`, `$0` — but a **non-zero FTG** driven by a shift that
isn't happening.

**Fix:** Filter cancelled shifts out of the fatigue input (and ideally don't
render cancelled cards, or render them visibly struck-through). Recommended:
build `fatigueInput` from non-cancelled assigned shifts only, mirroring the
hours/pay gate.

---

## M1 — Fatigue scale mis-calibrated vs. thresholds

A single ordinary 8h **day** shift scores **FTG ≈ 14**; a single 8h **night**
shift scores **≈ 26**. The badge/heatmap bands are `<10` green, `10–20` amber,
`≥20` red ([PeopleModeGrid.tsx:606-608, 694-696](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L694-L696)).
So a normal day worker is **permanently amber** and a single night shift is
**red**. The green band is effectively unreachable for anyone working a full
shift. Full derivation and worked numbers in
[02-fatigue-analysis.md](./02-fatigue-analysis.md). Treat as a **calibration** issue,
not an arithmetic bug — but the current bands make the signal near-useless.

---

## M2 — Casuals measured against a fabricated 38h contract

`getEligibleEmployees` sets `contracted_weekly_hours: displayContract?.contracted_weekly_hours ?? 38`
([eligibility.service.ts:221](../../src/modules/rosters/services/eligibility.service.ts#L221)).
Casual staff have no contracted weekly hours, yet they inherit **38**. A casual
who works 20h in a week shows `UTL ~53%` and the blue "under-utilized — priority
candidate for additional shifts" hint — semantically wrong for a casual. If the
DB instead stores `0` (not null) for a casual, the `?? 38` does **not** apply and
the row shows `20.0h / 0h`, `UTL 0%` — also wrong. See
[03-utilization-analysis.md](./03-utilization-analysis.md) §Edge cases.

---

## M6 — Day / short-range views make UTL read "over"

Utilization scales the weekly contract by **calendar days in view**
([workload.ts:28-49](../../src/modules/rosters/domain/projections/utils/workload.ts#L28-L49)).
In **Day** view (`rangeDays = 1`), the denominator is `38/7 ≈ 5.4h`, so a single
legitimate 8h shift reads `UTL 147%` (red, "over-utilized"). The metric is only
meaningful at week-or-longer ranges. See [03-utilization-analysis.md](./03-utilization-analysis.md).

---

## M3 — UTL tooltip icon color class bug

**Where:** [PeopleModeGrid.tsx:760-764](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L760-L764)

```tsx
<Scale className={cn('h-4 w-4',
  employee.utilization < 80 ? 'text-blue-400' :
  employee.utilization <= 105 ? 'text-emerald-400' : 'bg-amber-400')} />
```

The over-utilized branch applies **`bg-amber-400`** (a background class) to an
SVG icon instead of **`text-amber-400`**. The icon therefore isn't amber when
utilization > 105%. Cosmetic; one-character fix.

---

## M4 — Per-shift projected fields computed but unused by the card

`toProjectedShift` computes `estimatedCost`, `costBreakdown`, `stateId`,
`roleName`, `levelName/Number/Id`, `groupType/groupColors`, `employeeName`,
`isUrgent`, `isOnBidding`, `isTrading`, `status`, `hours`, `pay`, …
([people.projector.ts:64-129](../../src/modules/rosters/domain/projections/projectors/people.projector.ts#L64-L129)).
But the People-Mode `SmartShiftCard` renders almost everything from the **raw
Shift row** — role from `shift.roles?.name`, subgroup from
`shift.roster_subgroup?.name`, times from `shift.start_time`, bidding from
`shift.bidding_status` ([SmartShiftCard.tsx:316-366](../../src/modules/rosters/ui/components/SmartShiftCard.tsx#L316-L366)).
The only projected per-shift field the card consumes is **`detailedCost`**.

**Impact:** wasted worker compute per shift and a **second source of truth** —
e.g. the projector's `stateId` (from `determineShiftState`) vs. the card's
`getShiftUIContext(...).state` can diverge for the same shift. See
[05-technical-debt.md](./05-technical-debt.md).

---

## M5 — Duplicate utilization logic; unused helper

- `fairness.ts#calculateUtilization` ([fairness.ts:20-23](../../src/modules/rosters/domain/projections/utils/fairness.ts#L20-L23))
  is a byte-for-byte duplicate of `workload.ts#computeUtilizationPct`.
- `getUtilizationStatus` (thresholds 80/105/120) is **imported into
  `PeopleModeGrid`** ([PeopleModeGrid.tsx:53](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L53))
  but never called; the badge re-inlines `< 80` / `<= 105` thresholds by hand
  ([PeopleModeGrid.tsx:744-746](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L744-L746)).
  The inlined bands also **omit the 120% "critical" tier** the helper defines.

---

## Low-severity findings

- **L1 — Dead imports/vars.** `Heart`, `Info`, `Scale as ScaleIcon`
  ([PeopleModeGrid.tsx:8-16](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L8-L16)),
  `getUtilizationStatus` (L53), and `availabilityLoading`
  ([PeopleModeGrid.tsx:381](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L381)) are unused.
- **L2 — No empty state.** When `employees` is empty (no eligible staff, or a
  search with zero matches), the grid renders only the header row — no "No
  employees found / adjust filters" message. The global spinner covers *loading*
  only ([RostersPlannerPage.tsx:1122-1129](../../src/modules/rosters/pages/RostersPlannerPage.tsx#L1122-L1129)).
- **L3 — `isUrgent` uses `computeBiddingUrgency`** (a deprecated alias of
  `computeShiftUrgency`) and ignores `start_at`
  ([people.projector.ts:114](../../src/modules/rosters/domain/projections/projectors/people.projector.ts#L114));
  it is also dead because the card re-derives urgency from the raw row.
- **L4 — Redundant re-derivation in the grid.** `resolveGroupType(rawShift)`
  ([PeopleModeGrid.tsx:946](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L946)) recomputes
  a color the projector already produced (`groupColors`/`groupColorKey`), and
  `resolveShiftStatus` recomputes past/locked per render.
- **L5 — `computePeakFatigue` re-allocates.** It rebuilds the full `mapped`
  array inside the per-reference-date loop
  ([workload.ts:81-90](../../src/modules/rosters/domain/projections/utils/workload.ts#L81-L90)) —
  `O(D×N)` allocations; hoist the mapping outside the loop.

---

## What is correct (regression guard)

- **Utilization period-scaling** is right: weekly contract scaled by `rangeDays/7`,
  divide-by-zero guarded ([workload.ts:28-59](../../src/modules/rosters/domain/projections/utils/workload.ts#L28-L59)).
- **Fatigue is anchored per-shift-date**, not "today," so future rosters don't
  read 0 ([workload.ts:77-92](../../src/modules/rosters/domain/projections/utils/workload.ts#L77-L92)).
- **Single-worker and pool-merge paths share the same helpers** — utilization &
  fatigue are recomputed post-merge over the full shift set, so chunk-splitting
  can't corrupt them ([projection.worker.pool.ts:152-178](../../src/modules/rosters/domain/projections/worker/projection.worker.pool.ts#L152-L178)).
- **Cost cache ordering** is correct: `buildStats` populates the per-worker cost
  cache before `projectPeople` reads it, and the card reuses that same
  `detailedCost` — so assigned-shift card costs and the employee pay total agree.
- **Assigned-only pay:** `currentHours`/`estimatedPay` exclude cancelled &
  unassigned shifts, matching payroll intent.

## Suggested remediation order

1. **H2** (data loss) and **H1** (blank ID) — highest user-visible impact.
2. **H3** + **M2** + **M6** — correctness of the health numbers managers act on.
3. **M1** — recalibrate fatigue bands (product decision; see fatigue-analysis).
4. **M3/M4/M5 + L*** — cleanup, best done together while touching these files.
