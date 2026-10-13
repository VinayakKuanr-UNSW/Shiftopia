-- ============================================================================
-- get_employee_quarterly_performance() — live per-employee performance read
-- ============================================================================
-- Found by audit: the Employee Profile "Performance" section
-- (PerformanceSection.tsx) read employee_performance_metrics, a snapshot
-- table only updated when someone clicks that employee's own "Refresh"
-- button. The Insights "Team Performance" report, for the same
-- employee/quarter, always computes live from assignment_snapshots /
-- v_shift_assignment_episodes / shift_bids. The two pages could — and
-- would, the moment any event happened after the last manual refresh —
-- disagree on the same Reliability Score.
--
-- Fix: this function runs the same live aggregation as
-- get_quarterly_performance_report(), scoped to a single employee instead
-- of an org/dept/subdept tree, so both surfaces are always in sync. Its
-- authorization mirrors the existing perf_metrics_self_or_manager_read RLS
-- policy on employee_performance_metrics (self, or any manager) — that
-- table still exists and keeps its own quarter-lock mechanism for whatever
-- other purpose it serves; this function does not read or write it.
-- ============================================================================

CREATE OR REPLACE FUNCTION "public"."get_employee_quarterly_performance"(
    "p_employee_id" "uuid",
    "p_year" integer,
    "p_quarter" integer
) RETURNS TABLE(
    "employee_id" "uuid",
    "total_offers" integer,
    "accepted" integer,
    "rejected" integer,
    "expired" integer,
    "assigned" integer,
    "emergency_assigned" integer,
    "completed" integer,
    "no_show" integer,
    "swap_out" integer,
    "acceptance_rate" numeric,
    "rejection_rate" numeric,
    "ignorance_rate" numeric,
    "cancel_rate" numeric,
    "late_cancel_rate" numeric,
    "no_show_rate" numeric,
    "swap_rate" numeric,
    "reliability_score" numeric,
    "late_clock_in_rate" numeric,
    "early_clock_out_rate" numeric,
    "attendance_compliance_rate" numeric,
    "total_bids" integer,
    "bids_accepted" integer,
    "bid_success_rate" numeric,
    "trade_requests" integer,
    "performance_score" numeric,
    "engagement_score" numeric,
    "calculated_at" timestamptz
)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
    v_start date;
    v_end   date;
