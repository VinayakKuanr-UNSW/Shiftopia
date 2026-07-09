# People Mode — Overview & Architecture

> Audit date: 2026-07-07 · Scope: the **People** view of the Rosters Planner
> (`Rosters → People`). This folder documents how People Mode works, what is
> correct, what is broken, and how to improve it. **No production code was
> modified** — these are findings only.

---

## 1. What People Mode is

People Mode is one of four render modes of the Rosters Planner
(`People` · `Group` · `Roles` · `Events`). It pivots the roster **by employee**:
one row per employee, one column per day in the visible range, with shift cards
in each `(employee, day)` cell. Alongside each employee's name it renders three
workforce-health signals:

| Signal | Badge | Meaning |
| --- | --- | --- |
| **Hours / Contract** | `30.0h / 38h` + progress bar | Scheduled hours vs. period-scaled contracted hours |
| **FTG** (Fatigue) | `FTG 14` | Peak projected fatigue score across the roster window |
| **UTL** (Utilization) | `UTL 79%` | Scheduled hours as a % of the period-scaled contract |
| **Pay** | `$1,234` | Estimated labour cost for the employee's assigned shifts |

Two People-Mode-only toggles live in the function bar
([RosterFunctionBar.tsx:415-438](../../src/modules/rosters/ui/components/RosterFunctionBar.tsx#L415-L438)):

- **Availabilities** — fetches & renders an availability bar under each cell.
- **Fatigue Heatmap** ("HEALTH MODE") — tints each employee row green/amber/red by fatigue.

It also supports **drag-and-drop assignment** (drag an unfilled shift from the
side panel onto an employee/day cell) and **shift moves** (drag an existing card
to a different employee/day), gated by a global "DnD Mode".

---

## 2. Architecture

People Mode follows the roster module's **projection engine** pattern: raw DB
rows are transformed into a view-specific projection inside Web Workers, then
rendered by a virtualized grid.

```
 Supabase (shifts, user_contracts, profiles, availability)
        │
        ▼
 React Query hooks ── useShifts / useEmployees / useResolvedAvailability
        │  shifts[], employees[] (ProfileSummary w/ contracted_weekly_hours)
        ▼
 RostersPlannerPage.tsx ── assembles ProjectionInput, calls:
        │
        ▼
 useRosterProjections(input)                          [hooks/useRosterProjections.ts]
        │  • DTO-ifies shifts + employees (mappers.ts)
        │  • debounced dispatch to a worker pool
        ▼
 ProjectionWorkerPool                    [projections/worker/projection.worker.pool.ts]
        │  • splits shifts into chunks (≥100 shifts → multi-worker)
        ├──▶ projection.worker.ts ──▶ runProjectionPipeline()   [pipeline/runProjectionPipeline.ts]
        │        1. applyFilters(shifts)
        │        2. buildStats(shifts)  ← populates the per-worker cost cache
        │        3. projectPeople(shifts, {employees, rangeDays})  [projectors/people.projector.ts]
        │              • bucket shifts by assignedEmployeeId (or "Open Shifts")
        │              • sum currentHours / estimatedPay / payBreakdown
        │              • utilization  = computeUtilizationPct()    ┐  [utils/workload.ts]
        │              • fatigueScore = computePeakFatigue()       ┘  [utils/fatigue.ts]
        └──▶ pool merges chunk partials (mergePeople) — recomputes
             utilization + fatigue over the *merged* shift set
        │
        ▼  PeopleProjection { employees: ProjectedEmployee[] }
 useRosterProjections callback ── re-attaches raw Shift rows as `rawShift`
        │
        ▼
 RostersPlannerPage → employeesWithShifts (cast `as any[]`)
        │
        ▼
 PeopleModeGrid                                   [ui/modes/PeopleModeGrid.tsx]
        │  • @tanstack/react-virtual row virtualizer
        │  • CSS-grid (sticky employee col + one col/day)
        ├── EmployeeRow (memo)  ── name, ID, hours, pay tooltip, FTG/UTL badges, progress bar
        └── EmployeeDateCell (memo) ── DroppableDateCell → SmartShiftCard(s) + availability bar
```

### Why workers?

A week view of a large department can render **~1,400 cells**. Cost/fatigue math
per shift is expensive, so it is pushed off the main thread. The pool splits the
shift array across `min(4, ⌊cores/2⌋)` workers, and results are marked as a React
`startTransition` so user input stays responsive
([useRosterProjections.ts:113-119](../../src/modules/rosters/hooks/useRosterProjections.ts#L113-L119)).

Because the pool splits **by shift index**, a single employee's shifts can land
in different workers. Therefore `currentHours`, `utilization`, and `fatigueScore`
are **recomputed after merge** over the employee's full shift set
([projection.worker.pool.ts:120-181](../../src/modules/rosters/domain/projections/worker/projection.worker.pool.ts#L120-L181)),
using the **same helpers** (`workload.ts`) as the single-worker path so the two
code paths can never diverge.

---

## 3. Main components & files

| Concern | File |
| --- | --- |
| Page wiring / data assembly | [pages/RostersPlannerPage.tsx](../../src/modules/rosters/pages/RostersPlannerPage.tsx) (People branch ~L1138-1197) |
| Projection hook | [hooks/useRosterProjections.ts](../../src/modules/rosters/hooks/useRosterProjections.ts) |
| Worker pool + merge | [domain/projections/worker/projection.worker.pool.ts](../../src/modules/rosters/domain/projections/worker/projection.worker.pool.ts) |
| Pipeline orchestrator | [domain/projections/pipeline/runProjectionPipeline.ts](../../src/modules/rosters/domain/projections/pipeline/runProjectionPipeline.ts) |
| People projector | [domain/projections/projectors/people.projector.ts](../../src/modules/rosters/domain/projections/projectors/people.projector.ts) |
| **Utilization math (SoT)** | [domain/projections/utils/workload.ts](../../src/modules/rosters/domain/projections/utils/workload.ts) |
| **Fatigue math** | [domain/projections/utils/fatigue.ts](../../src/modules/rosters/domain/projections/utils/fatigue.ts) |
| Fairness helpers (partly unused) | [domain/projections/utils/fairness.ts](../../src/modules/rosters/domain/projections/utils/fairness.ts) |
| Grid + row + cell | [ui/modes/PeopleModeGrid.tsx](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx) |
| People-mode types | [ui/modes/people-mode.types.ts](../../src/modules/rosters/ui/modes/people-mode.types.ts) |
| Canonical projection types | [domain/projections/types.ts](../../src/modules/rosters/domain/projections/types.ts) |
| Shift card | [ui/components/SmartShiftCard.tsx](../../src/modules/rosters/ui/components/SmartShiftCard.tsx) |
| Availability hook | [hooks/useResolvedAvailability.ts](../../src/modules/rosters/hooks/useResolvedAvailability.ts) |
| Cell shared helpers | [utils/roster-utils.ts](../../src/modules/rosters/utils/roster-utils.ts) |

---

## 4. Key data types

- **`ProjectedEmployee`** ([types.ts:209-236](../../src/modules/rosters/domain/projections/types.ts#L209-L236)) — the runtime object per row: `id`, `name`, `avatar`, `contractedHours`, `periodContractedHours`, `currentHours`, `overHoursWarning`, `estimatedPay`, `fatigueScore`, `utilization`, `payBreakdown`, `shifts`.
- **`PeopleModeEmployee`** ([people-mode.types.ts:30-53](../../src/modules/rosters/ui/modes/people-mode.types.ts#L30-L53)) — the *UI* type the grid is typed against. **Superset of `ProjectedEmployee`** — it additionally declares `employeeId`. The projection never produces that field (see [audit-report.md](./audit-report.md) H1).
- **Employee source**: `useEmployees` → `EligibilityService.getEligibleEmployees` returns only staff with an **Active `user_contract`**, defaulting `contracted_weekly_hours` to **38** ([eligibility.service.ts:221](../../src/modules/rosters/services/eligibility.service.ts#L221)).

---

## 5. Dependencies

- **React Query** — `useShifts`, `useEmployees`, `useResolvedAvailability` (server cache).
- **Zustand** — `useRosterStore` (`activeMode`, `advancedFilters`, date range, `showFatigueHeatmap`, DnD mode, bulk selection).
- **Web Workers** (Vite `new Worker(new URL(...))`) — the projection engine.
- **@tanstack/react-virtual** — row virtualization.
- **react-dnd** — drag/drop assignment & moves.
- **date-fns** — date range + formatting.
- **lucide-react**, **shadcn/radix primitives** (Avatar, Badge, Tooltip, DropdownMenu).

---

## 6. Reading order for a new engineer

1. This README (mental model).
2. [utilization-analysis.md](./utilization-analysis.md) and [fatigue-analysis.md](./fatigue-analysis.md) — the two numbers everyone asks about.
3. [audit-report.md](./audit-report.md) — what's actually broken, ranked.
4. [ui-review.md](./ui-review.md) — every element on the row/card.
5. [technical-debt.md](./technical-debt.md) — cleanup & perf backlog.
</invoke>
