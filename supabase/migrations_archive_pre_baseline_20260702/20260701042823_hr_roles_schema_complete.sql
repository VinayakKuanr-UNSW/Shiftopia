-- ===== hr cutover PHASE 1: make hr.roles carry all metadata public.roles has =====
-- so operational reads/functions can move to hr and public.roles can later be dropped.
-- Applied to prod (srfozdlphoempdattvtx) 2026-07-01 via MCP apply_migration.

alter table hr.roles
  add column if not exists department_id          uuid references hr.departments(id),
  add column if not exists remuneration_level_id  uuid,
  add column if not exists description            text,
  add column if not exists responsibilities       text[],
  add column if not exists forecasting_bucket      text,
  add column if not exists supervision_ratio_min   integer,
  add column if not exists supervision_ratio_max   integer,
  add column if not exists is_baseline_eligible    boolean default false,
  add column if not exists employment_type         text;

-- department_id from the authoritative parent subdepartment (always consistent)
update hr.roles h
set department_id = s.department_id
from hr.subdepartments s
where s.id = h.subdepartment_id;

-- remaining metadata backfilled from public.roles via the clean (subdept, level) map
update hr.roles h set
  remuneration_level_id = p.remuneration_level_id,
  description           = p.description,
  responsibilities      = p.responsibilities,
  forecasting_bucket    = p.forecasting_bucket,
  supervision_ratio_min = p.supervision_ratio_min,
  supervision_ratio_max = p.supervision_ratio_max,
  is_baseline_eligible  = coalesce(p.is_baseline_eligible, false),
  employment_type       = p.employment_type
from public.roles p
where p.sub_department_id = h.subdepartment_id and p.level = h.remuneration_level;
