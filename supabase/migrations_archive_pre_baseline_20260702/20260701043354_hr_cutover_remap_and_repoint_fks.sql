-- ===== hr cutover PHASE 2 + 3: remap role_id public->hr, repoint all FKs to hr.roles =====
-- Applied to prod (srfozdlphoempdattvtx) 2026-07-01 via MCP apply_migration.
-- Pre-verified: public.roles(sub_department_id, level) <-> hr.roles(subdepartment_id, remuneration_level)
-- is a clean bijective 200<->200 map.

-- 1) Drop FKs -> public.roles so role_id values can be rewritten
alter table public.demand_forecasts drop constraint demand_forecasts_role_id_fkey;
alter table public.role_levels       drop constraint role_levels_role_id_fkey;
alter table public.role_ml_class_map drop constraint role_ml_class_map_role_id_fkey;
alter table public.shifts            drop constraint shifts_role_id_fkey;
alter table public.template_shifts   drop constraint template_shifts_role_id_fkey;
alter table public.user_contracts    drop constraint user_contracts_role_id_fkey;

-- 2) Remap role_id: public.roles.id -> hr.roles.id via the clean (subdept, level) map.
update public.user_contracts uc
set role_id = h.id
from public.roles p
join hr.roles h on h.subdepartment_id = p.sub_department_id and h.remuneration_level = p.level
where uc.role_id = p.id;

update public.template_shifts ts
set role_id = h.id
from public.roles p
join hr.roles h on h.subdepartment_id = p.sub_department_id and h.remuneration_level = p.level
where ts.role_id = p.id;
-- shifts=0, role_levels=0, role_ml_class_map=0, demand_forecasts.role_id null -> nothing to remap

-- 3) Re-add FKs -> hr.roles(id), preserving original ON DELETE semantics
alter table public.demand_forecasts
  add constraint demand_forecasts_role_id_fkey foreign key (role_id) references hr.roles(id) on delete cascade;
alter table public.role_levels
  add constraint role_levels_role_id_fkey foreign key (role_id) references hr.roles(id) on delete cascade;
alter table public.role_ml_class_map
  add constraint role_ml_class_map_role_id_fkey foreign key (role_id) references hr.roles(id) on delete cascade;
alter table public.shifts
  add constraint shifts_role_id_fkey foreign key (role_id) references hr.roles(id) on delete set null;
alter table public.template_shifts
  add constraint template_shifts_role_id_fkey foreign key (role_id) references hr.roles(id);
alter table public.user_contracts
  add constraint user_contracts_role_id_fkey foreign key (role_id) references hr.roles(id);
