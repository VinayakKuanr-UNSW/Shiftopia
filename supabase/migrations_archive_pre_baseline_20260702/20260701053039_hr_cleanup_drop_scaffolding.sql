-- Cutover verified complete -> drop scaffolding + recovery copies.
-- Applied to prod (srfozdlphoempdattvtx) 2026-07-01 via MCP apply_migration.
drop table if exists hr._role_id_map;
drop table if exists hr._backup_role_refs;
drop table if exists hr._backup_public_roles;
