# 7 · Security, Permissions & Error Handling

## 7.1 Authentication

Auth is Supabase Auth (JWT). `auth.uid()` is the caller in SQL; the client uses
`useAuth()`. Every DB access passes through Row-Level Security; SECURITY DEFINER
functions re-check the caller against `is_admin()` / access certificates.

## 7.2 Authorization model (certificates)

RBAC uses **access certificates** in two families
([access.policy.ts](../../src/platform/auth/access.policy.ts)):

- **Type X (personal):** `alpha` < `beta`.
- **Type Y (managerial):** `gamma` < `delta` < `epsilon` < `zeta`.

### Timesheets permission matrix

| Capability | Requirement | Source |
|-----------|-------------|--------|
| View own timesheets (read-only) | `timesheets_view` → Type X **beta** | `PERSONAL_PAGES` |
| Open the Timesheets manager page | `timesheets` → Type Y **gamma** | `MANAGERIAL_PAGES` |
| Edit / approve / reject / no-show (`timesheet-edit`) | gamma · delta · epsilon · zeta | [useAuth.ts#L99](../../src/platform/auth/useAuth.ts#L99) |
| Toggle AutoPilot policy | `timesheet-edit` + an org selected + `is_admin()`/gamma+ (DB RLS) | `TimesheetPage#L374`, RLS |
| Read AutoPilot decisions / audit log | gamma+ certificate or `is_admin()` | `timesheet_decisions_read` / `timesheet_audit_read` RLS |
| Run decide/queue RPCs | `service_role` only | `REVOKE … FROM anon` grants |
| Revert an auto-verify | gamma+ or `is_admin()` (and `authenticated` EXECUTE) | `sm_timesheet_auto_revert` |

The page computes `canEdit = hasPermission('timesheet-edit')`; when false the grid
is `readOnly` (locks + no action buttons), matching the beta read-only tier.

## 7.3 Row-Level Security (autopilot tables)

From [20260722100000#L473](../../supabase/migrations/20260722100000_timesheet_auto_verify.sql#L473):

- `timesheet_approval_rules` — ALL for org-scoped gamma+ or admin (USING + WITH CHECK).
- `timesheet_decisions` — SELECT for gamma+/admin; INSERT/UPDATE service_role only.
- `timesheet_audit_log` — SELECT for gamma+/admin; INSERT service_role; **append-only**
  (UPDATE/DELETE raise via `trg_timesheet_audit_append_only`).
- `timesheet_review_queue` — service_role only.
- `timesheets` — `FORCE ROW LEVEL SECURITY`; policies from the baseline model.

## 7.4 Ownership / access-control checks in code

- **Scope filter** confines a manager to their org(s); gamma is locked to one org
  (`isGammaLocked`).
- **DEFINER RPCs re-check the caller** even though RLS also applies (defence in
  depth): `sm_timesheet_auto_decide`/`_revert` return `FORBIDDEN` unless
  `is_admin()` or an active gamma+ cert (service role passes with null uid).
- **Grants explicitly REVOKE `anon`/`PUBLIC`** on every bot function (Supabase
  auto-grants EXECUTE to anon on new functions — see project memory
  `rls-cross-table-recursion-and-verification`).

## 7.5 Sensitive fields / audit

- Money-adjacent fields (billable times, breaks, pay estimate) are governed by the
  review gate + variance reasons + immutable audit.
- **Provenance is unbypassable:** the audit trigger fires on every `timesheets`
  write (bot, manager, system); bot vs human is disambiguated by the
  `app.timesheet.autopilot` GUC, not by trusting the client.
- No PII beyond employee name is rendered; actor UUIDs resolve to names only for
  display.
- **Encryption:** at-rest/in-transit handled by Supabase/Postgres platform — **Not
  verified** at the app layer (no app-level field encryption in this module).

## 7.6 Error handling

| Layer | Strategy |
|-------|----------|
| **Read (`getShiftsForTimesheet`)** | Try/catch → logs, returns `[]`. Never throws to the page. |
| **Write (`updateTimesheetEntry`)** | Returns `false` on guard failures/errors; **re-throws `TimesheetConflictError`** so the page can prompt refresh. `PGRST204` variance-column fallback retry. |
| **Bulk** | Aggregates `{success, failed}`; page surfaces both (a silent skip would look like success). |
| **AutoPilot / audit adapters** | `isTableMissingError` → return null/empty so an un-provisioned feature is inert, never a crash. |
| **DB triggers** | Provenance + notification + enqueue triggers wrap bodies in `EXCEPTION WHEN OTHERS → RAISE WARNING; RETURN NEW` so an audit/notify failure can **never block** a timesheet write. |
| **Review gate** | The one trigger that *does* raise (`check_violation`) — deliberately blocks illegal writes. |
| **Worker** | Per-row try/catch → `RETRY` (exp-backoff, then `DLQ` at `max_attempts`). Fails **closed** outside the window / on TZ resolution failure. |
| **Idempotency** | `timesheet_decisions.idempotency_key` UNIQUE + queue `(shift_id, idempotency_key)` UNIQUE → replays are `IDEMPOTENT_REPLAY`, no double approve. |

### UI error/success surfaces

Toasts: "Error loading data", "Entry Updated", "Update failed" (+ hint about
missing clock-in/out), "Changed by someone else" (conflict), "Timesheet
Approved/Rejected", "Bulk action complete" / "Some shifts were not updated",
"Shift marked as No-Show". Validation errors render inline in the edit cell +
a toast.

## 7.7 Monitoring / observability

- **`timesheet_audit_log`** — full provenance timeline (per-shift History popover).
- **`timesheet_decisions`** — every bot decision + variance snapshot + revert.
- **`timesheet_review_queue`** — queue depth, attempts, `last_error`, DLQ.
- Worker returns a `WorkerSummary` (claimed/committed/manual_review/done/retried/errors).
- **Retry/rollback:** the worker never writes timesheets directly; the RPC owns
  the transactional commit, and a committed auto-verify is fully reversible via
  `sm_timesheet_auto_revert` (a manager Undo).
