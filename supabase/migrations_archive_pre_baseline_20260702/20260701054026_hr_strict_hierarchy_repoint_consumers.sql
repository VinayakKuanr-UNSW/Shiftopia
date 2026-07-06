-- Strict hierarchy: stop consumers using redundant hr.roles.department_id / remuneration_level_id.
-- Applied to prod (srfozdlphoempdattvtx) 2026-07-01 via MCP apply_migration.
-- (columns dropped in the follow-up migration once the get-roster-view edge fn was redeployed off them)

-- 1) roster planner stats: use the canonical level link remuneration_level -> hr.remuneration_levels
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
      JOIN public.departments d ON d.id = db.dept_id AND d.organization_id = p_organization_id
      WHERE db.period_start <= p_end_date AND db.period_end >= p_start_date
        AND (p_department_ids IS NULL OR db.dept_id = ANY(p_department_ids))
    ) AS budget_cost
  FROM shifts s
  LEFT JOIN hr.roles r              ON r.id = s.role_id
  LEFT JOIN hr.remuneration_levels rl ON rl.level_number = r.remuneration_level
  WHERE s.organization_id = p_organization_id
    AND s.shift_date BETWEEN p_start_date AND p_end_date
    AND s.deleted_at IS NULL
    AND (p_department_ids IS NULL OR s.department_id = ANY(p_department_ids))
    AND (p_sub_department_ids IS NULL OR s.sub_department_id = ANY(p_sub_department_ids));
$function$;

-- 2) role_ml_class_map policies: derive department via subdepartment (drop r.department_id dependency)
DROP POLICY IF EXISTS authenticated_update_role_ml_class_map ON public.role_ml_class_map;
CREATE POLICY authenticated_update_role_ml_class_map ON public.role_ml_class_map
  FOR UPDATE TO authenticated
  USING (EXISTS ( SELECT 1 FROM hr.roles r JOIN hr.subdepartments sd ON sd.id = r.subdepartment_id
    WHERE r.id = role_ml_class_map.role_id
      AND user_has_action_in_scope('shift.edit'::text, NULL::uuid, sd.department_id, r.subdepartment_id)))
  WITH CHECK (EXISTS ( SELECT 1 FROM hr.roles r JOIN hr.subdepartments sd ON sd.id = r.subdepartment_id
    WHERE r.id = role_ml_class_map.role_id
      AND user_has_action_in_scope('shift.edit'::text, NULL::uuid, sd.department_id, r.subdepartment_id)));

DROP POLICY IF EXISTS authenticated_write_role_ml_class_map ON public.role_ml_class_map;
CREATE POLICY authenticated_write_role_ml_class_map ON public.role_ml_class_map
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS ( SELECT 1 FROM hr.roles r JOIN hr.subdepartments sd ON sd.id = r.subdepartment_id
    WHERE r.id = role_ml_class_map.role_id
      AND user_has_action_in_scope('shift.edit'::text, NULL::uuid, sd.department_id, r.subdepartment_id)));

-- 3) drop dead, unused function (inserted into a never-existent public.employee_assignments)
DROP FUNCTION IF EXISTS public.assign_employee(uuid, text, text, text, boolean);
