# 3 · API Documentation

There is no REST/GraphQL layer of the module's own. "APIs" are (a) TypeScript
client functions that talk to Supabase via PostgREST, and (b) Postgres **RPCs**
invoked by the client or the worker. RLS is the authorization boundary (see
[07-security-permissions-errors.md](07-security-permissions-errors.md)).

## 3.1 Live client API — `timesheets.supabase.api.ts`

### `getShiftsForTimesheet(startDate, filters, endDate?) → TimesheetShiftRow[]`
[L122](../../src/modules/timesheets/api/timesheets.supabase.api.ts#L122)

- **Purpose:** load the grid. Reads `shifts` (lifecycle ∈ Published/InProgress/
  Completed, not soft-deleted) with org/dept/role/remuneration joins, then
  batch-fetches `profiles` (no FK) and the `timesheets` overlay by `shift_id`.
- **Called from:** `TimesheetPage.loadShifts`.
- **Filters:** organizationId, departmentId, subDepartmentId, shiftStatus,
  groupType, roleId (server-side); searchQuery (client-side).
- **Per-row computation:** billable resolution (`resolveBillableSide` ×2),
  `calculateNetMinutes`, clock-in/out variance vs `start_at`/`end_at` (overnight
  aware), estimated pay = `netMins/60 × hourlyRate`, adjusted-source flags.
- **Errors:** never throws — logs and returns `[]` on any error/exception.
- **Side effects:** none (read-only).

### `updateTimesheetEntry(shiftId, updates, opts?) → boolean` (throws `TimesheetConflictError`)
[L440](../../src/modules/timesheets/api/timesheets.supabase.api.ts#L440)

The single write path for the live grid (edit / approve / reject / metric
override). Upserts the `timesheets` row keyed by `shift_id`.

- **`updates`:** `clockIn/clockOut` (ISO only), `adjustedStart/adjustedEnd`,
  `status`, `notes`, `rejectedReason`, `length/netLength/approximatePay`,
  `paidBreak/unpaidBreak`, `arrival/departureVarianceReason`.
- **`opts.expectedVersion`:** optimistic-lock CAS. When supplied, the UPDATE adds
  `.eq('version', expected)`; zero rows updated ⇒ throws `TimesheetConflictError`.
- **Business rules enforced (in order):**
  1. **Finalized guard** — if current status ∈ {approved, rejected, no_show} and
     the change isn't a metric edit, it no-ops (returns true, idempotent).
  2. **No-show override** — editing metrics on a `no_show` clears
     `shifts.attendance_status` (note "No-Show overridden by manager").
  3. **Adjusted-time normalization** — a value equal to the snapped actual is
     stored as `null` (not a manual override); only genuine edits persist.
  4. **Reopen on edit** — editing metrics on a finalized row resets status to
     `submitted`.
  5. **Approval completeness guard** — refuses (`return false`) to approve a
     finished shift whose billable start or end resolves to `missing`.
  6. **PostgREST fallback** — if variance columns aren't in the schema cache
     (`PGRST204`), retries without them.
  7. **Insert path** — if no row exists, seeds `clock_in`/`clock_out` from actual
     or scheduled and inserts with `profile_id = employee_id = assigned_employee_id`.
  8. **Completion** — on approve, sets `shifts.lifecycle_status='Completed'`.
- **Audit:** owned by the DB trigger — no client-side audit insert.
- **Called from:** `handleSaveEntry`, `bulkUpdateTimesheetStatus`,
  `markShiftAsNoShow`.

### `bulkUpdateTimesheetStatus(ids, userId, status) → {success, failed}`
[L734](../../src/modules/timesheets/api/timesheets.supabase.api.ts#L734)

Loops `updateTimesheetEntry` over shift ids with a bulk note. Failures (e.g. the
completeness guard) increment `failed`; the page surfaces both counts.

### `markShiftAsNoShow(shiftId, userId) → boolean`
[L761](../../src/modules/timesheets/api/timesheets.supabase.api.ts#L761)

Sets `shifts.attendance_status='no_show'`, `lifecycle_status='Completed'`,
`last_modified_by`, then upserts a `no_show` timesheet with zero length/net/pay.

### Re-exports
`snapToQuarterHour`, `isShiftFinished` (from `domain/billable-time.ts`) for
external consumers like AttendancePage.

## 3.2 AutoPilot adapter API — `timesheetAutoPilot.api.ts`

`createTimesheetAutoPilotAdapter({ organizationId, userId })` returns an
`AutoPilotAdapter` (generic contract in `core/autopilot/types.ts`). All methods
**degrade to null/empty** when the tables aren't provisioned (`isTableMissingError`).

| Method | Reads/writes | Notes |
|--------|--------------|-------|
| `getPolicy()` | SELECT `timesheet_approval_rules` (org default) | → `{enabled, version, fields:{}}` or null. |
| `savePolicy(next)` | UPSERT `timesheet_approval_rules` | Writes only `enabled` (+`updated_by/at`); tolerance/window are fixed server-side. |
| `getRecentDecisions(limit)` | SELECT `timesheet_decisions` | For a global feed (Timesheets sets `showDecisionFeed:false`). |
| `getDecisionsForEntities(shiftIds)` | SELECT `timesheet_decisions` in shiftIds | Latest per shift → per-row chip map. |
| `revert(decision)` | RPC `sm_timesheet_auto_revert` | Requires `userId`; undoes a committed auto-verify. |

`TIMESHEET_AUTOPILOT_COPY` supplies the ON/OFF label, warning, and the 5-bullet
"how it works" explainer.

## 3.3 Audit reader — `timesheetAudit.api.ts`

`getTimesheetAuditTrail(shiftId) → TimesheetAuditEvent[]` — SELECT
`timesheet_audit_log` by `shift_id` (newest first), resolving actor UUIDs to names
via a batched `profiles` lookup. Degrades to `[]` if the table is missing.

## 3.4 Legacy client API (vestigial)

`timesheetReadApi` / `timesheetWriteApi` operate on an **empty in-memory array**.
`timesheetWriteApi.updateTimesheetStatus` enforces the `VALID_TRANSITIONS` table
(`DRAFT→SUBMITTED→APPROVED→LOCKED`, with `LOCKED` terminal). Not used by the live
page. See [01-architecture.md#17](01-architecture.md#17-notable-architectural-finding--two-api-lineages).

## 3.5 Database RPCs (invoked by client/worker)

| RPC | Caller | In | Out (jsonb codes) | Side effects |
|-----|--------|----|-------------------|--------------|
| `sm_timesheet_auto_decide(shift, idem_key, payload)` | worker | decision + variance snapshot | `COMMITTED` / `MANUAL_REVIEW` / `OUTSIDE_WINDOW` / `PREVIOUSLY_REVERTED` / `NOT_REVIEWABLE` / `DISABLED` / `IDEMPOTENT_REPLAY` / `GONE` / `FORBIDDEN` / `ERROR` | Inserts `timesheet_decisions`; on AUTO_APPROVE flips `timesheets.status='approved'` + `shifts.lifecycle_status='Completed'` (via GUC-tagged write). |
| `sm_timesheet_auto_revert(decision_id, actor)` | UI adapter | decision id | `REVERTED` / `ALREADY_REVERTED` / `NOT_REVERTABLE` / `NOT_FOUND` / `FORBIDDEN` | `approved→submitted`, clears `approved_*`, stamps `reverted_*`; audit logs `REVERTED`. |
| `sm_timesheet_queue_claim(worker, limit)` | worker | worker id, batch | rows | `PENDING/stale CLAIMED → CLAIMED` (SKIP LOCKED). |
| `sm_timesheet_queue_complete(id, status, err)` | worker | queue id | `SETTLED`/`NOT_FOUND` | DONE, or exp-backoff / DLQ. |
| `sm_timesheet_enqueue_backlog(org, days)` | (superseded) | org | `SWEEP_COMPLETE`/`OUTSIDE_WINDOW`/`DISABLED` | Enqueues daytime backlog. |

**AuthZ:** the decide/revert RPCs require the caller to be `is_admin()` or hold an
active gamma+ certificate (or be the service role with a null `auth.uid()`).
