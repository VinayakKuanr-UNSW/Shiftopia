-- =====================================================================
-- Performance Scorecard: Standard and Urgent Drop Rates
-- =====================================================================
-- Adds Standard Drop Rate (TTS > 24h) and Urgent Drop Rate (4h < TTS <= 24h)
-- to get_quarterly_performance_report.
-- =====================================================================

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
    bid_success_rate numeric,
    assignment_changes integer,
    trade_requests integer,
    trade_completion_rate numeric,
    trade_cancellation_rate numeric,
    attendance_compliance_rate numeric,
    performance_score numeric,
    engagement_score numeric,
    -- New drop rates additions
    standard_drop_rate numeric,
    urgent_drop_rate numeric
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
            COUNT(*)::int                                                             AS held_count,
            
            -- Assignment Changes: standard cancel, late cancel, no show, traded out, reassigned
            COUNT(*) FILTER (WHERE snap.end_reason IS NOT NULL AND snap.end_reason != 'worked')::int AS assignment_changes,
            -- Compliant count (for Attendance %): completed/worked AND neither late check-in nor early check-out
            COUNT(*) FILTER (WHERE snap.end_reason = 'worked' AND NOT snap.late_in AND NOT snap.early_out)::int AS compliant_count,
            
            -- Standard drops (TTS > 24 hours)
            COUNT(*) FILTER (WHERE snap.end_reason = 'dropped_std' AND (snap.scheduled_start - snap.ended_at) > interval '24 hours')::int AS standard_drop_count,
            -- Urgent drops (4 hours < TTS <= 24 hours)
            COUNT(*) FILTER (WHERE snap.end_reason = 'dropped_std' AND (snap.scheduled_start - snap.ended_at) <= interval '24 hours')::int AS urgent_drop_count
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

    -- Trading metrics (new CTE for swap_requests)
    trade_agg AS (
        SELECT
            sr.requested_by_employee_id AS emp_id,
            COUNT(*)::int AS trade_requests,
            COUNT(*) FILTER (WHERE sr.status = 'approved')::int AS trades_approved,
            COUNT(*) FILTER (WHERE sr.status = 'cancelled')::int AS trades_cancelled
        FROM swap_requests sr
        JOIN shifts s ON s.id = sr.original_shift_id
        WHERE s.shift_date BETWEEN v_start AND v_end
          AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids))
        GROUP BY sr.requested_by_employee_id
    ),

    all_emps AS (
        SELECT emp_id FROM offer_agg
        UNION
        SELECT emp_id FROM snap_agg
        UNION
        SELECT emp_id FROM bid_agg
        UNION
        SELECT emp_id FROM trade_agg
    ),

    raw_metrics AS (
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

            -- Assignment/cancellation rates
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.cancel_standard_count,0)::numeric/sa.held_count*100 END,2)::numeric AS cancel_rate,
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.cancel_late_count,0)::numeric/sa.held_count*100 END,2)::numeric AS late_cancel_rate,
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.swap_out_count,0)::numeric/sa.held_count*100 END,2)::numeric AS swap_rate,

            -- Reliability: same formula shape, snapshot-based denominators
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
                  ELSE COALESCE(sa.early_clock_out_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS early_clock_out_rate,
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.no_show_count,0)::numeric/sa.held_count*100 END,2)::numeric AS no_show_rate,
            ROUND(CASE WHEN COALESCE(oa.total_accepted,0)=0 THEN 0
                  ELSE COALESCE(oa.dropped_count,0)::numeric/oa.total_accepted*100 END,2)::numeric AS drop_rate,

            COALESCE(ba.total_bids, 0)::int AS total_bids,
            COALESCE(ba.bids_accepted, 0)::int AS bids_accepted,
            ROUND(CASE WHEN COALESCE(ba.total_bids,0)=0 THEN 0
                  ELSE ba.bids_accepted::numeric/ba.total_bids*100 END, 2)::numeric AS bid_success_rate,
            
            -- Restructured dashboard additions
            COALESCE(sa.assignment_changes, 0)::int AS assignment_changes,
            COALESCE(ta.trade_requests, 0)::int AS trade_requests,
            ROUND(CASE WHEN COALESCE(ta.trade_requests,0)=0 THEN 0 
                  ELSE ta.trades_approved::numeric/ta.trade_requests*100 END, 2)::numeric AS trade_completion_rate,
            ROUND(CASE WHEN COALESCE(ta.trade_requests,0)=0 THEN 0 
                  ELSE ta.trades_cancelled::numeric/ta.trade_requests*100 END, 2)::numeric AS trade_cancellation_rate,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0 
                  ELSE sa.compliant_count::numeric/sa.completed_count*100 END, 2)::numeric AS attendance_compliance_rate,
            
            -- Standard and Urgent Drop rates
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE sa.standard_drop_count::numeric/sa.held_count*100 END,2)::numeric AS standard_drop_rate,
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE sa.urgent_drop_count::numeric/sa.held_count*100 END,2)::numeric AS urgent_drop_rate
        FROM all_emps ae
        LEFT JOIN profiles      prof ON prof.id   = ae.emp_id
        LEFT JOIN offer_agg     oa   ON oa.emp_id = ae.emp_id
        LEFT JOIN snap_agg      sa   ON sa.emp_id = ae.emp_id
        LEFT JOIN bid_agg       ba   ON ba.emp_id = ae.emp_id
        LEFT JOIN trade_agg     ta   ON ta.emp_id = ae.emp_id
    )
    SELECT
        rm.employee_id,
        rm.employee_name,
        rm.total_offers,
        rm.accepted,
        rm.rejected,
        rm.expired,
        rm.assigned,
        rm.emergency_assigned,
        rm.cancel_standard,
        rm.cancel_late,
        rm.swap_out,
        rm.late_clock_in,
        rm.early_clock_out,
        rm.no_show,
        rm.completed,
        rm.acceptance_rate,
        rm.rejection_rate,
        rm.ignorance_rate,
        rm.cancel_rate,
        rm.late_cancel_rate,
        rm.swap_rate,
        rm.reliability_score,
        rm.late_clock_in_rate,
        rm.early_clock_out_rate,
        rm.no_show_rate,
        rm.drop_rate,
        rm.total_bids,
        rm.bids_accepted,
        rm.bid_success_rate,
        
        -- Additional restructured fields
        rm.assignment_changes,
        rm.trade_requests,
        rm.trade_completion_rate,
        rm.trade_cancellation_rate,
        rm.attendance_compliance_rate,
        -- performance_score: weighted sum of Reliability, Acceptance, Attendance, Bid Success
        ROUND(
            (rm.reliability_score * 0.35) + 
            (rm.acceptance_rate * 0.25) + 
            (rm.attendance_compliance_rate * 0.20) + 
            (rm.bid_success_rate * 0.20),
            2
        )::numeric AS performance_score,
        -- engagement_score: marketplace activity based on bids, trades, and direct offers
        GREATEST(0, LEAST(100, ROUND(
            (rm.total_bids * 8) + 
            (rm.trade_requests * 12) + 
            (rm.total_offers * 10),
            2
        )))::numeric AS engagement_score,
        
        -- Standard and Urgent Drop rates
        rm.standard_drop_rate,
        rm.urgent_drop_rate
    FROM raw_metrics rm
    ORDER BY employee_name;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_quarterly_performance_report(integer, integer, uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_quarterly_performance_report(integer, integer, uuid[], uuid[], uuid[]) TO authenticated, service_role;