BEGIN
    IF NOT (p_employee_id = auth.uid() OR public.is_manager_or_above()) THEN
        RAISE EXCEPTION 'insufficient_privilege: may only view your own performance, or requires managerial access';
    END IF;

    SELECT qdr.v_start, qdr.v_end INTO v_start, v_end
    FROM quarter_date_range(p_year, p_quarter) qdr;

    RETURN QUERY
    WITH
    offer_agg AS (
        SELECT
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.terminal_outcome <> 'unassigned')::int                  AS total_offers_sent,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.had_accept AND ep.terminal_outcome <> 'unassigned')::int AS total_accepted,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.terminal_outcome = 'rejected')::int                     AS total_rejected,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.terminal_outcome = 'ignored')::int                      AS total_expired
        FROM v_shift_assignment_episodes ep
        WHERE ep.employee_id = p_employee_id
          AND ep.shift_date BETWEEN v_start AND v_end
          AND ep.terminal_outcome != 'shift_deleted'
    ),
    snap_agg AS (
        SELECT
            COUNT(*) FILTER (WHERE snap.source != 'emergency')::int                   AS assigned_count,
            COUNT(*) FILTER (WHERE snap.source = 'emergency')::int                    AS emergency_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'worked')::int                   AS completed_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'dropped_std')::int              AS cancel_standard_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'dropped_late')::int             AS cancel_late_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'traded_out')::int               AS swap_out_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'no_show')::int                  AS no_show_count,
            COUNT(*) FILTER (WHERE snap.late_in AND snap.end_reason = 'worked')::int  AS late_clock_in_count,
            COUNT(*) FILTER (WHERE snap.early_out AND snap.end_reason = 'worked')::int AS early_clock_out_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'worked' AND NOT snap.late_in AND NOT snap.early_out)::int AS compliant_count,
            COUNT(*)::int                                                             AS held_count
        FROM assignment_snapshots snap
        WHERE snap.employee_id = p_employee_id
          AND snap.shift_date BETWEEN v_start AND v_end
    ),
    bid_agg AS (
        SELECT
            COUNT(*)::int                                       AS total_bids,
            COUNT(*) FILTER (WHERE sb.status = 'accepted')::int AS bids_accepted
        FROM shift_bids sb
        JOIN shifts s ON s.id = sb.shift_id
        WHERE sb.employee_id = p_employee_id
          AND s.shift_date BETWEEN v_start AND v_end
    ),
    trade_agg AS (
        SELECT COUNT(*)::int AS trade_requests
        FROM swap_requests sr
        JOIN shifts s ON s.id = sr.original_shift_id
        WHERE sr.requested_by_employee_id = p_employee_id
          AND s.shift_date BETWEEN v_start AND v_end
    ),
    raw_metrics AS (
        SELECT
            COALESCE(oa.total_offers_sent, 0)::int AS total_offers,
            COALESCE(oa.total_accepted,    0)::int AS accepted,
            COALESCE(oa.total_rejected,    0)::int AS rejected,
            COALESCE(oa.total_expired,     0)::int AS expired,
            COALESCE(sa.assigned_count,    0)::int AS assigned,
            COALESCE(sa.emergency_count,   0)::int AS emergency_assigned,
            COALESCE(sa.completed_count,   0)::int AS completed,
            COALESCE(sa.no_show_count,     0)::int AS no_show,
            COALESCE(sa.swap_out_count,    0)::int AS swap_out,

            ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
                  ELSE oa.total_accepted::numeric/oa.total_offers_sent*100 END,2)::numeric AS acceptance_rate,
            ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
                  ELSE oa.total_rejected::numeric/oa.total_offers_sent*100 END,2)::numeric AS rejection_rate,
            ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
                  ELSE oa.total_expired::numeric/oa.total_offers_sent*100 END,2)::numeric  AS ignorance_rate,

            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.cancel_standard_count,0)::numeric/sa.held_count*100 END,2)::numeric AS cancel_rate,
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.cancel_late_count,0)::numeric/sa.held_count*100 END,2)::numeric AS late_cancel_rate,
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.no_show_count,0)::numeric/sa.held_count*100 END,2)::numeric AS no_show_rate,
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.swap_out_count,0)::numeric/sa.held_count*100 END,2)::numeric AS swap_rate,

            GREATEST(0,LEAST(100,ROUND(
                100
                -CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                      ELSE (COALESCE(sa.cancel_standard_count,0)+COALESCE(sa.cancel_late_count,0))::numeric/sa.held_count*30 END
                -CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                      ELSE COALESCE(sa.cancel_late_count,0)::numeric/sa.held_count*20 END
                -CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0 ELSE COALESCE(sa.no_show_count,0)::numeric/sa.held_count*40 END
                -CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                      ELSE COALESCE(sa.late_clock_in_count,0)::numeric/sa.completed_count*5 END
                -CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                      ELSE COALESCE(sa.early_clock_out_count,0)::numeric/sa.completed_count*5 END
            ,2)))::numeric AS reliability_score,

            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.late_clock_in_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS late_clock_in_rate,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.early_clock_out_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS early_clock_out_rate,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE sa.compliant_count::numeric/sa.completed_count*100 END, 2)::numeric AS attendance_compliance_rate,

            COALESCE(ba.total_bids, 0)::int AS total_bids,
            COALESCE(ba.bids_accepted, 0)::int AS bids_accepted,
            ROUND(CASE WHEN COALESCE(ba.total_bids,0)=0 THEN 0
                  ELSE ba.bids_accepted::numeric/ba.total_bids*100 END, 2)::numeric AS bid_success_rate,

            COALESCE(ta.trade_requests, 0)::int AS trade_requests
        FROM offer_agg oa, snap_agg sa, bid_agg ba, trade_agg ta
    )
    SELECT
        p_employee_id,
        rm.total_offers,
        rm.accepted,
        rm.rejected,
        rm.expired,
        rm.assigned,
        rm.emergency_assigned,
        rm.completed,
        rm.no_show,
        rm.swap_out,
        rm.acceptance_rate,
        rm.rejection_rate,
        rm.ignorance_rate,
        rm.cancel_rate,
        rm.late_cancel_rate,
        rm.no_show_rate,
        rm.swap_rate,
        rm.reliability_score,
        rm.late_clock_in_rate,
        rm.early_clock_out_rate,
        rm.attendance_compliance_rate,
        rm.total_bids,
        rm.bids_accepted,
        rm.bid_success_rate,
        rm.trade_requests,
        -- Same weighting as get_quarterly_performance_report(): keep these two in sync.
        ROUND(
            (rm.reliability_score * 0.35) +
            (rm.acceptance_rate * 0.25) +
            (rm.attendance_compliance_rate * 0.20) +
            (rm.bid_success_rate * 0.20),
            2
        )::numeric AS performance_score,
        GREATEST(0, LEAST(100, ROUND(
            (rm.total_bids + rm.trade_requests * 1.5 + rm.total_offers * 1.25)
            / GREATEST(rm.completed, 1)
            * 30,
            2
        )))::numeric AS engagement_score,
        now() AS calculated_at
    FROM raw_metrics rm;
END;
$$;

ALTER FUNCTION "public"."get_employee_quarterly_performance"("uuid", integer, integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_employee_quarterly_performance"("uuid", integer, integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_employee_quarterly_performance"("uuid", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_employee_quarterly_performance"("uuid", integer, integer) TO "service_role";
