-- Strict Org->Dept->SubDept->Role(+remuneration_level): remove the two redundant links.
-- Applied to prod (srfozdlphoempdattvtx) 2026-07-01 via MCP apply_migration.
-- department_id (transitive via subdepartment) and remuneration_level_id (loose uuid duplicating
-- the canonical remuneration_level -> hr.remuneration_levels). All consumers already repointed.
alter table hr.roles drop column if exists department_id;
alter table hr.roles drop column if exists remuneration_level_id;
