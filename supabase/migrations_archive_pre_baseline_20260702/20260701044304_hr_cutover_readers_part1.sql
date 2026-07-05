-- ===== hr cutover PHASE 4a (part 1): fix role names + migrate SQL readers to hr.roles =====
-- Applied to prod (srfozdlphoempdattvtx) 2026-07-01 via MCP apply_migration.

-- 1) Restore REAL role titles (hr.roles.name was generic "<Subdept> - <Level>" from the seed trigger)
update hr.roles h
set name = p.name
from public.roles p
where p.sub_department_id = h.subdepartment_id and p.level = h.remuneration_level;

-- 2) Audit UUID->name resolver: role_id now lives in hr.roles
CREATE OR REPLACE FUNCTION public.resolve_audit_uuid_name(p_field text, p_uuid uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    v_name text;
BEGIN
    IF p_uuid IS NULL THEN
        RETURN NULL;
    END IF;
    CASE p_field
        WHEN 'role_id' THEN
            SELECT name INTO v_name FROM hr.roles WHERE id = p_uuid;
        WHEN 'remuneration_level_id' THEN
            SELECT level_name INTO v_name FROM public.remuneration_levels WHERE id = p_uuid;
        WHEN 'shift_group_id' THEN
            SELECT name INTO v_name FROM public.roster_groups WHERE id = p_uuid;
        WHEN 'roster_subgroup_id' THEN
            SELECT name INTO v_name FROM public.roster_subgroups WHERE id = p_uuid;
        WHEN 'sub_department_id' THEN
            SELECT name INTO v_name FROM public.sub_departments WHERE id = p_uuid;
        ELSE
            v_name := NULL;
    END CASE;
    RETURN COALESCE(v_name, p_uuid::text);
END;
$function$;

-- 3) Roster planner stats: join hr.roles (keeps remuneration_levels join via r.remuneration_level_id)
CREATE OR REPLACE FUNCTION public.get_roster_planner_stats(p_organization_id uuid, p_start_date date, p_end_date date, p_department_ids uuid[] DEFAULT NULL::uuid[], p_sub_department_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(total_shifts integer, assigned_shifts integer, open_shifts integer, published_shifts integer, cancelled_shifts integer, total_net_minutes bigint, unique_employees integer, est_cost numeric, budget_cost numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    COUNT(*) FILTER (WHERE NOT s.is_cancelled)::int AS total_shifts,
    COUNT(*) FILTER (WHERE NOT s.is_cancelled AND s.assigned_employee_id IS NOT NULL)::int AS assigned_shifts,
    COUNT(*) FILTER (WHERE NOT s.is_cancelled AND s.assigned_employee_id IS NULL)::int AS open_shifts,
    COUNT(*) FILTER (WHERE s.lifecycle_status IN ('Published','InProgress','Completed'))::int AS published_shifts,
    COUNT(*) FILTER (WHERE s.is_cancelled)::int AS cancelled_shifts,
    COALESCE(SUM(s.net_length_minutes) FILTER (WHERE NOT s.is_cancelled), 0)::bigint AS total_net_minutes,
    COUNT(DISTINCT s.assigned_employee_id) FILTER (WHERE NOT s.is_cancelled)::int AS unique_employees,
    COALESCE(SUM( (s.net_length_minutes/60.0) * COALESCE(s.actual_hourly_rate, s.remuneration_rate, rl.hourly_rate_min, 0) )
             FILTER (WHERE NOT s.is_cancelled AND s.assigned_employee_id IS NOT NULL), 0)::numeric AS est_cost,
    (
      SELECT COALESCE(SUM(
        db.budgeted_cost
        * ( (LEAST(db.period_end, p_end_date) - GREATEST(db.period_start, p_start_date) + 1)::numeric
            / NULLIF((db.period_end - db.period_start + 1), 0) )
      ), 0)::numeric
      FROM public.department_budgets db
      JOIN public.departments d
        ON d.id = db.dept_id
       AND d.organization_id = p_organization_id
      WHERE db.period_start <= p_end_date
        AND db.period_end   >= p_start_date
        AND (p_department_ids IS NULL OR db.dept_id = ANY(p_department_ids))
    ) AS budget_cost
  FROM shifts s
  LEFT JOIN hr.roles r ON r.id = s.role_id
  LEFT JOIN remuneration_levels rl ON rl.id = r.remuneration_level_id
  WHERE s.organization_id = p_organization_id
    AND s.shift_date BETWEEN p_start_date AND p_end_date
    AND s.deleted_at IS NULL
    AND (p_department_ids IS NULL OR s.department_id = ANY(p_department_ids))
    AND (p_sub_department_ids IS NULL OR s.sub_department_id = ANY(p_sub_department_ids));
$function$;
