-- Make hr reachable by the Data API roles (was missing -> app hr reads failed at runtime).
-- Applied to prod (srfozdlphoempdattvtx) 2026-07-01 via MCP apply_migration.
-- NOTE: this fixes GRANTS only. The `hr` schema must ALSO be added to the Data API
-- "Exposed schemas" (Dashboard > Settings > API, or config.toml [api] schemas) for
-- PostgREST `.schema('hr')` calls to work — that is a project setting, not SQL.

grant usage on schema hr to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema hr to anon, authenticated, service_role;
alter default privileges in schema hr grant select, insert, update, delete on tables to anon, authenticated, service_role;
