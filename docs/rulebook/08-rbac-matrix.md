# Chapter 8 — RBAC Permission Matrix (Phase 8)

**Confidence:** role model and gate mechanism are **Verified** (read directly, cross-checked client-vs-RLS). Individual matrix cells are graded per-row; anything not explicitly marked is **Strongly Inferred**.

## 1. The role model

Shiftopia does **not** use a single role enum. The live, authoritative model is a two-axis **certificate system** on `app_access_certificates`:

| Access level | Axis | Meaning |
|---|---|---|
| `alpha` | Personal (Type X) | Employee — own data only |
| `beta` | Personal (Type X) | Team Lead — read-only timesheets |
| `gamma` | Managerial (Type Y) | Sub-Department Manager |
| `delta` | Managerial (Type Y) | Department Manager |
| `epsilon` | Managerial (Type Y) | Global Admin |
| `zeta` | Managerial (Type Y) | System Admin |

Source: `src/platform/auth/types.ts`, `src/platform/auth/constants.ts:5-54`. Each certificate carries an org/department/sub-department scope, so "manager" is always scope-bounded, not a global flag.

A legacy flat `Role` type (`'admin' | 'manager' | 'teamlead' | 'member'`) still exists as a **derived, display-only** field (`auth.service.ts:108-113`: `zeta|epsilon→admin`, `delta|gamma→manager`, `beta→teamlead`, else `member`) and mirrored in the DB as `public.system_role` / `profiles.legacy_system_role` (column comment: `'DEPRECATED: Use user_contracts table instead.'`).

**⚠ Finding (OPEN):** `broadcasts` is the one module confirmed to gate manager actions on the legacy `Role` string directly (`useBroadcasts.ts:242-248`: `user?.role === 'admin' || user?.role === 'manager'`) rather than `AccessLevel`. Its "manager" threshold therefore doesn't map cleanly onto the gamma/delta/epsilon ladder used everywhere else — treat Broadcasts' manager check as "legacy admin/manager role holder," not a specific access level, until reconciled.

## 2. Client-side gate mechanism

**Live, wired-in gate:** `FeatureGate` (`src/router/AppRouter.tsx:123-129`) wraps route groups and calls `useAuth().hasPermission(feature)` (`src/platform/auth/useAuth.ts:80-128`) — a hard-coded `Record<string, AccessLevel[]>` table (lines 84-115). `getEffectiveLevel()` (lines 38-51) resolves the caller's level from: active certificate → `zeta/epsilon/delta` superuser fallback on `highestAccessLevel` → active contract → default `'alpha'`.

Convenience wrappers on the same hook: `isAdmin()`, `isManagerOrAbove()`, `isTeamLeadOrAbove()` (all threshold checks on `getEffectiveLevel()`), and `useScopeFilter(mode)` (`src/platform/auth/useScopeFilter.ts`) for page-level org/dept/sub-dept scoping, backed by the `resolve_user_permissions()` RPC.

**Confirmed dead code (do not treat as live spec):**
- `src/platform/auth/access.policy.ts` — a second `hasAccess()`/`PERSONAL_PAGES`/`MANAGERIAL_PAGES` permission table. **Disagrees with the live `useAuth.hasPermission` map** on at least the Insights threshold (`delta` here vs. `gamma+` live) — nothing calls this file's exports, but it reads like a spec and is easy to cite by mistake.
- `src/modules/auth/ui/ProtectedRoute.tsx` — a role/feature guard HOC, confirmed unimported anywhere.
- `src/modules/auth/contexts/AuthContext.tsx`'s duplicate `Role`/`AuthContext` (explicitly commented `// DEBUG VERSION`), confirmed unimported.
- `AuthProvider.hasAccess(feature, subDeptId?)` context method — exposed but never called anywhere in the app.

**⚠ Finding (OPEN):** delete or reconcile `access.policy.ts` — its presence as apparently-authoritative-looking code with a *different* answer than the live gate is a real onboarding hazard for a new team.

## 3. Server-side (RLS/RPC) gate mechanism

