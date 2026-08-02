# 5 · Business Rules, Validations & Calculations

Every rule below cites where it is implemented and, where relevant, the edge case
it exists to close.

## Status model

- **Live status set:** `draft → submitted → approved / rejected`, plus `no_show`.
  Editing metrics on a finalized row **reopens** it to `submitted`
  ([updateTimesheetEntry#L569](../../src/modules/timesheets/api/timesheets.supabase.api.ts#L569)).
- **`locked`** exists only in the TS model + payroll's "final for pay" set; **Not
  verified** in the DB enum ([grossPay.read.api.ts#L85](../../src/modules/payroll/data/grossPay.read.api.ts#L85)).
- The strict `DRAFT→SUBMITTED→APPROVED→LOCKED` transition validator lives in the
  **vestigial** `timesheets.write.api.ts` and does not gate the live path.

## R1 · Terminal-attendance review gate  (the central rule)

A manager may **approve / reject / edit billable times** only once the shift has a
**terminal attendance outcome**:

- No-Show (ended, never clocked in), OR
- a recorded clock-out (`actual_end` set), OR
- an **auto clock-out** (system closed the shift at `end_at` / `start_at`+12.5 h).

Non-terminal states (Scheduled, Awaiting Check-In, Missing, mid-shift, **Working
Overtime**) block review.

- **Client:** `isTimesheetReviewable` ([shift-ui.ts#L727](../../src/modules/rosters/domain/shift-ui.ts#L727)),
  wired through `isEntryReviewable`. Drives disabled buttons + tooltips + bulk-
  select eligibility.
- **Database (authoritative):** `enforce_timesheet_review_gate` trigger + the SQL
  `is_shift_timesheet_reviewable` function
  ([baseline#L5741 / #L9515](../../supabase/migrations/20251015000000_baseline_schema.sql#L5741)).
  A blocked write raises `check_violation`.
- **Edge case:** "Working Overtime" (shift ended, still clocked in, no auto-out
  yet) has a departure badge but is **not** terminal — explicitly excluded
  ([shift-ui.ts#L739](../../src/modules/rosters/domain/shift-ui.ts#L739)).

## R2 · Three-tier billable resolution (per side, independent)

For each of start and end, resolve in order
([resolveBillableSide](../../src/modules/timesheets/domain/billable-time.ts#L127)):

1. **`manual`** — a manager-entered `timesheets.start_time`/`end_time` wins.
2. **`snapped`** — no manual edit AND the shift is finished → the actual punch
   **snapped to the nearest 15 min** ([snapToQuarterHour](../../src/modules/timesheets/domain/billable-time.ts#L51)).
3. **`missing`** — finished, no manual edit, no actual clock → a **genuine gap**
   (rendered blank). Deliberately **NOT** filled from the schedule.
4. **`null`** — shift not finished yet; nothing to resolve.

- **Why:** the same resolver prices the timesheet grid AND payroll gross pay, so a
  forgotten clock-out can never be silently priced from the scheduled time. The
  file header documents the two bugs this closed (scheduled fallback + stale
  `is_overnight` double-count) — [billable-time.ts#L1-L15](../../src/modules/timesheets/domain/billable-time.ts#L1).
- Each side resolves **independently** — a manager can edit only one side and the
  other still falls through its own chain (mirrors the per-side `*` badge).

## R3 · Approval completeness guard

A finished shift cannot be moved to `approved` while either billable side resolves
to `missing` (forgotten clock-in/out with no manager edit). Returns `false`; UI
surfaces "…missing clock-in/out that needs an adjusted time first."
([updateTimesheetEntry#L598](../../src/modules/timesheets/api/timesheets.supabase.api.ts#L598)).
Tested in [approval-gate.test.ts](../../src/modules/timesheets/api/__tests__/updateTimesheetEntry.approval-gate.test.ts).

## R4 · Optimistic concurrency (F18)

Two managers must not silently overwrite each other. Every `timesheets` UPDATE
bumps `version` (`trg_timesheet_version_bump`). The client passes the loaded
`version`; the write adds `.eq('version', expected)`. A stale save matches zero
rows → `TimesheetConflictError` → toast "Changed by someone else" + auto-refresh.
Bulk/legacy paths that pass no version keep last-write-wins.

## R5 · Billable-edit validation (F6)

[validateBillableEdit](../../src/modules/timesheets/domain/billable-edit.ts#L57):

| Check | Rule | Message |
|-------|------|---------|
| Format | `HH:MM` / `HHMM` (auto-formatted) | "Invalid time format. Use HH:MM or HHMM." |
| Granularity | minutes % 5 == 0 | "Billable times must be on 5-minute increments." |
| Order | end after start (overnight-aware) | "Adjusted end time must be after start time." |
| Break ≥ 0 | unpaidBreak ≥ 0 | "Unpaid break cannot be negative." |
| Break ≤ shift | unpaidBreak ≤ gross | "Unpaid break exceeds the shift length." |

It also reports which sides **changed** and which changed sides now vary from
roster (drives R6). Only changed sides are persisted, so an untouched
snapped/auto side never becomes a manual override
([TimesheetRow.tsx#L352](../../src/modules/timesheets/ui/components/TimesheetRow.tsx#L352)).

## R6 · Variance reasons (payroll governance)

If a **changed** billable side varies from the roster by **more than ±5 min**
(`VARIANCE_GRACE_MIN`), the manager must pick a reason from a fixed list before
saving ([variance-reasons.ts](../../src/modules/timesheets/domain/variance-reasons.ts)):

- **Arrival:** Approved early start · Operational demand · Opening/setup duties ·
  Training or handover · Corrected clock in error · Other.
- **Departure:** Approved early finish · Low customer demand · Shift covered by
  another employee · Personal emergency (approved) · Corrected clock out error ·
  Approved overtime · Overtime — operational need · Other.

Stored in `arrival_variance_reason` / `departure_variance_reason`; a side that
returns on-roster clears its stale reason. Departure variance uses a **wrap-safe**
distance so overnight ends don't false-trigger ([billable-edit.ts#L116](../../src/modules/timesheets/domain/billable-edit.ts#L116)).

## R7 · Approve-with-warnings override

Approving a shift with attendance warnings opens a modal. `error`-severity
warnings (e.g. missing clock-in on an active/completed shift, review still locked)
require an **override reason** (saved to `notes`, visible to the employee). Warning
list built in [TimesheetRow.tsx#L187](../../src/modules/timesheets/ui/components/TimesheetRow.tsx#L187).

## R8 · Reject requires a reason

Reject always opens a modal demanding a reason (`rejected_reason`), surfaced to the
employee via notification and the row's action-note tooltip.

## R9 · No-Show handling

`markShiftAsNoShow`: shift → `attendance_status='no_show'`,
`lifecycle_status='Completed'`; timesheet upserted with **zero** length/net/pay.
No-Show rows are excluded from approve/reject and shown red. A No-Show can be
**overridden** by editing metrics, which clears the shift's no_show status.

## R10 · Draft & Unassigned exclusion

`Draft`-lifecycle shifts and Unassigned shifts are filtered out of the grid,
counts, and metrics ([TimesheetPage.tsx#L152](../../src/modules/timesheets/ui/TimesheetPage.tsx#L152)).

## R11 · Timezone rule

All times render as **Australia/Sydney** wall-clock regardless of the viewer's
browser TZ. ISO instants are formatted via `formatInTimezone`; scheduled fallbacks
use `parseZonedDateTime` with `SYDNEY_TZ`; snapping reads ISO timestamps as Sydney
wall-clock. (See project memory `timezone-aest-display`.)

## Calculations

| Quantity | Formula | Source |
|----------|---------|--------|
| **Scheduled minutes** | `end−start` (overnight +24 h) or `shifts.scheduled_length_minutes` | `calculateMinutes` / supabase api |
| **Net billable minutes** | `max(0, (billableEnd−billableStart, overnight +24h) − unpaidBreak)`; **null** if either side unresolved | [calculateNetMinutes](../../src/modules/timesheets/domain/billable-time.ts#L152) |
| **Estimated pay** | `netMinutes/60 × hourlyRate` (rate = `remuneration_levels.hourly_rate_min` ?? `shifts.remuneration_rate`) | supabase api `#L261` |
| **Clock-in variance** | `round((effectiveStart − scheduledStart)/60000)` min; effective = manual edit ?? actual_start | supabase api `#L276` |
| **Clock-out variance** | `round((effectiveEnd − scheduledEnd)/60000)` min, overnight-corrected | supabase api `#L283` |
| **Differential (UI)** | billable length − scheduled length (hours) | `TimesheetRow` `calculatedValues` |
| **`total_hours` (DB)** | `round(epoch(end_time−start_time)/3600 − break_minutes/60, 2)` GENERATED | `timesheets` table |
| **Snap** | `round((m + s/60)/15) × 15`; 60 → next hour | `snapToQuarterHour` |
| **Auto-verify variance** | `round((actual − scheduled)/60000)`; AUTO_APPROVE iff `|varIn|≤7.5 ∧ |varOut|≤7.5` | [variance.ts](../../supabase/functions/auto-verify-timesheets/variance.ts) |

### Rounding rules

- **Billable snap** → nearest **15 min**.
- **Estimated pay** → 2 dp.
- **Edit granularity** → **5-min** increments enforced.
- **Auto-verify tolerance** → **±7.5 min** (fixed, not the DB `tolerance_minutes`).

### Payroll / billing / utilization interaction

- Payroll (`grossPay.read.api.ts`) prices **only** shifts whose timesheet status ∈
  {approved, locked} by default (`approvedOnly`), using the **same** billable
  resolver — pay == the minutes the manager reviewed.
- Leave pay is synthesised from `leave_requests`, **not** timesheets. Allowances
  are not represented on timesheet data. Overtime is **not** modelled here (a
  late-out past +7.5 m simply routes to a manager).
- The grid's "≈" pay column is an **award estimate**, explicitly **not** payroll
  (`COST_ESTIMATE_DISCLAIMER`).
