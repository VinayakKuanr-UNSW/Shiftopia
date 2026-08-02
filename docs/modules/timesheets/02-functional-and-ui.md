# 2 · Functional & UI Documentation

## 2.1 Why the module exists (business problem)

Casual/part-time/full-time staff are rostered to shifts, clock in/out (from
elsewhere in the system — the Rosters/Attendance surfaces), and must be **paid for
the time actually worked**, adjusted for legitimate variances and breaks, in
compliance with an enterprise agreement (EBA). Raw clock data is noisy (early/late
punches, forgotten clock-outs, no-shows). A human (or an approved bot) must
**verify** the billable window before it becomes pay.

The Timesheets module solves:

- **Pay-accuracy** — one reviewed billable window per shift, priced identically by
  the timesheet UI and the payroll engine (shared resolver).
- **Auditability** — an immutable, per-shift provenance timeline of every action.
- **Throughput** — bulk approve/reject, and optional overnight auto-verification
  of the obvious (zero-variance) cases so managers only touch exceptions.
- **Compliance/governance** — variance reasons, terminal-state review gating, and
  RBAC on who can view vs edit.

## 2.2 Users & roles

| User | What they do here |
|------|-------------------|
| **Manager / supervisor** (Type Y: gamma→zeta) | Primary user. Review, adjust, approve/reject, mark no-show, bulk actions, export, toggle AutoPilot. |
| **Team member / employee** (Type X: beta) | **Read-only** view of their own timesheets (`timesheets_view` = beta). Receive approve/reject/adjust notifications. Do NOT approve. |
| **AutoPilot bot** (`service_role`) | Auto-verifies zero-variance timesheets overnight when a manager has turned it ON. |
| **Payroll** (downstream) | Consumes approved timesheets via `grossPay.read.api.ts` (not a UI in this module). |
| **System** | Auto clock-out, enqueue trigger, notifications, audit. |

Terminology assumptions baked into the system: shifts are in **Australia/Sydney**
wall-clock; a shift left un-clocked-out is auto-closed at **scheduled end (or
`start_at`+12.5 h)**; "on time" = within **±5 min** of roster for reasons, **±7.5
min** for auto-verify.

## 2.3 Screen: Timesheets page

File: [TimesheetPage.tsx](../../src/modules/timesheets/ui/TimesheetPage.tsx). Route
`/timesheet` (see notification deep-links and `AppRouter`).

### Layout

```
┌ GoldStandardHeader ─────────────────────────────────────────────┐
│ [Clock] Timesheets   ·  Scope selector (org/dept/subdept)        │
│ Row3: date navigator | view toggle (card/table) | search |       │
│        refresh | [AutoPilot control] | status tabs               │
└──────────────────────────────────────────────────────────────────┘
│ AttendanceMetricsBar (9 metrics, when shifts loaded)             │
│ ┌ TimesheetTable ───────────────────────────────────────────┐   │
│ │  timecard view  |  table view (24–25 columns)             │   │
│ └────────────────────────────────────────────────────────────┘   │
```

### Controls (what each does)

| Element | Behaviour | Source |
|---------|-----------|--------|
| **Scope selector** | Org/dept/subdept filter; managerial vs personal mode from `isManagerOrAbove()`; gamma-locked to a single org. | `useScopeFilter`, `TimesheetPage.tsx#L57` |
| **Date navigator** | Day/week/month range; drives the fetch window. | `UnifiedRosterNavigator` |
| **View toggle** | `timecard` (cards) ↔ `table` (dense grid). | `viewMode` state |
| **Search** | Client-side filter over employee name / role / department / sub-group / group. | `getShiftsForTimesheet#L380` |
| **Refresh** | Re-fetches shifts + AutoPilot decisions. | `handleRefresh` |
| **AutoPilot control** | Managers only (`timesheet-edit` + an org selected). ON/OFF switch + "i" explainer. | `AutoPilotControl` |
| **Status tabs** | All / Pending / Approved / Rejected / No-Show, each with a live count badge. | `TIMESHEET_STATUS_TABS`, `statusCounts` |

### States

- **Loading** — `loading` flag; refresh spinner in header.
- **Empty** — "No records found" cell when the filtered/sorted set is empty
  (`TimesheetTable.tsx#L349`).
- **Error** — toast "Error loading data" on fetch failure; the fetch itself
  returns `[]` on any Supabase error (never throws to the page).
- **Success** — toasts on each action ("Entry Updated", "Timesheet Approved",
  "Bulk action complete", "Shift marked as No-Show").
- **Filtering out** — Draft-lifecycle and Unassigned shifts are always excluded
  from the grid and counts (`TimesheetPage.tsx#L152`).

## 2.4 Component: `TimesheetTable`

File: [TimesheetTable.tsx](../../src/modules/timesheets/ui/components/TimesheetTable.tsx).
Owns filter/sort/bulk-select state shared by both mobile and desktop.

- **Two views:** `timecard` (`TimesheetTimecardView`) and `table` (24–25 column
  grid, min-width 2200 px, horizontally scrollable).
- **Column groups** (table view): Employee · Organization & Role · Scheduled ·
  Attendance (Actual) · Adjusted (inline edit) · Payroll & Diff · Statuses ·
  Actions.
- **Sorting:** click any `SortableHeader` to toggle asc/desc; string vs numeric
  aware.
