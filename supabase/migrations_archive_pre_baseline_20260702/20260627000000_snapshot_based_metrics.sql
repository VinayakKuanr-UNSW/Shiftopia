-- =====================================================================
-- Performance Metrics & Scorecard: Snapshot-based Calculations
-- =====================================================================
-- Fixes Accept % exceeding 100% and Overall Score anomalies (e.g. 105%)
-- by aligning calculations with public.assignment_snapshots.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. compute_employee_quarter_metrics
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
    v_held        int := 0; -- total snapshots held
BEGIN
    IF p_quarter_year = 'ALL_TIME' THEN
        v_start := '2000-01-01'; v_end := '2099-12-31';
    ELSE
        v_quarter := replace(split_part(p_quarter_year, '_', 1), 'Q', '')::int;
        v_year    := split_part(p_quarter_year, '_', 2)::int;
        SELECT qdr.v_start, qdr.v_end INTO v_start, v_end FROM quarter_date_range(v_year, v_quarter) qdr;
    END IF;

    -- 1. Offer behavior metrics from episodes view (gated on had_offer to ensure rates are sound)
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE ep.had_accept),
        COUNT(*) FILTER (WHERE ep.terminal_outcome = 'rejected'),
        COUNT(*) FILTER (WHERE ep.terminal_outcome = 'ignored')
    INTO v_offered, v_accepted, v_rejected, v_expired
    FROM v_shift_assignment_episodes ep
    WHERE ep.employee_id = p_employee_id
      AND ep.shift_date BETWEEN v_start AND v_end
      AND ep.terminal_outcome != 'shift_deleted'
      AND ep.had_offer;

    -- 2. Assignment, reliability, and attendance metrics from assignment_snapshots
    SELECT
        COUNT(*) FILTER (WHERE snap.source != 'emergency'),
        COUNT(*) FILTER (WHERE snap.source = 'emergency'),
        COUNT(*) FILTER (WHERE snap.end_reason = 'worked'),
        COUNT(*) FILTER (WHERE snap.end_reason = 'traded_out'),
        COUNT(*) FILTER (WHERE snap.end_reason = 'dropped_std'),
        COUNT(*) FILTER (WHERE snap.end_reason = 'dropped_late'),
        COUNT(*) FILTER (WHERE snap.end_reason = 'no_show'),
        COUNT(*) FILTER (WHERE snap.late_in AND snap.end_reason = 'worked'),
        COUNT(*) FILTER (WHERE snap.early_out AND snap.end_reason = 'worked'),
        COUNT(*)
    INTO v_assigned, v_emergency, v_worked, v_swapped,
         v_std_cancel, v_late_cancel, v_no_show,
         v_late_in, v_early_out, v_held
    FROM assignment_snapshots snap
    WHERE snap.employee_id = p_employee_id
      AND snap.shift_date BETWEEN v_start AND v_end;

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
        -- Assignment rates: denominator = held snapshots
        CASE WHEN v_held=0 THEN 0 ELSE ROUND(v_std_cancel::numeric /v_held*100,2) END,
        CASE WHEN v_held=0 THEN 0 ELSE ROUND(v_late_cancel::numeric/v_held*100,2) END,
        CASE WHEN v_held=0 THEN 0 ELSE ROUND(v_swapped::numeric   /v_held*100,2) END,
        -- Reliability score: same shape, snapshot-based denominators
        GREATEST(0,LEAST(100,ROUND(100
            - CASE WHEN v_held=0   THEN 0 ELSE (v_std_cancel+v_late_cancel)::numeric/v_held*30 END
            - CASE WHEN v_held=0   THEN 0 ELSE v_late_cancel::numeric/v_held*20 END
            - CASE WHEN v_held=0   THEN 0 ELSE v_no_show::numeric   /v_held*40 END
            - CASE WHEN v_worked=0 THEN 0 ELSE v_late_in::numeric   /v_worked  *5  END
            - CASE WHEN v_worked=0 THEN 0 ELSE v_early_out::numeric /v_worked  *5  END
        ,2))),
        -- Attendance rates: denominator = worked snapshots
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
-- 2. get_quarterly_performance_report
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_quarterly_performance_report(integer, integer, uuid[], uuid[], uuid[]);

