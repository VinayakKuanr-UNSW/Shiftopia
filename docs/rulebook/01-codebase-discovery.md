# Chapter 1 — Codebase Discovery (Phase 1)

**Confidence: Verified** for structure/counts (read directly); **Strongly Inferred** for per-module "Purpose" prose (inferred from code shape, not from product requirements docs, which don't appear to exist in this repo).

## 1. Top-level structure

```
src/
  modules/       17 feature modules (business domains) — see §2
  platform/      cross-cutting infra: auth (src/platform/auth/), supabase client
  router/        single route table — src/router/AppRouter.tsx — see §3
supabase/
  migrations/    65 SQL files (schema, RLS, functions, triggers) — see §4
  functions/     Edge Functions (background workers) — see §4.5
docs/            existing hand-written docs (architecture, ADRs, audits, per-module deep dives for timesheets/people-mode)
graphify-out/    knowledge graph (graph.json, GRAPH_REPORT.md) covering the whole repo
```

No orphan top-level dirs (`src/lib`, `src/components` etc.) — everything lives under `src/modules/`, `src/platform/`, or `src/router/`, per this repo's own architecture convention.

## 2. Frontend module inventory

17 modules under `src/modules/`. For each: purpose, subfolder shape, key entry points, primary DB surface, module-to-module dependencies, and core domain types.

### 2.1 `auth`
**Purpose:** Authentication (login/signup), session state, and the auth *data* layer that the router's gate mechanism (Ch. 8) reads from.
**Structure:** `contexts/`, `pages/` (Login, SignUp, PendingAccess, Unauthorized), `ui/` (a dead `ProtectedRoute` guard — see Ch. 8). No `api/`/`state/`/`model/` split — thin module.
**Entry points:** `contexts/AuthContext.tsx` (session provider wrapping `supabase.auth`), `pages/LoginPage.tsx`.
**DB:** `profiles`; auth itself is Supabase's built-in `supabase.auth.*`.
**Depends on:** `core` only.
**Core types:** `Role` (`admin|manager|teamlead|member` — legacy, display-only, see Ch. 8), `User`.
**Note:** `src/modules/auth/contexts/AuthContext.tsx` defines a second, near-duplicate `Role`/`AuthContext` explicitly labeled `// DEBUG VERSION` — confirmed unused (nothing imports it). Dead code.

### 2.2 `availability`
**Purpose:** Employees declare recurring/one-off availability windows and reserve-list opt-in, consumed downstream by scheduling/compliance when assigning shifts.
**Structure:** `api/`, `layout/` (responsive desktop/tablet/mobile), `model/`, `pages/`, `state/`, `ui/{calendar,form,header,list,modals,navigation,panes}`, `utils/`.
**Entry points:** `pages/AvailabilityPage.tsx`, `ui/AvailabilityScreen.tsx`, `api/availability.service.ts`, `state/useAvailability.ts`.
**DB:** `availability_rules`, `availability_slots`, `shifts` (read-only, for assigned-shift overlay). No RPCs.
**Depends on:** `core`, `reserve-list` (opt-in toggle).
**Core types:** `AvailabilityRule`, `AvailabilitySlot`, `RepeatType`, `AvailabilityStatus`.

### 2.3 `broadcasts`
**Purpose:** Org-wide/team messaging — channels, groups, broadcast messages with attachments, read receipts, acknowledgement tracking (the "Control Room" comms hub).
**Structure:** `api/` (CQRS-style: queries/commands/DTOs/query-keys), `layout/`, `model/`, `state/`, `ui/{components,dialogs,pages,screens/ControlRoom,views}`.
**Entry points:** `ui/pages/BroadcastsManager.page.tsx`, `MyBroadcastsPage.tsx`, `api/broadcasts.api.ts`.
**DB:** `broadcasts`, `broadcast_channels`, `broadcast_groups`, `broadcast_attachments`, `broadcast_notifications`, `broadcast_read_status`, `group_participants`; views `v_broadcast_groups_with_stats`, `v_channels_with_stats`, `v_group_all_participants`, `v_unread_broadcasts_by_group`. RPCs: `get_broadcast_analytics`, `get_broadcast_ack_stats`, `get_broadcast_group_role`.
**Depends on:** `core` only.
**Core types:** `Broadcast(WithDetails)`, `BroadcastGroup(WithStats/Full)`, `BroadcastChannel(WithStats)`, `GroupParticipant(WithDetails)`, `BroadcastAcknowledgement`, `BroadcastNotification`.
**Note:** the one module confirmed to gate its own "manager" actions on the legacy `Role` string rather than the certificate/`AccessLevel` system everything else uses — see Ch. 8 §5.

### 2.4 `compliance`
**Purpose:** The rules/constraint engine validating whether a shift assignment, swap, or bid complies with award/EBA law (rest gaps, max hours, student-visa caps, min-engagement, etc.) — the platform's core labor-law guardrail.
**Structure:** Flat engine files (`hard-validation.ts`, `prevalidation.ts`, `bulk-engine.ts`, `employee-context.ts`, `types.ts`) + `api/`, `hooks/useCompliance`, `ui/pages` (badge/modal/panel/RejectionsPage), and the large `v8/` sub-engine: `adapters/`, `orchestrator/{batch,bidding,conflict-resolver,swapping}`, `rules/` (one file per rule — rest-pause, meal-break, student-visa, ordinary-hours-avg, etc.), `swap-engine/`, `utils/`.
**Entry points:** `v8/index.ts` and `v8/orchestrator/index.ts` (current engine), `v8/bridge.ts` (legacy bridge), `hooks/useCompliance.ts`.
**DB:** `compliance_rejections`, `employee_licenses`, `employee_skills`, `leave_requests`, `profiles`, `roles`, `shift_swaps`, `shifts`, `user_contracts`. Pure client-side evaluation over fetched data — no RPCs.
**Depends on:** `core`, `rosters` (shared shift/assignment entity types).
**Core types:** `ComplianceResult`, `ComplianceRule`, `UnifiedComplianceResult`/`Status`, `ConstraintViolation`, bulk-mode types.

### 2.5 `core`
**Purpose:** App shell / shared foundation — layout chrome, providers, cross-cutting hooks, org/department domain model, design primitives consumed by every other module.
**Structure:** `assets/`, `autopilot/` (AutoPilot control widget), `contexts/` (Org, Search, Theme), `hooks/`, `lib/` (date/holiday/shift helpers, logger), `model/org.types.ts`, `pages/` (`Index`, `NotFound`, `MyNotificationsPage`), `providers/`, `types/` (barrel re-exporting other modules' types), `ui/{components,icons,layout/sidebar,motion,primitives}`.
**Entry points:** `pages/Index.tsx`, `providers/ProviderWrapper.tsx`, `ui/layout/sidebar/AppSidebar.tsx`, `BottomNavbar.tsx` (global nav — see §3).
**DB:** `profiles`, `organizations`, `departments`, `sub_departments`, `notifications`, `user_contracts`.
**Depends on (unusual, "reverse" direction as the app-shell layer):** `availability`, `broadcasts`, `planning`, `rosters`, `settings`, `templates`, `timesheets`, `users` — mostly via the `core/types` barrel and global-nav badge/notification surfacing.
**Core types:** `Department`, `SubDepartment`, `Role`, `RemunerationLevel`, `Organization`; central type barrel re-exporting `Shift`, `Employee`, `Template`, `Broadcast`, `Availability`, `Timesheet`.

### 2.6 `insights`
**Purpose:** Analytics/reporting dashboard — workforce utilization, scheduling efficiency, financial/budget, compliance-cost, manager-scorecard metrics, mostly aggregated server-side.
**Structure:** `api/insights.api.ts`, `hooks/` (one per KPI domain), `model/` (metric types, `grid-compliance.ts`), `pages/` (`InsightsPage`, `AnalysisPage`, `GridPage`), `state/`, `ui/{components,views}` (Workforce/Financial/Forecasting/Location/Charts tabs).
**Entry points:** `pages/InsightsPage.tsx`, `api/insights.api.ts`, `state/useInsights.ts`.
**DB:** `employee_licenses` directly; otherwise entirely RPC-driven — `get_insights_summary`, `get_insights_trend`, `get_dept_insights_breakdown`, `get_bidding_kpis`, `get_marketplace_kpis`, `get_manager_scorecard`, `get_metric_detailed_analysis`, `get_quarterly_performance_report`, `get_employee_quarterly_performance` — i.e. most of Insights' real logic lives in Postgres functions, not client queries.
**Depends on:** `core`, `rosters` (Grid page), `users` (performance metrics).
**Core types:** `MetricId`, `MetricDefinition`, `MetricValue`, `InsightsSummary`, `TrendRow`, `DeptBreakdownRow`.

### 2.7 `leave`
**Purpose:** NES/EBA-compliant leave policies, balance accrual/projection, leave-request CRUD, approve/reject workflow, and leave↔shift conflict detection.
**Structure:** `api/leave.api.ts`, `domain/` (`leave-policy.ts`, `leave-conflicts.ts` — pure business logic), `model/leave.types.ts`, `ui/pages/LeavePage.tsx`. No separate `state/` folder.
**Entry points:** `api/leave.api.ts` (get/create/approve/reject/cancel, conflict detection/unassignment), `domain/leave-policy.ts` (`LEAVE_POLICIES`, `projectBalance`).
**DB:** `leave_balances`, `leave_requests`, `profiles`, `roles`, `shifts`, `user_contracts`. No RPCs.
**Depends on:** `core`, `rosters` (unassigns shifts conflicting with approved leave).
**Core types:** `LeaveTypeCode`, `LeavePolicy`, `LeaveBalance`, `LeaveRequest(Status)`, `LeaveShiftConflict`.

### 2.8 `payroll`
**Purpose:** GROSS-pay calculation engine — prices approved worked hours through the EBA award calculator and rolls them up per employee/pay-period into itemised gross earnings. Explicitly out of scope: tax/super/STP (left to a certified payroll provider).
**Structure:** `data/` (read/write adapters), `domain/` (`computeShiftGrossPay.ts`, `aggregatePeriodGrossPay.ts`, `cpiRateIncrease.ts` — pure calculation), `export/` (CSV/provider-JSON), `model/gross-pay.types.ts`, `state/`, `ui/` (`GrossPayPage.tsx`, `rate-admin/` sub-app).
**Entry points:** `ui/GrossPayPage.tsx`, `domain/computeShiftGrossPay.ts`/`aggregatePeriodGrossPay.ts`, `data/grossPay.write.api.ts`.
**DB:** `eba_allowance`, `eba_rate`, `eba_trainee_schedule`, `gross_pay_records`, `pay_periods`, `shift_payroll_records`, `timesheets`, `shifts`, `leave_requests`, `profiles`, `user_contracts`. No RPCs.
**Depends on:** `core`, `rosters` (cost-matrix helpers), `timesheets` (billable-time), `leave` (leave-to-gross-pay mapping).
**Core types:** `EarningsCode`, `EarningsLine`, `ShiftGrossPay`, `PeriodGrossPay`.

### 2.9 `planning`
**Purpose:** Orchestrates the shift marketplace — bidding on open shifts and swapping/trading assigned ones — including compliance evaluation and manager approval, so shift changes never bypass fatigue/EBA/visa rules.
**Structure:** Three sub-modules: `bidding/` (api/hooks/model/ui), `swapping/` (api/hooks/model/state/ui), `unified/` (newer consolidated engine: `service/`, `compliance/`, `hooks/`, large `__tests__/` — bid/swap/concurrency/edge). Top-level `index.ts` re-exports `bidding` + `swapping`.
**Entry points:** `unified/service/planning-request.service.ts` (single service for BID+SWAP lifecycle: `createPlanningRequest`, `submitOffer`, `selectOffer`, `approveRequest`, `rejectRequest` — delegates compliance to the V8 orchestrator), `bidding/ui/pages/{Employee,Manager}Bids.page.tsx`, `swapping/ui/pages/{Employee,Manager}Swaps.page.tsx`.
**DB:** `shift_bids`, `shift_swaps`, `swap_offers`, `swap_decisions`, `swap_approval_rules`, `bid_decisions`, `bid_approval_rules`, `planning_requests`, `planning_offers`, `shifts`, `departments`, `employee_licenses`, `organizations`. RPCs: `sm_select_bid_winner`, `sm_bid_auto_revert`, `withdraw_bid_rpc`, `sm_create_swap_request`, `sm_accept_trade`, `sm_cancel_swap_request`, `sm_swap_auto_revert`, `sm_finalize_planning_request`.
**Depends on:** `rosters` (shift entities), `compliance` (V8 orchestrator + `swap-engine`, which physically lives inside `compliance/v8/swap-engine/` — planning only consumes it), `availability`, `payroll`, `core`.
**Core types:** `PlanningRequest(Status|Type)` (`OPEN→MANAGER_PENDING→APPROVED/REJECTED/BLOCKED/CANCELLED/EXPIRED`), `BidComplianceSnapshot`/`SwapComplianceSnapshot`, `Bid(Status)`, `SwapRequest(Status)`.

### 2.10 `reserve-list`
**Purpose:** Lets managers instantly find and assign a qualified, available, compliant "reserve" employee to an unfilled/emergency shift — a fast-path staffing tool layered on existing eligibility/availability/compliance subsystems, not a new engine.
**Structure:** Flat and small — `api/`, `model/`, `state/`, `ui/`.
**Entry points:** `api/reserveList.api.ts` (`getReserveListCandidates`, `assignFromReserveList`), `ui/ReserveListPanel.tsx` (manager-only overlay, mounted once in `RostersPlannerPage`).
**DB:** `availability_slots`, `profiles`, `roles`. RPCs (via a `callRpc` wrapper): `check_shift_overlap`, `sm_apply_shift_op` (assign, then publish).
**Depends on:** `rosters` (`EligibilityService`, `compliance.service`), `core`.
**Core types:** `ReserveListCandidate`, `ReserveListAssignResult(FailureReason)`.

### 2.11 `rosters`
**Purpose:** The core scheduling module — creating, structuring, publishing, and mutating rosters and shifts (groups/subgroups, templates, bulk assignment, cost/fairness projections, attendance, labor-demand forecasting). The largest and most heavily-depended-upon module.
**Structure:** Full DDD layering — `domain/` (commands/queries/policies/projections with cache/pipeline/projectors/worker/cost), `bulk-assignment/` (engine + tests), `api/`, `services/`, `state/`, `hooks/`, `infra/`, `contexts/`, `model/`, `pages/`, `ui/` (dialogs, modes, my-roster, presence, views), `utils/`.
**Entry points:** `pages/RostersPlannerPage.tsx`, `MyRosterPage.tsx`, `AttendancePage.tsx`, `LaborDemandForecastingPage.tsx`, `ShiftFormPage.tsx`; `bulk-assignment/bulk-assignment.controller.ts` + `engine/assignment-committer.ts` (consumed by `scheduling`'s auto-scheduler); `services/compliance.service.ts`, `eligibility.service.ts`.
**DB:** the largest surface of any module — `rosters`, `shifts`, `roster_groups/subgroups/templates`, `template_shifts`, `shift_templates`, `shift_subgroups`, `shift_events`, `shift_bids`, `demand_forecasts/rules/templates/tensor`, `autoschedule_sessions`, `synthesis_runs`, `fairness_ledger`, `supervisor_feedback`, `availability_rules/slots`, `leave_requests`, `employee_licenses`, `licenses`, `skills`, `remuneration_levels`, `user_contracts`, `work_rules`, `departments`, `organizations`, `profiles`, `roles`, `events`, `venueops_events`, `v_template_full`. RPCs: `sm_apply_shift_op`, `sm_move_shift`, `sm_unassign_shift`, `sm_emergency_assign`, `sm_expire_offer_now`, `get_shift_lifecycle`, `add_roster_subgroup_range`, `toggle_roster_lock_for_range`, plus `sm_create_shift`, `check_in_shift`, `sm_clock_out_shift`.
**Depends on:** `planning`, `reserve-list`, `templates`, `timesheets`, `users`, `settings`, `availability`, `compliance`, `payroll`, `core` — the most-depended-upon module in the codebase.
**Core types:** `Shift`, `Roster`, `LifecycleStatus`/`ShiftFlag`, `RosterAssignment`, `AssignmentStatus`.

### 2.12 `scheduling`
**Purpose:** Automated, AI-assisted shift-filling — a two-layer pipeline sending unassigned shifts/employees to an OR-Tools CP-SAT optimizer microservice for proposed assignments, validated through the compliance engine before a manager commits.
**Structure:** `audit/`, `data/`, `optimizer/`, `ui/`. No `domain/`/`api/`/`pages/` — logic centers on the controller file.
**Entry points:** `auto-scheduler.controller.ts` (1,479 lines — `.run()` optimize+validate preview, `.commit()` concurrency-rechecked write, falls back to `rosters/bulk-assignment` greedy engine on optimizer failure), `optimizer/optimizer.client.ts`/`solution-parser.ts`, `ui/AutoSchedulerPanel.tsx`/`Modal.tsx`/`Insights.tsx`/`WhyThisPerson.tsx`.
**DB:** reads `shifts`, `availability_rules/slots`, `leave_requests` directly; no writes/RPCs of its own — commits delegate to `rosters/bulk-assignment`'s `sm_apply_shift_op`.
**Depends on:** `rosters` (heavy — bulk-assignment engine, cost/fatigue/fairness projections, fairness-ledger, bidding-urgency), `core`.
**Core types:** `OptimizeRequest/Response`, `AssignmentProposal`/`ValidatedProposal`, `AutoSchedulerResult`, `PillarScores`/`ParetoAlternative`/`AssignmentRationale`.

### 2.13 `search`
**Purpose:** App-wide global search UI (rosters, templates, timesheets, bids, etc.) — a thin presentation layer with no data-access logic of its own.
**Structure:** Minimal — `pages/`, `index.ts`.
**Entry points:** `pages/SearchPage.tsx` — consumes `useSearch()` from `core/contexts/SearchContext`.
**DB:** None directly — delegated to `core`'s `SearchContext`.
**Depends on:** `core` only.

### 2.14 `settings`
**Purpose:** User/org-level preferences (appearance/theme, locale, notifications, account) plus an embedded pay-rate administration panel for org admins.
**Structure:** Small — `hooks/`, `pages/`, `ui/components/`.
**Entry points:** `pages/SettingsPage.tsx` (tabs), `hooks/useSettings.ts`.
**DB:** `organizations`, `profiles`.
**Depends on:** `payroll` (embeds `PayRatesSettings`), `core`.

### 2.15 `templates`
**Purpose:** Reusable roster templates (recurring shift patterns per department/subgroup), capturable from a live roster, versioned, and published to generate future rosters in bulk.
**Structure:** `api/`, `hooks/` (+queries), `model/`, `pages/`, `state/`, `ui/` (editor, dialogs), `utils/`.
**Entry points:** `pages/TemplatesPage.tsx`, `api/templates.service.ts`, `state/useTemplateEditor.ts` (+legacy `useTemplates`).
**DB:** `roster_templates`, `template_groups/subgroups/shifts`, `roster_template_batches`, `v_template_full`, `organizations`. RPCs: `save_template_full`, `publish_template_range`, `capture_roster_as_template`, `check_template_version`, `validate_template_name`, `delete_template_shifts_cascade`, `undo_template_batch`.
**Depends on:** `rosters` (`Shift` type), `users`, `core`.
**Core types:** `Template`, `TemplateShift`, `Group`/`SubGroup`, `TemplateBatch`, `SaveTemplateInput/Result`.

### 2.16 `timesheets`
**Purpose:** Tracks actual worked time against scheduled shifts, supports approval workflow and an audit trail, feeding payroll.
**Structure:** `api/`, `domain/`, `model/`, `state/`, `ui/components/`.
**Entry points:** `ui/TimesheetPage.tsx`; `api/timesheets.{read,write,supabase}.api.ts`; `state/TimesheetContext.tsx` + `timesheet.hooks.ts`.
**DB:** `timesheets`, `timesheet_audit_log`, `shifts`, `shift_events`, `profiles`. No RPCs (direct reads/writes).
**Depends on:** `rosters`, `planning`, `payroll`, `core`.
**Core types:** `Timesheet(Status)`, `TimesheetRow`/`Entry`.

### 2.17 `users`
**Purpose:** Employee/user profiles, contracts, roles, skills, licenses, and performance — the HR/org-structure system of record other modules reference for eligibility and identity.
**Structure:** `api/`, `domain/` (`casualConversion.ts`, `swsTrial.ts` — business-rule calculators), `hooks/`, `model/`, `pages/`, `ui/`.
**Entry points:** `pages/UsersPage.tsx` (admin roster), `pages/ProfilePage.tsx`, `api/employee.service.ts`.
**DB:** `profiles`, `roles`, `departments`, `organizations`, `user_contracts`, `employee_licenses`, `licenses`, `employee_skills`, `skills`, `remuneration_levels`, `app_access_certificates`. RPCs: `delete_user_entirely`, `get_employee_quarterly_performance`, `get_quarterly_performance_report`.
**Depends on:** `core` only — a relatively "leaf" module, depended on heavily by others but not reaching into rosters/planning itself.
**Core types:** `Employee`, `UserContract`, `AccessLevel`, `ContractStatus`.

## 3. Routes, pages & navigation

Single source of truth: **`src/router/AppRouter.tsx`** (234 lines), mounted in `src/App.tsx`. No other route table exists anywhere in `src/` (exhaustive grep).

Three layered guards wrap the route tree:
1. **`AuthLayout`** — redirects to `/login` if unauthenticated, `/pending-access` if no active contract, otherwise renders the sidebar shell + `Outlet`.
2. **`MobileAccessGuard`** — on mobile viewports, blocks any path not in an allowlist, shows "Desktop Required" instead.
3. **`FeatureGate`** — the real per-route permission gate: `useAuth().hasPermission(feature)` → redirects to `/unauthorized` on failure (full mechanism detail in Ch. 8).

### 3.1 Route table

| Route | Page Component | Module | `FeatureGate` feature |
|---|---|---|---|
| `/` | `Index` | core | — (public) |
| `/login`, `/unauthorized`, `/pending-access`, `/signup` | respective auth pages | auth | — (public) |
| `/profile` | `ProfilePage` | users | none (auth only) |
| `/my-roster` | `MyRosterPage` | rosters | none |
| `/my-attendance` | `AttendancePage` | rosters | none |
| `/my-availabilities` | `AvailabilityPage` | availability | none |
| `/my-bids` | `EmployeeBidsPage` | planning/bidding | none |
| `/my-swaps` | `EmployeeSwapsPage` | planning/swapping | none |
| `/my-notifications` | `MyNotificationsPage` | core | none |
| `/my-leave` | `LeavePage` | leave | none |
| `/my-broadcasts` | `MyBroadcastsPage` | broadcasts | `my-broadcasts` |
| `/templates` | `TemplatesPage` | templates | `templates` |
| `/rosters` | `RostersPlannerPage` | rosters | `rosters` |
| `/rosters/shift/new` | `ShiftFormPage` | rosters | `rosters` |
| `/labor-demand` | `LaborDemandForecastingPage` | rosters | `rosters` |
| `/timesheet` | `TimesheetPage` | timesheets | `timesheet-view` |
| `/management/bids` | `ManagerBidsPage` | planning/bidding | `management` |
| `/management/swaps` | `ManagerSwapsPage` | planning/swapping | `management` |
| `/broadcast` | `BroadcastManagerPage` | broadcasts | `broadcast` |
| `/management/leave` | `LeavePage` (`tab="approvals"`) | leave | `management` |
| `/management/payroll` | `GrossPayPage` | payroll | `management` |
| `/insights`, `/insights/:metricId`, `/grid` | `InsightsPage`/`AnalysisPage`/`GridPage` | insights | `insights` |
| `/compliance/rejections` | `ComplianceRejectionsPage` | compliance | **none** (⚠ see Ch. 8) |
| `/users` | `UsersPage` | users | `users` |
| `/settings`, `/settings/:section` | `SettingsPage` | settings | none (self-gated per-section) |
| `/search` | `SearchPage` | search | none |
| `*` | `NotFound` | core | — (public) |

Non-URL tab state (not router-driven): `LeavePage` (`balances/requests/new/approvals`), `InsightsPage` (`overview/workforce/compliance/performance`), `RostersPlannerPage` (view-mode/zoom/DnD state), `TimesheetPage` (`viewType`/`viewMode`). `SettingsPage`'s `:section` param *is* a real URL-addressable sub-route.

### 3.2 Navigation menu structure

Desktop: `AppSidebar.tsx` — sections **Work** (My Roster/Attendance/Availabilities, always visible), **Requests** (Bids/Swaps/Leave, always visible), **Communication** (Broadcasts/Notifications, always visible), **Rostering** (Templates/Rosters/Labor Demand/Timesheet — shown if any of those features granted), **Management** (Open Bids/Swap Requests/Leave Approvals/Gross Pay — shown if `management`), **Features** (Broadcast/Insights — shown if `broadcast`/`insights`/`management`), **Admin** (Grid/Users — shown if `insights`/`management`). Mobile: `BottomNavbar.tsx` — pill bar + "More" drawer.

**⚠ Finding (OPEN, cosmetic):** both `AppSidebar` and `BottomNavbar` link to `/performance`; `MobileAccessGuard` also allowlists `/performance` and `/contracts` — **neither route exists** in `AppRouter.tsx`. Dead nav links, fall through to `NotFound`.

**⚠ Finding (OPEN, dead code):** `src/modules/auth/ui/ProtectedRoute.tsx` and `src/modules/core/ui/layout/sidebar/NavigationLinks.tsx` are both confirmed unimported anywhere in `src/` — superseded by `AuthLayout`+`FeatureGate` and `AppSidebar.tsx` respectively.

## 4. Database inventory

Full detail (every table/view/function/trigger with source migration) lives in the research artifact this chapter was built from; the summary below is the citable, curated version. See Ch. 9 (not yet written) for the deep per-object reference the original spec calls for.

### 4.1 Source overview

| Item | Detail |
|---|---|
| Migration files | 65 total: 1 baseline snapshot (`20251015000000_baseline_schema.sql`, 30,031 lines, consolidating pre-Oct-2025 history archived separately) + 60 incremental (Oct 2025 → Jul 2026) + 5 non-applied parity/validation scripts under `_parity/` |
| Schemas | `public` (~139 tables) + `hr` (7 tables, newer HR/contracts cutover, fronted by `public.*` compatibility views for backward compatibility) |
| Extensions | `pg_cron`, `pg_net`, `pg_stat_statements`, `pgcrypto`, `supabase_vault`, `uuid-ossp` |
| Scheduled jobs | `nightly_leave_accrual` (02:00 daily), `dead_shift_cleanup` (every 10 min) via `pg_cron`; 5 Edge Function workers (§4.5) driven by DB job queues |
| RLS | ~433 `CREATE POLICY` statements + 6 dedicated hardening migrations (2026-07-19/20/21) |
| Raw counts | 139 `CREATE TABLE`, 17 `CREATE VIEW`/`MATERIALIZED VIEW`, ~336 unique functions, 92 `CREATE TRIGGER` |

### 4.2 Tables by business domain (representative, not exhaustive — see raw research artifact for full ~139-row catalog)

| Domain | Key tables |
|---|---|
| RBAC / Org structure | `organizations`, `departments`, `sub_departments`, `profiles`, `app_access_certificates`, `role_levels`, `rbac_actions`, `rbac_permissions`, `hr.*` (parallel newer org/contract model) |
| Scheduling / Shifts / Rosters | `shifts` (core FSM table), `shift_templates`, `shift_compliance_snapshots`, `shift_payroll_records`, `shift_events` (event-sourcing spine), `rosters`, `roster_groups/subgroups`, `roster_shift_assignments`, `roster_templates`, `autoschedule_sessions/assignments`, `assignment_runs/events/decisions`, `assignment_snapshots` (KPI spine), `work_rules`, `events` |
| Marketplace — Bids | `shift_bids`, `shift_bid_windows`, `shift_offers`, `bid_approval_rules`, `bid_decisions`, `bid_audit_log`, `bid_review_queue` |
| Marketplace — Swaps | `shift_swaps`, `swap_requests`, `swap_offers`, `swap_approvals`, `swap_approval_rules`, `swap_decisions`, `swap_audit_log` (immutable), `swap_review_queue`, `swap_validations`, `planning_requests/offers/periods` (newer unified model) |
| Timesheets / Attendance / Payroll | `timesheets`, `attendance_records`, `pay_periods`, `gross_pay_records`, `eba_rate`/`eba_allowance`/`eba_trainee_schedule` (effective-dated), `department_budgets`, `timesheet_approval_rules/decisions/audit_log/review_queue` |
| Leave | `leave_requests`, `employee_leave_balances` (legacy), `leave_balances` (current, nightly-accrued), `leave_request_events` (audit) |
| Compliance / Skills | `certifications`, `licenses`/`employee_licenses`, `skills`/`employee_skills`, `rest_period_violations`, `compliance_rejections`, `cancellation_history` |
| Notifications / Broadcasts | `notifications` (unified, realtime), `broadcasts`, `broadcast_channels/groups/attachments/acknowledgements/read_status` |
| Insights / Performance / Demand ML | `employee_performance_metrics/snapshots`, `employee_reliability_metrics`, `fairness_ledger`, `ml_prediction_log/outcomes`, `demand_forecasts/rules/templates/tensor`, `function_map`, `role_ml_class_map`, `synthesis_runs` |
| VenueOps (event integration feeding ML demand) | `venueops_events/functions/series/rooms/tasks/ml_features` |

### 4.3 Notable views

`v_shift_assignment_episodes` (reconstructs assignment episodes from `shift_events` — source for KPIs and quarterly performance), `employee_daily_metrics` (materialized), `v_template_full`, `hr.v_headcount_by_level`, `hr.v_org_chart`, `hr.v_promotion_ladder`. Several views (`v_group_all_participants`, `v_broadcast_groups_with_stats`, `v_unread_broadcasts_by_group`, `v_template_full`) were **dropped by the Oct-2025 re-baseline and had to be restored** in follow-up migrations — see §5.

### 4.4 App-facing RPCs (called from the frontend, confirmed via grep of `.rpc(`)

**Scheduling gateway:** `sm_apply_shift_op` (unified state-machine entry point — `assign`/`publish`/`unpublish`/`edit`/`delete`/`select_winner`/`approve_trade`/`reject_trade`/`unassign`, with optimistic concurrency + idempotency), `sm_move_shift`, `sm_unassign_shift`, `sm_emergency_assign`, `sm_finalize_planning_request`, `get_shift_lifecycle`.
**Swaps:** `sm_accept_trade`, `sm_create_swap_request`, `sm_cancel_swap_request`, `sm_expire_offer_now`, `sm_swap_auto_revert`.
**Bids:** `sm_select_bid_winner` (deprecated wrapper → `sm_apply_shift_op`), `sm_bid_auto_revert`, `withdraw_bid_rpc`.
**Templates/Rosters:** `add/rename/delete/clone_roster_subgroup_v2`, `toggle_roster_lock_for_range`, `capture_roster_as_template`, `save_template_full`, `check_template_version`, `validate_template_name`, `publish_template_range`, `delete_template_shifts_cascade`, `undo_template_batch`.
**RBAC:** `resolve_user_permissions`, `delete_user_entirely`.
**Insights:** `get_insights_summary/trend`, `get_dept_insights_breakdown`, `get_bidding_kpis`, `get_marketplace_kpis`, `get_manager_scorecard`, `get_metric_detailed_analysis`, `get_quarterly_performance_report`, `get_employee_quarterly_performance`.
**Broadcasts:** `get_broadcast_ack_stats`, `get_broadcast_analytics`, `get_broadcast_group_role`.

**⚠ Finding (OPEN, informational):** a large number of `sm_*`/`*_rpc`/action-verb functions exist in the schema with no confirmed frontend call site (`accept_swap_offer`, `assign_shift_rpc`, `sm_bulk_assign`, `publish_shift`, dozens more) — most look superseded by `sm_apply_shift_op` or `_v2` equivalents, several (`accept_swap_offer` etc.) explicitly raise a `LEGACY_RPC_DISABLED_V3` exception so old callers fail loudly rather than silently. `refresh_all_performance_metrics` and 3 siblings were confirmed dead and dropped 2026-07-30. Recommend a "still needed?" pass before treating the full function list as live API surface.

**⚠ Finding (OPEN):** `ensure_shift_events_partitions` is called by the `partition-manager` Edge Function but has no `CREATE FUNCTION` in any migration file — likely drift or defined outside `supabase/migrations/`.

### 4.5 Edge Functions (background workers)

`auto-approve-swaps`, `auto-assign-bids`, `auto-verify-timesheets` — the three **AutoPilot** workers (see Ch. 2 §7). `shift-state-processor` — sweeps time-based FSM transitions (offer/bidding expiry). `partition-manager` — calls the not-found `ensure_shift_events_partitions` (see above).

### 4.6 Trigger highlights

Full 60+ row catalog in the research artifact; the load-bearing ones: `trg_capture_shift_event`/`trg_capture_swap_event`/`trg_capture_timesheet_event`/`trg_capture_leave_event` (write to the respective append-only audit tables — the backbone of Ch. 14's audit trail), `trg_increment_shift_version` (optimistic concurrency), `trg_enforce_timesheet_review_gate` (blocks timesheet approve/reject/edit until terminal attendance state), `trg_swap_audit_no_update`/`trg_bid_audit_append_only`/`trg_timesheet_audit_append_only` (enforce immutability), `trg_refresh_snapshots` (re-projects the `assignment_snapshots` KPI spine on every relevant `shift_events` insert), `on_auth_user_created` → `handle_new_user()` (bootstraps `profiles` on signup).

## 5. Config / infra & known schema-history risks

**⚠ Finding (OPEN, process risk, not a live bug):** the schema has a documented "baselining drift" pattern — the October 2025 re-baseline silently dropped several views and RLS policies, requiring dedicated restore migrations (`20260702013458_restore_v_group_all_participants.sql`, `20260702051700_restore_missing_views.sql`, and an equivalent for dropped SELECT policies — see project memory `rebaseline-dropped-select-policies`). A new team should be aware that "present in the baseline snapshot" is not sufficient evidence something is still live — always check for a later restore/drop migration.

Three deliberate hardening sprints exist in the migration history and are worth knowing about as a pattern, not just their individual fixes: 2026-07-19→21 ("WS-A" through "WS-E", tied to Supabase Advisor findings), 2026-07-20 ("Phase 1–5", tied to an internal production-readiness audit), and 2026-07-30 (IDOR fix + this rulebook's own RLS finding, Ch. 8 §5). Each swept a specific *pattern* of bug (`USING(true)`, missing policies, RLS recursion, IDOR) — none of them happened to catch the correlated-subquery bug fixed during this rulebook's research, because it doesn't match any of those patterns syntactically. Recommend a dedicated pass specifically hunting for correlated-subquery / alias-shadowing bugs in RLS predicates, since this bug class is now confirmed to exist and evaded three prior sweeps.
