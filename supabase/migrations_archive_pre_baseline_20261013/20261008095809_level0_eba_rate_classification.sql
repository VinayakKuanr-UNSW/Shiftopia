-- Level 0 shifts priced as NULL in the SQL cost engine.
--
-- `public.eba_rate` stores Schedule 2's lowest classification ("ICC Sydney
-- Trainee", the Schedule 1 §1 Introductory Team Member) under the key
-- 'TRAINEE', not 'LEVEL_0'. Both lookups below built 'LEVEL_' || level, so a
-- Level 0 shift resolved no rate: fn_eba_shift_cost returned no cost and the
-- Roster Planner counted it as uncosted. The TS engine already maps 0 → TRAINEE
-- (grossPay.read.api.ts); this brings the two SQL lookups into line.
--
-- Both bodies are copied from pg_get_functiondef() on 2026-10-08 with only the
-- classification expression changed. CREATE OR REPLACE keeps the existing ACLs.

CREATE OR REPLACE FUNCTION public.fn_eba_resolve_shift_rate(p_remuneration_level smallint, p_target_employment_type text, p_shift_date date, p_actual_hourly_rate numeric DEFAULT NULL::numeric, p_remuneration_rate numeric DEFAULT NULL::numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    -- An explicit per-shift rate always wins (a manager override must never be
    -- silently replaced by the schedule). Otherwise resolve the effective-dated
    -- EBA rate for this classification + basis. `paid_hourly_rate` already
    -- carries the 25% casual loading; the engine de-loads it internally.
    -- Level 0 is stored as 'TRAINEE' in eba_rate (Schedule 2 "ICC Sydney Trainee").
    SELECT COALESCE(
        p_actual_hourly_rate,
        p_remuneration_rate,
        (
            SELECT er.paid_hourly_rate
              FROM public.eba_rate er
             WHERE er.classification = CASE
                       WHEN p_remuneration_level = 0 THEN 'TRAINEE'
                       ELSE 'LEVEL_' || p_remuneration_level::text END
               AND er.employment_basis = CASE
                       WHEN p_target_employment_type = 'Casual' THEN 'casual'
                       ELSE 'permanent' END
               AND er.effective_from <= p_shift_date
             ORDER BY er.effective_from DESC
             LIMIT 1
        )
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_roster_planner_stats(p_organization_id uuid, p_start_date date, p_end_date date, p_department_ids uuid[] DEFAULT NULL::uuid[], p_sub_department_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(total_shifts integer, assigned_shifts integer, open_shifts integer, published_shifts integer, cancelled_shifts integer, total_net_minutes bigint, unique_employees integer, est_cost numeric, budget_cost numeric, scheduled_cost numeric, actual_cost numeric, actual_net_minutes bigint, costed_shifts integer, uncosted_shifts integer, actual_shifts integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH scoped AS (
      SELECT
          s.*,
          -- cl 28.2: computed field, not a column — `s.*` does not include it.
          COALESCE(s.is_first_aid_duty, false) AS first_aid_duty,
          COALESCE(
              s.actual_hourly_rate,
              s.remuneration_rate,
              (
                  SELECT er.paid_hourly_rate
                    FROM public.eba_rate er
                   -- Level 0 is stored as 'TRAINEE' in eba_rate (Schedule 2 "ICC Sydney Trainee").
                   WHERE er.classification = CASE
                             WHEN s.remuneration_level = 0 THEN 'TRAINEE'
                             ELSE 'LEVEL_' || s.remuneration_level::text
                         END
                     AND er.employment_basis = CASE
                             WHEN s.target_employment_type = 'Casual' THEN 'casual'
                             ELSE 'permanent'
                         END
                     AND er.effective_from <= s.shift_date
                   ORDER BY er.effective_from DESC
                   LIMIT 1
              )
          ) AS resolved_rate,
          CASE
              WHEN ts.start_time IS NOT NULL AND ts.end_time IS NOT NULL THEN
                  GREATEST(0, (EXTRACT(EPOCH FROM (
                      (s.shift_date + ts.end_time)
                        + CASE WHEN ts.end_time <= ts.start_time
                               THEN INTERVAL '1 day' ELSE INTERVAL '0' END
                        - (s.shift_date + ts.start_time)
                  )) / 60)::int - COALESCE(s.unpaid_break_minutes, 0))
              WHEN s.actual_start IS NOT NULL AND s.actual_end IS NOT NULL THEN
                  GREATEST(0, (EXTRACT(EPOCH FROM (s.actual_end - s.actual_start)) / 60)::int
                              - COALESCE(s.unpaid_break_minutes, 0))
              ELSE NULL
          END AS worked_minutes
      FROM public.shifts s
      LEFT JOIN LATERAL (
          SELECT t.start_time, t.end_time
            FROM public.timesheets t
           WHERE t.shift_id = s.id
           ORDER BY t.start_time NULLS LAST
           LIMIT 1
      ) ts ON TRUE
      WHERE s.organization_id = p_organization_id
        AND s.shift_date BETWEEN p_start_date AND p_end_date
        AND s.deleted_at IS NULL
        AND (p_department_ids IS NULL OR s.department_id = ANY(p_department_ids))
        AND (p_sub_department_ids IS NULL OR s.sub_department_id = ANY(p_sub_department_ids))
  ),
  priced AS (
      SELECT
          scoped.*,
          -- Full award pricing: cl 41 penalties, cl 41.4 non-cumulative loadings,
          -- cl 42 tiered overtime + PH floor, cl 43 night allowance, cl 28.1 meal,
          -- cl 28.2 first aid, cl 12/56.2 minimum engagement, overnight midnight split.
          public.fn_eba_estimate_shift_cost(
              shift_date, start_time, net_length_minutes, scheduled_length_minutes,
              resolved_rate, target_employment_type,
              COALESCE(target_requires_flexible, false), COALESCE(is_training, false),
              first_aid_duty
          ) AS sched_shift_cost,
          CASE WHEN worked_minutes IS NULL THEN NULL ELSE
              public.fn_eba_estimate_shift_cost(
                  shift_date, start_time, worked_minutes, scheduled_length_minutes,
                  resolved_rate, target_employment_type,
                  COALESCE(target_requires_flexible, false), COALESCE(is_training, false),
                  first_aid_duty
              )
          END AS actual_shift_cost
      FROM scoped
  )
  SELECT
      COUNT(*) FILTER (WHERE NOT is_cancelled)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND assigned_employee_id IS NOT NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND assigned_employee_id IS NULL)::int,
      COUNT(*) FILTER (WHERE lifecycle_status IN ('Published','InProgress','Completed'))::int,
      COUNT(*) FILTER (WHERE is_cancelled)::int,
      COALESCE(SUM(net_length_minutes) FILTER (WHERE NOT is_cancelled), 0)::bigint,
      COUNT(DISTINCT assigned_employee_id) FILTER (WHERE NOT is_cancelled)::int,
      COALESCE(SUM(sched_shift_cost) FILTER (WHERE NOT is_cancelled), 0)::numeric,
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
      ),
      COALESCE(SUM(sched_shift_cost) FILTER (WHERE NOT is_cancelled), 0)::numeric,
      COALESCE(SUM(actual_shift_cost) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL), 0)::numeric,
      COALESCE(SUM(worked_minutes) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL), 0)::bigint,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND resolved_rate IS NOT NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND resolved_rate IS NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL)::int
  FROM priced;
$function$;
