# Access matrix: per-level tests

Checks what each access level can see and do, against a **local** database only. Never run these against prod: the fixtures create users and contracts (whose access the certificate rows mirror).

## Who's who

| Persona | Certificate | Place |
|---|---|---|
| A | alpha (Type X) | O; no contract |
| B | beta (Type X) | O; contracts in S1 (D1) and S3 (D2) |
| G | gamma | O / D1 / S1 |
| G2 | gamma | O / D1 / S2 |
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
2. `psql -f 01_fixtures.sql`, then `psql -f 02_matrix_by_level.sql`, `psql -f 03_legacy_flag.sql`, `psql -f 04_suites_by_level.sql`, `psql -f 05_place_guards.sql`, `psql -f 06_contract_access.sql` and `psql -f 07_contract_dates.sql`, e.g. `docker exec -i supabase_db_<project_id> psql -U postgres -f - < 01_fixtures.sql`. The test files run inside `BEGIN … ROLLBACK`.

`02` and `04` print one line per persona. Compare them with `expected_matrix.txt` and `expected_suites.txt`: the state after `20261015110641_access_suites_view_only` (delta and epsilon view-only, Admin Suite zeta-only, open bids and swaps by contracted sub-department). Last reproduced line-for-line on a database rebuilt from the baseline: 2026-10-15.

Since 2026-10-14 the lines read the access-suites model: delta and epsilon see their scope and change nothing; gamma has full rights in S1 only; the Admin Suite tables (`adm` in `04`) answer to zeta alone.

## Reading a line

- `see[...]`: which shifts, timesheets, bids and swaps the persona can read; `ctr` = X's contracts visible; `cert` = other personas' certificates visible.
- `upd` / `del2`: direct table writes, through RLS only.
- `op`, `rdel2`, `bulk13`, `cxl3`: the shift RPCs. `F` = refused, `y` = got past the access check.
- `ctrS2`: insert a contract for X in S2 (`.` = refused by policy, `y` = allowed).
- `grantX`, `revD`, `revE2`, `delD`: access set on contracts — raise X's contract to gamma, lower D's and E2's to alpha, delete D's (rows changed; `0` = refused by policy — zeta deletes any contract with no shift rostered under it).
- `certW`: write a certificate directly — refused for everyone, since certificates only mirror contracts.
- `lastZeta`: the last zeta contract cannot be lowered.

Swaps (`swp`) and open bids are visible to the people contracted to the shift's sub-department, and to managers whose scope covers it. Until 2026-10-14 they were visible to anyone holding a certificate anywhere in the organization.

`04` is explained in its own header comment. `07_contract_dates.sql` (compare with `expected_dates.txt`) checks that dates drive the contract: Upcoming / Active / Expired, the hourly sweep, an expired contract corrected or reopened, deleting any contract with no shifts rostered under it, shifts kept inside the contract's dates, the overlap-aware 38-hour rule and the only Administrator keeping no end date. `06_contract_access.sql` (compare with `expected_contract_access.txt`) checks that contracts carry access: the certificate rows mirror them, only zeta sets access, the last zeta can't be lowered or ended, and contracted hours follow the employment type (EBA). `05_place_guards.sql` (compare with `expected_places.txt`) checks the organization structure against access: a place with active access scoped to it can be neither deleted nor retired, revoked certificates go with their place, and nothing is granted in a retired place.
