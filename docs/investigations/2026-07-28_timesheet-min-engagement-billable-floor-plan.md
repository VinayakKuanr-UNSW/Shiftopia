# Timesheets — EBA Minimum Engagement on the Billable Side (Plan)

**Status:** IMPLEMENTED 2026-07-28 on `feat/autopilot-uniform-onoff` (uncommitted — see git status). §3's policy (automatic top-up, no manager override) and §5's mechanism (floor centralized in `billable-time.ts`) as designed below. tsc clean, full build green, 1589/1589 vitest green (incl. new tests). Not yet reviewed/committed.
**Date:** 2026-07-28
**Scope:** The **billable** window computed from timesheet clock-in/clock-out (what payroll pays), NOT the raw **actual** attendance record (`shift.actual_start`/`actual_end`, the "Actual" column). The actual clock times must never be rewritten — this plan only ever touches what gets *paid*.

---

## 1. The gap, confirmed

EBA minimum engagement (3h Mon–Sat, 4h Sun/PH, 2h training — training wins over the Sun/PH uplift) is enforced **exactly once**, at shift creation/scheduling time:

- `src/modules/compliance/v8/rules/min-engagement.ts` — `minEngagementRule`, rule id `V8_MIN_ENGAGEMENT`. Compares `shiftDurationMinutes(s.start_time, s.end_time)` — the **scheduled** roster window — against the tiered floor.
- Wired into `V8Engine` (`src/modules/compliance/v8/engine.ts:34`) and reached via `complianceService.validateShiftCompliance(...)`, which runs during shift create/edit, bidding, assignment, and swap validation.
- It explicitly skips committed shifts: `if (s.is_candidate === false) continue;` (line 27) — it only ever validates the shift **being scheduled**, never re-checks it later.

Nothing downstream re-checks this once a shift has actually run. Timesheets resolve a **billable window** that is frequently shorter than the roster (early clock-out, manager-adjusted times, auto clock-out capped at 12.5h, etc.), and that shorter window flows straight into payroll pricing with no floor:

- `src/modules/timesheets/domain/billable-time.ts` — `resolveBillableSide()` + `calculateNetMinutes()` — the canonical billable-time resolver (three-tier: manager edit → snapped actual → missing).
- Consumed by `src/modules/timesheets/api/timesheets.supabase.api.ts:259` (`calculatedNetMins`, shown to managers as `netLengthMinutes`) and by `src/modules/payroll/data/grossPay.read.api.ts:227` (`netMinutes`, fed straight into `computeShiftGrossPay.ts` → priced dollars).
- `computeShiftGrossPay.ts`'s own docstring says it prices "from APPROVED ACTUAL worked hours" — by design it has no concept of a statutory floor; it just prices whatever `netMinutes` it's handed.

So today: an employee rostered for a 6h shift who clocks out after 1.5h nets **1.5h of pay**, not the 3h EBA guarantees. That's the hole.

---

## 2. Billable vs. actual — keep the boundary intact

This distinction is already first-class in the codebase and this plan preserves it exactly:

| | Source | Used for | Touched by this plan? |
|---|---|---|---|
| **Actual** | `shift.actual_start` / `actual_end` → `clockIn`/`clockOut` on `TimesheetShiftRow` | The true attendance history record. `timesheets.supabase.api.ts:316-320` explicitly documents that this column is never overridden by manager edits, "to preserve the true history record." | **No.** |
| **Billable** | `resolveBillableSide()` → `calculateNetMinutes()` → `netLengthMinutes` / `netMinutes` | What payroll pays. Manager-edit-first, else snapped actual. | **Yes — this is where the EBA floor applies.** |

The minimum-engagement floor is a **pay guarantee**, not a rewrite of history — it must never touch `actual_start`/`actual_end`, the audit log's provenance of what really happened, or the "Live Rules" arrival/departure badges (which report actual clocking). It only affects the number that reaches `netMinutes`/`grossPay`.

---

## 3. Policy — DECIDED 2026-07-28

No exemption path. No manager override, no reason codes, no "pay the shorter actual net instead" escape hatch — unlike `variance-reasons.ts`'s arrival/departure model, minimum engagement is not negotiable through the UI:

