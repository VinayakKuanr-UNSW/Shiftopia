# Access suites

Agreed 2026-10-14. Access is split into three suites. Certificates stay the grant mechanism; `rbac_permissions` (by place, through `user_has_action_in_scope`) stays the one rule the database enforces.

| Level | Certificate | Personal suite | Managerial suite | Admin suite |
|---|---|---|---|---|
| alpha | X | every sub-department contracted to | — | — |
| beta | X | every sub-department contracted to | Timesheets, **view-only** | — |
| gamma | Y | (from their X) | **full**, one sub-department | — |
| delta | Y | | **view-only**, one department and all its sub-departments | — |
| epsilon | Y | | **view-only**, the organization | — |
| zeta | Y | | **full**, everything | **full** |

Notifications, Settings and Profile are open to everyone signed in.

| Suite | Pages |
|---|---|
| Personal | My Roster `/my-roster`, My Availabilities, My Timesheets `/my-attendance`, My Bids, My Swaps, My Leave, My Broadcasts, My Performance `/performance` |
| Managerial | Roster `/rosters`, Templates, Timesheets `/timesheet`, Open Bids, Swap Requests, Leave Approvals, Broadcast Centre `/broadcast`, KPI `/insights`, Grid `/team-availability`, Payroll |
| Admin | Labor Demand, Compliance Rejections, Users |

## Decisions (2026-10-14)

1. Delta's scope is one department and all its sub-departments.
2. One Type X certificate per person (alpha or beta), no department or sub-department on it; the personal scope is the person's active contracts. Someone contracted to several sub-departments sees all of them. A contract ending drops that sub-department with no certificate edit.
3. Beta's read-only Timesheets cover every sub-department they are contracted to. Trade-off: "team lead in Bar, ordinary staff in Kitchen" cannot be expressed.
4. Payroll and the Grid are bound to the managerial scope filter, so "view" includes export of what is on screen.
5. Action alerts (bidding closed with no winner, shift dropped) go to someone who can act: the sub-department's gamma, else a zeta. Never to a view-only level.
6. Surfaces not on the sheet: organization configuration (org structure, pay periods, work rules, system config, cleanup rules, Pay Rates) is Admin; AutoScheduler, Reserve List and budgets are Managerial writes; first aid, TOIL and skills belong to the Users page.
7. No Type X certificate and no contract ⇒ no employee hat.
8. Open bids and swaps are visible in the sub-departments a person is contracted to, not organization-wide.
9. One organization (ICC Sydney). The organization column stays; epsilon and zeta see the same data and differ only in writes and the Admin suite.
10. Broadcast group roles (admin / broadcaster / member) stay independent of access level. Broadcast Centre is therefore the one managerial page where rights come from the group: a delta made a group broadcaster can post.

## Where it is enforced

- **Database** — the authority. `rbac_permissions` rows by level and scope; RLS and RPC guards ask `user_has_action_in_scope` / `can_act_on_*` at the row's place. Per-level tests: `supabase/tests/access_matrix/` (`02` reads and writes on shifts, timesheets, bids, swaps, contracts, certificates; `04` availability, budgets, KPI, payroll, templates, Admin-suite tables, clock-in on behalf, assignment runs, open-bid visibility). The HTTP suite in `tests/integration/` asserts the same matrix over PostgREST.
- **Client** — `src/platform/auth/accessSuites.ts` decides what to show, per suite, from both certificates a person holds. Every route guard, nav entry and in-page write control asks `hasPermission(key)`; `managerial-write` is the key for "may change things". A write the UI offers but the matrix refuses comes back as a silent 0-row update, so the two must stay in step.

## Steps — applied to Supabase 2026-10-15

Four migrations, applied in order. Each was generated from the live definitions on a local copy of the database and tested there; then the whole set was proven on a fresh rebuild from the baseline (migrations, then the reference seed), where the per-level harness reproduced line for line and all 61 HTTP integration tests passed, edge functions included.

**1. Tighten — `20261015110641_access_suites_view_only`.**
Delta and epsilon lose every write row (15 each); beta loses roster and broadcast views. Epsilon loses certificate grants, contract writes and organization configuration. Checks that asked "gamma or above?" with no place now ask at the row's place: availability, department budgets, performance, payroll records, templates, clock-in on someone's behalf, assignment runs, another employee's quarterly performance, pay terms. Labor Demand and Compliance Rejections tables become zeta's. Reads that only a write action unlocked (bids, swaps, swap and shift offers, planning, cancellation history, full-time baseline) move to a view action, so view-only levels keep seeing them. Open bids and swaps narrow to contracted sub-departments. Template creation, refused for everyone because its check read a contract field pinned to NULL, works again.

