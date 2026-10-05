# Shiftopia Business Rulebook

A from-the-codebase functional/business specification of the Shiftopia workforce-management platform, intended to let a new engineering team understand and eventually rebuild the platform without access to the original developers.

This is **not** API reference documentation and **not** inline code documentation — it documents *what the business rules are, why they exist, and where they live in the code*.

## How to read this

Every claim in this rulebook is tagged with a confidence level:

| Tag | Meaning |
|---|---|
| **Verified** | Read directly in source (code, live schema, or migration) and cross-checked against at least one other source (e.g. client gate + matching RLS policy) |
| **Strongly Inferred** | Read directly in one authoritative source, consistent with the codebase's established patterns elsewhere |
| **Weakly Inferred** | Indirect evidence only (naming conventions, partial reads, absence of contrary evidence) |
| **Unknown** | Could not be determined by static analysis in this pass — flagged for a follow-up with live traffic/logs or a domain expert |

Findings that describe a live bug or security gap are called out in a **⚠ Finding** block with a status (`OPEN` / `FIXED <date>`).

## Chapter status

| # | Chapter | Status |
|---|---|---|
| 00 | [Executive Summary](00-executive-summary.md) | Done |
| 01 | [Codebase Discovery](01-codebase-discovery.md) — full inventory: folders, modules, routes, DB objects, config | Done (Phase 1) |
| 02 | [Architecture](02-architecture.md) — Mermaid diagrams: overall, module relationships, data flow, DB, scheduling, marketplace, notifications, auth, AutoPilot | Done (Phase 2) |
| 03 | Module Documentation (per-module deep dive: business rules, validation, edge cases) | Not started — module *inventory* exists in Ch. 1, but not the full per-module business-rule depth Phase 3 calls for |
| 04 | Page Documentation (per-page KPIs, states, cross-page deps) | Not started |
| 05 | [Business Rules Catalog](05-business-rules.md) — SCH-/ATT-/MKT-/LEAVE-/PAY-/COM-/VIS-/ONB- IDs, ~60 rules consolidated across all prior chapters | Done (Phase 5) |
| 06 | [Workflow Documentation](06-workflows.md) — auth, onboarding, scheduling, auto-scheduling, publishing, marketplace, attendance, breaks, timesheets, payroll, leave, compliance, notifications, reporting | Done (Phase 6) |
| 07 | [State Machines](07-state-machines.md) — shift FSM, timesheet, swap/bid, leave, all traced to source with a live-DB-verified fix | Done (Phase 7) |
| 08 | [RBAC Permission Matrix](08-rbac-matrix.md) | Done (Phase 8) |
| 09 | Database Documentation (per-table/view/function/trigger deep reference) | Partial — inventory-level in Ch. 1, not yet the full per-object spec Phase 9 calls for |
| 10 | API Documentation (per-RPC request/response/validation/consumers) | Not started — RPC inventory exists in Ch. 1 |
| 11 | KPI Dictionary | Not started |
| 12 | [Compliance Engine](12-compliance-engine.md) — all 21 rule IDs, orchestration control flow, 6 real entry points mapped, kill switches | Done (Phase 12) |
| 13 | Notifications | Not started — trigger-level inventory exists in Ch. 1/2 |
| 14 | Audit Trail | Not started — table-level inventory exists in Ch. 1 |
| 15 | Cross-Module Dependencies | Partial — module-to-module dependency list exists in Ch. 1, not the full lifecycle dependency maps Phase 15 calls for |
| 16 | Edge Cases | Not started |
| 17 | [Production Audit](17-production-audit.md) — dead code, duplicate logic, hardcoded values, tech debt, security/performance/scalability risk, production readiness verdict | Done |

**Recommended next chapter**: Ch. 09/10/11 (DB/API/KPI deep reference) or Ch. 03/04 (per-module and per-page deep dives) — the process/lifecycle/rule-catalog/audit layers (Ch. 5/6/7/8/12/17) are all done now.

## Compliance engine gaps found while researching this rulebook

Surfaced while writing Ch. 12 — see there for full detail.

