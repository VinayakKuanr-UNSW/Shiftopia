-- =====================================================================
-- Episode-based Metrics Rewrite — rebase performance metrics onto
-- v_shift_assignment_episodes instead of current shifts-row heuristics.
-- =====================================================================
-- Function signatures and output columns are UNCHANGED so the UI
-- (usePerformanceMetrics / useQuarterlyReport) needs zero changes.
--
-- Key differences from the previous implementation:
-- 1. ALL metrics now source from the episode view (not shifts row)
-- 2. Late-cancel threshold unified to 4 hours (was 24h in metrics, 12h in trigger)
-- 3. Episodes with terminal_outcome='shift_deleted' are excluded
-- 4. Per-employee aggregation counts episodes, not shifts
-- 5. EMERGENCY_ASSIGNED is positive (not penalised in reliability)
-- 6. SWAPPED_OUT is neutral (excluded from reliability formula)
-- =====================================================================

-- ---------------------------------------------------------------------
-- compute_employee_quarter_metrics: fully episode-based
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_employee_quarter_metrics(p_employee_id uuid, p_quarter_year text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_start       date; v_end         date;
    v_year        int;  v_quarter     int;
    v_offered     int := 0; v_accepted int := 0; v_rejected int := 0; v_expired  int := 0;
    v_assigned    int := 0; v_emergency int := 0; v_worked   int := 0; v_swapped  int := 0;
    v_std_cancel  int := 0; v_late_cancel int := 0; v_no_show int := 0;
    v_late_in     int := 0; v_early_out int := 0;
    v_held        int := 0; -- episodes where the employee held/accepted the shift
BEGIN
    IF p_quarter_year = 'ALL_TIME' THEN
        v_start := '2000-01-01'; v_end := '2099-12-31';
    ELSE
        v_quarter := replace(split_part(p_quarter_year, '_', 1), 'Q', '')::int;
        v_year    := split_part(p_quarter_year, '_', 2)::int;
        SELECT qdr.v_start, qdr.v_end INTO v_start, v_end FROM quarter_date_range(v_year, v_quarter) qdr;
    END IF;

    -- All metrics from episodes (excluding deleted shifts)
    SELECT
        COUNT(*) FILTER (WHERE ep.had_offer),
        COUNT(*) FILTER (WHERE ep.had_accept),
        COUNT(*) FILTER (WHERE ep.terminal_outcome = 'rejected'),
        COUNT(*) FILTER (WHERE ep.terminal_outcome = 'ignored'),
        COUNT(*) FILTER (WHERE ep.had_assign AND NOT ep.had_emergency),
        COUNT(*) FILTER (WHERE ep.had_emergency),
        COUNT(*) FILTER (WHERE ep.terminal_outcome = 'fulfilled'),
        COUNT(*) FILTER (WHERE ep.terminal_outcome = 'swapped_out'),
        COUNT(*) FILTER (WHERE ep.terminal_outcome = 'cancelled_standard'),
        COUNT(*) FILTER (WHERE ep.terminal_outcome = 'cancelled_late'),
        COUNT(*) FILTER (WHERE ep.terminal_outcome = 'no_show'),
        COUNT(*) FILTER (WHERE ep.late_in AND ep.terminal_outcome = 'fulfilled'),
        COUNT(*) FILTER (WHERE ep.early_out AND ep.terminal_outcome = 'fulfilled'),
        -- held = episodes where the employee accepted/was assigned/emergency-assigned
        COUNT(*) FILTER (WHERE ep.had_accept OR ep.had_assign OR ep.had_emergency)
    INTO v_offered, v_accepted, v_rejected, v_expired,
         v_assigned, v_emergency, v_worked, v_swapped,
         v_std_cancel, v_late_cancel, v_no_show,
         v_late_in, v_early_out, v_held
    FROM v_shift_assignment_episodes ep
    WHERE ep.employee_id = p_employee_id
      AND ep.shift_date BETWEEN v_start AND v_end
      AND ep.terminal_outcome != 'shift_deleted';

    INSERT INTO employee_performance_metrics (
        employee_id, period_start, period_end, quarter_year,
        shifts_offered, shifts_accepted, shifts_rejected, offer_expirations,
        shifts_assigned, emergency_assignments, shifts_worked, shifts_swapped,
        standard_cancellations, late_cancellations, no_shows, late_clock_ins, early_clock_outs,
        acceptance_rate, rejection_rate, offer_expiration_rate,
        cancellation_rate_standard, cancellation_rate_late, swap_ratio, reliability_score,
        late_clock_in_rate, early_clock_out_rate, no_show_rate, calculated_at
    ) VALUES (
        p_employee_id, v_start, v_end, p_quarter_year,
        v_offered, v_accepted, v_rejected, v_expired,
        v_assigned, v_emergency, v_worked, v_swapped,
        v_std_cancel, v_late_cancel, v_no_show, v_late_in, v_early_out,
        -- Offer rates: denominator = offered episodes
        CASE WHEN v_offered=0 THEN 0 ELSE ROUND(v_accepted::numeric/v_offered*100,2) END,
        CASE WHEN v_offered=0 THEN 0 ELSE ROUND(v_rejected::numeric/v_offered*100,2) END,
        CASE WHEN v_offered=0 THEN 0 ELSE ROUND(v_expired::numeric /v_offered*100,2) END,
        -- Assignment rates: denominator = held episodes
        CASE WHEN v_held=0 THEN 0 ELSE ROUND(v_std_cancel::numeric /v_held*100,2) END,
        CASE WHEN v_held=0 THEN 0 ELSE ROUND(v_late_cancel::numeric/v_held*100,2) END,
        CASE WHEN v_held=0 THEN 0 ELSE ROUND(v_swapped::numeric   /v_held*100,2) END,
        -- Reliability score: same shape, episode-based denominators
        -- Emergency NOT penalised. Swap NOT in the formula.
        GREATEST(0,LEAST(100,ROUND(100
            - CASE WHEN v_held=0   THEN 0 ELSE (v_std_cancel+v_late_cancel)::numeric/v_held*30 END
            - CASE WHEN v_held=0   THEN 0 ELSE v_late_cancel::numeric/v_held*20 END
            - CASE WHEN v_held=0   THEN 0 ELSE v_no_show::numeric   /v_held*40 END
            - CASE WHEN v_worked=0 THEN 0 ELSE v_late_in::numeric   /v_worked  *5  END
            - CASE WHEN v_worked=0 THEN 0 ELSE v_early_out::numeric /v_worked  *5  END
        ,2))),
        -- Attendance rates: denominator = worked episodes
        CASE WHEN v_worked=0 THEN 0 ELSE ROUND(v_late_in::numeric   /v_worked  *100,2) END,
        CASE WHEN v_worked=0 THEN 0 ELSE ROUND(v_early_out::numeric /v_worked  *100,2) END,
        CASE WHEN v_held=0   THEN 0 ELSE ROUND(v_no_show::numeric   /v_held*100,2) END,
        now()
    ) ON CONFLICT (employee_id, quarter_year) DO UPDATE SET
        period_start=EXCLUDED.period_start, period_end=EXCLUDED.period_end,
        shifts_offered=EXCLUDED.shifts_offered, shifts_accepted=EXCLUDED.shifts_accepted,
        shifts_rejected=EXCLUDED.shifts_rejected, offer_expirations=EXCLUDED.offer_expirations,
        shifts_assigned=EXCLUDED.shifts_assigned, emergency_assignments=EXCLUDED.emergency_assignments,
        shifts_worked=EXCLUDED.shifts_worked, shifts_swapped=EXCLUDED.shifts_swapped,
        standard_cancellations=EXCLUDED.standard_cancellations, late_cancellations=EXCLUDED.late_cancellations, no_shows=EXCLUDED.no_shows,
        late_clock_ins=EXCLUDED.late_clock_ins, early_clock_outs=EXCLUDED.early_clock_outs,
        acceptance_rate=EXCLUDED.acceptance_rate, rejection_rate=EXCLUDED.rejection_rate,
        offer_expiration_rate=EXCLUDED.offer_expiration_rate, cancellation_rate_standard=EXCLUDED.cancellation_rate_standard,
        cancellation_rate_late=EXCLUDED.cancellation_rate_late, swap_ratio=EXCLUDED.swap_ratio, reliability_score=EXCLUDED.reliability_score,
        late_clock_in_rate=EXCLUDED.late_clock_in_rate, early_clock_out_rate=EXCLUDED.early_clock_out_rate,
        no_show_rate=EXCLUDED.no_show_rate, calculated_at=now()
    WHERE NOT employee_performance_metrics.is_locked;
END;
$function$;

-- ---------------------------------------------------------------------
-- get_quarterly_performance_report: fully episode-based
-- Signature and RETURNS TABLE columns are UNCHANGED.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_quarterly_performance_report(p_year integer, p_quarter integer, p_org_ids uuid[] DEFAULT NULL::uuid[], p_dept_ids uuid[] DEFAULT NULL::uuid[], p_subdept_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(employee_id uuid, employee_name text, total_offers integer, accepted integer, rejected integer, expired integer, assigned integer, emergency_assigned integer, cancel_standard integer, cancel_late integer, swap_out integer, late_clock_in integer, early_clock_out integer, no_show integer, completed integer, acceptance_rate numeric, rejection_rate numeric, ignorance_rate numeric, cancel_rate numeric, late_cancel_rate numeric, swap_rate numeric, reliability_score numeric, late_clock_in_rate numeric, early_clock_out_rate numeric, no_show_rate numeric, drop_rate numeric, total_bids integer, bids_accepted integer, bid_success_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_start date;
    v_end   date;
BEGIN
    SELECT qdr.v_start, qdr.v_end INTO v_start, v_end
    FROM quarter_date_range(p_year, p_quarter) qdr;

    RETURN QUERY
    WITH
    -- ── Episode-based aggregation ────────────────────────────────────────────
    episode_agg AS (
        SELECT
            ep.employee_id AS emp_id,
            -- Offer behaviour
            COUNT(*) FILTER (WHERE ep.had_offer)::int                           AS total_offers_sent,
            COUNT(*) FILTER (WHERE ep.had_accept)::int                          AS total_accepted,
            COUNT(*) FILTER (WHERE ep.terminal_outcome = 'rejected')::int       AS total_rejected,
            COUNT(*) FILTER (WHERE ep.terminal_outcome = 'ignored')::int        AS total_expired,
            -- Assignment
            COUNT(*) FILTER (WHERE ep.had_assign AND NOT ep.had_emergency)::int AS assigned_count,
            COUNT(*) FILTER (WHERE ep.had_emergency)::int                       AS emergency_count,
            -- Outcomes
            COUNT(*) FILTER (WHERE ep.terminal_outcome = 'fulfilled')::int      AS completed_count,
            COUNT(*) FILTER (WHERE ep.terminal_outcome = 'cancelled_standard')::int AS cancel_standard_count,
            COUNT(*) FILTER (WHERE ep.terminal_outcome = 'cancelled_late')::int AS cancel_late_count,
            COUNT(*) FILTER (WHERE ep.terminal_outcome = 'swapped_out')::int    AS swap_out_count,
            COUNT(*) FILTER (WHERE ep.terminal_outcome = 'no_show')::int        AS no_show_count,
            -- Attendance (only for worked episodes)
            COUNT(*) FILTER (WHERE ep.late_in AND ep.terminal_outcome = 'fulfilled')::int  AS late_clock_in_count,
            COUNT(*) FILTER (WHERE ep.early_out AND ep.terminal_outcome = 'fulfilled')::int AS early_clock_out_count,
            -- Denominators
            COUNT(*) FILTER (WHERE ep.had_accept OR ep.had_assign OR ep.had_emergency)::int AS held_count,
            -- Drop count: episodes that were accepted but then cancelled/no_show
            COUNT(*) FILTER (WHERE ep.had_accept AND ep.terminal_outcome IN ('cancelled_standard','cancelled_late','no_show','unassigned'))::int AS dropped_count
        FROM v_shift_assignment_episodes ep
        WHERE ep.shift_date BETWEEN v_start AND v_end
          AND ep.terminal_outcome != 'shift_deleted'
          AND (p_org_ids     IS NULL OR ep.organization_id    = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR ep.department_id      = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR ep.sub_department_id  = ANY(p_subdept_ids))
        GROUP BY ep.employee_id
    ),

    -- Bidding metrics stay sourced from shift_bids (unchanged).
    bid_agg AS (
        SELECT
            sb.employee_id AS emp_id,
            COUNT(*)::int                                       AS total_bids,
            COUNT(*) FILTER (WHERE sb.status = 'accepted')::int AS bids_accepted
        FROM shift_bids sb
        JOIN shifts s ON s.id = sb.shift_id
        WHERE s.shift_date BETWEEN v_start AND v_end
          AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids))
        GROUP BY sb.employee_id
    ),

    all_emps AS (
        SELECT emp_id FROM episode_agg
        UNION
        SELECT emp_id FROM bid_agg
    )

    SELECT
        ae.emp_id                                               AS employee_id,
        COALESCE(prof.full_name, ae.emp_id::text)               AS employee_name,
        COALESCE(ea.total_offers_sent,    0)::int              AS total_offers,
        COALESCE(ea.total_accepted,       0)::int              AS accepted,
        COALESCE(ea.total_rejected,       0)::int              AS rejected,
        COALESCE(ea.total_expired,        0)::int              AS expired,
        COALESCE(ea.assigned_count,       0)::int              AS assigned,
        COALESCE(ea.emergency_count,      0)::int              AS emergency_assigned,
        COALESCE(ea.cancel_standard_count,0)::int              AS cancel_standard,
        COALESCE(ea.cancel_late_count,    0)::int              AS cancel_late,
        COALESCE(ea.swap_out_count,       0)::int              AS swap_out,
        COALESCE(ea.late_clock_in_count,  0)::int              AS late_clock_in,
        COALESCE(ea.early_clock_out_count,0)::int              AS early_clock_out,
        COALESCE(ea.no_show_count,        0)::int              AS no_show,
        COALESCE(ea.completed_count,      0)::int              AS completed,

        -- Offer rates
        ROUND(CASE WHEN COALESCE(ea.total_offers_sent,0)=0 THEN 0
              ELSE ea.total_accepted::numeric/ea.total_offers_sent*100 END,2) AS acceptance_rate,
        ROUND(CASE WHEN COALESCE(ea.total_offers_sent,0)=0 THEN 0
              ELSE ea.total_rejected::numeric/ea.total_offers_sent*100 END,2) AS rejection_rate,
        ROUND(CASE WHEN COALESCE(ea.total_offers_sent,0)=0 THEN 0
              ELSE ea.total_expired::numeric/ea.total_offers_sent*100 END,2)  AS ignorance_rate,

        -- Assignment/cancellation rates — denominator = held_count (episode-based)
        ROUND(CASE WHEN COALESCE(ea.held_count,0)=0 THEN 0
              ELSE COALESCE(ea.cancel_standard_count,0)::numeric/ea.held_count*100 END,2) AS cancel_rate,
        ROUND(CASE WHEN COALESCE(ea.held_count,0)=0 THEN 0
              ELSE COALESCE(ea.cancel_late_count,0)::numeric/ea.held_count*100 END,2) AS late_cancel_rate,
        ROUND(CASE WHEN COALESCE(ea.held_count,0)=0 THEN 0
              ELSE COALESCE(ea.swap_out_count,0)::numeric/ea.held_count*100 END,2) AS swap_rate,

        -- Reliability: same formula shape, episode-based denominators
        -- Emergency NOT penalised. Swap NOT in formula.
        GREATEST(0,LEAST(100,ROUND(
            100
            -CASE WHEN COALESCE(ea.held_count,0)=0 THEN 0
                  ELSE (COALESCE(ea.cancel_standard_count,0)+COALESCE(ea.cancel_late_count,0))::numeric/ea.held_count*30 END
            -CASE WHEN COALESCE(ea.held_count,0)=0 THEN 0
                  ELSE COALESCE(ea.cancel_late_count,0)::numeric/ea.held_count*20 END
            -CASE WHEN COALESCE(ea.held_count,0)=0 THEN 0
                  ELSE COALESCE(ea.no_show_count,0)::numeric/ea.held_count*40 END
            -CASE WHEN COALESCE(ea.completed_count,0)=0 THEN 0
                  ELSE COALESCE(ea.late_clock_in_count,0)::numeric/ea.completed_count*5 END
            -CASE WHEN COALESCE(ea.completed_count,0)=0 THEN 0
                  ELSE COALESCE(ea.early_clock_out_count,0)::numeric/ea.completed_count*5 END
        ,2))) AS reliability_score,

        ROUND(CASE WHEN COALESCE(ea.completed_count,0)=0 THEN 0
              ELSE COALESCE(ea.late_clock_in_count,0)::numeric/ea.completed_count*100 END,2) AS late_clock_in_rate,
        ROUND(CASE WHEN COALESCE(ea.completed_count,0)=0 THEN 0
              ELSE COALESCE(ea.early_clock_out_count,0)::numeric/ea.completed_count*100 END,2) AS early_clock_out_rate,
        ROUND(CASE WHEN COALESCE(ea.held_count,0)=0 THEN 0
              ELSE COALESCE(ea.no_show_count,0)::numeric/ea.held_count*100 END,2) AS no_show_rate,
        ROUND(CASE WHEN COALESCE(ea.total_accepted,0)=0 THEN 0
              ELSE COALESCE(ea.dropped_count,0)::numeric/ea.total_accepted*100 END,2) AS drop_rate,

        COALESCE(ba.total_bids, 0)::int AS total_bids,
        COALESCE(ba.bids_accepted, 0)::int AS bids_accepted,
        ROUND(CASE WHEN COALESCE(ba.total_bids,0)=0 THEN 0
              ELSE ba.bids_accepted::numeric/ba.total_bids*100 END, 2) AS bid_success_rate
    FROM all_emps ae
    LEFT JOIN profiles      prof ON prof.id   = ae.emp_id
    LEFT JOIN episode_agg   ea   ON ea.emp_id = ae.emp_id
    LEFT JOIN bid_agg       ba   ON ba.emp_id = ae.emp_id
    ORDER BY employee_name;
END;
$function$;

-- ---------------------------------------------------------------------
-- refresh_all_performance_metrics: enrollment set includes everyone
-- with episode activity (via shift_events) — same logic as before.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_all_performance_metrics()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_qy text; v_emp record;
BEGIN
    v_qy := 'Q'||date_part('quarter',now())::int||'_'||date_part('year',now())::int;
    FOR v_emp IN
        SELECT DISTINCT id FROM (
            -- Include everyone with episode activity
            SELECT employee_id AS id FROM v_shift_assignment_episodes
            WHERE terminal_outcome != 'shift_deleted'
            UNION
            -- Fallback: also include anyone with raw events (covers edge cases)
            SELECT employee_id AS id FROM shift_events WHERE employee_id IS NOT NULL
        ) q
        WHERE id IS NOT NULL
    LOOP
        PERFORM compute_employee_quarter_metrics(v_emp.id, v_qy);
    END LOOP;
END;
$function$;
