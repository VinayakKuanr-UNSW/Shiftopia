# People Mode — Technical Debt & Performance

Cleanup, duplication, complexity, and performance backlog for People Mode.
Ordered roughly by payoff. Nothing here changes behaviour on its own — pair each
with the correctness fixes in [audit-report.md](./audit-report.md) where noted.

---

## 1. Dead code & unused symbols

| Item | Location | Action |
| --- | --- | --- |
| `getUtilizationStatus` imported, never called | [PeopleModeGrid.tsx:53](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L53) | Use it in the UTL badge (dedupe thresholds) **or** remove the import |
| `Heart`, `Info`, `Scale as ScaleIcon` imports unused | [PeopleModeGrid.tsx:8-16](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L8-L16) | Remove |
| `availabilityLoading` destructured, unused | [PeopleModeGrid.tsx:381](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L381) | Wire a loading shimmer or drop |
| `fairness.ts#calculateUtilization` duplicates `workload.ts#computeUtilizationPct` | [fairness.ts:20-23](../../src/modules/rosters/domain/projections/utils/fairness.ts#L20-L23) | Delete; re-export from `workload.ts` if needed |
| `payBreakdown.leave` hard-coded 0, but a tooltip branch renders it | [people.projector.ts:99](../../src/modules/rosters/domain/projections/projectors/people.projector.ts#L99), [PeopleModeGrid.tsx:672-677](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L672-L677) | Wire leave loading or remove the branch |
| `EmployeeShift`/`Employee` re-export aliases | [PeopleModeGrid.tsx:66-67](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L66-L67) | Confirm consumers; likely removable |
| `DND_UNFILLED_SHIFT`, `DND_EMPLOYEE_TYPE`, `EmployeeDragItem`, `DragItem` | [people-mode.types.ts:57-87](../../src/modules/rosters/ui/modes/people-mode.types.ts#L57-L87) | Grep usage; `DragItem` type alias is unused-looking |

**ESLint caveat:** `npm run lint` is broken repo-wide (version mismatch — see
project memory); these won't be auto-flagged. Verify with `npx tsc --noEmit`
after enabling `noUnusedLocals` locally, or by grep.

---

## 2. Duplicate logic / multiple sources of truth

### 2a. Projected per-shift fields the People card ignores (audit M4)

`toProjectedShift` ([people.projector.ts:64-129](../../src/modules/rosters/domain/projections/projectors/people.projector.ts#L64-L129))
computes a full `ProjectedShiftResult` per shift, but the People-Mode card renders
from the **raw Shift row**, using only `detailedCost`. Fields computed and then
ignored by the People card: `stateId`, `roleName`, `levelName/Number/Id`,
`groupType/groupColors/groupColorKey`, `employeeName`, `isUrgent`, `isOnBidding`,
`isTrading`, `status`, `hours`, `pay`, `estimatedCost`, `costBreakdown`.

- **Risk:** two sources of truth. The projector's `determineShiftState` vs. the
  card's `getShiftUIContext(...).state`; the projector's `resolveGroupType`-
  equivalent vs. the grid's `resolveGroupType(rawShift)`. These can drift.
- **Action:** Either (a) have the People card **consume** the projected fields
  (single source of truth, less main-thread work), or (b) trim
  `toProjectedShift` to only what People Mode needs (`id`, `date`, times,
  `unpaidBreakMinutes`, `detailedCost`, `isCancelled`, `lifecycleStatus`) and let
  richer modes keep the full shape. Note `ProjectedShift` is **shared** across all
  four modes, so option (b) needs care — measure which modes read which fields
  first.

### 2b. Utilization thresholds inlined vs. helper

The badge hand-codes `<80` / `≤105` ([PeopleModeGrid.tsx:744-746, 757-763](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L744-L763))
while `getUtilizationStatus` already defines `under/ideal/over/critical`
(80/105/120). The inlined version silently drops the 120% "critical" tier.
**Action:** one `getUtilizationStatus` + a `UTIL_BAND_STYLE` map, consumed by
badge, tooltip, and progress bar.

### 2c. Fatigue bands copied three times

`<10 / <20` appears in the heatmap tint, the badge, and (as `/25`) the tooltip
bar ([PeopleModeGrid.tsx:602-611, 692-735](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L602-L735)).
**Action:** one `FATIGUE_BANDS` constant next to `fatigue.ts`.

### 2d. Group-color / past-lock re-derivation (audit L4)

`resolveGroupType(rawShift)` and `resolveShiftStatus(shift)` recompute in the grid
what the projector already knows (`groupColors`, and the state/lock context).
**Action:** thread the projected values through instead of recomputing per render.

---

## 3. Complexity hotspots

| Spot | Why it's complex | Suggestion |
| --- | --- | --- |
| `SmartShiftCard.tsx` (~1,270 lines) | Four variants (`compact`/`detailed`/`comfortable`) × `isPeopleMode` branches, each with near-duplicate JSX | Extract shared header/body/cost sub-components; the People-Mode compact path could be its own small component |
| `runProjectionPipeline` cost branch | `employmentType` mapping is a nested ternary over strings ([runProjectionPipeline.ts:118](../../src/modules/rosters/domain/projections/pipeline/runProjectionPipeline.ts#L118)) | Extract a `normalizeEmploymentType()` helper |
| `useRosterProjections` callback | One giant `startTransition` closure remaps all four modes inline ([useRosterProjections.ts:113-205](../../src/modules/rosters/hooks/useRosterProjections.ts#L113-L205)) | Split per-mode `rehydrate*` helpers |
| `as any` casts | `employeesWithShifts as any[]`, `ps as any`, worker merge maps typed `any[]` | Introduce shared typed contracts (`PeopleModeEmployee = ProjectedEmployee`) — this is what let H1 ship |

---

## 4. Performance

Most heavy work is already well-handled (workers, virtualization, memoized rows/
cells, stable callbacks, `startTransition`, per-minute `nowIso`). Remaining items:

| Item | Detail | Fix |
| --- | --- | --- |
| **`computePeakFatigue` allocations (L5)** | Rebuilds the `mapped` array inside the per-reference-date loop → `O(D×N)` allocs per employee ([workload.ts:81-90](../../src/modules/rosters/domain/projections/utils/workload.ts#L81-L90)) | Map once outside the loop; pass the same array to each `calculateFatigueWithRecovery` |
| **Fatigue re-sort per date** | `calculateFatigueWithRecovery` re-sorts the window for every reference date | Sort the employee's shifts once; slice the window per date |
| **Redundant per-shift work** | `toProjectedShift` computes fields the People card never reads (see 2a) | Trim after measuring |
| **Grid re-derivation** | `resolveGroupType` / `resolveShiftStatus` run per card per render | Use projected values |
| **Availability query key** | Sorted-join of all profile IDs recomputed on every `employees` change ([useResolvedAvailability.ts:45-48](../../src/modules/rosters/hooks/useResolvedAvailability.ts#L45-L48)) | Fine at 200 rows; watch if page size grows |
| **Empty rows** | Every eligible employee (incl. zero-shift) is a virtualized row | Acceptable (virtualized); consider a "hide staff with no shifts" toggle |

### Verified-good performance patterns (keep)

- Worker pool splits ≥100-shift rosters across `min(4, ⌊cores/2⌋)` workers with
  stale-discard + debounce ([projection.worker.pool.ts:377-559](../../src/modules/rosters/domain/projections/worker/projection.worker.pool.ts#L377-L559)).
- `@tanstack/react-virtual` with dynamic `measureElement`
  ([PeopleModeGrid.tsx:395-401](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L395-L401)).
- `EmployeeRow`/`EmployeeDateCell`/`DraggableShiftCard`/`ShiftRowMenu` are
  `React.memo`; selection uses a `Set` built once
  ([PeopleModeGrid.tsx:304-307](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L304-L307)).
- `canDrag` reads `useRosterStore.getState()` instead of subscribing, avoiding a
  full-grid re-render on the DnD toggle ([PeopleModeGrid.tsx:151-173](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L151-L173)).
- CSS `contain: layout paint style` on cards + `modal={false}` menus to avoid
  focus-trap/body-lock INP costs.

---

## 5. Refactor opportunities (grouped so one PR touches each file once)

1. **`workload.ts` / `fatigue.ts`** — export `FATIGUE_BANDS` + `UTIL_BANDS`,
   delete `fairness.ts#calculateUtilization`, hoist the `computePeakFatigue`
   allocation, exclude cancelled shifts (H3).
2. **`PeopleModeGrid.tsx`** — remove dead imports (L1), consume the shared bands,
   fix the `bg-amber-400` icon (M3), add empty state (L2), stop re-deriving group
   color (L4), fix/remove the ID line once the projection provides it (H1).
3. **`people.projector.ts` + `types.ts`** — add `employeeId` to the projection
   (H1), route off-page assigned shifts to a visible bucket (H2), trim unused
   per-shift fields after measuring (M4).
4. **`RostersPlannerPage.tsx`** — type `employeesWithShifts` properly (drop
   `as any[]`), add the "N shifts hidden" indicator (H2).
5. **`SmartShiftCard.tsx`** — extract the People-Mode compact card; de-duplicate
   variant JSX; add a net-hours chip; drop the dead leave branch.

---

## 6. Testing gaps

- No unit tests found for `computePeakFatigue` / `computeUtilizationPct` /
  `periodContractedHours`. These are pure functions with clear worked examples in
  [fatigue-analysis.md](./fatigue-analysis.md) and
  [utilization-analysis.md](./utilization-analysis.md) — cheap, high-value to lock
  in (Vitest; `npm run lint` is unusable, so rely on `tsc` + `vitest`).
- No test asserting the **single-worker vs. pool-merge** paths produce identical
  `utilization`/`fatigueScore` for the same input — the invariant the whole
  shared-helper design exists to protect. Add a property test that runs a fixed
  roster through both paths and asserts equality.
- No regression test that a shift assigned to an off-page employee is surfaced
  (would have caught H2).