| Finding | Status |
|---|---|
| `auto-approve-swaps` and `auto-assign-bids` all run a **fixed 4-check compliance subset** (overlap/48h/11h/qualification) via a separately-deployed Edge Function, not the full 21-rule engine — ~11 rules including 20-in-28, streak limit, spread-of-hours, split-shift, meal-break, and leave-conflict are unenforced on these paths, with no mechanical sync between the two rule sets | OPEN — documented as an accepted gap by the code's own authors, Ch. 12 §1.2 |
| Autoscheduler commit-time validation runs the full rule set but through a wrapper that bypasses the audit-logging orchestrator — its BLOCKING rejections are never written to `compliance_rejections`, unlike every other full-engine caller | OPEN — Ch. 12 §1.2 |
| `orchestrator/{batch,bidding,swapping,conflict-resolver}/` — a fully-built global-optimization/fairness/conflict-resolution layer — has zero callers anywhere outside its own package; live bid/swap-accept paths bypass it entirely | OPEN — Ch. 12 §1.2, dormant infrastructure |
| A global `VITE_COMPLIANCE_BLOCKING_ENABLED` kill switch can silently downgrade every BLOCKING compliance result to WARNING for the caller (while still logging the true result to the audit table) — legitimate escape hatch, but a significant lever worth knowing the current setting of | OPEN — Ch. 12 §1.3, not necessarily a bug |

## Process gaps found while researching this rulebook (not security bugs — missing/dormant functionality)

Surfaced while writing Ch. 06 (Workflows) — see there for full detail.

| Finding | Status |
|---|---|
| No admin "Add Employee"/invite flow exists — onboarding is self-signup + two separate manual admin actions (contract, then optionally certificate), with no linking automation, no pending-user queue, and no notification to anyone at any step | OPEN — Ch. 06 §2 |
| No offboarding/termination workflow exists despite full schema support (`user_contracts.status`, `profiles.termination_date`) — only hard-delete is available | OPEN — Ch. 06 §2 |
| Payroll pay-period locking and gross-pay export are fully built, tested, and RLS-protected but have **zero callers** anywhere in the app — the live payroll page is a non-persisted, on-demand calculator only | OPEN — Ch. 06 §12 |
| `shifts.payroll_exported` (the terminal timesheet-edit lock) has no writer anywhere in the app, so it can never actually trip in production today | OPEN — Ch. 06 §12 |
| Gross-pay rate resolution reads an embedded in-code TS array, not the `eba_rate`/`eba_allowance` DB tables at runtime — updating the DB rows alone would not change what employees are priced at | OPEN — Ch. 06 §12 |
| Three Insights KPI panels (Manager Scorecard, Bidding KPIs, Marketplace KPIs) are fully built but confirmed unwired into any route — invisible to managers today | OPEN — Ch. 06 §15 |

## Live production bugs found and fixed while researching this rulebook

These were found as a side effect of Phase 1/7/8 research, not from a dedicated security/QA audit — see Ch. 07 §top and Ch. 08 §5 for full detail. Both share a root cause shape: something correct was silently dropped during the October 2025 schema squash and never re-verified against the pre-squash archive — see Ch. 07 §5 for the pattern.

