-- Complete + enforce the 0-7 remuneration standardization on the LIVE roles table.
-- Applied to prod (srfozdlphoempdattvtx) 2026-07-01 via MCP apply_migration.
-- Data pre-verified before apply: 0 null remuneration_level_id, 0 duplicate (subdept, level) groups.

-- 1) Fill the only gaps: Building Services > Security was missing levels 0,1,2.
insert into public.roles (name, level, sub_department_id, department_id, remuneration_level_id, is_active)
select 'Security - ' || rl.level_name, rl.level_number,
       'af07db1d-89cc-4d90-9fff-e81a12c912f7',   -- Building Services > Security
       '07e5d78d-5213-49f4-8468-89c15d23498b',   -- Building Services
       rl.id, true
from public.remuneration_levels rl
where rl.level_number in (0, 1, 2);

-- 2) Make remuneration level mandatory (removes the nullable -> unassignedRoles fallback path).
alter table public.roles alter column remuneration_level_id set not null;

-- 3) At most one role per level per subdepartment.
alter table public.roles
  add constraint roles_subdept_remlevel_unique unique (sub_department_id, remuneration_level_id);