- **Filtering:** `TimesheetFilterDrawer` (group, sub-group, role, status) + the
  search query, applied via `applyTimesheetFilters`.
- **Bulk select:** select-mode toggles checkboxes; only **reviewable** entries in
  `draft`/`submitted` are selectable (`isEntryReviewable`, `TimesheetTable.tsx#L141`).
  Bulk approve/reject call `onBulkAction`.
- **Export:** XLSX + PDF of the *currently filtered+sorted* view
  (`timesheet.export.ts`).
- **Mobile (<md):** `TimesheetMobileView` + `TimesheetMobileCard` render the same
  data as stacked cards with the same edit/approve affordances.

## 2.5 Component: `TimesheetRow` (the inline editor)

File: [TimesheetRow.tsx](../../src/modules/timesheets/ui/components/TimesheetRow.tsx)
(1128 lines — the richest component). Per-shift row with:

### Columns rendered

1. **Select** checkbox — disabled unless `draft`/`submitted` **and** reviewable.
2. **Employee** id + name; **Group / Sub-group / Role / Level** badges.
3. **Scheduled** start/end (roster).
4. **Clock (Actual)** in/out with per-side variance (`+Nm`/`-Nm`) and a red
   **"Missing"** badge when an active/completed shift lacks a punch.
5. **Adjusted (billable)** start/end — inline `<input type=time>` when editing;
   otherwise color-coded by source: **indigo=manual**, **sky=snapped**,
   **amber=auto clock-out**, muted-italic=none. A `BillableSourceIcon`
   (User/Clock/Bot) explains the source (F16 iconography, replacing a bare `*`).
6. **Length / Paid / Unpaid / Net** — auto-calculated; net = length − unpaid/60.
7. **Estimated cost** ("≈ …", award estimate, **NOT payroll** — carries the
   `COST_ESTIMATE_DISCLAIMER` tooltip).
8. **Differential** — billable length − scheduled length, colored ±.
9. **Time Rules** badge (attendance state), **Live Rules** (per-side manual
   override `*` + AutoPilot chip + History icon + `📝 editCount` badge),
   **Payroll Rules** (billable-vs-roster variance + variance-reason tooltip).
10. **Actions** (hover): Edit ✏️, Approve ✔️, Reject ✖️, Mark No-Show 🚫 — each
    gated (see below).

### Editing & modals

| Modal | Trigger | Validation | Effect |
|-------|---------|-----------|--------|
| **Inline edit** | Edit icon or clicking an adjusted cell | `validateBillableEdit` (format, 5-min granularity, end-after-start, break bounds) | Persists only the **changed** side(s). |
| **Billable variance reason** | Save when a changed side varies > ±5 min from roster | Requires an arrival and/or departure reason from fixed lists | Saves `arrival/departure_variance_reason`. |
| **Approve warnings** | Approve with any attendance warning | Requires an override reason if a warning is `error` severity | Sets status `approved` (+ optional note). |
| **Reject reason** | Reject | Reason mandatory | Sets status `rejected` + `rejected_reason`. |

### Action gating (visibility + enabled)

- **Edit / Approve / Reject** disabled while `reviewLocked` (`!isReviewable`) with
  tooltip "unlocks after clock-out, auto clock-out, or no-show".
- **Approve / Reject** shown only for `submitted`/`draft` and **not** `no_show`,
  and only when `!readOnly`.
- **Mark No-Show** shown only when both clocks are empty, the shift is over, not
  already `no_show`, `!readOnly`, and `onMarkNoShow` provided.
- **Finalized** rows (`approved`/`rejected`/`no_show`) show no edit affordances
  (though the API allows re-editing metrics, which reopens to `submitted`).

## 2.6 Component: `TimesheetHistoryPopover`

File: [TimesheetHistoryPopover.tsx](../../src/modules/timesheets/ui/components/TimesheetHistoryPopover.tsx).
A per-row History (📜) button (amber + pulsing when it "needs review") that lazily
loads the provenance timeline via `getTimesheetAuditTrail(shiftId)`. Renders each
event with an icon, human label, source chip (AutoPilot/Manager/Employee/System),
actor name, before→after diff for edits, variance reasons, and relative time. A
`📝 N EDITS` badge summarizes manager edits. `modal={false}` to avoid the
inert-dialog pointer-events bug.

## 2.7 Component: `AttendanceMetricsBar`

Shows 9 attendance metrics (punctuality, no-show rate, etc.) computed by
`computeAttendanceMetrics` over the loaded, assigned, non-draft shifts —
independent of the status tab. Same definitions as My Attendance + Insights.

## 2.8 Other components

| Component | Role |
|-----------|------|
| `TimesheetStatusBadge` / `ShiftStatusBadge` | Colored status pills. |
| `TimesheetHeader` (`TimesheetFunctionBar`) | Desktop function bar (view/search/filter/export/bulk). |
| `TimesheetFilterDrawer` | Categorical filters + `applyTimesheetFilters`/`countActiveFilters` helpers. |
| `TimesheetTimecardView` | Card grid view with per-card AutoPilot chip + selection. |
| `TimesheetMobileView` / `TimesheetMobileCard` | Mobile surface (parity with desktop row). |
| `timesheet.export.ts` | `exportTimesheetXLSX` / `exportTimesheetPDF`. |
| `TimesheetTable.utils.ts` | `timesheetEntryToShiftInput`, `isEntryReviewable`, hour math, `isShiftFinished` re-export. |
