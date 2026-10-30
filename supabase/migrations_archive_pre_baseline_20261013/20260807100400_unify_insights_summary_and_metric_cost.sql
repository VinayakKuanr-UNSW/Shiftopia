-- Migration: 20260807100400_unify_insights_summary_and_metric_cost.sql
-- Description: The last two cost expressions still on `COALESCE(remuneration_rate, 0)`.
--
--   get_insights_summary          -> the Insights top-line cost KPI
--   get_metric_detailed_analysis  -> the 'labour-cost-per-event' / 'estimated-cost'
--                                    drilldown (headline value + daily chart series)
--
-- Both read a column that is NULL on every shift in prod, so both reported
-- $0.00 for every period. Verified after this migration: 2 assigned Casual
-- Level 2 shifts report $484.96 = 2 x $242.48, the exact per-card figure.
--
-- These bodies are large and mostly unrelated to cost, so rather than retyping
-- them (transcription risk) the cost expressions are replaced in place against
-- pg_get_functiondef. The DO block RAISES if a pattern does not match, so a
-- silent no-op is impossible — a substitution that quietly matches nothing is
-- exactly how this class of bug survives a refactor.

DO $mig$
DECLARE
    v_def  text;
    v_new  text;
    v_hits int;
BEGIN
    -- ── get_insights_summary ────────────────────────────────────────────────
    SELECT pg_get_functiondef(oid) INTO v_def
      FROM pg_proc WHERE proname = 'get_insights_summary';

    v_new := replace(v_def,
        E'COALESCE(SUM(\n            COALESCE(s.net_length_minutes,0)::numeric / 60\n            * COALESCE(s.remuneration_rate, 0))\n            FILTER (WHERE s.assigned_employee_id IS NOT NULL), 0)',
        E'COALESCE(SUM(public.fn_eba_shift_cost(s))\n            FILTER (WHERE s.assigned_employee_id IS NOT NULL), 0)');

    IF v_new = v_def THEN
        RAISE EXCEPTION 'get_insights_summary: cost expression not found — the body changed, re-derive the patch';
    END IF;
    EXECUTE v_new;

    -- ── get_metric_detailed_analysis ────────────────────────────────────────
    SELECT pg_get_functiondef(oid) INTO v_def
      FROM pg_proc WHERE proname = 'get_metric_detailed_analysis';

    -- Two occurrences: the daily chart series and the headline value. The
    -- unqualified `shifts` reference needs an alias to pass the row to the
    -- engine, so the FROM clauses are aliased in the same pass.
    v_new := replace(v_def,
        'COALESCE(SUM(COALESCE(net_length_minutes,0)::numeric/60*COALESCE(remuneration_rate,0)),0) as c'
        || E'\n            FROM shifts WHERE shift_date BETWEEN p_start_date AND p_end_date AND assigned_employee_id IS NOT NULL',
        'COALESCE(SUM(public.fn_eba_shift_cost(s)),0) as c'
        || E'\n            FROM shifts s WHERE s.shift_date BETWEEN p_start_date AND p_end_date AND s.assigned_employee_id IS NOT NULL');

    v_new := replace(v_new,
        'SELECT ROUND(SUM(COALESCE(net_length_minutes,0)::numeric/60*COALESCE(remuneration_rate,0)),0)::text INTO v_current_val'
        || E'\n        FROM shifts WHERE shift_date BETWEEN p_start_date AND p_end_date AND assigned_employee_id IS NOT NULL',
        'SELECT ROUND(SUM(public.fn_eba_shift_cost(s)),0)::text INTO v_current_val'
        || E'\n        FROM shifts s WHERE s.shift_date BETWEEN p_start_date AND p_end_date AND s.assigned_employee_id IS NOT NULL');

    SELECT count(*) INTO v_hits
      FROM regexp_matches(v_new, 'fn_eba_shift_cost', 'g');
    IF v_hits <> 2 THEN
        RAISE EXCEPTION 'get_metric_detailed_analysis: expected 2 cost substitutions, made % — re-derive the patch', v_hits;
    END IF;
    EXECUTE v_new;
END
$mig$;