| Finding | Status |
|---|---|
| `payroll_records_select` / `compliance_snapshots_select` RLS policies were a no-op (correlated-subquery bug let any employee read any other employee's payroll/compliance data) | **FIXED 2026-07-30** — migration `20260730050000_fix_payroll_compliance_snapshot_rls_org_check.sql`, applied to prod, verified via `get_advisors` |
| Manager "Approve Swap Request" and Swap AutoPilot's auto-approve were completely non-functional (`_apply_shift_op_write` had no `approve_trade` branch, silently returned `UNSUPPORTED_OP`) | **FIXED 2026-07-31** — migration `20260731000000_restore_approve_trade_branch_in_apply_shift_op_write.sql`, applied to prod, verified via a rollback-only live-DB transaction + `get_advisors` |
| `auth_can_manage_rosters()`, `get_my_role()`, `get_user_role()`, `admin_delete_shift_rpc()`, `create_profile_for_user()` reference a nonexistent `profiles.system_role` column | OPEN — currently low blast radius (unused/dormant call sites), same bug class as the already-fixed `is_manager_or_above()` |
| Stale docs claiming `is_manager_or_above()` is "BROKEN in prod" (it was fixed; several docs postdate the fix and still say otherwise) | OPEN — documentation correction needed in `HANDOVER.md` and `docs/investigations/2026-06-24_auto-assign-bids-and-swap-approval/*.md` |
| `employee_leave_balances`, `shift_offers`, `roster_templates` still carry always-true (`USING(true)`) permissive policies not swept in the 2026-07-19/20 hardening passes | OPEN |
| Two competing client-side permission specs (`access.policy.ts` vs `useAuth.hasPermission`) disagree on the Insights threshold | OPEN — `access.policy.ts` is dead code but easy to cite by mistake |
| `/compliance/rejections` route has no client-side `FeatureGate`, while its RLS is delta+-only (inconsistent, not exploitable — sub-delta users just see an empty table) | OPEN |
| Timesheet AutoPilot's audit trigger no longer labels bot-approvals as bot-approvals — if AutoPilot is ever re-enabled without also reverting the provenance trigger, auto-approvals will be mislabeled as manual manager approvals | OPEN — Ch. 07 §2.3 |
| Bid AutoPilot's enqueue trigger fires on a shift transition (`bidding_closed_no_winner`) that no code path produces any more — pipeline is unreachable via its intended entry point | OPEN — Ch. 07 §1.6/§3.7 |
| Two leave types (`religious_cultural`, `gender_affirmation`) are fully live in prod (constraint values, accrual logic, seed data) with zero trace in any tracked migration | OPEN — Ch. 07 §4.4, repo/prod drift |
| Bidding-timeout sweep never cleans up orphaned `pending` bids on the now-Draft shift (swaps got the equivalent fix, bids didn't) | OPEN — Ch. 07 §1.6 |
| `leave_requests.status` has no DB-level CHECK/enum constraint, enforced only by RLS + app-layer guards | OPEN — Ch. 07 §4.1 |
| A leave-triggered shift unassignment is indistinguishable from an ordinary manual unassignment in the audit trail | OPEN — Ch. 07 §4.3 |

## Performance, scalability & tech-debt findings (Ch. 17 — new research, live-DB-verified)

| Finding | Status |
|---|---|
| Grid page inherits an 8,000-row truncation cap sized for a different feature — silently produces a **wrong** EBA compliance verdict for the back half of the year once an org's annual shift volume exceeds it (~30-40 active employees), no UI warning | OPEN — Ch. 17 §9 |
| `shifts` table has 7 overlapping permissive RLS SELECT policies (12 on `leave_requests`, 12 on `swap_offers`) from two uncosolidated RBAC generations coexisting on the same tables | OPEN — Ch. 17 §6/§9, live `get_advisors` data |
| The `auth_rls_initplan` performance anti-pattern (unwrapped `auth.uid()` in RLS policies) was fixed schema-wide once, then **reintroduced 3 times since**, including in the very migration that fixed this session's RLS security bug | OPEN — Ch. 17 §7/§9 |
| At least 13 pages read only `scope.org_ids[0]` from an otherwise multi-org-ready scope filter, silently dropping additional org selections — same failure shape as the fixed RLS bug, one layer up, at the client | OPEN — Ch. 17 §8/§10 |
| `shift_events` (unbounded append-only event log) has no partitioning/archival; the intended partition-manager job isn't even scheduled in live `pg_cron` | OPEN — Ch. 17 §10 |
| `'Australia/Sydney'` is hardcoded in 36 places (`organizations` has no `timezone` column at all) — harmless today, blocks any second-org onboarding outside Sydney's DST calendar without a schema change first | OPEN — Ch. 17 §3 |
| Several N+1 / fully-serial write patterns (`duplicateTemplate`, `bulkPublishShifts`, `useBulkUpdateShiftTimes`) | OPEN — Ch. 17 §9 |

## Source material

Built from: direct codebase reads (`src/`, `supabase/migrations/`), the existing `graphify-out/graph.json` knowledge graph (4,039 nodes / 12,057 edges across the whole repo), and live-database verification via Supabase MCP against the `Shiftopia` project (`srfozdlphoempdattvtx`).
