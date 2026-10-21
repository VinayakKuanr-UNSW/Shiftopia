# Chapter 8 — Access: suites, levels and the permission matrix

**Confidence:** Verified 2026-10-16 against a database rebuilt from `supabase/migrations` + `supabase/seeds`, with the per-level harness in `supabase/tests/access_matrix/` and the HTTP suite in `tests/integration/`. The design and its decisions are in `docs/architecture/access-suites-plan.md`; this chapter describes how it works.

## 1. The model

Access is set on **contracts** (since 2026-10-15). Every row of `hr.user_contracts` — one position: organization, department, sub-department, role, employment type, remuneration — also carries the **access level** that position gives, and that access reaches the row's own place. A person's access is the union of their active contracts, so multi-hiring (EBA cl 13) needs nothing special: each position brings its own. Levels are named alpha to zeta in the database and by name on screen — Employee, Team Lead, Manager, Department Viewer, Organisation Viewer, Administrator (`ACCESS_LEVEL_CONFIG`; `access_level_label()` for database messages). Only an Administrator sets them, on the Users page table.

| Level | Personal suite | Managerial suite | Admin suite | Reaches |
|---|---|---|---|---|
| alpha | own data | — | — | the row's sub-department (every contract) |
| beta | own data | Timesheets, view-only | — | the row's sub-department |
| gamma | own data | full | — | the row's sub-department |
| delta | own data | view-only | — | the row's department and all its sub-departments |
| epsilon | own data | view-only | — | the row's organization |
| zeta | own data | full, everything | full | everything |

`app_access_certificates` is a **read-only mirror** of the contracts: one row per contract above alpha, written only by `hr.apply_contract_access()` (fired by `trg_contract_access_sync`). Every policy and function reads the mirror, unchanged; nobody writes it directly. Type X (beta) and Type Y (gamma–zeta) survive only as its derived `certificate_type` column.

Every access level sits on a real position, so anyone with access has the Personal suite; no contract means no access at all. Contracted hours follow the employment type (EBA cl 12.2–12.5, 35.3): Full-Time 38 a week, Part-Time more than 0 and under 38, Flexible Part-Time 624–1,976 a year, Casual none.

**Contract dates drive the contract** (since 2026-10-16). Every contract has a start date and, optionally, a last day, which is inclusive. The database sets the status from them on the Sydney calendar: **Upcoming** before the start, **Active**, then **Expired** after the last day. `hr.contract_lifecycle()` does this on every write, and `hr.run_contract_lifecycle()` sweeps hourly at :07 (pg_cron `contract_lifecycle_hourly`). The access mirror follows. An Upcoming contract gives no access until it starts, and an Expired one has its access revoked, logged like any other revocation.

| Rule | Where |
|---|---|
| An expired contract can still be corrected; a later end date, or none, puts it back in force with its access (since 2026-10-16). | `contract_lifecycle` |
| Any contract can be deleted unless a shift is rostered under it: shifts are priced on their contract. A contract ends by being given an end date; one of today or earlier ends it at once. | `contracts_delete_manager`, `contract_delete_guard` |
| One role in one place at a time: the same role can be held again once the earlier contract has ended. | `user_contracts_one_role_one_place_at_a_time` (exclusion over the dates), `fn_check_user_contract_guardrails` |
| An Upcoming contract can't be "ended": there is nothing to end, so delete it. | `contract_lifecycle` |
| The status is never written directly. The old values `Inactive` / `Terminated` are refused, with a message saying how to end a contract. | `contract_lifecycle`, `user_contracts_status_check` |
| A shift assigned under a contract must fall inside its dates, so a date change that would strand one is refused, naming the first such shift. | `contract_lifecycle` |
| The Full-Time / Part-Time and 38-hour rules count every contract whose dates overlap, expired ones included, so a backdated contract can't double-book a period. A contract that ends before another starts doesn't count. | `fn_check_user_contract_guardrails` (the wizard mirrors it: `concurrentWith`) |
| The only Administrator contract can't have a last day. | `contract_access_guard` |
| A place with contracts recorded there can't be deleted, only retired, so the records keep their place. | `place_keep_access_scope` |
| Backdating is allowed. Access applies from the moment of saving, and pay already processed is not recalculated. | the wizard says so |

