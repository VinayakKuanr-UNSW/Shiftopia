# People Mode — Utilization (UTL) & Contracted-Hours Analysis

Source of truth: [utils/workload.ts](../../src/modules/rosters/domain/projections/utils/workload.ts).
Rendered by the `UTL` badge, the `Xh / Yh` hours line, the "OT" pill, and the
contract progress bar in
[PeopleModeGrid.tsx](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx).

> **✅ Fixes landed 2026-07-08.** Two behaviours this doc flags as wrong are now
> fixed: **M6** — `periodContractedHours` now applies a **weekly floor**
> (`days = max(rangeDays, 7)`), so Day/short-range views no longer over-read
> (a single 8h shift in Day view now reads ~21% of the weekly contract, not
> 147%); Week/Month are unchanged. **M2** — casual staff now arrive with
> `contractedHours = 0`, and zero-contract rows render `UTL —` ("no contract")
> instead of a phantom % or `Xh / 0h`. The §2–3 tables below marked ⚠ for Day
> view / casuals describe the *pre-fix* behaviour and explain why the fix was
> made.

---

## 1. Calculation methodology

Utilization answers *"how much of this employee's contracted capacity is
scheduled in the visible window?"*

```
periodContractedHours = contractedWeeklyHours × (rangeDays / 7)      // scale weekly → view
utilization %         = (currentHours / periodContractedHours) × 100
overHoursWarning      = currentHours > periodContractedHours
```

