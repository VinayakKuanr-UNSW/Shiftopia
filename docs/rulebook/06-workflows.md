# Chapter 6 — Workflow Documentation (Phase 6)

**Confidence:** each workflow cites its source chapter or fresh research below. Where a workflow turned out not to exist as designed (onboarding, payroll persistence), that absence is itself the documented finding — verified by exhaustive grep for callers, not assumed from missing UI alone.

## Two findings that reframe this chapter before the detail

1. **There is no functioning employee onboarding or offboarding workflow**, despite the schema being built for one. See §2.
2. **The payroll "workflow" is a non-persisted, on-demand calculator** — pay-period locking, gross-pay persistence, and export are fully built and tested but have zero callers anywhere in the app. See §12.

Both are exactly the kind of gap Phase 17 (Production Audit) is meant to surface — flagged here rather than held back, since they materially change how a new engineer should read the rest of this chapter: several "workflows" below describe what the schema *supports*, not necessarily what a human actually does today.

---

## 1. Authentication

**Actors:** any user; system (`handle_new_user` trigger).
**Preconditions:** none for login attempt; an active contract or certificate is required to get past `/pending-access` (see §2).
**Happy path:** `/login` → `AuthProvider.login()` → `supabase.auth.signInWithPassword` → `auth.service.ts` fetches `profiles` + active `user_contracts` + active `app_access_certificates` → `resolve_user_permissions()` RPC resolves effective scope → `AuthLayout` gate passes → user lands on `getLandingPage()`'s target (gamma+ → `/rosters`, else `/my-roster`).
**⚠ Finding (OPEN, minor):** `LoginPage.tsx` hardcodes its own post-login fallback redirect to `/my-roster` instead of calling the same `getLandingPage()` helper `SignUpPage.tsx` and `UnauthorizedPage.tsx` use — harmless in practice (every route re-gates regardless) but an inconsistency a future refactor could turn into a real bug.
**Alternative paths / failures:** wrong credentials → Supabase Auth error surfaced inline; no active contract → redirected to `/pending-access`; mobile viewport on a desktop-only route → `MobileAccessGuard` blocks with a "Desktop Required" screen.
**Full detail:** Ch. 8 §2-3 (gate mechanism, role model), Ch. 2 §11 (sequence diagram).

---

## 2. Employee onboarding & offboarding

**⚠ Finding (OPEN, significant process gap):** confirmed by exhaustive grep, not absence-of-evidence — there is no admin "Add Employee"/"Invite User" flow anywhere in `src/`. `employee.service.ts` is entirely read-only. The only way a person enters the system is self-signup, and the only way access is later revoked is a hard delete. This is a genuine gap between what the schema supports and what the product does.

**Actors:** the prospective employee (self-signup only); an Epsilon/Zeta admin (contract + certificate provisioning — manual, two separate actions).

**Happy path (3 steps, fully decoupled, no automation linking them):**
1. **Self-signup**: employee submits `/signup` (name/email/password) → `supabase.auth.signUp()` writes only to `auth.users` → `handle_new_user()` trigger inserts a minimal `profiles` row (id/email/first_name/last_name; everything else defaults — `employee_code` stays permanently `NULL` on this path, since the richer `create_profile_for_user()` RPC that would generate one is dead code, never called from `src/`).
2. Employee logs in, `hasActiveContracts` is false (no contract, no certificate) → routed to `/pending-access`, which tells them to contact an admin. **No notification is sent to any admin that a new signup is waiting** — an admin only discovers pending users by manually checking each profile.
3. **Contract assignment** (admin, `/users` → `AddContractDialog`): inserts an `hr.user_contracts` row (org/dept/subdept/role/remuneration/employment-type/hours). This alone clears `/pending-access` — **a contract with no certificate grants a default "alpha" (employee) access level via a client-side fallback (`|| 'alpha'`), not an explicit grant.**
4. **Certificate grant** (admin, same page, separate optional action): inserts an `app_access_certificates` row for elevated (gamma+) access, gated by `auth_can_manage_certificates()` server-side and a stricter Epsilon/Zeta-only check client-side.

**DB writes:** `auth.users` (signup) → `profiles` (trigger) → `hr.user_contracts` (admin) → `app_access_certificates` (admin, optional). No table in this chain is a notification or audit table — **there is no audit trail of who granted which access to whom, when**, beyond a plain `created_by`/`created_at` column on the row itself.