Layered role-check SQL functions (all `SECURITY DEFINER`, baseline `20251015000000_baseline_schema.sql` unless noted):

| Function | Logic | Status |
|---|---|---|
| `is_admin()` | `legacy_system_role IN ('admin','manager')` OR active cert `zeta/epsilon` | **Verified working** — has an `EXCEPTION WHEN OTHERS → FALSE` guard |
| `is_manager_or_above()` | same pattern, cert `gamma/delta/epsilon/zeta` | **Verified working now.** See §4 — this was previously broken, is now fixed, and several docs still incorrectly say otherwise |
| `has_permission(_user_id, _target_sub_dept_id, _required_level)` (2 overloads) | zeta global bypass; else org/dept/sub-dept scope match at/above required level via `user_contracts`/`app_access_certificates` | Verified live — used directly in `shifts_insert/update/delete_managers` RLS |
| `user_has_delta_access(_user_id)` | cert `delta/epsilon/zeta` OR legacy admin/manager | Verified live, OR'd alongside `has_permission()` on shifts/rosters/bids/swaps |
| `user_has_action_in_scope(action_code, org_id, dept_id, sub_dept_id)` | finer-grained lookup against `rbac_permissions(access_level, action_code, scope)` | **Unknown** whether `rbac_permissions` is actually seeded in prod — no seed data found in migrations. Drives `*_rbac`-suffixed policies on rosters/shifts, OR'd with the coarser checks above so an empty table fails safe (harmlessly permissive-by-omission, not permissive-by-bug) |
| `auth_can_manage_certificates()` | legacy admin OR active cert `epsilon/zeta` | Gates who can grant/revoke access levels (Users/Settings admin surface) |
| `auth_can_manage_templates()` | cert `gamma/delta/epsilon/zeta` OR legacy admin/manager | |
| `is_broadcast_system_manager()` | legacy admin/manager only | Global broadcast admin gate |
| `get_broadcast_group_role(group_id)` | per-group role, independent of org RBAC | What Broadcasts actually reads as its "manager" check |

## 4. ⚠ Finding: stale "is_manager_or_above() is broken" documentation (OPEN — docs only, not code)