- **Any shift that started** (has a resolved billable start) **and isn't a no-show/cancellation** is **always** automatically topped up to the EBA floor. No approval click required to trigger it — it applies as soon as the billable window resolves (§5.1), so the manager sees the true payable amount immediately, not just at approval time.
- **The floor is a hard constraint on manager edits too.** A manager editing the billable start/end in the timesheet UI must not be able to save a combination that nets less than the required minimum for that shift. The edit is rejected (or the end time is auto-suggested at the floor) — never silently accepted below it.
- **The floor is duration-based off the resolved billable start, not the rostered start.** If billable start is itself late (e.g. actual clock-in at 2:15 against a 2:00 roster), the guaranteed minimum runs from 2:15, not 2:00 — `requiredMins` is added to whatever the resolved start turns out to be, never to the scheduled start.
- **Never applies to:** no-shows and cancellations (already priced at $0 — they never started) and leave days (synthesised separately through `leaveGrossPay.ts`, never touches this code path at all).

This simplifies the mechanism considerably: with no exemption branch, the floor doesn't need to live at the approval gate as a decision point — it can live **inside `billable-time.ts` itself**, the file that already is (per its own docstring) "the ONE place that implements... the rule used by both the timesheet display/edit path and the payroll pricing path." Putting it there means both consumers inherit it automatically and can never drift apart, which is stronger than hooking it into each call site separately (§5 below reflects this).

---

## 4. Shared resolver — don't fork the EBA table a third time

The EBA tier table (training 2h > Sun/PH 4h > standard 3h) already exists once in `min-engagement.ts` and the Sunday/public-holiday day-typing logic already exists **twice**, independently:

- `src/modules/compliance/v8/adapters/v2-to-v8.ts:15,56-57` — `isSunday()` (`getDay() === 0`) + `isPublicHoliday()` via the AU holiday calendar, used to populate `V8RuleContext`.
- `src/modules/payroll/domain/computeShiftGrossPay.ts:296-341` — its own day-of-week + `ausHolidays.isHoliday()` segment logic for Sat/Sun/PH penalty loadings.

