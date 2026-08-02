# 9 · Developer Guide · FAQ · Troubleshooting · Extension · Traceability

## 9.1 Developer FAQ

**Q: How do approvals actually work?**
Manager clicks Approve → `updateTimesheetEntry(shiftId, {status:'approved'}, {expectedVersion})`.
The DB review-gate trigger requires a terminal shift; the completeness guard
requires both billable sides resolved; version-CAS prevents clobber; on success
`timesheets.status='approved'` + `shifts.lifecycle_status='Completed'`; the
provenance + notification triggers fire. Bot approvals go through
`sm_timesheet_auto_decide` instead.

**Q: Where do calculations happen?**
Net minutes / snap / overnight in [billable-time.ts](../../src/modules/timesheets/domain/billable-time.ts);
variance minutes + estimated pay in [timesheets.supabase.api.ts](../../src/modules/timesheets/api/timesheets.supabase.api.ts#L245);
UI hour math in [TimesheetTable.utils.ts](../../src/modules/timesheets/ui/components/TimesheetTable.utils.ts);
`total_hours` is a **generated column** in the DB.

**Q: Where does validation occur?**
Client: [billable-edit.ts](../../src/modules/timesheets/domain/billable-edit.ts)
(format/5-min/order/break) + variance-reason requirement. Server: review-gate
trigger + approval completeness guard + version CAS.

**Q: Where do notifications originate?**
The `trg_timesheet_outcome_notification` trigger (`notify_user`) on `timesheets`
UPDATE — approve / reject / manager-adjust. Enum value `timesheet_adjusted` added
in a **separate** migration (Postgres can't use a new enum value in the same tx).

**Q: How do I debug a "can't approve" issue?**
Check, in order: is the shift **reviewable** (terminal attendance)? does a billable
side resolve to `missing` (forgotten punch)? is there a stale `version` (conflict)?
is the user `readOnly` (lacks `timesheet-edit`)? The History popover +
`timesheet_audit_log` show what happened.

**Q: Why is a billable cell blank / italic?**
Source is `missing` — the shift finished with no manual edit and no actual clock.
It's a deliberate signal ("needs a manager"), not priced from schedule.

**Q: Why does `useTimesheets()` return nothing?**
It reads the **vestigial** in-memory store. The live page uses
`getShiftsForTimesheet` directly. Don't build on the legacy hooks/context.

**Q: How is bot vs manager distinguished in the audit?**
The `app.timesheet.autopilot` session GUC (set by the decide RPC) — not client
trust. Present ⇒ `AUTO_APPROVED`/bot; absent ⇒ `MANUALLY_APPROVED`/manager.

## 9.2 Common pitfalls

- **Migration file ≠ applied.** The AutoPilot tables/triggers/RPCs are NOT in prod
  yet; the client tolerates their absence (`isTableMissingError`). Don't assume
  `timesheet_decisions` exists.
- **The `tolerance_minutes` column is a decoy** — tolerance is fixed ±7.5 in
  `variance.ts`. Same for the windowing columns (fixed 18:00–06:00 in code).
- **`locked` status** is TS-model-only; the DB enum uses draft/submitted/approved/
  rejected/no_show.
- **Don't overwrite an untouched billable side** — only persist sides the manager
  changed, or you silently convert snapped/auto into a manual `*` override.
- **Timezone:** always pass raw ISO instants (not formatted strings) into the Live
  Rules engine / review gate, or overnight shifts and non-Sydney viewers
  misclassify.
- **New enum value + trigger** must be in **two** migrations (Postgres tx rule).

## 9.3 Extension guide

| To add… | Do this |
|---------|---------|
| A new **variance reason** | Append to `ARRIVAL_/DEPARTURE_VARIANCE_REASONS` in [variance-reasons.ts](../../src/modules/timesheets/domain/variance-reasons.ts). Reportable, no migration. |
| A new **audit event type** | Emit it from `fn_timesheet_provenance` (or the decide RPC) and add a row to `EVENT_META` in `TimesheetHistoryPopover.tsx`. |
| A new **timesheet column** | Migration (additive) → extend `TimesheetShiftRow` mapping in `getShiftsForTimesheet` → thread through `updateTimesheetEntry` payload → UI. |
| A new **AutoPilot policy knob** | Add to `POLICY_FIELDS` in the adapter + persist in `savePolicy`; the generic control renders it. (Currently intentionally empty — pure ON/OFF.) |
| Change the **auto-verify rule** | Edit the pure `evaluateTimesheet` in `variance.ts` + its unit tests; the commit gateway is unaffected. |
| A **new AutoPilot domain** | Implement the `AutoPilotAdapter` contract; reuse `<AutoPilotControl>`/`<AutoPilotDecisionChip>`. Mirror this module + swaps. |
| Change the **review gate** | Update BOTH `isTimesheetReviewable` (client) and `is_shift_timesheet_reviewable` (SQL) — they must agree. |

## 9.4 Build / test gates

- Type check: `npx tsc --noEmit` (target 0 errors).
- Unit tests: `vitest` — module tests in
  `src/modules/timesheets/{api,domain}/__tests__/` (approval-gate, concurrency,
  billable-time, billable-edit); worker rule test under
  `supabase/functions/auto-verify-timesheets/__tests__/`.
- ESLint is broken repo-wide (project memory `eslint-broken-use-tsc-vitest`) —
  gates are tsc + vitest + build.

## 9.5 Code traceability map

| Concern | File · symbol · line |
|---------|----------------------|
| Grid fetch | `timesheets.supabase.api.ts` · `getShiftsForTimesheet` · L122 |
| Write / approve / reject | `timesheets.supabase.api.ts` · `updateTimesheetEntry` · L440 |
| Approval completeness guard | same · L598 |
| Optimistic-lock CAS + conflict | same · L617, `TimesheetConflictError` · L432 |
| Bulk status | same · `bulkUpdateTimesheetStatus` · L734 |
| No-show | same · `markShiftAsNoShow` · L761 |
| 3-tier billable | `domain/billable-time.ts` · `resolveBillableSide` · L127 |
| Snap 15-min | same · `snapToQuarterHour` · L51 |
| Net minutes | same · `calculateNetMinutes` · L152 |
| Finished check | same · `isShiftFinished` · L87 |
| Edit validation | `domain/billable-edit.ts` · `validateBillableEdit` · L57 |
| Variance grace + reasons | `domain/variance-reasons.ts` · `VARIANCE_GRACE_MIN` · L10 |
| Review gate (client) | `rosters/domain/shift-ui.ts` · `isTimesheetReviewable` · L727 |
| Page state + actions | `ui/TimesheetPage.tsx` · L53 |
| Inline editor + modals | `ui/components/TimesheetRow.tsx` · L98 |
| History timeline | `ui/components/TimesheetHistoryPopover.tsx` · `EVENT_META` · L15 |
| AutoPilot adapter | `api/timesheetAutoPilot.api.ts` · `createTimesheetAutoPilotAdapter` · L113 |
| Audit reader | `api/timesheetAudit.api.ts` · `getTimesheetAuditTrail` · L68 |
| Generic autopilot types | `core/autopilot/types.ts` |
| Payroll consumer | `payroll/data/grossPay.read.api.ts` · `APPROVED_STATUSES` · L85 |
| Permissions | `platform/auth/access.policy.ts` · L40/L47; `useAuth.ts` · L99 |
| **DB** — timesheets table | `20251015000000_baseline_schema.sql` · L20968 |
| **DB** — review gate | same · `enforce_timesheet_review_gate` · L5741; `is_shift_timesheet_reviewable` · L9515 |
| **DB** — autopilot core | `20260722100000_timesheet_auto_verify.sql` |
| **DB** — fixed window + snap | `20260723130000_timesheet_autopilot_fixed_window.sql` |
| **DB** — edit_count / version / variance / notify | `20260724000000` / `…002000` / `…004000` / `…003000`+`…003100` |
| **Worker** | `supabase/functions/auto-verify-timesheets/{index,variance}.ts` |

## 9.6 Git history (recent, this feature)

`7a12b14` AutoPilot fixed-window auto-verify + Payroll Rules + F16 icons +
concurrency + notifications + variance reasons · `0408303` AutoPilot ON/OFF +
timesheet lifecycle audit · `2c3f9fa` unify AutoPilot header controls ·
`dce98c5` uniform AutoPilot (OFF/SHADOW/LIVE). Branch `feat/autopilot-uniform-onoff`.

## 9.7 Not-verified items (honest audit)

- DB `timesheet_status` enum membership of `locked` (code says the DB lacks it).
- Exact `timesheets` RLS SELECT/write policy predicates (inherited from baseline;
  not re-read here).
- The `pg_cron` schedule for the worker (not present in any migration; a deploy-time step).
- App-layer encryption of sensitive fields (none found; platform-level only).
- `max_auto_per_employee_per_week` enforcement (column exists; worker does not read it).
