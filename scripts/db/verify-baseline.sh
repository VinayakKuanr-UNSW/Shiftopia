#!/usr/bin/env bash
# Prove that supabase/migrations + supabase/seeds rebuild production.
#
# Starts a throwaway local Supabase from a copy of supabase/, fingerprints every
# app-owned object there and in production (scripts/db/schema-fingerprint.sql),
# and diffs the two. Then compares reference-seed row counts. Exit 0 = match.
# Read-only against production.
#
#   scripts/db/verify-baseline.sh
#   KEEP=1 scripts/db/verify-baseline.sh   # leave the local stack up afterwards
#
# Needs Docker, the supabase CLI, and SUPABASE_DB_PASSWORD (env or .env.local).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/db/prod-connection.sh
. scripts/db/prod-connection.sh

PROJECT_ID=shiftopia-baseline-verify
WORK="$(mktemp -d)"
mkdir -p "$WORK/supabase"
cp -R supabase/migrations supabase/seeds supabase/seed.sql "$WORK/supabase/"
sed -E "s/^project_id = .*/project_id = \"$PROJECT_ID\"/" supabase/config.toml > "$WORK/supabase/config.toml"

cleanup() {
  if [ -z "${KEEP:-}" ]; then
    supabase stop --workdir "$WORK" --no-backup >/dev/null 2>&1 || true
    rm -rf "$WORK"
  else
    echo "Local stack left running: supabase stop --workdir $WORK --no-backup"
  fi
}
trap cleanup EXIT

echo "Starting a throwaway local Supabase ($PROJECT_ID) — applies every migration and seed…"
supabase start --workdir "$WORK" \
  -x studio,imgproxy,mailpit,logflare,vector,edge-runtime,postgres-meta,supavisor,realtime

local_psql() {
  docker exec -i "supabase_db_$PROJECT_ID" psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 "$@"
}

status=0

echo "Fingerprinting local and production…"
local_psql -f - < scripts/db/schema-fingerprint.sql > "$WORK/local.txt"
prod_psql  -f - < scripts/db/schema-fingerprint.sql > "$WORK/prod.txt"
# Differences listed in fingerprint-equivalent.tsv (both hashes must match)
# are proven-equivalent re-deparses and do not fail the check.
if ! python3 - "$WORK/prod.txt" "$WORK/local.txt" scripts/db/fingerprint-equivalent.tsv <<'PY'
import sys
def load(path):
    return {(k, n): h for k, n, h in (l.rstrip('\n').split('\t') for l in open(path) if l.strip())}
prod, local = load(sys.argv[1]), load(sys.argv[2])
equivalent = {tuple(f[:4]) for f in (l.rstrip('\n').split('\t') for l in open(sys.argv[3]))
              if len(f) >= 4 and not f[0].startswith('#')}
accepted, bad = 0, []
for key in sorted(prod.keys() | local.keys()):
    p, l = prod.get(key), local.get(key)
    if p == l:
        continue
    if (key[0], key[1], p, l) in equivalent:
        accepted += 1
    else:
        bad.append(f"    {key[0]:<20} {key[1]}  ({'missing locally' if l is None else 'missing in production' if p is None else 'differs'})")
if bad:
    print(f"  schema: {len(bad)} object(s) DIFFER from production:")
    print('\n'.join(bad))
    sys.exit(1)
print(f"  schema: matches production ({len(prod)} objects; {accepted} known-equivalent re-deparses)")
PY
then
  status=1
fi

# Every table the reference seed covers must hold exactly production's rows.
count_sql="$(sed -n -E 's/^-- ([a-z_]+\.[a-z_]+)$/select '"'"'\1'"'"', count(*) from \1 union all/p' supabase/seeds/reference.sql | sed '$ s/ union all$//')"
if [ -n "$count_sql" ]; then
  local_psql -c "$count_sql order by 1" > "$WORK/local.counts"
  prod_psql  -c "$count_sql order by 1" > "$WORK/prod.counts"
  if diff "$WORK/prod.counts" "$WORK/local.counts" > "$WORK/counts.diff"; then
    echo "  reference data: identical ($(wc -l < "$WORK/prod.counts" | tr -d ' ') tables)"
  else
    echo "  reference data: DIFFERS (< production, > local)"
    sed 's/^/    /' "$WORK/counts.diff"
    status=1
  fi
fi

exit "$status"
