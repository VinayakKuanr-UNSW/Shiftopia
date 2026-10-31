-- Gross Pay follow-up 2: the stats RPCs return no cost and still run.
--
-- Checks:
--   A. none of the five calls the cost engine (fn_eba_shift_cost / shift_cost)
--   B. no cost or budget column / key remains in their results
--   C. grants are exactly authenticated + service_role (no anon, no PUBLIC)
--   D. each still runs over a real period and returns its non-cost fields
-- Ends by raising, so nothing persists.
--
-- Expected output (as the error text):  PASSED (rolled back): A B C D

DO $$
DECLARE
  v_names  text;
  v_passed text := '';
  v_org    uuid;
  v_json   json;
  v_n      int;
BEGIN
  -- A
  SELECT string_agg(p.proname, ', ') INTO v_names FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('get_roster_planner_stats', 'get_insights_summary', 'get_insights_trend',
                      'get_dept_insights_breakdown', 'get_metric_detailed_analysis')
    AND p.prosrc ~ '\m(fn_eba_shift_cost|shift_cost)\M';
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'FAILED (rolled back): A — still prices: %', v_names; END IF;
  v_passed := v_passed || 'A ';

  -- B
  SELECT string_agg(p.proname, ', ') INTO v_names FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('get_roster_planner_stats', 'get_insights_trend', 'get_dept_insights_breakdown')
    AND pg_get_function_result(p.oid) ~ '(cost|budget)';
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'FAILED (rolled back): B — cost column in: %', v_names; END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.get_insights_summary(date,date,uuid[],uuid[],uuid[])'::regprocedure) ~ 'estimated_cost' THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — get_insights_summary still returns estimated_cost';
  END IF;
  v_passed := v_passed || 'B ';

  -- C
  SELECT string_agg(p.proname, ', ') INTO v_names FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('get_roster_planner_stats', 'get_insights_summary', 'get_insights_trend',
                      'get_dept_insights_breakdown', 'get_metric_detailed_analysis')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
         OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE'));
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'FAILED (rolled back): C — grants wrong on: %', v_names; END IF;
  v_passed := v_passed || 'C ';

  -- D
  SELECT organization_id INTO v_org FROM public.shifts WHERE organization_id IS NOT NULL LIMIT 1;
  SELECT count(*) INTO v_n FROM public.get_roster_planner_stats(v_org, current_date - 30, current_date + 30)
    WHERE total_shifts IS NOT NULL AND actual_shifts IS NOT NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAILED (rolled back): D — planner stats returned % rows', v_n; END IF;
  v_json := public.get_insights_summary(current_date - 30, current_date + 30);
  IF v_json->>'shifts_total' IS NULL OR v_json->>'scheduled_hours' IS NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): D — insights summary lost its counts: %', v_json;
  END IF;
  PERFORM * FROM public.get_insights_trend(current_date - 30, current_date + 30);
  PERFORM * FROM public.get_dept_insights_breakdown(current_date - 30, current_date + 30);
  v_json := public.get_metric_detailed_analysis('shift-fill-rate', current_date - 30, current_date + 30);
  IF v_json IS NULL THEN RAISE EXCEPTION 'FAILED (rolled back): D — metric analysis returned NULL'; END IF;
  v_json := public.get_metric_detailed_analysis('estimated-cost', current_date - 30, current_date + 30);
  IF v_json::text ~ 'Labour Cost Analysis' THEN
    RAISE EXCEPTION 'FAILED (rolled back): D — the labour-cost branch still answers';
  END IF;
  v_passed := v_passed || 'D';

  RAISE EXCEPTION 'PASSED (rolled back): %', v_passed;
END $$;