Adding a third, timesheet-side copy is how these things drift (the codebase has several documented incidents of exactly this — see `billable-time.ts`'s own docstring about the two-copy drift it was written to fix). Instead:

**New file:** `src/modules/compliance/v8/rules/min-engagement-threshold.ts` (or lift the tier logic out of `min-engagement.ts` into a small exported helper the rule then calls) —

```ts
export function requiredMinEngagementMinutes(input: {
  isTraining?: boolean;
  isSunday?: boolean;
  isPublicHoliday?: boolean;
}): { requiredMins: number; reason: string } { /* the existing if/else in min-engagement.ts, unchanged */ }
```

Both `minEngagementRule` (scheduling-time) and the new timesheet/payroll floor call this same function, so the 3h/4h/2h numbers and the training-wins-over-holiday precedence live in exactly one place. Day-typing (`isSunday`/`isPublicHoliday` from a date string) should similarly be pulled out of `v2-to-v8.ts` into `@/modules/core/lib/holidays` (which `ausHolidays` already lives in) so `computeShiftGrossPay.ts`'s independent copy and the new timesheet floor both call the same helper instead of each re-deriving it.

---

## 5. Where the floor hooks in

### 5.1 Data needed that isn't fetched yet

- `shifts.is_training` is a real column (`supabase/migrations/20251015000000_baseline_schema.sql:20642`) but is **not** currently selected by `getShiftsForTimesheet`'s query (`timesheets.supabase.api.ts:131-164`) or present on `GrossPayShiftRow` (`src/modules/payroll/data/types.ts`). Add it to both selects and both row types.
- `is_sunday`/`is_public_holiday` are never stored — derive from `shift_date` via the shared holiday helper from §4 at read time, same as `v2-to-v8.ts` does today.

### 5.2 Core fix — floor it inside `billable-time.ts`, not at each call site

`calculateNetMinutes(start, end, unpaidBreakMinutes)` is pure time-math and shouldn't grow EBA-tier knowledge. Instead add a **new exported function in the same file**, called immediately after `calculateNetMinutes()` by every consumer:

```ts
// src/modules/timesheets/domain/billable-time.ts
export interface MinEngagementFloorInput {
  isTraining?: boolean;
  isSunday?: boolean;
  isPublicHoliday?: boolean;
  isNoShow?: boolean;
  isCancelled?: boolean;
}

export interface FlooredNetMinutes {
  netMinutes: number;          // the value every consumer should actually use
  requiredMins: number;        // the EBA floor that applied
  wasToppedUp: boolean;        // true when netMinutes was raised to requiredMins
}

/**
 * Applies the EBA minimum-engagement guarantee to an already-resolved billable
 * net-minutes figure. Duration-based off whatever the billable start actually
 * resolved to (§3) — never re-anchored to the rostered start. No-shows and
 * cancellations are exempt (never started); leave never reaches this function
 * at all (synthesised separately in leaveGrossPay.ts).
 */
export function applyMinEngagementFloor(
  netMinutes: number,
  input: MinEngagementFloorInput,
): FlooredNetMinutes {
  if (input.isNoShow || input.isCancelled) return { netMinutes, requiredMins: 0, wasToppedUp: false };
  const { requiredMins } = requiredMinEngagementMinutes(input); // shared helper, §4
  const wasToppedUp = netMinutes < requiredMins;
  return { netMinutes: wasToppedUp ? requiredMins : netMinutes, requiredMins, wasToppedUp };
}
```

Both call sites change identically — compute `calculateNetMinutes()` as today, then pipe it through `applyMinEngagementFloor()` before using it for anything display- or pay-facing:

- `timesheets.supabase.api.ts:259` — `calculatedNetMins` becomes the floored value; `netLengthMinutes` and `estimatedPay` (line 365) reflect the top-up **immediately**, not just after a manager approves. `wasToppedUp` flows onto the row for the badge (§5.3).
- `grossPay.read.api.ts:227` — `netMinutes` becomes the floored value before it ever reaches `computeShiftGrossPay()`. Because `computeShiftGrossPay.ts`'s own Sat/Sun/PH segment math derives its synthetic end purely from `startTime + ordinaryHours` (lines 296-341), flooring `netMinutes` upstream requires **no changes inside `computeShiftGrossPay.ts` itself** — it prices the floored duration correctly for free. Optionally surface `wasToppedUp` on `GrossPayShiftInput`/`ShiftGrossPay` (e.g. a `hoursSource: 'topped_up'` value alongside the existing `'actual'`/`'manual'`/`'none'`) purely for payslip/report transparency — not required for correctness, since the minutes are already right.

This is the one-function change that makes both consumers correct and undrift-able, consistent with `billable-time.ts`'s own stated purpose.

### 5.3 Timesheet UI — surface the top-up

`getPayrollRuleBadges()` (`src/modules/rosters/domain/shift-ui.ts:676`) is the existing "two-badge, billable-window-driven" model rendered as the "Payroll Rules" column (`TimesheetTable.tsx:336`, tooltip: *"Billable window vs roster — what payroll pays"*). Add a new badge state — **"Topped Up to Min"** — shown whenever `wasToppedUp` is true, instead of / alongside the existing Early/On-Time/Late labels, so a manager sees at a glance that payroll paid more than the raw clock times imply and why. `ShiftDotInput` (`shift-ui.ts:367-407`) needs `is_training` added so this can be computed without a second fetch.

### 5.4 Manager edit validation — reject, don't silently accept, a sub-floor edit

`validateBillableEdit()` (`src/modules/timesheets/domain/billable-edit.ts:57`) currently checks format / 5-minute granularity / end-after-start / break bounds. It needs one more check, gated on the same `requiredMinEngagementMinutes()` context (passed in by the caller, which already has `is_training`/date on hand):

```ts
if (grossMins !== null && (grossMins - p.unpaidBreakMinutes) < requiredMins) {
  return fail(`Adjusted times must net at least ${requiredMins / 60}h — the EBA minimum engagement for this shift.`);
}
```

This is what makes "the manager cannot go below the required net length" a hard UI constraint rather than a rule the backend quietly overrides after the fact. Open UX detail (not blocking): reject-with-message vs. auto-suggest the floor end time as a default value the manager can accept — either is fine mechanically, worth a quick product call.

### 5.5 Approval gate + audit trail

The existing "completeness guard" in `timesheets.supabase.api.ts:621-645` (refuses `approved` while a billable side is `'missing'`) is unchanged and still runs first. Since §5.2 already floors `netMinutes` before it's ever displayed or priced, there's no separate "block approval" branch to add here — by the time a manager clicks approve, the number they're approving is already the floored one. What approval *does* need to do: stamp `timesheet_audit_log` (the trigger-backed provenance timeline from `0408303`) with a `min_engagement_topup` entry recording the raw clocked net vs. the floored/paid net whenever `wasToppedUp` is true, so it's as traceable as every other lifecycle event, and reportable/auditable after the fact even though it was never a manager decision point.

### 5.6 AutoPilot fixed-window auto-verify

Per `feat/autopilot-uniform-onoff` (commit `7a12b14`, "AutoPilot fixed-window auto-verify"), timesheets can be auto-approved by the generic `core/autopilot/` engine without a human touching them. With §5.2 centralizing the floor inside `billable-time.ts`, this is actually the easy case now: AutoPilot reads `netMinutes` through the same resolver as everything else, so it **automatically inherits the floored value with zero AutoPilot-specific code** — there's no exemption branch it could wrongly take, because there isn't one anywhere in the system anymore. The only thing to verify is that the AutoPilot adapter doesn't have its own parallel/cached copy of net-minutes math that bypasses `billable-time.ts` (see open question #2).

---

## 6. Edge cases already handled elsewhere — don't re-derive them

- **No-show / cancelled** — already price at $0 in `computeShiftGrossPay.ts`'s `NOT_WORKED` short-circuit (line 152); `applyMinEngagementFloor` explicitly no-ops on these (§5.2). The floor must not apply here; the employee never started.
- **Leave days** (annual/personal/parental/LSL/jury/FDV/PH-not-worked) — synthesised entirely through `leaveGrossPay.ts`, never passes through `mapShiftRowToGrossPayInput`/`calculateNetMinutes` at all. No gating needed — the floor logic is simply never called on this path.
- **Multiple engagements same day (casuals)** — `max-daily-engagements.ts` already treats each occasion of duty independently; the floor does the same — it runs per shift/timesheet row, off that row's own resolved billable window, never summed or shared across a day.
- **Unresolved billable window** (`source === 'missing'`) — the existing completeness guard (`timesheets.supabase.api.ts:621-645`, unchanged) still blocks reaching `approved` here. `applyMinEngagementFloor` only ever receives a real number once `calculateNetMinutes` has actually resolved one.
- **Overnight shifts** — `calculateNetMinutes` already handles the midnight-rollover sign check; the floor is applied to its output, no separate handling needed.
- **Manager tries to edit an already-topped-up shift** — `validateBillableEdit` (§5.4) re-checks the floor on every edit, so a manager can freely move billable times **above** the floor (e.g. correcting to a longer actual duration) but can never move them below it, at any point, not just on the first save.

---

## 7. Testing plan

- Unit tests for `requiredMinEngagementMinutes()` — training-wins-over-Sunday precedence, each tier boundary (exactly at 179/180/239/240/119/120 minutes).
- Unit tests for `applyMinEngagementFloor()` in `billable-time.test.ts` — below/at/above floor for each tier, no-show/cancelled no-ops, floor anchored to the resolved (possibly late) billable start rather than the rostered start.
- `computeShiftGrossPay.test.ts`: confirm a floored `netMinutes` input prices correctly (ordinary hours reflect the floor, Sat/Sun/PH segment split still derives correctly from the floored duration) — no code changes expected here, so these tests exist to prove that's actually true.
- `read-adapter.test.ts` (payroll): below-floor raw clocks → `mapShiftRowToGrossPayInput` returns the floored `netMinutes`.
- `timesheets.supabase.api.ts` tests: below-floor finished shift → `netLengthMinutes`/`estimatedPay` already reflect the floor before any approval action; audit log gets a `min_engagement_topup` entry once approved.
- `billable-edit.test.ts`: an edit that would net below the required minimum is rejected with the new error; an edit at or above the floor succeeds; an edit that's below floor but the shift is a training shift (2h) succeeds where it would've failed for a standard 3h shift at the same duration.
- `shift-ui.test.ts` (or equivalent): `getPayrollRuleBadges` returns the new "Topped Up to Min" badge state exactly when `wasToppedUp` is true, and falls back to existing Early/On-Time/Late labels otherwise.

## 8. Rollout

Consistent with how the rest of the AutoPilot/timesheet-lifecycle work on this branch has landed (per `autopilot-uniform-feature` — migrations written but not applied, workers not deployed): land as reviewable code + migrations first. Because §5.2 puts the fix in the shared resolver, this is lower-risk than a multi-surface change — but it does mean every consumer of `netLengthMinutes`/payroll `netMinutes` changes behaviour simultaneously the moment it ships, so it should go out as its own reviewable change, not bundled into unrelated work.

---

## 9. Open questions (need a decision before implementation)

1. **§5.4 UX** — reject-with-error vs. auto-suggest the floor end time when a manager's edit would net below the minimum. Both satisfy "manager can't go below the required net length"; this is a product/UX call, not a policy one.
2. **§5.6** — locate the exact AutoPilot timesheet adapter (this pass found the generic `core/autopilot/types.ts` engine and the `TimesheetHistoryPopover`/`timesheetAudit.api.ts` surfaces, but not the specific fixed-window auto-verify entry point from commit `7a12b14`) and confirm it reads `netMinutes` through `billable-time.ts` rather than a parallel calculation that would bypass the floor.
3. Whether payslip/report output should also show `wasToppedUp` as its own line item for transparency (§5.2's optional `hoursSource: 'topped_up'`), or whether folding it silently into ordinary hours is acceptable now that there's no exemption path to distinguish it from.