CREATE OR REPLACE FUNCTION public.get_quarterly_performance_report(
    p_year integer,
    p_quarter integer,
    p_org_ids uuid[] DEFAULT NULL::uuid[],
    p_dept_ids uuid[] DEFAULT NULL::uuid[],
    p_subdept_ids uuid[] DEFAULT NULL::uuid[]
)
 RETURNS TABLE(
    employee_id uuid,
    employee_name text,
    total_offers integer,
    accepted integer,
    rejected integer,
    expired integer,
    assigned integer,
    emergency_assigned integer,
    cancel_standard integer,
    cancel_late integer,
    swap_out integer,
    late_clock_in integer,
    early_clock_out integer,
    no_show integer,
    completed integer,
    acceptance_rate numeric,
    rejection_rate numeric,
    ignorance_rate numeric,
    cancel_rate numeric,
    late_cancel_rate numeric,
    swap_rate numeric,
    reliability_score numeric,
    late_clock_in_rate numeric,
    early_clock_out_rate numeric,
    no_show_rate numeric,
    drop_rate numeric,
    total_bids integer,
    bids_accepted integer,
    bid_success_rate numeric
)
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
    -- ── Offer behaviour from episodes view ───────────────────────────────────
    offer_agg AS (
        SELECT
            ep.employee_id AS emp_id,
            COUNT(*) FILTER (WHERE ep.had_offer)::int                           AS total_offers_sent,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.had_accept)::int          AS total_accepted,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.terminal_outcome = 'rejected')::int AS total_rejected,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.terminal_outcome = 'ignored')::int  AS total_expired,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.had_accept AND ep.terminal_outcome IN ('cancelled_standard','cancelled_late','no_show','unassigned'))::int AS dropped_count
        FROM v_shift_assignment_episodes ep
        WHERE ep.shift_date BETWEEN v_start AND v_end
          AND ep.terminal_outcome != 'shift_deleted'
          AND (p_org_ids     IS NULL OR ep.organization_id    = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR ep.department_id      = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR ep.sub_department_id  = ANY(p_subdept_ids))
        GROUP BY ep.employee_id
    ),

    -- ── Assignment, Reliability, Attendance from assignment_snapshots ────────
    snap_agg AS (
        SELECT
            snap.employee_id AS emp_id,
            COUNT(*) FILTER (WHERE snap.source != 'emergency')::int                  AS assigned_count,
            COUNT(*) FILTER (WHERE snap.source = 'emergency')::int                    AS emergency_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'worked')::int                   AS completed_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'dropped_std')::int              AS cancel_standard_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'dropped_late')::int             AS cancel_late_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'traded_out')::int               AS swap_out_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'no_show')::int                  AS no_show_count,
            COUNT(*) FILTER (WHERE snap.late_in AND snap.end_reason = 'worked')::int  AS late_clock_in_count,
            COUNT(*) FILTER (WHERE snap.early_out AND snap.end_reason = 'worked')::int AS early_clock_out_count,
            COUNT(*)::int                                                             AS held_count
        FROM assignment_snapshots snap
        WHERE snap.shift_date BETWEEN v_start AND v_end
          AND (p_org_ids     IS NULL OR snap.organization_id    = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR snap.department_id      = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR snap.sub_department_id  = ANY(p_subdept_ids))
        GROUP BY snap.employee_id
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
        SELECT emp_id FROM offer_agg
        UNION
        SELECT emp_id FROM snap_agg
        UNION
        SELECT emp_id FROM bid_agg
    )

    SELECT
        ae.emp_id                                               AS employee_id,
        COALESCE(prof.full_name, ae.emp_id::text)::text        AS employee_name,
        COALESCE(oa.total_offers_sent,    0)::int              AS total_offers,
        COALESCE(oa.total_accepted,       0)::int              AS accepted,
        COALESCE(oa.total_rejected,       0)::int              AS rejected,
        COALESCE(oa.total_expired,        0)::int              AS expired,
        COALESCE(sa.assigned_count,       0)::int              AS assigned,
        COALESCE(sa.emergency_count,      0)::int              AS emergency_assigned,
        COALESCE(sa.cancel_standard_count,0)::int              AS cancel_standard,
        COALESCE(sa.cancel_late_count,    0)::int              AS cancel_late,
        COALESCE(sa.swap_out_count,       0)::int              AS swap_out,
        COALESCE(sa.late_clock_in_count,  0)::int              AS late_clock_in,
        COALESCE(sa.early_clock_out_count,0)::int              AS early_clock_out,
        COALESCE(sa.no_show_count,        0)::int              AS no_show,
        COALESCE(sa.completed_count,      0)::int              AS completed,

        -- Offer rates
        ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
              ELSE oa.total_accepted::numeric/oa.total_offers_sent*100 END,2)::numeric AS acceptance_rate,
        ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
              ELSE oa.total_rejected::numeric/oa.total_offers_sent*100 END,2)::numeric AS rejection_rate,
        ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
              ELSE oa.total_expired::numeric/oa.total_offers_sent*100 END,2)::numeric  AS ignorance_rate,

        -- Assignment/cancellation rates — denominator = held_count (snapshot-based)
        ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
              ELSE COALESCE(sa.cancel_standard_count,0)::numeric/sa.held_count*100 END,2)::numeric AS cancel_rate,
        ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
              ELSE COALESCE(sa.cancel_late_count,0)::numeric/sa.held_count*100 END,2)::numeric AS late_cancel_rate,
        ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
              ELSE COALESCE(sa.swap_out_count,0)::numeric/sa.held_count*100 END,2)::numeric AS swap_rate,

        -- Reliability: same formula shape, snapshot-based denominators
        -- Emergency NOT penalised. Swap NOT in formula.
        GREATEST(0,LEAST(100,ROUND(
            100
            -CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE (COALESCE(sa.cancel_standard_count,0)+COALESCE(sa.cancel_late_count,0))::numeric/sa.held_count*30 END
            -CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.cancel_late_count,0)::numeric/sa.held_count*20 END
            -CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.no_show_count,0)::numeric/sa.held_count*40 END
            -CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.late_clock_in_count,0)::numeric/sa.completed_count*5 END
            -CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.early_clock_out_count,0)::numeric/sa.completed_count*5 END
        ,2)))::numeric AS reliability_score,

        ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
              ELSE COALESCE(sa.late_clock_in_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS late_clock_in_rate,
        ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
              ELSE COALESCE(sa.early_out_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS early_clock_out_rate,
        ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
              ELSE COALESCE(sa.no_show_count,0)::numeric/sa.held_count*100 END,2)::numeric AS no_show_rate,
        ROUND(CASE WHEN COALESCE(oa.total_accepted,0)=0 THEN 0
              ELSE COALESCE(oa.dropped_count,0)::numeric/oa.total_accepted*100 END,2)::numeric AS drop_rate,

        COALESCE(ba.total_bids, 0)::int AS total_bids,
        COALESCE(ba.bids_accepted, 0)::int AS bids_accepted,
        ROUND(CASE WHEN COALESCE(ba.total_bids,0)=0 THEN 0
              ELSE ba.bids_accepted::numeric/ba.total_bids*100 END, 2)::numeric AS bid_success_rate
    FROM all_emps ae
    LEFT JOIN profiles      prof ON prof.id   = ae.emp_id
    LEFT JOIN offer_agg     oa   ON oa.emp_id = ae.emp_id
    LEFT JOIN snap_agg      sa   ON sa.emp_id = ae.emp_id
    LEFT JOIN bid_agg       ba   ON ba.emp_id = ae.emp_id
    ORDER BY employee_name;
END;
$function$;

-- ---------------------------------------------------------------------
-- 3. Security Hardening: Revoke anon execute permissions
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.compute_employee_quarter_metrics(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compute_employee_quarter_metrics(uuid, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_quarterly_performance_report(integer, integer, uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_quarterly_performance_report(integer, integer, uuid[], uuid[], uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Recalculate metrics for current quarter
-- ---------------------------------------------------------------------
SELECT public.refresh_all_performance_metrics();
