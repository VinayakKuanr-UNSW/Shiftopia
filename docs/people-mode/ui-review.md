# People Mode — UI Review

Covers every element of the employee row and the shift card in People Mode, plus
loading/empty/error states. Files:
[PeopleModeGrid.tsx](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx),
[SmartShiftCard.tsx](../../src/modules/rosters/ui/components/SmartShiftCard.tsx).

Legend: ✅ correct · ⚠️ misleading/needs work · ❌ broken · 💡 suggestion.

---

## 1. The employee row (sticky left cell)

[PeopleModeGrid.tsx:612-803](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L612-L803)

| Element | Source | Status |
| --- | --- | --- |
| Avatar (dicebear) + amber ring when over hours | `employee.avatar`, `overHoursWarning` | ✅ |
| Name | `employee.name` | ✅ |
| `OT` pill | `overHoursWarning` | ⚠️ fires at `>periodContract` (~100%), not aligned with the amber UTL band (`>105%`) |
| **`ID: {employeeId}`** | `employee.employeeId` | ❌ **always blank** — field doesn't exist on the projection (audit H1) |
| Hours line `Xh / Yh` | `currentHours` / `periodContractedHours` | ✅ math; ⚠️ shows `/ 0h` for zero-contract staff |
| Pay `$n` + breakdown tooltip | `estimatedPay`, `payBreakdown` | ✅ base/penalty/overtime/allowance/leave breakdown is a genuinely nice touch |
| `FTG n` badge + tooltip + bar | `fatigueScore` | ⚠️ mis-calibrated bands (audit M1); tooltip bar scales `/25` |
| `UTL n%` badge + tooltip + bar | `utilization` | ⚠️ Day-view over-reads (M6); ❌ tooltip icon uses `bg-amber-400` not `text-amber-400` (M3) |
| Contract progress bar | `min(100, utilization)` | ✅ (clamped) |

### Row-level observations

- **Badge density.** The left cell packs Avatar, name, OT pill, ID, hours, pay,
  **two** color-coded badges (FTG, UTL), **and** two progress bars (the UTL badge
  tooltip bar + the standalone contract bar) into a 240px column. FTG and UTL each
  carry a mini progress bar *inside their tooltip* and there is a third bar below
  — three bars conveying two numbers. 💡 Consolidate: one contract bar + numeric
  badges is enough.