| Suite | Pages |
|---|---|
| Personal | My Roster, My Availabilities, My Timesheets (`/my-attendance`), My Bids, My Swaps, My Leave, My Broadcasts, My Performance |
| Managerial | Roster, Templates, Timesheets, Open Bids, Swap Requests, Leave Approvals, Broadcast Centre, KPI (`/insights`), Grid (`/team-availability`), Payroll |
| Admin | Labor Demand, Compliance Rejections, Users |
| Everyone | Notifications, Settings, Profile |

Broadcast group roles (admin / broadcaster / member) are a separate grant, by design: a delta made a group's broadcaster can post in that group. Zeta is admin of every group.

## 2. Server side — the authority

**The matrix.** `rbac_permissions(access_level, action_code, scope)`, scope one of `SELF`, `SUB_DEPT`, `DEPT`, `ORG` (`CONTRACTED` remains in the enum, unused; a CHECK keeps it out). `user_has_action_in_scope(action, org, dept, sub)` answers "does the caller hold this action at this place": zeta anywhere; otherwise a certificate in the place's organization whose row reaches it — `ORG`, the certificate's department (`DEPT`) or its sub-department (`SUB_DEPT`). Each certificate mirrors one contract, so with several contracts the caller holds the action wherever any of them reaches. `SELF` rows never match a place; personal reads are written as `x = auth.uid()` in the policy itself.

