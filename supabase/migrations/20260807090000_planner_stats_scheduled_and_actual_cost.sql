-- Migration: 20260807090000_planner_stats_scheduled_and_actual_cost.sql
-- Description: Splits the planner footer's single "Est. Cost" into SCHEDULED cost
--              (what the roster as planned will cost) and ACTUAL cost (what was
--              really worked), and fixes the rate source.
--
-- THREE THINGS WERE WRONG WITH `est_cost`
-- ---------------------------------------
-- 1. It was filtered to `assigned_employee_id IS NOT NULL`, so a roster of 156
--    planned-but-unfilled shifts reported **$0.00**. A planned roster costs what
--    it costs whether or not the names are filled in yet; that filter turned the
--    single most useful planning number into a blank.
--
-- 2. The rate chain ended at `hr.remuneration_levels.hourly_rate_min`, which is
--    the PERMANENT (unloaded) rate and is also stale: it still carries the
--    pre-2026-07-06 figures (Level 2 = 26.37 vs the current 27.71). Pricing a
--    casual off it under-reads by the 25% loading AND by the CPI increase — the
--    same class of error as the casual-rate-sourcing finding in the EBA pay
--    remediation.
--
-- 3. It ignored `target_employment_type` entirely, so a Casual and a Full-Time
--    shift at the same level costed identically.
--
-- RATE SOURCE
-- -----------
-- `public.eba_rate` is the effective-dated table that the TypeScript engine's
-- `rate-schedule.ts` mirrors, and `paid_hourly_rate` already carries the casual
-- loading. Resolving (classification, employment_basis) as at the SHIFT's date
-- reproduces the TS engine exactly for ordinary hours — verified against the
-- cards: Level 2 casual 7.00h = 7 x 34.64 = $242.48; Level 5 permanent 7.50h =
-- 7.5 x 32.39 = $242.93.
--
-- Both figures stay ORDINARY-HOURS estimates: weekend/public-holiday penalties,
-- overtime, night allowance and the minimum-engagement floor live in the
-- TypeScript engine (utils/cost/) and are NOT reproduced here. They are labelled
-- "Est." in the UI for that reason. This is a planning total, not a payroll run.
--
-- Rate precedence keeps an explicit per-shift rate winning, so a manager override
-- is never silently replaced by the schedule.

DROP FUNCTION IF EXISTS public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]);

CREATE OR REPLACE FUNCTION public.get_roster_planner_stats(
    p_organization_id    uuid,
    p_start_date         date,
    p_end_date           date,
    p_department_ids     uuid[] DEFAULT NULL::uuid[],
    p_sub_department_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
    total_shifts      integer,
    assigned_shifts   integer,
    open_shifts       integer,
    published_shifts  integer,
    cancelled_shifts  integer,
    total_net_minutes bigint,
    unique_employees  integer,
    est_cost          numeric,
    budget_cost       numeric,
    scheduled_cost    numeric,
    actual_cost       numeric,
    actual_net_minutes bigint,
    costed_shifts     integer,
    uncosted_shifts   integer,
    actual_shifts     integer
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH scoped AS (
      SELECT
          s.*,
          -- Rate as at THIS shift's date. `paid_hourly_rate` already includes the
          -- 25% casual loading, so no separate multiplier is applied.
          COALESCE(
              s.actual_hourly_rate,
              s.remuneration_rate,
              (
                  SELECT er.paid_hourly_rate
                    FROM public.eba_rate er
                   WHERE er.classification = 'LEVEL_' || s.remuneration_level::text
                     AND er.employment_basis = CASE
                             WHEN s.target_employment_type = 'Casual' THEN 'casual'
                             ELSE 'permanent'
                         END
                     AND er.effective_from <= s.shift_date
                   ORDER BY er.effective_from DESC
                   LIMIT 1
              )
          ) AS resolved_rate,
          -- Minutes actually worked. Prefer the timesheet's billable window (a
          -- manager's committed override), else the raw clock pair. NULL when the
          -- shift was never worked — so it contributes nothing rather than zero.
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
  )
  SELECT
      COUNT(*) FILTER (WHERE NOT is_cancelled)::int AS total_shifts,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND assigned_employee_id IS NOT NULL)::int AS assigned_shifts,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND assigned_employee_id IS NULL)::int AS open_shifts,
      COUNT(*) FILTER (WHERE lifecycle_status IN ('Published','InProgress','Completed'))::int AS published_shifts,
      COUNT(*) FILTER (WHERE is_cancelled)::int AS cancelled_shifts,
      COALESCE(SUM(net_length_minutes) FILTER (WHERE NOT is_cancelled), 0)::bigint AS total_net_minutes,
      COUNT(DISTINCT assigned_employee_id) FILTER (WHERE NOT is_cancelled)::int AS unique_employees,

      -- est_cost: kept for backward compatibility with any caller still reading
      -- it, but now an ALIAS OF scheduled_cost rather than the assigned-only
      -- subset that read $0.00 on an unfilled roster.
      COALESCE(SUM((net_length_minutes / 60.0) * resolved_rate)
               FILTER (WHERE NOT is_cancelled), 0)::numeric AS est_cost,

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
      ) AS budget_cost,

      -- What the roster as PLANNED costs — every live shift, filled or not.
      COALESCE(SUM((net_length_minutes / 60.0) * resolved_rate)
               FILTER (WHERE NOT is_cancelled), 0)::numeric AS scheduled_cost,

      -- What was actually WORKED. Only shifts with a resolvable worked window
      -- contribute, so an un-worked roster reads $0.00 over 0 shifts rather than
      -- implying the work was free.
      COALESCE(SUM((worked_minutes / 60.0) * resolved_rate)
               FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL), 0)::numeric AS actual_cost,

      COALESCE(SUM(worked_minutes) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL), 0)::bigint AS actual_net_minutes,

      -- Transparency: how much of the scheduled total is actually priced. A shift
      -- with no resolvable rate contributes 0 and would otherwise silently deflate
      -- the total with no indication.
      COUNT(*) FILTER (WHERE NOT is_cancelled AND resolved_rate IS NOT NULL)::int AS costed_shifts,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND resolved_rate IS NULL)::int     AS uncosted_shifts,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL)::int AS actual_shifts
  FROM scoped;
$$;

ALTER FUNCTION public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]) OWNER TO postgres;

COMMENT ON FUNCTION public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]) IS
    'Roster Planner footer totals. scheduled_cost = the roster as planned (all live '
    'shifts, filled or not); actual_cost = what was worked (timesheet billable '
    'window, else raw clocks). Rates resolve from public.eba_rate as at the shift '
    'date, so casual loading and CPI steps are included. ORDINARY HOURS ONLY — '
    'penalties, overtime, night allowance and the minimum-engagement floor live in '
    'the TypeScript engine and are not reproduced here.';

REVOKE ALL ON FUNCTION public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]) TO service_role;
