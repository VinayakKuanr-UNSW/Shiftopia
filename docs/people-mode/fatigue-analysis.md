# People Mode — Fatigue (FTG) Analysis

Source of truth: [utils/fatigue.ts](../../src/modules/rosters/domain/projections/utils/fatigue.ts),
orchestrated by `computePeakFatigue` in
[utils/workload.ts](../../src/modules/rosters/domain/projections/utils/workload.ts).
Rendered by the `FTG` badge, tooltip, and Health-Mode heatmap in
[PeopleModeGrid.tsx](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx).

> **⚠️ Bands recalibrated 2026-07-08 (M1 fix).** The classification bands below
> were **`<10` green / `<20` amber / `≥20` red** at audit time — the miscalibration
> this doc describes. They are now defined once in `fatigue.ts` as
> `FATIGUE_BANDS = { OK_MAX: 20, RISK_MAX: 35 }` with `getFatigueBand()`:
> **`<20` ok (emerald) / `20–35` risk (amber) / `≥35` critical (red)**, and the
> tooltip progress bar scales `/40`. So a normal day shift (~14) is now green, a
> single night shift (~26) is "risk," and stacked/no-recovery patterns (≥35) are
> "critical." The §3 worked FTG *scores* are unchanged; only the band cut-offs
> moved. Sections below discussing the old `<10/<20` bands are retained as the
> rationale for the change.

