# Timesheets Module — Complete Documentation

> Generated 2026-07-25 from a full read of the codebase. Every statement is
> backed by a file/line reference. Anything that could not be confirmed from
> code, schema, or tests is explicitly marked **Not verified**.

This folder is the single source of truth for the **Timesheets** module of
Superman_ULTIMATE: what it does, how it is built, every workflow, business rule,
API, table, permission, calculation, and integration.

## Documents

| # | File | Covers |
|---|------|--------|
| 0 | [README.md](README.md) | Executive summary · glossary · deployment status · index |
| 1 | [01-architecture.md](01-architecture.md) | Layered architecture · dependency graph · data-flow · class diagram |
| 2 | [02-functional-and-ui.md](02-functional-and-ui.md) | Business problem · users · every screen/component/button/modal |
| 3 | [03-api.md](03-api.md) | Every client API function + every DB RPC (route/payload/side effects) |
| 4 | [04-database.md](04-database.md) | Every table/column/index/trigger/RPC · ER diagram |
| 5 | [05-business-rules-and-validations.md](05-business-rules-and-validations.md) | Every rule, validation, and calculation with formulas + edge cases |
| 6 | [06-workflows-and-diagrams.md](06-workflows-and-diagrams.md) | Step-by-step workflows · sequence diagrams · flowcharts |
| 7 | [07-security-permissions-errors.md](07-security-permissions-errors.md) | AuthN/Z · RLS · permissions matrix · error handling |
| 8 | [08-autopilot-auto-verify.md](08-autopilot-auto-verify.md) | AutoPilot (auto-verify) deep dive: queue, worker, cron, revert |
| 9 | [09-developer-guide-faq-traceability.md](09-developer-guide-faq-traceability.md) | FAQ · troubleshooting · extension guide · code traceability |

## Executive summary

The Timesheets module is the **manager-facing pay-verification surface**. It does
**not** collect time from employees via a punch clock inside this module; instead
it **overlays** an editable "timesheet" record on top of each already-scheduled
**shift** and presents managers a reviewable grid of *scheduled vs actual vs
billable* time so they can **approve, reject, adjust, or mark no-show** each shift
before it flows to payroll.

Core ideas:

1. **Shift is primary; timesheet is an overlay.** The page reads `shifts` (with
   clock data on `actual_start`/`actual_end`) and left-joins an optional
   `timesheets` row keyed by `shift_id`. A timesheet row is created lazily on the
   first manager edit/decision. See [getShiftsForTimesheet](../../src/modules/timesheets/api/timesheets.supabase.api.ts#L122).

2. **Three-tier billable time.** Billable start/end resolve through one canonical
   rule — *manager edit → snapped actual (nearest 15 min) → "missing"* — never
   silently falling back to the scheduled time. This ONE resolver
   ([billable-time.ts](../../src/modules/timesheets/domain/billable-time.ts)) is
   shared by the timesheet reader **and** the payroll gross-pay adapter so pay is
   priced from the exact minutes the manager reviewed.

3. **Terminal-attendance review gate.** A manager can only approve/reject/edit
   once a shift reaches a terminal attendance state (clock-out, auto clock-out at
   the 12.5 h horizon, or no-show). Enforced on both the client
   ([isTimesheetReviewable](../../src/modules/rosters/domain/shift-ui.ts#L727))
   and the database
   ([enforce_timesheet_review_gate](../../supabase/migrations/20251015000000_baseline_schema.sql#L5741)).

4. **AutoPilot (auto-verify).** An optional, per-org **ON/OFF** bot that
   auto-approves *zero-variance clean punches* (both punches within ±7.5 min of
   schedule, no manual edits) overnight (18:00–06:00 Australia/Sydney). It is one
   instance of a generic AutoPilot framework shared with Swaps and Bids. See
   [08-autopilot-auto-verify.md](08-autopilot-auto-verify.md).

5. **Immutable provenance.** Every timesheet write (bot, manager, or system) is
   logged to an append-only `timesheet_audit_log` by a database trigger that no
   write path can bypass, surfaced in a per-row History popover.

## ⚠️ Deployment status (updated 2026-07-25 — verified against prod)

- **AutoPilot has been REMOVED from the Timesheets module** (code) as of
  2026-07-25. `AutoPilotControl`, the adapter (`timesheetAutoPilot.api.ts`), and
  the per-row decision chip are gone; the shared `core/autopilot/` framework
  remains for Swaps/Bids. The autopilot DB tables/RPCs still exist in prod but are
  unused by this module. **Sections referring to AutoPilot below are historical.**
- **Lifecycle drift reconciled in prod** (migrations `20260725011041/011118/011129`):
  `edit_count` column + trigger, `version`-bump trigger (F18), an autopilot-free
  provenance trigger → append-only `timesheet_audit_log` (History popover), and the
  `timesheet_adjusted` notification. **These are now live in prod.**
- **Employee notifications work in prod**: approve/reject via the long-standing
  `after_timesheet_decision` trigger, plus the new adjust-without-approve notice.
- The core review path (grid, edit, approve/reject, no-show, audit, notifications)
  is fully wired against the live `shifts`/`timesheets` schema.

## Glossary

| Term | Meaning |
|------|---------|
| **Shift** | A scheduled work assignment (`shifts` table). The primary record; the timesheet overlays it. |
| **Timesheet** | Per-shift editable pay record (`timesheets` table), keyed by `shift_id`. Created lazily. |
| **Actual / Clock** | Real attendance instants `shifts.actual_start` / `actual_end`. Never overwritten by the module. |
| **Adjusted / Billable** | The time we actually pay for. Resolved via the three-tier rule. Stored on `timesheets.start_time`/`end_time`. |
| **Snapped** | An actual punch rounded to the nearest 15 min (used when no manual edit exists). |
| **Auto clock-out** | System-applied close of a shift left un-clocked-out, at scheduled-end/`start_at`+12.5 h. |
| **No-Show** | Shift ended, employee never clocked in. `attendance_status = 'no_show'`. Zero hours/pay. |
| **Variance** | Difference between billable and rostered time. ±5 min grace before a *reason* is required. |
| **AutoPilot** | Per-org ON/OFF bot that auto-verifies zero-variance timesheets. No "shadow" mode. |
| **Live Rules / Time Rules / Payroll Rules** | The three badge columns: attendance state, per-side manual override, and billable-vs-roster variance. |
| **Certificate / Access level** | RBAC unit. Type X (personal: alpha/beta), Type Y (managerial: gamma→zeta). |