- **Pay label semantics.** The tooltip labels penalties/overtime with `+` signs
  as if additive to a base, which reads well, but "Leave Loading" only appears
  when `> 0` and People-Mode `payBreakdown.leave` is always 0
  ([people.projector.ts:99](../../src/modules/rosters/domain/projections/projectors/people.projector.ts#L99)
  hard-codes `leave: 0`), so that row never shows. 💡 Either wire leave loading or
  drop the dead branch.
- **Health-Mode heatmap** ([L602-611](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L602-L611))
  tints the whole row by `fatigueScore` using the same mis-calibrated bands, so in
  Health Mode almost every row is amber/red. ✅ toggle + legend UX is clear.

---

## 2. The shift card (People-Mode `CompactCard`, the default)

[SmartShiftCard.tsx:381-526](../../src/modules/rosters/ui/components/SmartShiftCard.tsx#L381-L526).
`variant` defaults to `compact`; `dense` is on when `dates.length > 3` (Week/Month).

| Element | Source | Status |
| --- | --- | --- |
| Left accent bar (group color) | `resolveGroupType(rawShift)` | ✅ ; 💡 projector already computed this (L4) |
| State ID badge (`S6`, …) | `getShiftStateDisplay` on card | ✅ gapless display ID |
| Dense status dots (time-rule / arrival / departure) | `getTimeRule`, `getLiveRuleBadges` | ⚠️ three unlabeled colored dots; tooltip is native `title` only |
| Template icon (`CopyPlus`) | `shift.is_from_template` | ✅ |
| "Generated" sparkle | `shift.notes.startsWith('Generated')` | ✅ |
| History button (audit timeline) | `shift.id` | ✅ |
| Row menu (Edit / Clone / Unpublish) | `headerAction` (`ShiftRowMenu`) | ✅ ; Edit/Clone disabled when past |
| Status icons row | `getShiftStatusIcons` | ⚠️ overlaps conceptually with the state badge + dots |
| Role name | `shift.roles?.name` | ✅ |
| Sub-group name | `shift.roster_subgroup?.name ?? sub_group_name` | ✅ |
| Time range `HH:MM - HH:MM` | `shift.start_time/end_time` | ✅ |
| Cost badge `$n` + breakdown tooltip | `detailedCost` else `estimateDetailedCostFromShift` | ✅ ; see note below |
| DnD blocking overlay (red stripes) | `isDnDActive && isLocked && isPublished` | ✅ |

### Card observations

- **Missing on the card: hours.** The compact People card shows the time range
  but **not** net hours. `PeopleModeShift.hours` exists but is only surfaced as a
  "Xh net" badge in the *detailed* variant ([SmartShiftCard.tsx:855-856](../../src/modules/rosters/ui/components/SmartShiftCard.tsx#L855-L856)),
  which People Mode doesn't use by default. 💡 A small `7.5h` chip would save the
  reader from mentally subtracting times + break.
- **Missing on the card: employee.** Correct — the row *is* the employee, so the
  card renders **role** where other modes render the assignee name. ✅
- **Cost fallback consistency.** For **assigned** shifts the card uses the
  projector's cached `detailedCost` (same value that feeds the employee pay
  total) → card costs and the header pay reconcile. ✅ For **Open Shifts**
  `detailedCost` is zero, so the card falls back to `estimateDetailedCostFromShift`
  and shows an estimate — but the Open-Shifts row aggregate is `$0`. ⚠️ Minor:
  cards show `≈$` estimates while the bucket total reads `$0`.
- **Status-signal overload.** A single dense card can display: state-ID badge,
  time-rule dot, arrival dot, departure dot, template icon, sparkle, plus 1–3
  status icons — up to **~9 indicators** competing in a ~150px-wide card. 💡 This
  is the strongest UX cleanup opportunity; consolidate into fewer, labeled signals.
- **Redundant `≈`/`=` prefix** logic exists in other variants but the People
  compact card just shows `$n` (no prefix) — fine, but inconsistent with the
  Group-mode card that prefixes `= $` for assigned. Cosmetic.

---

## 3. The date cell (drop target + add affordance)

[PeopleModeGrid.tsx:865-997](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L865-L997)

- ✅ Empty editable non-past cell is click-to-add; a floating `+` button appears
  on hover (or always, dimmed, when empty). Good discoverability.
- ✅ Past cells (`isSydneyPast`) disable add; cards grayscale.
- ✅ `DroppableDateCell` handles both "assign unfilled shift" and "move existing
  shift" drops, validated before firing the callback.
- ✅ Availability bar renders under the cell only when the Availabilities toggle
  is on; min-height grows (`110px` vs `80px`) to reserve space.
- 💡 While availability is loading, `getAvailability` returns `null` and the bar
  renders empty with no skeleton (`availabilityLoading` is fetched but unused —
  see tech-debt L1). A subtle shimmer would signal "loading" vs "no availability."

---

## 4. Loading / empty / error states

| State | Handling | Status |
| --- | --- | --- |
| **Loading (shifts)** | Full-area overlay spinner "Loading shifts…" ([RostersPlannerPage.tsx:1122-1129](../../src/modules/rosters/pages/RostersPlannerPage.tsx#L1122-L1129)) | ✅ |
| **Loading (availability)** | none (empty bars) | 💡 add shimmer |
| **Empty (no employees / no search match)** | Header row only, no message | ❌ **L2** — add "No employees found — adjust filters/scope" |
| **Truncated (>200)** | "Showing first 200 … — refine search to see more" ([L1150-1162](../../src/modules/rosters/pages/RostersPlannerPage.tsx#L1150-L1162)) | ⚠️ tells the user rows are capped, but does **not** warn that *assigned shifts* for hidden staff are dropped (audit H2) |
| **Error (query failure)** | no People-Mode-specific error UI | 💡 surface a retry banner |

---

## 5. Redundant / missing / misleading — consolidated

**Redundant**
- Three progress bars for two numbers (FTG tooltip bar, UTL tooltip bar, contract bar).
- State-ID badge + status-icons + time/live-rule dots overlap in meaning on the card.
- Group color re-derived in the grid though the projector already produced it.

**Missing**
- Net hours on the compact card.
- A real value for the "ID:" line (currently blank — H1).
- Empty-state and availability-loading affordances.
- A hidden-shifts indicator when pagination/search drops assigned shifts (H2).

**Misleading**
- FTG bands (everyone amber/red — M1).
- UTL in Day/short views (always "over" — M6) and for casuals (phantom 38h — M2).
- UTL tooltip icon not amber when over (M3).
- "Leave Loading" tooltip branch that can never trigger in People Mode.

---

## 6. UX recommendations (priority order)

1. **Fix the blank ID** and stop the `as any[]` cast (H1) — visible on every row.
2. **Warn when shifts are hidden** by pagination/search (H2) or, better, keep them
   visible in an "off-page" bucket.
3. **Recalibrate FTG bands and fix Day-view UTL** so the two headline health
   signals are trustworthy (M1, M6, M2).
4. **De-clutter the card**: consolidate the 9 status indicators into a few labeled
   signals; add a net-hours chip; drop the dead leave-loading branch.
5. **Add empty/error states** and an availability-loading shimmer.
6. **Collapse the three progress bars** into one contract bar.