**2. Grant — `20261015110702_access_suites_grants`.**
Thirteen actions: `template.view/manage`, `bid.view`, `swap.view`, `payroll.view`, `kpi.view`, `availability.view/manage`, `demand.view/manage`, `compliance.view`, `access.manage`, `org.manage`. (`timesheet.edit` was planned and dropped: `timesheet.approve` already covers editing a timesheet.) Gamma gains `shift.delete` and `roster.publish` in its sub-department, and sees pay there. Delta and epsilon gain view actions only. Step 1's stand-ins give way to these actions; the Admin suite (`is_admin()`, certificate grants, demand, compliance, fairness recompute) is decided by actions zeta holds rather than by `is_zeta()`. Recomputing the fairness ledger moves from any gamma+ to `org.manage`.

**3. Personal scope on contracts — `20261015110713_access_suites_contracted_scope_value` (the `CONTRACTED` scope; its own migration because a new enum value cannot be used in the transaction adding it) and `20261015110725_access_suites_personal_scope_on_contracts`.**
A Type X names no department or sub-department and there is one active per person (CHECK, unique index, and a readable trigger message). Beta's `timesheet.view`, `shift.view` and `user.view` use `CONTRACTED`. `resolve_user_permissions` returns `contracted_scope_tree`, which the personal scope filter reads. `get_broadcast_group_role` inherits membership from every active contract (it read one, arbitrarily). Existing X certificates lose their department and sub-department; a person holding several keeps the highest.

Client. Per-suite permissions (`accessSuites.ts`); Admin mode zeta-only; no employee hat without a Type X or a contract; read-only modes for delta and epsilon on the Roster (toolbar and Events mode), Templates, Open Bids, Swap Requests and Leave Approvals; the Users page, contracts and certificates on the Admin suite (zeta was locked out by an exact match on epsilon); zeta can pick departments in the organization selector and resolves to ICC Sydney; broadcast rights follow the database (group role, or zeta); the certificate dialog asks only for the organization on a Type X and refuses a second one; levels are named alpha–zeta only. `access.policy.ts`, a dead second permission table that contradicted the live one, is gone.

## Rebuild order — a trap these migrations had to avoid

The baseline is schema-only; `supabase/seeds/reference.sql` loads `rbac_actions` and `rbac_permissions` **after** the migrations. So on a fresh rebuild a migration sees an empty matrix: an UPDATE or DELETE of a row silently does nothing, and inserting a row for an existing action fails its foreign key. Matrix migrations therefore (a) also edit the seed to the end state, (b) upsert rather than update, and (c) re-declare, `ON CONFLICT DO NOTHING`, any existing action they grant. Only a fresh rebuild catches a slip; the live database never would.

## Closed after the three steps (2026-10-14)

- **Places and the access scoped to them** — migration `20261015110735_access_certificate_place_guards`. Deleting or retiring an organization, department or sub-department is refused while an active certificate is scoped to it; the message names the place and the holders and says to revoke or re-scope on the Users page. Revoked certificates no longer block a delete — they go with the place (`ON DELETE CASCADE`), and `access_certificate_events` keeps the full row and records the removal. Nothing is granted, or re-activated, in a retired place. Tested by `supabase/tests/access_matrix/05_place_guards.sql`. On the Users page, revoke is now a soft revoke (`is_active = false`, recorded as `revoked`) as agreed on 2026-10-11; it used to hard-delete the row.
- **Writes the database silently refuses** — `src/platform/supabase/writes.ts`. A write aimed at one record asks for the row count; `assertWrote()` turns "no error, nothing changed" into a `PERMISSION_DENIED` AppError (the code a refusing RPC raises), so existing toasts show it. Applied to the record-targeted writes on Leave, Timesheets (incl. no-show), Templates, Users (certificates, contracts, work rights, first aid, skills, licences), swaps and swap approval rules, bids, availability, drag-and-drop assignment, Broadcast Centre administration, Labor Demand templates and the planning-request terminal actions. Bulk and idempotent writes (mark all read, clear-then-insert, range clean-ups) are deliberately left alone: touching nothing is normal for them.
- **Stale "is_manager_or_above() is broken" docs** — `HANDOVER.md` gotcha #8 rewritten; the 2026-06-24 investigation docs carry dated corrections.

## Contracts carry access (2026-10-15)

