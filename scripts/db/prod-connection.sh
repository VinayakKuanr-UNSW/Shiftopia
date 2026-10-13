# Sourced by scripts/db/*.sh — not run directly.
#
# Exports libpq's PG* variables for the production session pooler and defines
# `prod_psql`, which runs psql in a container. The password travels only in the
# environment (`docker run -e PGPASSWORD`), never on a command line, so it does
# not show up in `ps`. Read-only use only: nothing here writes to production.
#
# Password: SUPABASE_DB_PASSWORD from the environment, else from .env.local.
# Host: the SESSION pooler — the direct db.<ref>.supabase.co host is IPv6-only.

PROJECT_REF="${PROJECT_REF:-srfozdlphoempdattvtx}"
PG_IMAGE="${PG_IMAGE:-postgres:17}"

if [ -z "${SUPABASE_DB_PASSWORD:-}" ] && [ -f .env.local ]; then
  SUPABASE_DB_PASSWORD="$(sed -n -E 's/^SUPABASE_DB_PASSWORD=["'\'']?([^"'\'']*)["'\'']?$/\1/p' .env.local | tail -n1)"
fi
if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "SUPABASE_DB_PASSWORD is not set (environment or .env.local)." >&2
  exit 1
fi

export PGHOST="${PGHOST:-aws-1-ap-southeast-1.pooler.supabase.com}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="postgres.${PROJECT_REF}"
export PGPASSWORD="$SUPABASE_DB_PASSWORD"
export PGDATABASE="postgres"
export PGSSLMODE="require"

prod_psql() {
  docker run --rm -i -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE \
    "$PG_IMAGE" psql -X -At -v ON_ERROR_STOP=1 "$@"
}

# Fail fast with a clear message rather than halfway through a dump.
if ! prod_psql -c 'select 1' >/dev/null 2>&1; then
  echo "Cannot sign in to production as $PGUSER@$PGHOST — is SUPABASE_DB_PASSWORD current?" >&2
  echo "If you reset the database password, also update the SUPABASE_DB_URL repo secret (CI's RLS guard uses it)." >&2
  exit 1
fi