**Place helpers**, used by RLS and RPC guards: `can_act_on_shift`, `can_act_on_employee` (any of the employee's active contracts), `can_act_on_timesheet`, `can_act_in_subdept`, `can_act_in_dept`, `can_act_on_swap`, `can_act_on_planning_request`, and `holds_action(action)` for rows with no place.

**Who holds what** (scope in brackets):

| Action | gamma | delta | epsilon | zeta | Also |
|---|---|---|---|---|---|
| `roster.view`, `shift.view`, `timesheet.view`, `leave.view`, `user.view`, `broadcast.view`, `bid.view`, `swap.view`, `template.view`, `payroll.view`, `kpi.view`, `availability.view` | SUB_DEPT | DEPT | ORG | ORG | beta: `shift.view`, `timesheet.view`, `user.view` [SUB_DEPT — the team lead's own row] |
| `contract.view` | — | DEPT | ORG | ORG | |
| `shift.create/edit/assign/publish/delete`, `roster.edit/publish`, `bid.assign/close`, `swap.approve`, `timesheet.approve`, `leave.approve`, `broadcast.create`, `template.manage`, `availability.manage` | SUB_DEPT | — | — | ORG | |
| `contract.manage`, `user.edit`, `access.manage`, `org.manage`, `demand.view/manage`, `compliance.view` | — | — | — | ORG | |
| `bid.submit`, `swap.request` | | | | | alpha, beta [SELF]; alpha also holds the view actions at SELF, which match no place |

Two assertions in the migrations keep the shape honest: delta and epsilon hold no action outside `*.view`, and no Admin suite action is held below zeta.

**Level-named helpers that remain**, each now defined through the matrix: `is_admin()` = `holds_action('org.manage')` (organization structure, pay periods, work rules, system config, cleanup rules); `is_org_admin(org)`; `can_read_certificates_in` = `access.manage` (`can_grant_certificate` / `can_change_certificate` remain but guard nothing: certificates are no longer written by clients); `auth_can_manage_templates()` = zeta, `auth_can_create_template(place)` = `template.manage` there. `is_manager_or_above()` and `user_has_delta_access()` gate nothing any more: no policy uses either, and the only function still naming the first, `auth_can_manage_rosters()`, has no callers itself.

**Access rules**, all enforced in the database: only the Admin suite sets a contract's access (`trg_contract_access_guard`, on top of contract writes being zeta-only); the row must have the place its level reaches (`user_contracts_access_has_place`, with a readable message from the guard); the mirror's level matches its type and place (`chk_level_matches_type`, `chk_scope_nullability`), its department belongs to its organization and its sub-department to its department, and a mirror row stays with its contract (`validate_certificate_on_change`); the last active zeta can be neither lowered nor ended (`trg_access_certificate_keep_last_zeta`, break-glass runbook in `docs/operations/access-break-glass.md`); every change is logged with its actor (`access_certificate_events`). Lowering a contract to alpha, ending it, letting it expire or deleting it revokes its mirror; an Upcoming contract has no mirror until it starts. A place — organization, department, sub-department — that active access reaches can be neither deleted nor retired (`place_keep_access_scope`, with a message naming the holders); revoked access goes with a deleted place; nothing is set in a retired one.

## 3. Client side — what to show

`src/platform/auth/accessSuites.ts` decides, per suite, from every certificate (one per contract) a person holds — never from a single "effective level": gamma in one sub-department and delta in another is full access in the first and read-only in the second. Everything asks `useAuth().hasPermission(key)`:

| Key | Who |
|---|---|
| `profile`, `read` | everyone signed in |
| `my-roster`, `availabilities`, `bids`, `my-swaps`, `my-broadcasts`, `performance` | Type X or an active contract |
| `timesheet-view` | beta and every Type Y |
| `rosters`, `templates`, `management`, `broadcast`, `insights` | gamma, delta, epsilon, zeta |
| `managerial-write`, `create`, `update`, `delete`, `timesheet-edit` | gamma, zeta |
| `admin`, `users`, `labor-demand`, `compliance`, `configurations`, `audit` | zeta |

Unknown keys are refused. Route guards (`FeatureGate` in `AppRouter.tsx`), the sidebar, the bottom nav and every in-page write control use these keys. Personas mirror the suites — employee, employer, admin — and a hat is offered only to someone holding that suite (`PersonaProvider.tsx`).

**The gap to remember:** an UPDATE or DELETE that RLS refuses returns 0 rows and no error through PostgREST. A write aimed at a particular record therefore asks for the count and passes the result to `assertWrote()` (`src/platform/supabase/writes.ts`), which raises a `PERMISSION_DENIED` AppError on zero rows. Bulk and idempotent writes, where zero rows is normal, do not. Keep the UI and the matrix in step anyway; the per-level tests are how.

## 4. Testing access

- `supabase/tests/access_matrix/` — fixtures (one persona per level, plus beta B contracted to two sub-departments in different departments), two per-level files, a place-guard file (`05`), contract access (`06`) and contract dates (`07`). `02` covers shifts, timesheets, bids, swaps, contracts and certificates. `04` covers availability, budgets, KPI, payroll, templates, the Admin suite tables, clock-in on someone's behalf, assignment runs, open-bid visibility, pay terms, the fairness recompute and broadcast membership. Each prints one line per persona to compare with `expected_matrix.txt` / `expected_suites.txt`. Local database only.
- `tests/integration/` runs the same matrix over HTTP with real JWTs, plus the core shift flows and edge-function authorisation.
- `src/platform/auth/__tests__/accessSuites.test.ts` pins the table in §1 for the client.
- Changing access on purpose means changing the expected files, the seed (`supabase/seeds/reference.sql` — see the rebuild-order note in the plan) and this chapter together.

## 5. Historical findings (2026-07-30 audit) — status

| Finding | Status |
|---|---|
| `payroll_records_select` / `compliance_snapshots_select` correlated-subquery no-op | Fixed 2026-07-30 (`20260730050000`); both now scoped by place |
| `employee_leave_balances` / `shift_offers` / `roster_templates` always-true policies | Closed — none of those policies exists (checked 2026-10-14) |
| Dangling `profiles.system_role` references | Closed — no function references it (checked 2026-10-14) |
| Dead `access.policy.ts` second permission table | Deleted 2026-10-14 |
| `/compliance/rejections` client gate vs delta+ RLS | Resolved — both are zeta (Admin suite) |
| Broadcasts gated on the legacy `Role` string | Resolved — the client follows the database: group role, or zeta |
| `HANDOVER.md` and `docs/investigations/2026-06-24_*` still say `is_manager_or_above()` is broken | Closed 2026-10-14 — handover gotcha #8 rewritten, dated corrections in the investigation docs |
