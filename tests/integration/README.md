# API integration tests

These tests make real HTTP calls (PostgREST, RPCs and edge functions) to a **local** Supabase stack built from `supabase/migrations` and `supabase/seeds`. That stack matches production; `scripts/db/verify-baseline.sh` proves it. The tests cover what unit tests with a mocked Supabase client cannot: grants, RLS, PostgREST exposure, the JWT → `auth.uid()` path, and edge-function authorisation.

## Run

```sh
supabase start -x studio,imgproxy,mailpit,logflare,vector,postgres-meta,supavisor,realtime
npm run test:integration        # ~12 s
npm run type-check:integration
```

The suite finds the stack with `supabase status`. You can override that with `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `JWT_SECRET` and `SUPABASE_DB_CONTAINER`.

**It refuses any non-local API URL.** The tests create users, certificates and shifts, and reset fixture rows between probes.

CI runs the suite in the `api-integration` job (`.github/workflows/ci.yml`).

## What each file proves

| File | Proves |
|---|---|
| `security/access-matrix-http.int.test.ts` | For each persona, the reads, RLS writes, shift RPCs, contract write and certificate operations **over HTTP** produce exactly `supabase/tests/access_matrix/expected_matrix.txt`. |
| `security/access-matrix-sql.int.test.ts` | The same matrix inside the database (`02_matrix_by_level.sql`), plus the retired legacy admin flag (`03_legacy_flag.sql`). If the two matrix files disagree, the difference is in API exposure, not the database rules. |
| `security/anon-surface.int.test.ts` | Covers what someone holding only the public anon key can reach. No `SECURITY DEFINER` routine is executable by them, and every one refuses them over HTTP. Every view runs as the caller, and no materialized view is client-readable. They read no rows outside a reviewed list. |
| `security/edge-functions.int.test.ts` | `get-roster-view` refuses the anon key (the 2026-10-05 pre-auth leak), other organisations, out-of-scope managers and employees, even when its shared cache already holds the answer. It serves an in-scope manager only their scope. `evaluate-compliance` answers only the employee and their managers. |

## Personas

Callers are the fixture personas in `supabase/tests/access_matrix/01_fixtures.sql`; its README describes who's who. Each test gets a real HS256 access token signed with the stack's JWT secret, the kind GoTrue issues, so RLS, `auth.uid()` and the edge functions' `auth.getUser()` all treat it as a signed-in user.

## Changing access on purpose

Update `supabase/tests/access_matrix/expected_matrix.txt`; both matrix tests follow it. Make **new** exposure to the anon key a recorded decision: add it to `ANON_READABLE` in `anon-surface.int.test.ts` with the reason.

Current reviewed exposures (2026-10-13), all known issues with proposed fixes in that list:

- `organizations`, `departments`, `sub_departments` (`public_read` policies)
- `venueops_ml_features`, `labor_correction_factors` (read by the ML service with the anon key)

## Not yet covered

The older SQL harnesses in `supabase/tests/` don't run against the real schema, so they're not part of this suite. Each needs porting:

| Harness | Fails with | Why |
|---|---|---|
| `availability_exceptions.sql` | `relation "profiles" already exists` | Builds its own stub schema. |
| `contract_ordinary_hours_envelope.sql` | `type "employment_status" already exists` | Builds its own stub schema. |
| `availability_subdepartment_scope.sql` | `"employee_leave_days" is not a table` | Stale: that table is now a view. |
| `fairness_ledger_parity.sql` | `target_employment_type is required` | Stale: its shift inserts predate that rule. |
| `implicit_roster_activation.sql` | `function public.sm_resolve_roster(…) does not exist` | Stale: the signature changed. |