**⚠ Findings (all OPEN):**
- **No "pending users" admin view** — `/users` lists every profile in one flat list; an admin must check each one's Contracts section to find who's stuck.
- **UI/RLS gate mismatch**: the contract-management UI only renders for Epsilon/Zeta, but the underlying RLS policy (`contracts_manage_delta`) only requires Delta — a Delta manager could write `hr.user_contracts` directly via the API even though the button is hidden from them.
- **No offboarding workflow exists**, despite `hr.user_contracts.status` supporting `Active/Inactive/Terminated` and `profiles` having a `termination_date` column — no UI ever sets either. The only "removal" actions are hard-deleting a contract row or `delete_user_entirely()` (full account wipe, including nulling FK references across shifts/timesheets/rosters). There is no graceful "terminate effective [date], revoke access, retain history" path.
- **Bootstrap gap**: the very first admin account has no in-app path to get `legacy_system_role='admin'` or an initial Epsilon/Zeta certificate — must be set via raw SQL outside the application.
- Dead code found along the way: a second, unused `AuthContext.tsx`; an orphaned `hr.employees` table with no FK to `auth.users` and zero live callers; `create_profile_for_user()`.

---

## 3. Scheduling (manual roster building)

**Actors:** Manager (gamma+, `rosters` feature).
**Preconditions:** a roster/department scope selected; optionally a template to apply.
**Happy path:** Manager opens `/rosters` (`RostersPlannerPage`) → creates shifts individually (`ShiftFormPage`, `/rosters/shift/new`) or applies a template in bulk (`templates` module → `publish_template_range` RPC) → each shift starts at **S1 (Draft, unassigned)** → manager assigns an employee directly, or leaves it open for bidding at publish time (see §5) → compliance is evaluated at assignment time via the same v8 orchestrator every other assignment path uses (Ch. 2 §9) → manager may also invoke Reserve List (fast-path assignment for unfilled/emergency shifts, reusing the same `sm_apply_shift_op(assign)` gateway) or the Autoscheduler (§4) instead of assigning by hand.
**DB changes / state:** shift creation and manual `assign` both go through the FSM gateway (Ch. 7 §1) — S1→S2 on assign, cost/fatigue/fairness projections recomputed client-side from `rosters/domain/projections`.
**Confidence:** Strongly Inferred — this workflow wasn't re-traced line-by-line this pass; it's synthesized from the Ch. 1 module inventory and Ch. 7's FSM detail. A dedicated Ch. 3 pass on `rosters` would sharpen exact validation-order detail.

---

## 4. Auto-scheduling

**Actors:** Manager; the optimizer microservice (OR-Tools CP-SAT).
**Preconditions:** unassigned Draft/S1 shifts in the current view; the optimizer service reachable (falls back to a greedy engine if not).
**Happy path:** manager requests auto-fill → controller fetches shifts/availability/leave → sends an `OptimizeRequest` to the optimizer → gets back `AssignmentProposal[]` → **every proposal is re-validated through the same v8 compliance orchestrator** used everywhere else (not a separate, looser check) → manager reviews a preview (pillar scores, Pareto alternatives, "why this person" rationale) → on commit, each accepted proposal re-checks for a race (shift not since modified/taken by someone else) → applies via `rosters/bulk-assignment`'s use of the same `sm_apply_shift_op(assign)` gateway.
**Failure/alternative paths:** optimizer unreachable → falls back to the bulk-assignment greedy engine, not a hard failure; a proposal that raced (shift taken between preview and commit) is skipped, not fatal to the batch.
**Full detail + diagram:** Ch. 2 §6.

---

## 5. Publishing

**Actors:** Manager.
**Preconditions:** shift is Draft (S1/S2).
**Happy path:** manager publishes a shift via the gateway (`publish` op). Three distinct outcomes depending on assignment state and time-to-start (TTS):
- Unassigned (S1) → **S5**, opened for bidding (unless TTS<4h, which blocks publish entirely with `PUBLISH_TOO_LATE`).
- Assigned, TTS≥4h (S2) → **S3**, a direct offer is created and the employee must accept.
- Assigned, TTS<4h (S2) → **skips straight to S4** (emergency window — an offer would immediately expire under the 4h sweep rule, so the gateway confirms directly instead, stamping an emergency-assignment audit marker).
**Alternative paths:** manager unpublishes (S3/S4/S5/S9/S10 → back to Draft) — cancels any in-flight swap and reverts the counter-shift too; no TTS guard on this manual action (only automatic publish has the 4h block).
**Full detail + full transition table:** Ch. 7 §1.2.

---

## 6. Marketplace — Open Bids

