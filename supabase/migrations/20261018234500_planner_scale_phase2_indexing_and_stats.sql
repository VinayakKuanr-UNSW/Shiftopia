-- Phase 2 Performance & Scaling Migration:
-- 1. F-05: Delta sync composite index on public.shifts (organization_id, updated_at DESC)
--    Eliminates O(N) linear table scans on 30s client polling daemon.
-- 2. Parallel-safe markings on read-only EBA pricing routines.
-- 3. F-07: Optimized get_roster_planner_stats with direct timesheet join and redundant
--    shift_cost avoidance.

-- 1. Delta Polling Composite Index
CREATE INDEX IF NOT EXISTS idx_shifts_org_updated 
ON public.shifts (organization_id, updated_at DESC);

-- 2. Mark read-only costing routines PARALLEL SAFE
ALTER FUNCTION public.fn_eba_estimate_shift_cost(date, time, integer, integer, numeric, text, boolean, boolean, boolean, boolean) PARALLEL SAFE;
ALTER FUNCTION internal.resolve_pay_terms(date, smallint, text, text, smallint, numeric, text, numeric, boolean) PARALLEL SAFE;
ALTER FUNCTION internal.shift_pay_terms(public.shifts) PARALLEL SAFE;
ALTER FUNCTION internal.shift_cost(public.shifts, integer) PARALLEL SAFE;
ALTER FUNCTION public.is_first_aid_duty(public.shifts) PARALLEL SAFE;
ALTER FUNCTION public.fn_normalize_employment_type(text) PARALLEL SAFE;
ALTER FUNCTION public.fn_eba_resolve_shift_rate(smallint, text, date, numeric, numeric) PARALLEL SAFE;
ALTER FUNCTION hr.contract_pay_terms_on(uuid, date) PARALLEL SAFE;

-- 3. Optimized get_roster_planner_stats
CREATE OR REPLACE FUNCTION public.get_roster_planner_stats(
    p_organization_id uuid,
    p_start_date date,
    p_end_date date,
    p_department_ids uuid[] DEFAULT NULL::uuid[],
    p_sub_department_ids uuid[] DEFAULT NULL::uuid[]
) RETURNS TABLE(
    total_shifts integer,
    assigned_shifts integer,
    open_shifts integer,
    published_shifts integer,
    cancelled_shifts integer,
    total_net_minutes bigint,
    unique_employees integer,
    est_cost numeric,
    budget_cost numeric,
    scheduled_cost numeric,
    actual_cost numeric,
    actual_net_minutes bigint,
    costed_shifts integer,
    uncosted_shifts integer,
    actual_shifts integer
)
    LANGUAGE sql STABLE PARALLEL SAFE
    SET search_path TO 'public'
    AS $$
  WITH scoped AS (
      SELECT
          s,
          s.id,
          s.is_cancelled,
          s.lifecycle_status,
          s.assigned_employee_id,
          s.net_length_minutes,
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
      LEFT JOIN public.timesheets ts ON ts.shift_id = s.id
      WHERE s.organization_id = p_organization_id
        AND s.shift_date BETWEEN p_start_date AND p_end_date
        AND s.deleted_at IS NULL
        AND (p_department_ids IS NULL OR s.department_id = ANY(p_department_ids))
        AND (p_sub_department_ids IS NULL OR s.sub_department_id = ANY(p_sub_department_ids))
  ),
  sched AS (
      SELECT
          sc.id,
          sc.is_cancelled,
          sc.lifecycle_status,
          sc.assigned_employee_id,
          sc.net_length_minutes,
          sc.worked_minutes,
          sc.s,
          CASE
              WHEN sc.is_cancelled THEN NULL
              ELSE internal.shift_cost(sc.s, sc.net_length_minutes)
          END AS sched_shift_cost
      FROM scoped sc
  ),
  priced AS (
      SELECT
          sh.id,
          sh.is_cancelled,
          sh.lifecycle_status,
          sh.assigned_employee_id,
          sh.net_length_minutes,
          sh.worked_minutes,
          sh.sched_shift_cost,
          CASE
              WHEN sh.is_cancelled OR sh.worked_minutes IS NULL THEN NULL
              WHEN sh.worked_minutes = sh.net_length_minutes THEN sh.sched_shift_cost
              ELSE internal.shift_cost(sh.s, sh.worked_minutes)
          END AS actual_shift_cost
      FROM sched sh
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
      COUNT(*) FILTER (WHERE NOT is_cancelled AND sched_shift_cost IS NOT NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND sched_shift_cost IS NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL)::int
  FROM priced;
$$;

COMMENT ON FUNCTION public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]) IS 'Roster Planner footer totals. Optimized with direct timesheet join, parallel safety, and redundant evaluation elimination while strictly preserving EBA costing parity to the cent.';