The function **is fixed and currently working** (confirmed both by reading its current body and by the fact that today's `get_quarterly_performance_report()` migration relies on it directly for a security-critical gate). The original bug (archived migration `20260615232747_fix_is_manager_or_above.sql`, reading a nonexistent `profiles.system_role` column, silently swallowed to always-FALSE) was fixed by switching to `legacy_system_role`.

However, **`HANDOVER.md` (gotcha #8) and several files under `docs/investigations/2026-06-24_auto-assign-bids-and-swap-approval/*.md` still say it's "BROKEN in prod"**, including at least one comment that postdates the actual fix. This has caused real downstream cost: developers avoided the helper and hand-rolled the same cert-check boilerplate inline across many RPCs (`sm_apply_shift_op`, `sm_bulk_assign`, `sm_swap_auto_decide`, etc.) instead of calling it. `docs/investigations/2026-07-21_reserve-list-audit-and-implementation-plan.md:185` already corrects the record for that one document. **Action item: correct `HANDOVER.md` and the `docs/investigations/2026-06-24_auto-assign-bids-and-swap-approval/*.md` files** — this is pure documentation debt at this point, not a code fix.

## 5. ⚠ Findings: the same bug class recurs, and a real live gap was found and fixed during this rulebook's research

**FIXED 2026-07-30** (during this rulebook's research — see `README.md` for the full writeup): `payroll_records_select` and `compliance_snapshots_select` RLS SELECT policies on `shift_payroll_records`/`shift_compliance_snapshots` used a correlated subquery (`s.organization_id IN (SELECT s.organization_id FROM profiles WHERE profiles.id = auth.uid())`) that — because `profiles` has no `organization_id` column — silently resolved as a self-referential check, collapsing to "does the caller have any profile row," with **no actual org, ownership, or manager scoping**. Verified live in prod: 107 profiles, any of which could read all 75 rows of both tables regardless of whose shift it was. Fixed by replacing both with the established self-or-manager idiom already used elsewhere in this schema (`employee_performance_metrics.perf_metrics_self_or_manager_read`: `(employee_id = auth.uid()) OR is_manager_or_above()`), applied via migration `20260730050000_fix_payroll_compliance_snapshot_rls_org_check.sql`, verified via `get_advisors` (0 new findings).

**OPEN — same bug class, not yet fixed** (reference to nonexistent `profiles.system_role`, same root cause as the original `is_manager_or_above()` bug, never swept when that one was patched):

| Function | Gates | Current blast radius |
|---|---|---|
| `auth_can_manage_rosters()` | `roster_shift_assignments` INSERT/UPDATE/DELETE | Low — confirmed the client never reads/writes this table (real assignment goes through `shifts.assigned_employee_id`); dormant table, but a live bug if ever wired up |
| `get_my_role()` | `timesheets_member_select` (`get_my_role() = 'team_member' AND profile_id = auth.uid()`) | None — has an exception guard (silently NULL), and is masked by the newer, correct `timesheets_self_select`/`timesheets_manager_select` policies on the same table |
| `get_user_role()` | none confirmed (generated-types only) | None — confirmed unused by client code |
| `admin_delete_shift_rpc()` | shift deletion (legacy) | None — confirmed unused by client code |
| `create_profile_for_user()` | profile creation (legacy) | None — confirmed unused; the real signup path is the `handle_new_user()` trigger, which is correct |

**OPEN — always-true policies not caught by the 2026-07-19/20 hardening sweeps** (same "grants everyone" failure shape as the payroll/compliance finding, but via an explicit `USING(true)` rather than a subtle bug — should have been caught by those sweeps' own search pattern but apparently wasn't, worth re-running that grep):

- `employee_leave_balances` — `"Public read for employee_leave_balances"` (`USING(true)`). Note the *newer* `leave_balances` table got proper cert-scoped policies; this looks like the legacy table was missed.
- `shift_offers` — `"Enable insert/read/update for all users"` on all three commands (`USING(true)`/`WITH CHECK(true)`).
- `roster_templates` — `"Authenticated users can delete templates"` (`USING(auth.uid() IS NOT NULL)`), OR'd alongside an intended admin-only delete policy — since RLS permissive policies OR together, the broadest wins: any authenticated user can currently delete any roster template.

**OPEN — route/RLS threshold mismatch (inconsistent, not directly exploitable):** `/compliance/rejections` has no client-side `FeatureGate` at all (any authenticated user with an active contract can navigate there directly by URL — it's just not linked from either nav menu), while its RLS (`managers_read_compliance_rejections`) is `delta+`-only, excluding gamma unlike almost every other manager-gated table in this schema. Sub-delta users hitting the route see an empty table, not an error. Recommend deciding the intended threshold and making both layers agree.

## 6. Draft permission matrix

Legend: **V** = Verified (client gate + matching RLS/RPC both confirmed), **SI** = Strongly Inferred, **WI** = Weakly Inferred, **U** = Unknown.

| Feature area | Employee (alpha) | Team Lead (beta) | Sub-Dept Mgr (gamma) | Dept Mgr (delta) | Global/System Admin (epsilon/zeta) | Confidence |
|---|---|---|---|---|---|---|
| **Rosters/Scheduling** (`/rosters`, `FeatureGate: rosters`, gamma+) | View own via `/my-roster` only | Same as employee | View + edit planner (`hasPermission('update')`); RLS requires `has_permission(...,'Gamma')` OR delta+ | Dept-wide edit | Org/cross-org (zeta bypass) | **SI** — client + RLS agree on gamma+ for edit; "cross-department" is bounded by the cert's own scope field, not a separate check |
| **Reserve List** (embedded panel in Rosters, no separate route) | No access | No access | Inherits Rosters' gamma+ gate | Same, wider scope | Full | **WI** — no dedicated RLS table; reuses `sm_apply_shift_op`'s gate |
| **Timesheets** (`/timesheet`, `FeatureGate: timesheet-view`, beta+) | No access | View own only (`profile_id=auth.uid()`); no edit | View team + **edit** (`is_manager_or_above()`) | Dept-wide | Full (`is_admin()`) | **V** — client gate, `hasPermission` map, and RLS all align |
| **Payroll** (`/management/payroll`, `FeatureGate: management`, gamma+) | No access | No access | View/export gross-pay for scope | Dept-wide | Full | **SI** — page gate gamma+; underlying `shifts`/`timesheets` RLS supports gamma+ reads. `gross_pay_records` itself is owner-only-read + service_role-write (no manager cross-employee RLS on that specific table, but the UI doesn't read it directly) |
| **Leave** (`/my-leave` personal; `/management/leave`, gamma+) | Submit/view/cancel own | Same as employee | Approve team leave, sub-dept scoped | Dept-wide | Org-wide | **V** — client `isManager` check matches the gamma+ RLS branches exactly |
| **Marketplace (Bids/Swaps)** (`/my-bids`,`/my-swaps` personal; `/management/*`, gamma+) | Bid/swap own shifts; view all open bids/swaps (intentionally open marketplace) | Same as employee | Approve/select winners, bulk-assign, manage own-scope approval rules | Dept-wide | Org-wide | **V** for the manager-approval gate; **SI** for cross-department (bounded by cert scope, not a separate block) |
| **Compliance** (`/compliance/rejections`, no client gate) | Can navigate to route (unlinked); RLS blocks read | Same | RLS excludes gamma from reading rejections (delta+-only — see §5 finding) | Can read | Can read | **V** for the delta+-only RLS restriction; **SI** for practical effect (empty table, not error, for sub-delta) |
| **Insights** (`/insights`, `FeatureGate: insights`) | No access | No access | View dashboards (live gate is gamma+; dead `access.policy.ts` says delta — see §2) | Dept-wide | Full | **SI** — the quarterly-performance RPC gate (gamma+, scope-clamped) matches the live client gate |
| **Settings** (`/settings`, no route-level gate) | Can reach page, edit own profile/preferences | Same | Same, plus rate management (`hasPermission('configurations')`, delta+, client-only gate) | Manage rates | Manage rates + certificates (`auth_can_manage_certificates()`, epsilon/zeta or legacy admin) | **SI** — route itself is unguarded; sub-sections self-gate |
| **Users** (`/users`, `FeatureGate: users`, epsilon+) | No access | No access | No access | No access | View/manage all users, grant certificates | **V** — client and RLS agree on epsilon+. Note `profiles` itself is broadly readable by any authenticated user (`profiles_select_all: USING(true)`) — a deliberate directory-style read (name/email/phone/DOB/emergency contact), not manager-gated |
| **Notifications** (`/my-notifications`, no gate) | Full CRUD on own only | Same | Same | Same | Same | **V** — strictly self-scoped at RLS (`profile_id/user_id = auth.uid()`); no manager cross-employee read found anywhere |
| **Broadcasts** (`/my-broadcasts` alpha+; `/broadcast` manager console, gamma+) | Read/participate per group membership | Same | Manage groups if legacy admin/manager OR per-group role (see §1 finding) | Same | Full (`is_broadcast_system_manager()`) | **WI** — the one module gating on the legacy `Role` string rather than `AccessLevel` |

## 7. Phase-8 action items (carried forward for a future security/docs pass)

1. Document the certificate model as canonical; explicitly deprecate the `Role` string as display-only except for Broadcasts.
2. Correct `HANDOVER.md` and `docs/investigations/2026-06-24_auto-assign-bids-and-swap-approval/*.md`'s stale "is_manager_or_above() is broken" language.
3. Sweep the remaining `profiles.system_role` dangling references (`auth_can_manage_rosters()`, `get_my_role()`, `get_user_role()`, `admin_delete_shift_rpc()`, `create_profile_for_user()`) — low urgency given current dormancy, but same bug class as a fixed prior incident.
4. Close the `employee_leave_balances` / `shift_offers` / `roster_templates` always-true policies.
5. Reconcile or delete `access.policy.ts` so there's exactly one client-side permission spec.
6. Decide and align `/compliance/rejections`' client gate vs. its delta+-only RLS.
