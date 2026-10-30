# API integration tests

These tests make real HTTP calls (PostgREST, RPCs, Storage and edge functions) to a **local** Supabase stack built from `supabase/migrations` and `supabase/seeds`. That stack matches production; `scripts/db/verify-baseline.sh` proves it. The tests cover what unit tests with a mocked Supabase client cannot: grants, RLS, PostgREST exposure, the JWT → `auth.uid()` path, and edge-function authorisation.

## Run

```sh
supabase start -x studio,imgproxy,mailpit,logflare,vector,postgres-meta,supavisor,realtime
npm run test:integration        # ~15 s
npm run type-check:integration
```

The suite finds the stack with `supabase status`. You can override that with `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `JWT_SECRET` and `SUPABASE_DB_CONTAINER`.

**It refuses any non-local API URL.** The tests create users, certificates and shifts, and reset fixture rows between probes.

CI runs the suite in the `api-integration` job (`.github/workflows/ci.yml`).

## What each file proves

| File | Proves |
|---|---|
| `security/access-matrix-http.int.test.ts` | For each persona, the reads, RLS writes, shift RPCs, contract write and certificate operations **over HTTP** produce exactly `supabase/tests/access_matrix/expected_matrix.txt`. |
| `security/access-matrix-sql.int.test.ts` | The same matrix inside the database (`02_matrix_by_level.sql`), the access-suites probes (`04_suites_by_level.sql` against `expected_suites.txt`: availability, budgets, KPI, payroll, templates, Admin-suite tables, clock-in on behalf, assignment runs, open bids, pay terms, fairness recompute, broadcast membership), plus the retired legacy admin flag (`03_legacy_flag.sql`). If the two matrix files disagree, the difference is in API exposure, not the database rules. |
| `security/anon-surface.int.test.ts` | Covers what someone holding only the public anon key can reach. No `SECURITY DEFINER` routine is executable by them, and every one refuses them over HTTP. They can write to nothing, and no client role holds TRUNCATE, REFERENCES, TRIGGER or MAINTAIN. Every view runs as the caller, and no materialized view is client-readable. They read no rows outside a reviewed list (empty since 2026-10-13). |
| `security/storage.int.test.ts` | The public `broadcast-attachments` bucket. Someone who can't post to a broadcast can't upload; an employee can't delete someone else's file; a broadcast manager can, and the file is really gone afterwards (before 2026-10-13 every delete was a silent no-op). |
| `security/scope-trees.int.test.ts` | The global scope filter's places, per persona, as `resolve_user_permissions` returns them — all built from contracts. No contract ⇒ none; an alpha (no certificate) still gets a personal scope; a Team Lead's Timesheets scope is the sub-department they lead, not the ones where they are staff; gamma its sub-department, delta its department, epsilon its organization, zeta everything; personal scope is each person's own contracts whatever their level. |
| `security/edge-functions.int.test.ts` | `get-roster-view` refuses the anon key (the 2026-10-05 pre-auth leak), other organisations, out-of-scope managers and employees, even when its shared cache already holds the answer. It serves an in-scope manager only their scope. The compliance RPC `eba_check_assignment` (which replaced the `evaluate-compliance` edge function, retired 2026-10-26) answers only the employee and their managers. |

| `flows/template-roster-subgroups.int.test.ts` | Templates → rosters (migration `20261017111129`). Deleting a sub-group touches only its own group (the old RPC also deleted another group's same-named shifts), leaves days before today alone instead of failing on them, and is refused to employees, other sub-departments' managers and view-only levels. A roster sub-group cannot be cloned (`clone_roster_subgroup_v2` is gone; copying lives in Templates). A rename that clashes with an existing name is reported in the dry run and refused. Office keeps exactly one sub-group, Administration, even through direct table writes, and every new template gets it. A second template merges by name whatever the case, adds on top, and its preview counts duplicates; undo removes one application's shifts and leaves the other's. No client role can run the unguarded legacy writers. |
| `flows/shift-lifecycle.int.test.ts` | The core shift flows the UI drives. Through the gateway: publish and unpublish with version checks, stale-version refusal, double-booking refusal, impossible transitions reported, no shift moved onto a day without a roster, employees, other-department managers and view-only levels (delta, epsilon) refused. Bulk publish: in scope only, the whole batch refused when any shift is out of scope, and the real caller recorded as actor (a regression test for the 2026-10-13 fix). Also: permanent delete; the gateway's `delete` op refused with a pointer to `sm_delete_shift`; emergency assignment; clock in and out. Timesheets: approval only after the shift reaches a final attendance state, never by the employee themselves, and only by a manager whose scope covers the shift. |

## Personas

Callers are the fixture personas in `supabase/tests/access_matrix/01_fixtures.sql`; its README describes who's who. Each test gets a real HS256 access token signed with the stack's JWT secret, the kind GoTrue issues, so RLS, `auth.uid()` and the edge functions' `auth.getUser()` all treat it as a signed-in user.

## Changing access on purpose

Update `supabase/tests/access_matrix/expected_matrix.txt`; both matrix tests follow it. Make **new** exposure to the anon key a recorded decision: add it to `ANON_READABLE` in `anon-surface.int.test.ts` with the reason.

The list is empty. Migration `20261013120936_close_anon_surface` closed the five exposures the 2026-10-13 review found: the org tables' `public_read` policies, and the venue event schedule and model coefficients the ML service read with the anon key. The ML service now requires `SUPABASE_SERVICE_ROLE_KEY`.

## Not yet covered

The older SQL harnesses in `supabase/tests/` don't run against the real schema, so they're not part of this suite. Porting each means rewriting its setup against today's schema; `fairness_ledger_parity.sql`, for example, also inserts shifts without columns now required, references employees that don't exist, and deletes every bid in the database.

| Harness | Fails with | Why |
|---|---|---|
| `availability_exceptions.sql` | `relation "profiles" already exists` | Builds its own stub schema. |
| `contract_ordinary_hours_envelope.sql` | `type "employment_status" already exists` | Builds its own stub schema. |
| `availability_subdepartment_scope.sql` | `"employee_leave_days" is not a table` | Stale: that table is now a view. |
| `fairness_ledger_parity.sql` | `target_employment_type is required` | Stale: its shift inserts predate that rule. |
