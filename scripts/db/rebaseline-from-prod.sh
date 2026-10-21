#!/usr/bin/env bash
# Regenerate the migration baseline from production.
#
# Use when `supabase db reset` no longer rebuilds what production runs — the
# repo's migration files and production's supabase_migrations history drift
# because migrations are applied through the MCP, which stamps its own
# versions. It happened 2026-07-02 and again 2026-10-13 (92 of 230 files
# matched a production history row).
#
#   scripts/db/rebaseline-from-prod.sh
#   scripts/db/verify-baseline.sh        # then commit only if this is clean
#
# Read-only against production: one schema-only pg_dump and SELECTs for the
# reference seed. Production's migration history is not touched.
#
# Needs Docker, the supabase CLI, and SUPABASE_DB_PASSWORD (env or .env.local).
#   1. dumps every app-owned schema into
#      supabase/migrations/20251015000000_baseline_schema.sql
#   2. moves every other migration — except the baseline supplements
#      (…0001 auth trigger, …0002 storage, …0003 grants) — into
#      supabase/migrations_archive_pre_baseline_<YYYYMMDD>/
#   3. regenerates the grants supplement, 20251015000003_baseline_acl_from_prod.sql
#      (the dump alone leaves anon/authenticated with grants production revoked —
#      see scripts/db/acl-from-prod.sql)
#   4. regenerates supabase/seeds/reference.sql
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/db/prod-connection.sh
. scripts/db/prod-connection.sh

MIGRATIONS=supabase/migrations
BASELINE="$MIGRATIONS/20251015000000_baseline_schema.sql"
KEEP_RE='^20251015000000_|^20251015000001_|^20251015000002_|^20251015000003_'
ACL_SUPPLEMENT="$MIGRATIONS/20251015000003_baseline_acl_from_prod.sql"
STAMP="$(TZ=Australia/Sydney date +%Y%m%d)"
ARCHIVE="supabase/migrations_archive_pre_baseline_$STAMP"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -e "$ARCHIVE" ]; then
  echo "$ARCHIVE already exists — refusing to overwrite an earlier archive." >&2
  exit 1
fi

echo "1/4 Dumping the production schema…"
# Take the CLI's own pg_dump script (exclusions + Supabase post-processing)
# from a dry run against a placeholder, and run it with the real credentials
# supplied through the environment.
supabase db dump --db-url "postgresql://placeholder:placeholder@placeholder.invalid:5432/postgres" --dry-run 2>/dev/null \
  | sed -n '/^#!\/usr\/bin\/env bash/,$p' \
  | grep -v '^export PG' > "$TMP/dump.sh"
grep -q '^pg_dump' "$TMP/dump.sh" || { echo "Could not extract the pg_dump script from the supabase CLI." >&2; exit 1; }

docker run --rm -i -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE \
  "$PG_IMAGE" bash -s < "$TMP/dump.sh" > "$TMP/baseline.sql"
grep -q 'CREATE TABLE IF NOT EXISTS "public"."shifts"' "$TMP/baseline.sql" \
  || { echo "The dump does not contain public.shifts — refusing to continue." >&2; exit 1; }

echo "2/4 Archiving superseded migrations into ${ARCHIVE}…"
mkdir -p "$ARCHIVE"
moved=0
for f in "$MIGRATIONS"/*.sql; do
  name="$(basename "$f")"
  if ! [[ "$name" =~ $KEEP_RE ]]; then
    mv "$f" "$ARCHIVE/"
    moved=$((moved + 1))
  fi
done
# The outgoing baseline goes into the archive too, so the history stays readable.
cp "$BASELINE" "$ARCHIVE/"
{
  echo "-- Baseline: schema-only dump of production ($PROJECT_REF),"
  echo "-- taken $(TZ=Australia/Sydney date '+%Y-%m-%d %H:%M %Z') by scripts/db/rebaseline-from-prod.sh."
  echo "-- Everything applied to production up to that moment is in here; the"
  echo "-- migrations it replaced are in $ARCHIVE/. Regenerate, don't hand-edit."
  cat "$TMP/baseline.sql"
} > "$BASELINE"
echo "    moved $moved files"

echo "3/4 Regenerating production's grants into $ACL_SUPPLEMENT"
prod_psql -f - < scripts/db/acl-from-prod.sql > "$ACL_SUPPLEMENT"
echo "    $(grep -c '^REVOKE' "$ACL_SUPPLEMENT") objects"

echo "4/4 Regenerating supabase/seeds/reference.sql…"
mkdir -p supabase/seeds
prod_psql -f - < scripts/db/reference-seed.sql > supabase/seeds/reference.sql
echo "    $(grep -c '^INSERT INTO' supabase/seeds/reference.sql) rows"

echo
echo "Done. Next: scripts/db/verify-baseline.sh"