- **`contractedWeeklyHours`** — the employee's weekly contract (e.g. 38),
  sourced from the **Active `user_contract`**, defaulting to **38**
  ([eligibility.service.ts:221](../../src/modules/rosters/services/eligibility.service.ts#L221)) →
  `EmployeeRecord.contracted_weekly_hours` → `WorkerEmployeeDTO.contractedHours`
  ([mappers.ts:131-147](../../src/modules/rosters/domain/projections/worker/mappers.ts#L131-L147)).
- **`rangeDays`** — calendar days in the visible range (Day = 1, Week = 7,
  Month = 28–31), a Zustand selector so identical ranges don't churn the worker
  ([useRosterProjections.ts:32-35](../../src/modules/rosters/hooks/useRosterProjections.ts#L32-L35)).
- **`currentHours`** — sum of **net** hours over **non-cancelled, assigned**
  shifts in the window, rounded to 0.01 per add
  ([people.projector.ts:185-194](../../src/modules/rosters/domain/projections/projectors/people.projector.ts#L185-L194)).

The three helpers (`periodContractedHours`, `computeUtilizationPct`,
`isOverContractedHours`) are the **single source of truth**, shared by the
projector and the pool-merge path so the number is identical no matter how the
pool split the work ([workload.ts:1-59](../../src/modules/rosters/domain/projections/utils/workload.ts#L1-L59)).

### How it renders

| Element | Value | File |
| --- | --- | --- |
| Hours line | `{currentHours.toFixed(1)}h / {round(periodContractedHours)}h` | [PeopleModeGrid.tsx:637-643](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L637-L643) |
| `OT` pill + amber avatar ring | shown when `overHoursWarning` | [PeopleModeGrid.tsx:615-630](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L615-L630) |
| `UTL n%` badge | color bands `<80` blue / `≤105` emerald / else amber | [PeopleModeGrid.tsx:740-788](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L740-L788) |
| Progress bar | `min(100, utilization)%`, amber if over | [PeopleModeGrid.tsx:791-802](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L791-L802) |

---

## 2. Validation

Computed from the formulae above:

| Employee | View | Scheduled | Period contract | **UTL** | Band |
| --- | --- | --- | --- | --- | --- |
| FT 38h | Week (7d) | 30h | 38h | **79%** | blue (under) |
| FT 38h | Week (7d) | 40h | 38h | **105%** | emerald (ideal, `OT` on at >38) |
| FT 38h | Month (31d) | 160h | 168.3h | **95%** | emerald |
| FT 38h | **Day (1d)** | 8h | 5.43h | **147%** | amber (over) ⚠ |
| Casual (→38 default) | Week | 20h | 38h | **53%** | blue (under) ⚠ |
| PT 20h | Week | 22h | 20h | **110%** | amber + `OT` |

Observations:
- Week/Month views behave sensibly.
- **Day view is misleading** (see M6 below).
- The `OT` pill (over period contract) and the amber UTL band (`>105%`) use
  **different thresholds**, so an employee at 100–105% shows `OT` **without** an
  amber UTL badge. Minor inconsistency worth aligning.

---

## 3. Edge cases

| Case | Behaviour | Verdict |
| --- | --- | --- |
| **No contract / 0 weekly hours** | `periodContractedHours = 0` → `computeUtilizationPct` returns **0**; hours line shows `Xh / 0h` | Guarded against divide-by-zero, but the display is nonsensical for real scheduled hours |
| **Casual staff** | Contract defaults to **38** upstream, so casuals read as a % of 38 (or `0h` if DB stores literal 0 — `?? 38` only catches null/undefined) | **M2** — wrong denominator for casuals either way |
| **Open Shifts bucket** | `contractedHours = 0`, no assigned hours → `0.0h / 0h`, `UTL 0%`, `FTG 0`, `$0` | Correct (nothing to measure), though the row still shows a full badge set |
| **Day view** | `rangeDays = 1` → denominator `38/7 ≈ 5.4h`; one 8h shift ⇒ 147% | **M6** — over-reads on any short range |
| **Custom multi-week range** | Scales linearly by `rangeDays` | Correct |
| **`overHoursWarning` vs UTL band** | over is `>periodContract` (~100%); amber band is `>105%` | Off-by-band inconsistency |
| **`currentHours` rounding** | rounded per-add in projector, summed again in merge | Sub-cent drift only; acceptable |
| **Employee with zero shifts** | Still rendered (bucket seeded from `employees`) → `0.0h / 38h`, `UTL 0%` | Intended (assignment target), but adds many empty rows |

---

## 4. Suggested improvements

1. **Handle casuals explicitly (M2).** Detect `contract_type === 'CASUAL'` (it's
   already on `ProfileSummary`/`EligibleEmployee`) and either hide UTL/OT for
   casuals or measure against a **rolling average of recent hours** rather than a
   phantom 38h. Stop defaulting casual `contracted_weekly_hours` to 38 in
   `getEligibleEmployees`, or carry a nullable flag through so the UI can tell
   "no contract" apart from "38h contract."
2. **Fix Day/short-range UTL (M6).** Options: (a) always base UTL on the **full
   week containing** the shifts regardless of the view zoom; (b) suppress the UTL
   badge below a 7-day range; or (c) label it "UTL (this week)" so the denominator
   is unambiguous. Period-scaling a weekly contract to a single day is not a
   meaningful ratio.
3. **Align the two "over" thresholds.** Make the `OT` pill and the amber UTL band
   agree (e.g. both fire at `>100%`), or document why they differ.
4. **Reuse the shared thresholds.** Replace the inlined `<80` / `≤105` in the
   badge with `getUtilizationStatus` ([fairness.ts:46-51](../../src/modules/rosters/domain/projections/utils/fairness.ts#L46-L51)),
   which already encodes `under / ideal / over / critical` (and delete the
   duplicate `calculateUtilization`). See [05-technical-debt.md](./05-technical-debt.md).
5. **Empty-denominator display.** When `periodContractedHours = 0`, render `Xh`
   alone (drop `/ 0h`) and a neutral "—" for UTL instead of `0%`.

---

## 5. Cross-view consistency

- **`currentHours` (net, assigned, non-cancelled)** matches the definition used
  by the Group/Roles stats builders (`buildStats`), so the People per-employee
  hours reconcile with the roster footer totals for the same filter set.
- **Utilization/fatigue are People-Mode-only** derivations — Group/Roles/Events
  modes don't show them, so there is no cross-mode number to disagree with.
- The **Grid (Insights) view** computes its own compliance against
  `contracted_weekly_hours` with a different fallback and a 2-week window
  ([availability/domain/hours-compliance.ts](../../src/modules/availability/domain/hours-compliance.ts), moved there from `insights/model/grid-compliance.ts`);
  it is a separate lineage and should not be assumed equal to People-Mode UTL.
