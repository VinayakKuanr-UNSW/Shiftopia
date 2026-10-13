# Access matrix: per-level tests

Checks what each access level can see and do, against a **local** database only. Never run these against prod: the fixtures create users and certificates.

## Who's who

| Persona | Certificate | Place |
|---|---|---|
| A | alpha (Type X) | O / D1 / S1 |
| G | gamma | O / D1 / S1 |
| D | delta | O / D1 |
| DD | delta | O / D2 |
| E, E2 | epsilon | O |
| F | epsilon | other org |
| Z | zeta | global |
| X | none; employee with a contract in S1 | O / D1 / S1 |

Shifts: 1 = S1 (assigned X), 2 = S2 (same department), 3 = D2 / S3 (assigned X), 4 = other org.

## Running it

Since the 2026-10-13 re-baseline the migrations rebuild production exactly, and `supabase/seeds/reference.sql` carries the `rbac_actions` / `rbac_permissions` rows and the org / department / sub-department rows the fixtures use (see `docs/operations/database-baseline.md`). So:

1. Start Docker, then `supabase start` — or `KEEP=1 scripts/db/verify-baseline.sh`, which also proves the local database matches production first.
2. `psql -f 01_fixtures.sql`, then `psql -f 02_matrix_by_level.sql` and `psql -f 03_legacy_flag.sql`, e.g. `docker exec -i supabase_db_<project_id> psql -U postgres -f - < 01_fixtures.sql`. Both test files run inside `BEGIN … ROLLBACK`.

`02` prints one line per persona. Compare it with `expected_matrix.txt` (the state after migrations `20261011005610` … `20261011005853`). Last reproduced line-for-line on a database rebuilt from the baseline: 2026-10-13.

## Reading a line

- `see[...]`: which shifts, timesheets, bids and swaps the persona can read; `ctr` = X's contracts visible; `cert` = other personas' certificates visible.
- `upd` / `del2`: direct table writes, through RLS only.
- `op`, `rdel2`, `bulk13`, `cxl3`: the shift RPCs. `F` = refused, `y` = got past the access check.
- `ctrS2`, `grantX`, `revD`, `revE2`, `delD`: contract and certificate writes. `.` = refused by policy, `y` / `1` = allowed.
- `lastZeta`: the last zeta certificate cannot be revoked.

Swaps (`swp`) stay visible to anyone holding a certificate in the shift's organization. That is the open-marketplace design, not a leak.