Decided after the three steps, on the spreadsheet "Combine Position Contracts + Access Certificates into one uniform table — call it Contracts". It supersedes decisions 2 (one X per person), 3 (beta covers every contracted sub-department) and the one-managerial-certificate rule.

- **One row per position.** Each contract carries an access level, reaching the row's own place: alpha/beta/gamma its sub-department, delta its department, epsilon its organization, zeta everything. A person's access is the union of their contracts (EBA cl 13 multi-hiring). Team Lead (beta) is therefore per position: Kurry leads in Event Setup, not in EIS.
- **Every access level sits on a real position.** No contract, no access. Kurry's zeta is on his Full-Time EIS Specialist contract.
- **Employment type is the four EBA categories** (cl 12.1): Full-Time, Part-Time, Flexible Part-Time, Casual — not "Class 1 / Class 2". It decides the remuneration options (already enforced by CHECKs on `hr.user_contracts`): Full-Time salaried or Level 0–7 (security roles: annualised Level 3–6); Part-Time Level 0–7 or salaried pro-rata (cl 2.2(b)); Flexible Part-Time and Casual Level 0–7 only. And the contracted hours (now enforced too): 38 / under 38 / 624–1,976 a year / none.
- **Migration** `20261015110745_contracts_carry_access`: the access level on each contract (default alpha; set by zeta only); existing certificates carried onto contracts (a managerial one onto the most permanent contract in its place, beta onto every contract) and then made a **read-only mirror** of them, so the ~70 readers, the audit log, the last-zeta guard and the place guards keep working unchanged; beta's matrix rows move from CONTRACTED to SUB_DEPT; `resolve_user_permissions` returns every managerial certificate (`typeYs`) and the union of their places; the retired `auth_can_manage_certificates()` (still honoured the legacy admin flag; no callers) is dropped.
- **Rehearsed on the live data**: Kurry's zeta lands on his EIS Specialist contract keeping its certificate id; his alpha certificate is removed (logged); his Event Setup Team Leader row is alpha (he never held beta; zeta covers it).
- **Tests**: fixtures now give every persona a contract carrying their level (B: beta in S1, alpha in S3 — Team Lead only in S1); `06_contract_access.sql` covers the lifecycle; the HTTP matrix sets access on contracts.

## Contracts table on the Users page (2026-10-15)

Superseded on 2026-10-16 by the Users page as one table (below). It was one **Contracts** table per person, with search, filters and a column menu, replacing the contracts card and the Access card.

- The contract wizard is the single add / edit form: step 1 picks one of the four EBA employment types (no "Class 1 / Class 2"); step 2 (Position) picks the place, the role and the **Access**, saying where it reaches; a team-lead role gets a one-click "Use Team Lead" suggestion, never a silent grant. Editing saves from any step.
- Levels show by name everywhere: Employee, Team Lead, Manager, Department Viewer, Organisation Viewer, Administrator (`ACCESS_LEVEL_CONFIG`, and `access_level_label()` for database messages). The codes stay alpha–zeta in the data.
- Retired: `AccessCertificatesSection`, `AddAccessCertificateDialog`, `ContractsSection`, the multi-role `AddContractDialog` + `useContractForm` (superseded by "one contract = one role"), `EmploymentTypeDropdown`, `accessSummary`.

## Contract dates drive the contract (2026-10-16)

Asked for on 2026-10-16: contracts can start in the past (backdated) and end on a set last day; past the last day the contract expires; an expired contract, and the access it gave, stay visible as Expired and Revoked for the audit trail and can't be edited.

- **Migration** `20261016052306_contract_dates_drive_the_contract`, applied to Supabase 2026-10-16. Status becomes Upcoming / Active / Expired, set from `start_date` (now NOT NULL) and the inclusive `end_date` by `hr.contract_lifecycle()` on every write and by `hr.run_contract_lifecycle()` hourly (pg_cron `contract_lifecycle_hourly`, `7 * * * *`). The old Inactive / Terminated rows become Expired with a last day. `trg_contract_access_sync` now also fires on date changes, so the mirror grants on the start and revokes on expiry.
- **Guardrails** (the table in `docs/rulebook/08-rbac-matrix.md` §1). As first built, Expired was final and only an Upcoming contract could be deleted; both were relaxed the same day (next section). An Upcoming contract can't be ended; the status is never written directly; a date change can't strand an assigned shift; the hours and Full-Time / Part-Time rules count every contract whose dates overlap, which the wizard mirrors in `concurrentWith`; the only Administrator contract has no last day; a place with contracts recorded there is retired, not deleted; `auto_link_shift_to_contract` links a shift to the contract in force on the shift's date.
- **Client**: the wizard's Position step has Start date and Last day (optional), with notes for an upcoming start, a backdate ("access applies from now; pay already processed isn't recalculated") and a last day that ends the contract on save. The table has a Last day column, an Upcoming badge, "From …" on upcoming access and "Revoked …" on expired access. The End dialog picks the last day (today by default).
- **Tests**: `07_contract_dates.sql` (16 cases, compared with `expected_dates.txt`); `05` and `06` end contracts as Expired; unit tests for the table, the wizard hook, the date fields and `concurrentWith`. Proven on a fresh rebuild: harness 02–07 line for line, and the HTTP integration suite (64 tests, edge functions included).

