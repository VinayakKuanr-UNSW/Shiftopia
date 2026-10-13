-- ============================================================================
-- Give get_metric_detailed_analysis a branch for each KPI headline tile that
-- links into it.
--
-- The tabs render six drill-down links. The function recognised four metric
-- ids, all KEBAB-case (shift-fill-rate, no-show-rate, estimated-cost,
-- labour-cost-per-event), while the tiles passed the registry's SNAKE_case
-- ids. Every link therefore fell through to the "pending full database
-- migration" fallback — including shift-fill-rate, which had a working branch
-- it simply never reached.
--
-- Four behavioural branches are added, all reading assignment_snapshots with
-- the same end_reason definitions as get_kpi_behaviour_summary, so a
-- drill-down cannot contradict the tile that opened it:
--
--   attendance-compliance-rate   worked AND on time in AND on time out
--   cancellation-rate            dropped_std + dropped_late, over held
--   open-shift-award-rate        winners over open bidding shifts
--   swap-completion-rate         approved over swaps initiated
--
-- The frontend sends kebab-case via analysisMetricId() and only renders a link
-- where a branch exists, so a dead-end link cannot be reintroduced by adding a
-- tile.
--
-- Patched from the live definition by inserting before the single ELSE, so the
-- other 6kB of branches cannot drift. The guard aborts unless the anchor
-- appears exactly once, and the whole thing is a no-op on re-run.
--
-- Verified against production: all eight ids now return a real title,
-- summary and chart series.
-- ============================================================================

DO $mig$
DECLARE
    v_def       text;
    v_hits      int;
    v_anchor    constant text := E'\n    ELSE\n        -- FALLBACK';
    v_branches  text;
