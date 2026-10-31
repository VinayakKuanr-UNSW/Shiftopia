-- Gross Pay follow-up 2 (#24): the stats RPCs stop computing labour cost.
--
-- Money is shown in Gross Pay alone (decision 2026-10-09). These five RPCs still
-- priced every shift through the EBA engine, and nothing reads the result.
-- Consumers checked 2026-10-31 against main (app, edge functions, solver, ML):
--   get_roster_planner_stats  est_cost, budget_cost, scheduled_cost, actual_cost,
--                             costed_shifts, uncosted_shifts — unread (the zod
--                             schema strips them); Labour cost computes its own
--   get_insights_trend / get_dept_insights_breakdown  estimated_cost — unread
--   get_insights_summary      'estimated_cost' — unread
--   get_metric_detailed_analysis  the labour-cost branch — the app redirects
--                             'estimated-cost' to Gross Pay; nothing asks for
--                             'labour-cost-per-event'
-- No function, view or policy calls any of them. rpc_shift_coverage_stats, also
-- on #24's list, no longer exists.
--
-- A TABLE return type cannot change in place, so three are dropped and
-- recreated; their grants are restored exactly (authenticated, service_role).
-- Test: supabase/tests/stats_rpcs_without_cost.sql

-- ── get_dept_insights_breakdown / get_insights_trend: patched from live ──────
DO $$
DECLARE r record; v_def text; v_hits int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.get_dept_insights_breakdown(date,date,uuid[],uuid[],uuid[])',
       '\n\s+COALESCE\(SUM\(public\.fn_eba_shift_cost\(s\)\) FILTER \(WHERE s\.assigned_employee_id IS NOT NULL\), 0\),', ''),
      ('public.get_insights_trend(date,date,uuid[],uuid[],uuid[])',
       ',\n\s+COALESCE\(SUM\(public\.fn_eba_shift_cost\(s\)\) FILTER \(WHERE s\.assigned_employee_id IS NOT NULL\), 0\)(\n\s+FROM)', '\1')
    ) AS t(sig, pat, rep)
  LOOP
    v_def := pg_get_functiondef(r.sig::regprocedure);
    SELECT count(*) INTO v_hits FROM regexp_matches(v_def, r.pat, 'g');
    IF v_hits <> 1 THEN RAISE EXCEPTION '% body: % matches, expected 1', r.sig, v_hits; END IF;
    v_def := regexp_replace(v_def, r.pat, r.rep);
    SELECT count(*) INTO v_hits FROM regexp_matches(v_def, ', estimated_cost numeric', 'g');
    IF v_hits <> 1 THEN RAISE EXCEPTION '% signature: % matches, expected 1', r.sig, v_hits; END IF;
    v_def := replace(v_def, ', estimated_cost numeric', '');
    EXECUTE 'DROP FUNCTION ' || r.sig;
    EXECUTE v_def;
    EXECUTE 'REVOKE ALL ON FUNCTION ' || r.sig || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || r.sig || ' TO authenticated, service_role';
  END LOOP;
END $$;

-- ── get_roster_planner_stats: counts and minutes only ────────────────────────
DROP FUNCTION public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]);
CREATE FUNCTION public.get_roster_planner_stats(p_organization_id uuid, p_start_date date, p_end_date date, p_department_ids uuid[] DEFAULT NULL::uuid[], p_sub_department_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(total_shifts integer, assigned_shifts integer, open_shifts integer, published_shifts integer, cancelled_shifts integer, total_net_minutes bigint, unique_employees integer, actual_net_minutes bigint, actual_shifts integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH scoped AS (
      SELECT
          s.*,
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
        AND (p_department_ids IS NULL OR s.department_id = ANY(p_department_ids))
        AND (p_sub_department_ids IS NULL OR s.sub_department_id = ANY(p_sub_department_ids))
  )
  -- No cost or budget: money is shown in Gross Pay alone (decision 2026-10-09).
  SELECT
      COUNT(*) FILTER (WHERE NOT is_cancelled)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND assigned_employee_id IS NOT NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND assigned_employee_id IS NULL)::int,
      COUNT(*) FILTER (WHERE lifecycle_status IN ('Published','InProgress','Completed'))::int,
      COUNT(*) FILTER (WHERE is_cancelled)::int,
      COALESCE(SUM(net_length_minutes) FILTER (WHERE NOT is_cancelled), 0)::bigint,
      COUNT(DISTINCT assigned_employee_id) FILTER (WHERE NOT is_cancelled)::int,
      COALESCE(SUM(worked_minutes) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL), 0)::bigint,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL)::int
  FROM scoped;
$function$;
REVOKE ALL ON FUNCTION public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_roster_planner_stats(uuid, date, date, uuid[], uuid[]) TO authenticated, service_role;

-- ── get_insights_summary / get_metric_detailed_analysis: patched in place ────
-- All of a function's patches are applied to its text before one CREATE OR
-- REPLACE, so the body is never validated half-edited.
DO $$
DECLARE r record; p record; v_def text; v_hits int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.get_insights_summary(date,date,uuid[],uuid[],uuid[])'),
      ('public.get_metric_detailed_analysis(text,date,date,uuid[],uuid[])')
    ) AS t(sig)
  LOOP
    v_def := pg_get_functiondef(r.sig::regprocedure);
    FOR p IN SELECT * FROM (VALUES
        (1, 'public.get_insights_summary(date,date,uuid[],uuid[],uuid[])', 'v_sched_hrs   numeric; v_cost      numeric;', 'v_sched_hrs   numeric;'),
        (2, 'public.get_insights_summary(date,date,uuid[],uuid[],uuid[])',
            '(FILTER \(WHERE s\.assigned_employee_id IS NOT NULL\), 0\)\s+),\n\s+COALESCE\(SUM\(public\.fn_eba_shift_cost\(s\)\)\n\s+FILTER \(WHERE s\.assigned_employee_id IS NOT NULL\), 0\)', '\1'),
        (3, 'public.get_insights_summary(date,date,uuid[],uuid[],uuid[])', '(v_sched_hrs), v_cost(\n)', '\1\2'),
        (4, 'public.get_insights_summary(date,date,uuid[],uuid[],uuid[])', '\n\s+''estimated_cost'',\s+COALESCE\(v_cost, 0\),', ''),
        (5, 'public.get_metric_detailed_analysis(text,date,date,uuid[],uuid[])',
            '\n    ELSIF p_metric_id = ''labour-cost-per-event'' OR p_metric_id = ''estimated-cost'' THEN\n.*?(\n    ELSIF p_metric_id = ''no-show-rate'' THEN)', '\1')
      ) AS t(ord, sig, pat, rep) WHERE t.sig = r.sig ORDER BY ord
    LOOP
      SELECT count(*) INTO v_hits FROM regexp_matches(v_def, p.pat, 'g');
      IF v_hits <> 1 THEN RAISE EXCEPTION 'patch % on %: % matches, expected 1', p.ord, p.sig, v_hits; END IF;
      v_def := regexp_replace(v_def, p.pat, p.rep);
    END LOOP;
    EXECUTE v_def;
  END LOOP;
END $$;