## Users page as one table (2026-10-16)

The page is one table (`src/modules/users/ui/components/UsersTable.tsx`, data from `useUsersTable`, words from `domain/usersTable.ts`) inside the global scope chosen in the header: a row per contract, grouped under the person. Columns: Name, Organization, Department, Sub-department, Role, Employment, Remuneration (basis only), Access, Status, Start date, End date, Skills, Licences, Work rights, then Edit and Delete. Name and Actions stay in view while the table scrolls sideways; phones get a card per person.

- **Function line:** Export (Excel or PDF of the rows on screen, `ui/users.export.ts`) and New User. The employee picker and the filters are gone.
- **In place:** Start and End dates, with a date picker per cell; clearing End makes the contract ongoing. The database's checks still apply (shifts inside the dates, the only Administrator keeps no end date).
- **Edit** opens one panel (`UserEditDialog`): Contract (the wizard, `contract-wizard/ContractWizard.tsx`, no longer a dialog of its own), Skills, Licences, Work rights, First aid. People without a contract show with **Add contract**.
- **Delete** removes a contract whatever its status, unless a shift is rostered under it. Migration `*_contracts_add_edit_delete`: delete any contract with no shifts (`contract_delete_guard`), expired contracts editable again (a later end date reopens one), and the unique key on (person, place, role), which ignored the dates, became an exclusion over them, so a role held before can be added again.

## Global scope from contracts (2026-10-18)

The scope filter in every page header now rests on the contracts table alone. Before, it mixed the contracts and their certificate mirror, and that left gaps: alpha contracts create no certificate, so the personal filter was hidden from 444 of 491 people with a contract.

- **Trees** — migration `*_scope_trees_from_contracts`. `resolve_user_permissions` builds all three trees from `hr.user_contracts` through `hr.contract_scope_tree(user, min_level)`: `contracted_scope_tree` (personal: each active contract's own sub-department), `allowed_scope_tree` (managerial: what gamma-and-above contracts reach) and the new `timesheet_scope_tree` (the managerial reach plus each Team Lead contract's sub-department). Before applying, it was checked against the live function for every person with an active contract: the managerial tree was identical for all 491, and the personal tree had the same places (3 changed order only, now sorted by name).
- **Client** — `src/platform/auth/scope-selection.ts` holds the rules. The filter is shown when the mode's tree has a place in it, not when a certificate exists. Timesheets uses its own mode, `timesheet`, and shares the managerial selection. "Locked" (filter hidden) means the tree holds exactly one place, whatever the level. The organization is locked only when there is one. A saved selection is reconciled against the tree before a page reads it, and it is stored per person (`superman_scope_filters:<user id>`); the device-wide key is removed.
- **Users page** — every contract write there (inline dates, revoke, delete, the edit panel) refreshes the permission object without a loading state. Editing your own contract moves your filter straight away.
- **Not changed** — managerial pages stay single-select (except Users), so a delta views one sub-department at a time. That is a per-page product decision, not a scope-filter fault.

## Still open

- **Rostering ahead on an Upcoming contract.** Shift eligibility and compliance (`get_eligible_employees_for_shift`, `check_shift_compliance`, `fn_enforce_shift_employment_target`, `sm_holds_active_contract_in`) still ask whether a contract is Active today, so nobody can be rostered for a shift on 5 Nov under a contract starting 2 Nov until 2 Nov. For access, "Active today" is right. For rostering, the test should be the shift's date against the contract's dates, which `check_shift_compliance` already applies alongside it.
- **Contract history.** Editing a contract rewrites the row; nothing records what applied before. Decided 2026-10-16: no change log or "change from a date" until the app is fully built. A change is made by adding a contract and deleting (or ending) the old one.