BEGIN
    v_def := pg_get_functiondef('public.get_metric_detailed_analysis(text,date,date,uuid[],uuid[])'::regprocedure);

    SELECT count(*) INTO v_hits FROM regexp_matches(v_def, E'\n    ELSE\n        -- FALLBACK', 'g');
    IF v_hits <> 1 THEN
        RAISE EXCEPTION 'expected exactly one FALLBACK anchor, found %', v_hits;
    END IF;

    IF position('attendance-compliance-rate' in v_def) > 0 THEN
        RAISE NOTICE 'branches already present, nothing to do';
        RETURN;
    END IF;

    v_branches := $branches$
    ELSIF p_metric_id = 'attendance-compliance-rate' THEN
        v_title := 'Attendance Compliance Analysis';
        WITH daily AS (
            SELECT s.shift_date AS d,
                   COUNT(*) FILTER (WHERE s.end_reason = 'worked') AS w,
                   COUNT(*) FILTER (WHERE s.end_reason = 'worked' AND NOT s.late_in AND NOT s.early_out) AS ok
            FROM assignment_snapshots s
            WHERE s.shift_date BETWEEN p_start_date AND p_end_date
              AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
              AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids))
            GROUP BY 1 ORDER BY 1
        )
        SELECT jsonb_agg(jsonb_build_object('label', d, 'value', ROUND(ok::numeric/NULLIF(w,0)*100,1))) INTO v_chart_data FROM daily;
        SELECT ROUND(COUNT(*) FILTER (WHERE s.end_reason = 'worked' AND NOT s.late_in AND NOT s.early_out)::numeric
                     / NULLIF(COUNT(*) FILTER (WHERE s.end_reason = 'worked'),0) * 100, 1)::text
        INTO v_current_val
        FROM assignment_snapshots s
        WHERE s.shift_date BETWEEN p_start_date AND p_end_date
          AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
          AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids));
        v_target_val := '95%';
        v_summary := 'Attendance compliance is ' || COALESCE(v_current_val, '0') || '% across the selected period.';
        v_details := 'Counts shifts that were worked AND clocked in on time AND clocked out on time, over shifts worked. The grace window is 7.5 minutes either side of schedule.';
        v_recs := ARRAY['Check whether late starts cluster on particular shift times', 'Review sites with repeated missing clock-outs', 'Confirm rosters give enough travel time between venues'];

    ELSIF p_metric_id = 'cancellation-rate' THEN
        v_title := 'Cancellation Analysis';
        WITH weekly AS (
            SELECT date_trunc('week', s.shift_date::timestamp)::date AS d,
                   COUNT(*) AS held,
                   COUNT(*) FILTER (WHERE s.end_reason IN ('dropped_std','dropped_late')) AS c
            FROM assignment_snapshots s
            WHERE s.shift_date BETWEEN p_start_date AND p_end_date
              AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
              AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids))
            GROUP BY 1 ORDER BY 1
        )
        SELECT jsonb_agg(jsonb_build_object('label', d, 'value', ROUND(c::numeric/NULLIF(held,0)*100,1))) INTO v_chart_data FROM weekly;
        SELECT ROUND(COUNT(*) FILTER (WHERE s.end_reason IN ('dropped_std','dropped_late'))::numeric
                     / NULLIF(COUNT(*),0) * 100, 1)::text
        INTO v_current_val
        FROM assignment_snapshots s
        WHERE s.shift_date BETWEEN p_start_date AND p_end_date
          AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
          AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids));
        v_target_val := '5%';
        v_summary := 'Cancellation rate is ' || COALESCE(v_current_val, '0') || '% of shifts held.';
        v_details := 'Shifts released by the person holding them, over all shifts held. Two kinds, split at 24 hours notice: standard above, critical at or below. 4 hours is a different line entirely - the urgent/emergent boundary, where exchange operations are blocked.';
        v_recs := ARRAY['Look at the reason distribution before the rate', 'Critical cancellations matter more than the total', 'Check whether one sub-department carries most of them'];
        v_chart_type := 'bar';

    ELSIF p_metric_id = 'open-shift-award-rate' THEN
        v_title := 'Open-Shift Award Analysis';
        WITH weekly AS (
            SELECT date_trunc('week', s.shift_date::timestamp)::date AS d,
                   COUNT(DISTINCT s.id) AS opened,
                   COUNT(DISTINCT sb.shift_id) FILTER (WHERE sb.status = 'accepted') AS won
            FROM shifts s
            LEFT JOIN shift_bids sb ON sb.shift_id = s.id
            WHERE s.shift_date BETWEEN p_start_date AND p_end_date
              AND s.deleted_at IS NULL
              AND s.bidding_status NOT IN ('not_on_bidding','bidding_closed_no_winner')
              AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
              AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids))
            GROUP BY 1 ORDER BY 1
        )
        SELECT jsonb_agg(jsonb_build_object('label', d, 'value', ROUND(won::numeric/NULLIF(opened,0)*100,1))) INTO v_chart_data FROM weekly;
        SELECT ROUND(COUNT(DISTINCT sb.shift_id) FILTER (WHERE sb.status = 'accepted')::numeric
                     / NULLIF(COUNT(DISTINCT s.id),0) * 100, 1)::text
        INTO v_current_val
        FROM shifts s
        LEFT JOIN shift_bids sb ON sb.shift_id = s.id
        WHERE s.shift_date BETWEEN p_start_date AND p_end_date
          AND s.deleted_at IS NULL
          AND s.bidding_status NOT IN ('not_on_bidding','bidding_closed_no_winner')
          AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
          AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids));
        v_target_val := '80%';
        v_summary := 'Open-shift award rate is ' || COALESCE(v_current_val, '0') || '% across the selected period.';
        v_details := 'Open bidding shifts that ended with a winner selected. Distinct from bid win rate, which is winners over ALL bids placed and falls as competition per shift rises.';
        v_recs := ARRAY['Check shifts that expired without a single bid first', 'Compare bids per shift against award rate', 'Review whether urgent shifts are opening late'];
        v_chart_type := 'bar';

    ELSIF p_metric_id = 'swap-completion-rate' THEN
        v_title := 'Swap Completion Analysis';
        WITH weekly AS (
            SELECT date_trunc('week', s.shift_date::timestamp)::date AS d,
                   COUNT(sr.id) AS started,
                   COUNT(*) FILTER (WHERE sr.status = 'approved') AS done
            FROM shifts s
            JOIN swap_requests sr ON sr.original_shift_id = s.id
            WHERE s.shift_date BETWEEN p_start_date AND p_end_date
              AND s.deleted_at IS NULL
              AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
              AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids))
            GROUP BY 1 ORDER BY 1
        )
        SELECT jsonb_agg(jsonb_build_object('label', d, 'value', ROUND(done::numeric/NULLIF(started,0)*100,1))) INTO v_chart_data FROM weekly;
        SELECT ROUND(COUNT(*) FILTER (WHERE sr.status = 'approved')::numeric / NULLIF(COUNT(sr.id),0) * 100, 1)::text
        INTO v_current_val
        FROM shifts s
        JOIN swap_requests sr ON sr.original_shift_id = s.id
        WHERE s.shift_date BETWEEN p_start_date AND p_end_date
          AND s.deleted_at IS NULL
          AND (p_org_ids IS NULL OR s.organization_id = ANY(p_org_ids))
          AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids));
        v_target_val := '75%';
        v_summary := 'Swap completion rate is ' || COALESCE(v_current_val, '0') || '% of swaps initiated.';
        v_details := 'Swaps that reached an approved completion, over swaps initiated. The shortfall splits into manager rejections, requester withdrawals and expiries, each pointing at a different fix.';
        v_recs := ARRAY['Find which stage the pipeline leaks at before acting', 'Expiries suggest nobody saw the request', 'Manager rejections suggest a compliance or cost block'];
        v_chart_type := 'bar';
$branches$;

    EXECUTE replace(v_def, v_anchor, v_branches || v_anchor);
END $mig$;
