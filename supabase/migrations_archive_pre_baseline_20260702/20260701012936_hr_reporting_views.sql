-- Reporting layer for the standardized hr framework.
-- Applied to prod (srfozdlphoempdattvtx) 2026-07-01 via MCP apply_migration.

create or replace view hr.v_org_chart as
select o.name as organization, d.name as department, s.name as subdepartment,
       r.remuneration_level as level, r.name as role, r.is_active,
       o.id as org_id, d.id as dept_id, s.id as subdept_id, r.id as role_id
from hr.organizations o
join hr.departments d    on d.organization_id = o.id
join hr.subdepartments s on s.department_id   = d.id
join hr.roles r          on r.subdepartment_id = s.id;

create or replace view hr.v_promotion_ladder as
select d.name as department, s.name as subdepartment,
       r.remuneration_level as level, rl.level_name, r.name as role,
       rl.hourly_rate_min, rl.hourly_rate_max, rl.salary_min, rl.salary_max,
       lead(r.name) over (partition by s.id order by r.remuneration_level) as next_role,
       s.id as subdepartment_id
from hr.subdepartments s
join hr.departments d          on d.id = s.department_id
join hr.roles r                on r.subdepartment_id = s.id
join hr.remuneration_levels rl on rl.level_number = r.remuneration_level;

create or replace view hr.v_headcount_by_level as
select rl.level_number, rl.level_name,
       count(ea.id) as current_headcount
from hr.remuneration_levels rl
left join hr.roles r              on r.remuneration_level = rl.level_number
left join hr.employee_assignments ea on ea.role_id = r.id and ea.effective_to is null
group by rl.level_number, rl.level_name
order by rl.level_number;

grant select on hr.v_org_chart, hr.v_promotion_ladder, hr.v_headcount_by_level to authenticated;