**Actors:** Employee (bids); Manager (selects winner, or AutoPilot decides).
**Preconditions:** shift is S5/S6 (open for bidding).
**Happy path:** employee submits a bid (`pending`) → manager selects a winner → winning bid → `accepted`, all other pending bids on that shift → `rejected` in the same transaction → shift jumps directly to **S4** (no separate "won" intermediate state).
**Alternative paths:** employee withdraws a pending bid pre-start; AutoPilot auto-decides if enabled (fixed compliance subset + F3 fairness-debt-first ordering among eligible bidders — narrower than the manual v8 check, an accepted v1 gap per the subsystem's own README).
**Failure/expiry:** bidding times out at TTS<4h → shift reverts directly to S1 (no S8 intermediate) — **but the losing `shift_bids` rows are never cleaned up**, left `pending` forever against a now-Draft shift (an asymmetry with swaps, where the equivalent gap was fixed).
**⚠ Finding (OPEN):** Bid AutoPilot's enqueue trigger fires on a shift transition (`bidding_closed_no_winner`) that no code path produces any more (the state was retired) — the pipeline is structurally unreachable via its intended entry point, and separately, its autonomous drain endpoint is marked "NOT DEPLOYED" in its own README.
**Full detail:** Ch. 7 §3.

---

## 7. Marketplace — Swaps & Trades

**Actors:** Requesting employee; offering employee (peer); Manager (approves/rejects, or AutoPilot decides).
**Preconditions:** shift is S4 (confirmed); requester is the shift's assignee; TTS≥4h; no other active swap on that shift.
**Happy path:** requester opens a swap (S4→**S9**) → a peer submits an offer against it → requester accepts an offer (compliance snapshot required, must be `feasible`) → all competing offers on that swap auto-reject, shift moves to **S10** (manager-pending) → manager approves → the two shifts' assignments are swapped and both revert to no-trade-in-progress, back to **S4** each.
**⚠ This was broken end-to-end in production until fixed this session** — see Ch. 7's top callout. Manager approval now works correctly (fix verified against live DB).
**Alternative paths:** manager rejects instead (always worked); requester cancels while still `OPEN`; AutoPilot auto-decides if enabled (same narrower compliance subset as bidding; shadow mode was removed 2026-07-23 so nothing silently goes live without an explicit policy flip — verify current `swap_approval_rules.enabled`/`shadow_mode` before assuming either subsystem is deciding anything today).
**Failure/expiry:** TTS<4h sweep reverts S9/S10→S4 and cascades to expire child offers (this cleanup, unlike bidding's, was explicitly fixed).
**"Drops"**: `shift_swaps.swap_type` supports `'swap'` (two-way trade, both `sm_approve_peer_swap` UPDATE branches run) and `'giveaway'` (one-way — the requester's shift is reassigned to the accepting peer with no shift given back in return, the offered-shift branch is simply skipped). This is the mechanism behind an employee "dropping" a shift onto a willing peer rather than trading for one — same approval/manager-pending pipeline, not a separate workflow.
**Full detail:** Ch. 7 §3.

---

## 8. Attendance (clock-in / clock-out)

**Actors:** Employee (self-service, geofenced).
**Preconditions:** shift not already clocked in; within `[start-1h, start+12.5h]`; caller inside an allowed geofence.
**Happy path:** `check_in_shift` → attendance_status `checked_in` (within 5min grace) or `late`; `sm_clock_out_shift` → sets `actual_end`, shift lifecycle → Completed.
**Alternative paths / failures:** missed clock-out → auto-clock-out at `GREATEST(clock-in, scheduled start) + 12.5h` (`actual_end` deliberately left NULL, not fabricated — a past version that faked it was removed and backfilled); never clocked in and shift ends → auto-marked `no_show`.
**Note on breaks (§9):** there is no employee-facing break clock — see below.
**Full detail:** Ch. 7 §2.5.

---

## 9. Breaks

**⚠ Finding: this is not a workflow.** No employee-facing break start/end action exists anywhere in `src/` (confirmed by exhaustive grep — no RPC, no UI, no "on break" attendance state). Break time is a plain numeric field (`paid_break_minutes`/`unpaid_break_minutes`) set only by a manager, either while editing a roster shift (`RosterShiftModal`) or while reviewing/adjusting a timesheet (`TimesheetRow`). Validation is bounds-checking only (non-negative, doesn't exceed gross shift length) plus one non-blocking compliance rule: **`V8_MEAL_BREAK`** warns if a shift exceeds 5 hours with under 30 minutes of unpaid break, and **`V8_MEAL_BREAK_CEILING`** warns if unpaid break exceeds 60 minutes (EBA cl 36) — both `WARNING` severity, neither blocks the shift or the timesheet edit. There is no timing-window check (e.g. "break must start within N hours of shift start") because there's no clock-based break timestamp to check it against.

---

## 10. Timesheets (review & approval)

**Actors:** Manager (approve/reject/edit); AutoPilot (currently dormant — see below).
**Preconditions:** the review gate — shift must be attendance-terminal (auto-clock-out, no-show, has a real `actual_end`, or unclocked past scheduled end+12.5h) before any approve/reject or billable-time edit is allowed; enforced as a hard DB trigger exception, not just a disabled button.
**Happy path:** manager reviews a row (timesheet materializes lazily on first edit — no row exists until then), approves or edits billable/break minutes → `approved`.
**Alternative paths:** reject with reason; edit a finalized (approved/rejected/no_show) entry's metrics, which reopens it to `submitted`, re-entering the approval gate; AutoPilot auto-verifies "zero-variance clean punches" (±7.5min of scheduled) within an 18:00–06:00 Sydney window if enabled — never auto-rejects, only auto-approves or routes to manual review.
**⚠ Finding (OPEN):** AutoPilot's DB machinery (enqueue trigger, decide/revert RPCs, review queue, policy table) is fully intact even though a later migration states AutoPilot has been "removed" and reinstalls an audit trigger that always labels approvals as manual — if AutoPilot is ever re-enabled without also reverting that trigger, its auto-approvals would be silently mislabeled as manual manager approvals in the audit trail.
**Terminal lock:** once `shifts.payroll_exported = true`, no further edit is allowed on that timesheet, not even a notes-only annotation — see §12, this flag is currently never set by anything in the live app.
**Full detail:** Ch. 7 §2.

---

## 11. Leave

**Actors:** Employee (submit/cancel own); Manager (approve/reject).
**Preconditions:** no overlapping `pending`/`approved` request for the same employee (DB-enforced EXCLUDE constraint, not just app-layer).
**Happy path:** employee submits → manager approves → matching `leave_balances` row is atomically deducted in the same trigger that fires the audit event and employee notification.
**Alternative paths:** manager rejects (reason captured); employee cancels a still-`pending` request.
**⚠ Important correction:** approving leave does **not** automatically unassign any shift the employee is already scheduled for during that window — the manager must explicitly click "Unassign N shifts" on a post-approval warning banner. Once unassigned this way, the action is indistinguishable in the audit trail from an ordinary manual bulk-unassign (no `leave_request_id` reference is carried into the `shift_events` metadata).
**Scheduler protection:** a dedicated, `BLOCKING`-severity compliance rule (`V8_LEAVE_CONFLICT`) prevents the autoscheduler, manual assignment, *and* the swap engine from ever proposing an employee for a shift during their own approved leave — genuine defense in depth, not just a solver-side soft exclusion.
**Full detail:** Ch. 7 §4.

---

## 12. Payroll

**⚠ Finding: the persisted half of this "workflow" doesn't run in production today.** Opening `/management/payroll` triggers a **pure, on-demand, read-only client-side calculation** — it re-derives gross pay from `shifts`/`timesheets`/`leave_requests`/`user_contracts` every time the page renders and **never writes to the database**. `pay_periods` (the period lock/close lifecycle) and `gross_pay_records` (persisted results) have a fully built, fully tested write API and a real schema with RLS — with zero callers anywhere in application code, no button, no route, no cron, no edge function. The write module's own code comments confirm this was built to close a named audit gap ("H-13: these tables had no writer") but was never wired to a UI action.

**Actors:** Manager (gamma+, `management` feature) — the only actor; there is no batch/scheduled process today.
**Preconditions (for a shift to appear):** by default, its `timesheets.status` must be `approved`/`locked`/`no_show` — anything `draft`/`submitted`, or a shift with no timesheet row at all, is **silently excluded from the period's totals**, not shown as $0 or flagged. A "Preview Unapproved" toggle exists for an opt-in, clearly-labeled estimate mode.
**Happy path:** manager selects a date range → per-employee shifts are chronologically sequenced for weekly-overtime purposes → each shift is priced via the same cost engine used elsewhere in the app (`rosters/domain/projections/utils/cost`) → results render as an expandable line-item table with a persistent "GROSS estimate only — not a payslip of record" disclaimer.
**Rate resolution — a genuine gotcha:** the calculator does **not** read `eba_rate`/`eba_allowance`/`eba_trainee_schedule` from the database at compute time. It resolves rates from an **embedded, in-code TypeScript array** (`rate-schedule.ts`), kept honest only by a test that parses the migration SQL and asserts equality against the code. The DB tables are an auditable mirror, not the live source — a compliance auditor updating a DB rate row alone would **not** change what employees are actually priced at.
**Export:** two fully-built serializers (CSV, provider-JSON payload) exist with **zero callers** — no export button exists anywhere in the UI.
**The one real enforcement point:** `shifts.payroll_exported` is a genuine, strict terminal lock — once true, `updateTimesheetEntry` refuses *any* further edit, including a notes-only annotation, with an explicit "these numbers were already paid out" comment. But its only writer (`markShiftsPayrollExported`) is never called, so in practice no timesheet in this system is ever actually terminal today.
**Known asymmetry:** the shift-based pricing adapter filters to `Active`-status contracts only, silently losing apprentice/trainee/SWS-specific pricing context for a terminated employee's final shifts, while the leave-pricing adapter has no such filter — worth reconciling.

---

## 13. Compliance rule evaluation

**Actors:** every mutation path that touches shift assignment (structural, not a human-facing "workflow" on its own).
**Precondition:** none — this runs on every candidate assignment, not just some.
**Happy path:** any caller (manual assign, bid winner selection, swap accept/approve, autoscheduler proposal) builds an input via a caller-specific adapter → the same `compliance/v8` orchestrator + rule set evaluates it → returns pass/fail/warning with violation detail → callers surface failures as `compliance_rejections` rows and block the mutation; **AutoPilot subsystems (bid/swap) use a narrower, fixed rule subset** (overlap + 48h weekly cap + 11h rest + qualification) rather than the full manual orchestrator — an accepted, documented v1 gap, not an oversight to be treated as a bug.
**Full structural diagram:** Ch. 2 §9. Rule-by-rule detail (what each file in `v8/rules/` actually checks) is Ch. 12 — not yet written, though this chapter incidentally confirmed two rules' exact logic: `V8_LEAVE_CONFLICT` (§11) and `V8_MEAL_BREAK`/`V8_MEAL_BREAK_CEILING` (§9).

---

## 14. Notifications

**Actors:** none directly — this is 100% database-trigger-driven, never application-code-initiated.
**Happy path:** a domain table write (shift/bid/swap/timesheet/leave/broadcast) fires its corresponding `AFTER UPDATE`/`AFTER INSERT` trigger → calls `notify_user()` → writes a `notifications` row → surfaces via Realtime to `MyNotificationsPage`/sidebar badge.
**⚠ Finding (OPEN, confirmed again this chapter):** no notification fires anywhere in the onboarding flow (§2) — no `notification_type` enum value exists for account-created/contract-assigned/access-granted, and no trigger is attached to `profiles`/`user_contracts`/`app_access_certificates`. An employee's only signal that they've been provisioned is that `/pending-access` stops appearing.
**Full structural diagram:** Ch. 2 §10.

---

## 15. Reporting & Insights (read-only — no failure/recovery framing needed)

**Actors:** Manager (delta+ — corrects earlier chapters' gamma+ assumption for this specific feature; `access.policy.ts`'s `insights: 'delta'` and the live gate agree here, see Ch. 8 §2 for the general dead-code caveat about that file).
**Happy path:** manager opens `/insights` → **Overview** tab (fill rate, labour cost, no-show rate, compliance failures, at-a-glance) → drills into **Workforce** (org-wide reliability radar), **Compliance** (violations/overrides/cost), or **Performance** (full per-employee quarterly scorecard grid) → for raw per-person hours and compliance (computed client-side from shift rows, not RPC-aggregated like `/insights`) opens `/team-availability` and switches its cell mode to Hours or Compliance. That matrix used to be a separate annual page at `/grid`; it was folded into the Availability Manager and `/grid` now redirects there (docs/architecture/availability-manager-grid-merge-plan.md).
**⚠ Finding (OPEN, dead surface):** three KPI categories — Manager Scorecard, Bidding KPIs, Marketplace KPIs — have fully built backing RPCs, hooks, *and* panel components, each explicitly commented "Not wired into any page/route" — confirmed unimported anywhere. They exist in the module's surface area but are invisible to a manager today.
**No export exists** anywhere in Insights or Grid (contrast: Timesheets does have a CSV export, a different module).

---

## Cross-references

This chapter leans on Ch. 7 (State Machines) for shift/timesheet/marketplace/leave transition detail rather than repeating it, and on Ch. 2 (Architecture) for the AutoPilot pattern, compliance-engine structure, and notification-trigger diagram. Business-rule-level detail (exact thresholds, award clause citations, BR-/PAY-/COM- IDs) is Ch. 5, not yet written — this chapter documents *process*, not the individual rule catalog.