> **✅ View-independent lookback added 2026-07-08.** The roster shifts query is
> scoped to the visible range, so `computePeakFatigue`'s trailing 7-day recovery
> window was starved in Day/3D views — the SAME day read a lower FTG than in
> Week/Month. Fixed: `computePeakFatigue(shifts, history)` now takes the **7 days
> before the window** as read-only recovery context (fetched via
> `shiftsQueries.getFatigueHistoryShifts`, applied in `useRosterProjections`), so a
> given day's fatigue is identical in any zoom. The FTG *badge* still shows the
> **peak over the days shown** (Day = 1 day, Month = worst day of the month) — that
> aggregation is intended, and the tooltip now states the window ("Peak N over
> \<range\> · incl. prior 7 days"). Reference dates are visible-only; history is
> never itself a reported day.

---

## 1. Current implementation

Three layers:

### (a) Per-shift accumulation — `calculateFatigueAccumulation` ([fatigue.ts:65-108](../../src/modules/rosters/domain/projections/utils/fatigue.ts#L65-L108))

A single shift's fatigue is a **circadian-weighted, non-linear** function of its
net hours:

```
effectiveHours   = netHours × (1 + circadianPenalty)
cappedEff        = min(effectiveHours, 37.9)          // avoids log(0) at 38h
fatigue(shift)   = -76 × ln(1 − cappedEff / 38)
```

The circadian penalty is a length-weighted average over the hours the shift
spans, using these bands (hour-of-day → multiplier):

| Hours | 00-02 | 02-06 | 06-08 | 08-10 | 10-16 | 16-22 | 22-24 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Penalty | +0.25 | **+0.50** | +0.25 | 0 | **−0.25** | 0 | +0.25 |

So night hours (02:00-06:00) are penalized most (+50%) and mid-day hours
(10:00-16:00) are discounted (−25%, "recovery-friendly"). Overnight shifts are
handled by duplicating the band table shifted +24h
([fatigue.ts:85-87](../../src/modules/rosters/domain/projections/utils/fatigue.ts#L85-L87)).

### (b) Recovery over a window — `calculateFatigueWithRecovery` ([fatigue.ts:114-175](../../src/modules/rosters/domain/projections/utils/fatigue.ts#L114-L175))

Given a `referenceDate`, it looks at shifts in the **trailing 7-day window**
`[refMidnight+24h − 7×24h , refMidnight+24h]`, sorts them by start time, and walks
them chronologically:

```
for each shift (after the first):
    rest      = thisStart − prevEnd            // hours between shifts
    fatigue   = max(0, fatigue − rest)         // linear recovery: 1h rest → −1 unit
fatigue      += calculateFatigueAccumulation(shift)
```

Returns `current` (rounded to 0.1). A `candidate` shift can be appended for
"projected" scoring — **not used by People Mode**, only by the auto-scheduler.

### (c) Peak across the roster — `computePeakFatigue` ([workload.ts:77-92](../../src/modules/rosters/domain/projections/utils/workload.ts#L77-L92))

People Mode does **not** anchor to "today" (that reads 0 for future rosters).
Instead it computes `calculateFatigueWithRecovery` **once per distinct shift date**
and takes the **maximum**:

```
peak = max over each distinct shift_date d of  current(window ending at d)
```

This is what the `FTG` badge shows. The unassigned "Open Shifts" bucket is
skipped ([people.projector.ts:212](../../src/modules/rosters/domain/projections/projectors/people.projector.ts#L212)).

---

## 2. Formulae summary

| Quantity | Formula |
| --- | --- |
| Net hours | `(endMin − startMin − unpaidBreak) / 60`, `+24h` if overnight |
| Circadian penalty | `Σ (overlapMinutes_band / totalShiftMinutes) × penalty_band` |
| Effective hours | `netHours × (1 + penalty)`, capped at 37.9 |
| Per-shift fatigue | `−76 × ln(1 − effectiveHours / 38)` |
| Recovery | `fatigue ← max(0, fatigue − restHours)` between consecutive shifts |
| Displayed FTG | `max` of the 7-day-window score anchored at each shift date |

**Units:** unnamed "fatigue points." The `−76` and `38` are unlabeled magic
constants; 38 coincides with a standard full-time weekly-hours figure but is
applied here to a **single shift's** effective hours, which is what makes the
scale steep (see §4).

---

## 3. Worked examples

Computed directly from the formulae above. Handy for regression tests.

| Shift | Net hrs | Circadian penalty | Effective hrs | **FTG** | Band |
| --- | --- | --- | --- | --- | --- |
| 09:00–17:00 day, no break | 8.0 | −0.1875 | 6.50 | **14.3** | amber |
| 09:00–17:00 day, 30m break | 7.5 | −0.1875 | 6.09 | **13.3** | amber |
| 06:00–14:00 early | 8.0 | ~ +0.0625 | 8.50 | **20.0** | red |
| 22:00–06:00 night (overnight) | 8.0 | +0.375 | 11.0 | **26.0** | red |
| 12:00–16:00 short PT | 4.0 | −0.25 | 3.00 | **6.0** | green |

**Recovery example — two normal day shifts on consecutive days**
(09–17 each; rest 17:00→09:00 = 16h):

```
day1: fatigue = 14.3
gap : rest 16h → max(0, 14.3 − 16) = 0
day2: fatigue = 0 + 14.3 = 14.3
```

A full overnight rest (16h) **more than cancels** a day shift's 14.3 points, so a
run of ordinary day shifts **plateaus at ~14.3 (amber) forever** — it never
accumulates. Fatigue only stacks when shifts are **< ~14h apart** (e.g. a
"clopening": 22:00 finish → 06:00 start = 8h rest).

---

## 4. Edge cases

| Case | Behaviour | Note |
| --- | --- | --- |
| **Green is nearly unreachable** | FTG < 10 requires effective hours < **4.68h** (solve `−76 ln(1−e/38) < 10`) | Any full 7.6–8h shift is amber+; only short PT shifts are green |
| **Single night shift = red** | 8h overnight → **26** | One shift trips "Critical fatigue… mandatory rest per MA000080" |
| **Cancelled shifts counted** | Included in `computePeakFatigue` input | **Bug — H3** in [audit-report.md](./audit-report.md); inflates FTG with non-events |
| **Cross-week roster** | `computePeakFatigue` uses each shift's own date as the window end | Correct; the pool recomputes over the full merged set so index-splitting can't understate a consecutive-day peak ([projection.worker.pool.ts:160-168](../../src/modules/rosters/domain/projections/worker/projection.worker.pool.ts#L160-L168)) |
| **Overnight parsing** | `end ≤ start` ⇒ `+24h`; bands duplicated +24h | Correct for a single overnight; a shift > 24h would fall through the doubled bands |
| **Break longer than shift** | `shiftHours` can go negative → `effectiveHours < 0` → `ln(1 − neg/38)` > 0 → **negative fatigue** | Not guarded in `calculateFatigueAccumulation` (unlike `calculateShiftHours`, which clamps at 0). Data-quality dependent |
| **Cap at 37.9** | Prevents `ln(0)`; a ≥38h effective shift saturates at `−76 ln(0.00263) ≈ 452` | Extreme but bounded |
| **Timezone** | Parsed as **UTC** (`Date.UTC`) for both shift times and the window | Internally consistent (differences only), but not Sydney-anchored like the rest of the app's `isSydneyPast`/`getSydneyNow` |

---

## 5. Validation results

- **Arithmetic:** the implementation matches the formulae; the two code paths
  (single worker vs. pool merge) both call `computePeakFatigue`, so they agree.
- **The 60× / "reads 0 today" bugs are fixed** — verified `computePeakFatigue`
  anchors to shift dates, per project memory.
- **Calibration is the problem (M1).** The classification bands (`<10` / `<20` /
  `≥20` in [PeopleModeGrid.tsx:606-608](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L606-L608)
  and the tooltip's `/25` progress scale at
  [L728](../../src/modules/rosters/ui/modes/PeopleModeGrid.tsx#L728)) do not line up
  with a per-shift formula that yields 14–26 for ordinary shifts. Net effect: the
  badge is amber/red for essentially every working employee, so it can't
  discriminate the genuinely over-worked from the normal.

---

## 6. Discrepancies & recommendations

1. **Recalibrate the bands (product + data decision).** Either
   (a) rescale the output (e.g. normalize so a compliant 8h day shift ≈ "green"),
   or (b) move the thresholds so amber begins where a *problematic* pattern
   starts (e.g. insufficient rest / consecutive nights). Whatever is chosen,
   define the bands **once** next to the formula and import them into the badge,
   tooltip, and heatmap — today they are three hand-copied triples.
2. **Exclude cancelled shifts** from the fatigue input (H3).
3. **Name the constants.** Replace `38`, `−76`, `/25`, `<10/<20` with documented
   named constants and a one-paragraph rationale, so the model is auditable.
4. **Guard negative effective hours** in `calculateFatigueAccumulation`
   (`Math.max(0, shiftHours)` before the log).
5. **Cite the model.** The tooltip references "MA000080"; link the actual fatigue
   basis (or mark it as a heuristic) so managers know how literally to read it.
6. **Micro-perf (L5):** hoist the `mapped` allocation out of the per-date loop in
   `computePeakFatigue`.
