-- ============================================================
-- Performance & Insights RPC Functions
-- 2026-04-25
--
-- Powers:
--   PerformancePage    → get_quarterly_performance_report
--   WorkforceTab       → get_quarterly_performance_report (useQuarterlyReport)
--   OverviewTab        → get_insights_summary
--   Trend charts       → get_insights_trend
--   Dept breakdown     → get_dept_insights_breakdown
--   Per-employee view  → employee_performance_metrics table
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- TABLE: employee_performance_metrics
-- Pre-computed per-employee quarterly snapshots.
-- Read by usePerformanceMetrics() (employee profile page).
-- Written by compute_employee_quarter_metrics() only.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_performance_metrics (
    id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id                uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    period_start               date        NOT NULL,
    period_end                 date        NOT NULL,
    quarter_year               text        NOT NULL,  -- 'Q2_2026' | 'ALL_TIME'
    is_locked                  boolean     NOT NULL DEFAULT false,

    shifts_offered             int         NOT NULL DEFAULT 0,
    shifts_accepted            int         NOT NULL DEFAULT 0,
    shifts_rejected            int         NOT NULL DEFAULT 0,
    shifts_assigned            int         NOT NULL DEFAULT 0,
    emergency_assignments      int         NOT NULL DEFAULT 0,
    shifts_worked              int         NOT NULL DEFAULT 0,
    shifts_swapped             int         NOT NULL DEFAULT 0,
    standard_cancellations     int         NOT NULL DEFAULT 0,
    late_cancellations         int         NOT NULL DEFAULT 0,
    no_shows                   int         NOT NULL DEFAULT 0,
    offer_expirations          int         NOT NULL DEFAULT 0,
    early_clock_outs           int         NOT NULL DEFAULT 0,
    late_clock_ins             int         NOT NULL DEFAULT 0,

    -- Rates (0–100)
    acceptance_rate            numeric(5,2) NOT NULL DEFAULT 0,
    rejection_rate             numeric(5,2) NOT NULL DEFAULT 0,
    offer_expiration_rate      numeric(5,2) NOT NULL DEFAULT 0,
    cancellation_rate_standard numeric(5,2) NOT NULL DEFAULT 0,
    cancellation_rate_late     numeric(5,2) NOT NULL DEFAULT 0,
    swap_ratio                 numeric(5,2) NOT NULL DEFAULT 0,
    reliability_score          numeric(5,2) NOT NULL DEFAULT 100,
    late_clock_in_rate         numeric(5,2) NOT NULL DEFAULT 0,
    early_clock_out_rate       numeric(5,2) NOT NULL DEFAULT 0,
    no_show_rate               numeric(5,2) NOT NULL DEFAULT 0,

    calculated_at              timestamptz NOT NULL DEFAULT now(),

    UNIQUE (employee_id, quarter_year)
);

CREATE INDEX IF NOT EXISTS idx_epm_employee ON employee_performance_metrics (employee_id);
CREATE INDEX IF NOT EXISTS idx_epm_quarter  ON employee_performance_metrics (quarter_year);
CREATE INDEX IF NOT EXISTS idx_epm_period   ON employee_performance_metrics (period_start, period_end);

-- ──────────────────────────────────────────────────────────────
-- HELPER: quarter_date_range — maps Q2/2026 to Apr 1 / Jun 30
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quarter_date_range(
    p_year    int,
    p_quarter int,
    OUT v_start date,
    OUT v_end   date
)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    v_start := make_date(p_year, (p_quarter - 1) * 3 + 1, 1);
    v_end   := (v_start + interval '3 months' - interval '1 day')::date;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- RPC: get_quarterly_performance_report
--
-- Live computation — no cache dependency.
-- One row per employee who had any activity in the quarter.
-- All rates are 0–100 (1 decimal place).
--
-- Enum values used (verified against live schema):
--   lifecycle_status  : 'Draft' | 'Published' | 'InProgress' | 'Completed' | 'Cancelled'
--   attendance_status : 'unknown' | 'checked_in' | 'no_show' | 'late' | 'excused'
--   assignment_outcome: 'pending' | 'offered' | 'confirmed' | 'emergency_assigned' | 'no_show'
--   bid status (text) : 'pending' | 'accepted' | 'rejected' | 'withdrawn'
--   swap_request_status: 'OPEN'|'OFFER_SELECTED'|'MANAGER_PENDING'|'APPROVED'|'REJECTED'|'CANCELLED'|'EXPIRED'
--
-- Cancellation split:
--   Standard = cancelled with > 24h notice before shift start
--   Late     = cancelled with ≤ 24h notice before shift start
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_quarterly_performance_report(
    p_year        int,
    p_quarter     int,
    p_org_ids     uuid[] DEFAULT NULL,
    p_dept_ids    uuid[] DEFAULT NULL,
    p_subdept_ids uuid[] DEFAULT NULL
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
    drop_rate numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
    v_start date;
    v_end   date;
BEGIN
    SELECT qdr.v_start, qdr.v_end INTO v_start, v_end
    FROM quarter_date_range(p_year, p_quarter) qdr;

    RETURN QUERY
    WITH
    -- ── Activity CTEs ──────────────────────────────────────────────────────
    
    -- Potential assignments (Current + Dropped)
    assignment_events AS (
        -- (1) Current assignments
        SELECT
            s.assigned_employee_id          AS emp_id,
            s.id                            AS shift_id,
            s.lifecycle_status,
            s.attendance_status,
            s.assignment_outcome,
            s.assignment_source,            -- Added for differentiation
            s.is_cancelled,
            s.cancelled_at,
            s.scheduled_start,
            s.scheduled_end,
            COALESCE(t.clock_in, s.actual_start) AS clock_in_time,
            COALESCE(t.clock_out, s.actual_end)  AS clock_out_time,
            s.emergency_assigned_at,
            s.organization_id,
            s.department_id,
            s.sub_department_id,
            FALSE                           AS is_drop,
            NULL::timestamp                 AS dropped_at
        FROM shifts s
        LEFT JOIN timesheets t ON t.shift_id = s.id
        WHERE s.assigned_employee_id IS NOT NULL
          AND s.shift_date BETWEEN v_start AND v_end
          AND s.lifecycle_status != 'Draft'
          AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids))

        UNION ALL

        -- (2) Dropped shifts
        SELECT
            s.last_dropped_by               AS emp_id,
            s.id                            AS shift_id,
            s.lifecycle_status,
            s.attendance_status,
            s.assignment_outcome,
            s.assignment_source,            -- Added for differentiation
            s.is_cancelled,
            s.cancelled_at,
            s.scheduled_start,
            s.scheduled_end,
            NULL::timestamp                 AS clock_in_time,
            NULL::timestamp                 AS clock_out_time,
            s.emergency_assigned_at,
            s.organization_id,
            s.department_id,
            s.sub_department_id,
            TRUE                            AS is_drop,
            s.updated_at                    AS dropped_at
        FROM shifts s
        WHERE s.last_dropped_by IS NOT NULL
          AND s.shift_date BETWEEN v_start AND v_end
          AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids))
    ),

    -- Assignment + outcome aggregates
    asgn_agg AS (
        SELECT
            emp_id,
            COUNT(*)                                                                    AS total_assigned_shifts,
            -- Rostering: current active shifts that are NOT direct/emergency
            COUNT(*) FILTER (
                WHERE is_drop = FALSE 
                  AND is_cancelled = FALSE 
                  AND (assignment_source IS DISTINCT FROM 'direct' AND emergency_assigned_at IS NULL)
            )                                                                           AS current_assigned,
            -- Emergency: current active shifts that ARE direct/emergency
            COUNT(*) FILTER (
                WHERE is_drop = FALSE 
                  AND is_cancelled = FALSE 
                  AND (assignment_source = 'direct' OR emergency_assigned_at IS NOT NULL)
            )                                                                           AS emergency_count,
            COUNT(*) FILTER (WHERE is_drop = TRUE)                                      AS dropped_count,
            -- Standard Cancellation (> 24h)
            COUNT(*) FILTER (
                WHERE is_cancelled = true AND cancelled_at IS NOT NULL AND scheduled_start IS NOT NULL AND (scheduled_start - cancelled_at) > interval '24 hours'
            )                                                                           AS cancel_standard_count,
            -- Late Cancellation (<= 24h)
            COUNT(*) FILTER (
                WHERE is_cancelled = true AND cancelled_at IS NOT NULL AND scheduled_start IS NOT NULL AND (scheduled_start - cancelled_at) <= interval '24 hours'
            )                                                                           AS cancel_late_count,
            COUNT(*) FILTER (
                WHERE attendance_status = 'no_show' OR assignment_outcome = 'no_show'
            )                                                                           AS no_show_agg_count,
            COUNT(*) FILTER (WHERE lifecycle_status = 'Completed')                      AS completed_agg_count,
            -- STARTED SHIFTS (Denom for attendance metrics)
            COUNT(*) FILTER (WHERE lifecycle_status IN ('InProgress', 'Completed'))    AS started_agg_count,
            -- LATE CLOCK INS
            COUNT(*) FILTER (
                WHERE clock_in_time IS NOT NULL AND scheduled_start IS NOT NULL
                  AND clock_in_time > scheduled_start + interval '5 minutes'
            )                                                                           AS late_clock_in_count,
            -- EARLY CLOCK OUTS
            COUNT(*) FILTER (
                WHERE clock_out_time IS NOT NULL AND scheduled_end IS NOT NULL
                  AND clock_out_time < scheduled_end - interval '5 minutes'
            )                                                                           AS early_clock_out_count
        FROM assignment_events
        GROUP BY emp_id
    ),

    -- ── Bid / offer behavior ──────────────────────────────────────────────
    bid_agg AS (
        SELECT
            combined.emp_id,
            SUM(combined.s_offers_sent)::int AS total_offers_sent,
            SUM(combined.s_accepted)::int    AS total_accepted,
            SUM(combined.s_rejected)::int    AS total_rejected,
            SUM(combined.s_expired)::int     AS total_expired
        FROM (
            -- (a) Employee-initiated bids
            SELECT
                sb.employee_id                                               AS emp_id,
                COUNT(*)                                                     AS s_offers_sent,
                COUNT(*) FILTER (WHERE sb.status = 'accepted')              AS s_accepted,
                COUNT(*) FILTER (WHERE sb.status = 'rejected')              AS s_rejected,
                COUNT(*) FILTER (
                    WHERE sb.status IN ('pending','withdrawn')
                      AND (s.shift_date < CURRENT_DATE OR (s.shift_date + s.start_time) - interval '4 hours' < (now() AT TIME ZONE s.timezone))
                ) AS s_expired
            FROM shift_bids sb
            JOIN shifts s ON s.id = sb.shift_id
            WHERE s.shift_date BETWEEN v_start AND v_end
              AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
              AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
              AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids))
            GROUP BY sb.employee_id

            UNION ALL

            -- (b) Manager-sent offers explicitly rejected
            SELECT
                s.last_rejected_by  AS emp_id,
                COUNT(*)            AS s_offers_sent,
                0                   AS s_accepted,
                COUNT(*)            AS s_rejected,
                0                   AS s_expired
            FROM shifts s
            WHERE s.last_rejected_by IS NOT NULL
              AND s.shift_date BETWEEN v_start AND v_end
              AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
              AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
              AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids))
            GROUP BY s.last_rejected_by

            UNION ALL

            -- (c) Direct offers + Drops
            SELECT
                COALESCE(s.assigned_employee_id, s.last_dropped_by) AS emp_id,
                COUNT(*)               AS s_offers_sent,
                COUNT(*) FILTER (WHERE s.assignment_outcome = 'confirmed' OR s.last_dropped_by IS NOT NULL) AS s_accepted,
                0                      AS s_rejected,
                COUNT(*) FILTER (
                    WHERE s.assignment_outcome IS NULL AND s.last_dropped_by IS NULL
                      AND (s.shift_date < CURRENT_DATE OR (s.shift_date + s.start_time) - interval '4 hours' < (now() AT TIME ZONE s.timezone))
                ) AS s_expired
            FROM shifts s
            LEFT JOIN shift_bids sb ON sb.shift_id = s.id AND sb.employee_id = COALESCE(s.assigned_employee_id, s.last_dropped_by)
            WHERE (s.assigned_employee_id IS NOT NULL OR s.last_dropped_by IS NOT NULL)
              AND s.lifecycle_status != 'Draft'
              AND sb.id IS NULL
              AND s.shift_date BETWEEN v_start AND v_end
              AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
              AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
              AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids))
            GROUP BY COALESCE(s.assigned_employee_id, s.last_dropped_by)
        ) combined
        GROUP BY combined.emp_id
    ),

    -- Swaps initiated by employee
    swap_agg AS (
        SELECT
            ss.requester_id AS emp_id,
            COUNT(*)        AS total_swap_out
        FROM shift_swaps ss
        JOIN shifts s ON s.id = ss.requester_shift_id
        WHERE s.shift_date BETWEEN v_start AND v_end
          AND ss.status IN ('OPEN','OFFER_SELECTED','MANAGER_PENDING','APPROVED')
          AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
          AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
          AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids))
        GROUP BY ss.requester_id
    ),

    -- All employees
    all_emps AS (
        SELECT emp_id FROM asgn_agg
        UNION
        SELECT emp_id FROM bid_agg
        UNION
        SELECT emp_id FROM swap_agg
    )

    SELECT
        ae.emp_id                                               AS employee_id,
        COALESCE(prof.full_name, ae.emp_id::text)               AS employee_name,
        COALESCE(ba.total_offers_sent,    0)::int              AS total_offers,
        COALESCE(ba.total_accepted,       0)::int              AS accepted,
        COALESCE(ba.total_rejected,       0)::int              AS rejected,
        COALESCE(ba.total_expired,        0)::int              AS expired,
        COALESCE(aa.current_assigned,     0)::int              AS assigned,
        COALESCE(aa.emergency_count,0)::int                    AS emergency_assigned,
        COALESCE(aa.cancel_standard_count,0)::int              AS cancel_standard,
        COALESCE(aa.cancel_late_count,    0)::int              AS cancel_late,
        COALESCE(sa.total_swap_out,       0)::int              AS swap_out,
        COALESCE(aa.late_clock_in_count,  0)::int              AS late_clock_in,
        COALESCE(aa.early_clock_out_count,0)::int              AS early_clock_out,
        COALESCE(aa.no_show_agg_count,    0)::int              AS no_show,
        COALESCE(aa.completed_agg_count,  0)::int              AS completed,
        ROUND(CASE WHEN COALESCE(ba.total_offers_sent,0)=0 THEN 0
              ELSE ba.total_accepted::numeric/ba.total_offers_sent*100 END,1) AS acceptance_rate,
        ROUND(CASE WHEN COALESCE(ba.total_offers_sent,0)=0 THEN 0
              ELSE ba.total_rejected::numeric/ba.total_offers_sent*100 END,1) AS rejection_rate,
        ROUND(CASE WHEN COALESCE(ba.total_offers_sent,0)=0 THEN 0
              ELSE ba.total_expired::numeric/ba.total_offers_sent*100 END,1)  AS ignorance_rate,
        -- Refined Denominator: total_assigned_shifts (Current + Cancelled + Dropped)
        ROUND(CASE WHEN COALESCE(aa.total_assigned_shifts,0)=0 THEN 0
              ELSE COALESCE(aa.cancel_standard_count,0)::numeric/aa.total_assigned_shifts*100 END,1) AS cancel_rate,
        ROUND(CASE WHEN COALESCE(aa.total_assigned_shifts,0)=0 THEN 0
              ELSE COALESCE(aa.cancel_late_count,0)::numeric/aa.total_assigned_shifts*100 END,1) AS late_cancel_rate,
        ROUND(CASE WHEN COALESCE(aa.total_assigned_shifts,0)=0 THEN 0
              ELSE COALESCE(sa.total_swap_out,0)::numeric/aa.total_assigned_shifts*100 END,1) AS swap_rate,
        GREATEST(0,LEAST(100,ROUND(
            100
            -CASE WHEN COALESCE(aa.total_assigned_shifts,0)=0 THEN 0
                  ELSE (COALESCE(aa.cancel_standard_count,0)+COALESCE(aa.cancel_late_count,0))::numeric/aa.total_assigned_shifts*30 END
            -CASE WHEN COALESCE(aa.total_assigned_shifts,0)=0 THEN 0
                  ELSE COALESCE(aa.cancel_late_count,0)::numeric/aa.total_assigned_shifts*20 END
            -CASE WHEN COALESCE(aa.total_assigned_shifts,0)=0 THEN 0
                  ELSE COALESCE(aa.no_show_agg_count,0)::numeric/aa.total_assigned_shifts*40 END
            -CASE WHEN COALESCE(aa.started_agg_count,0)=0 THEN 0
                  ELSE COALESCE(aa.late_clock_in_count,0)::numeric/aa.started_agg_count*5 END
            -CASE WHEN COALESCE(aa.started_agg_count,0)=0 THEN 0
                  ELSE COALESCE(aa.early_clock_out_count,0)::numeric/aa.started_agg_count*5 END
        ,1))) AS reliability_score,
        ROUND(CASE WHEN COALESCE(aa.started_agg_count,0)=0 THEN 0
              ELSE COALESCE(aa.late_clock_in_count,0)::numeric/aa.started_agg_count*100 END,1) AS late_clock_in_rate,
        ROUND(CASE WHEN COALESCE(aa.started_agg_count,0)=0 THEN 0
              ELSE COALESCE(aa.early_clock_out_count,0)::numeric/aa.started_agg_count*100 END,1) AS early_clock_out_rate,
        ROUND(CASE WHEN COALESCE(aa.total_assigned_shifts,0)=0 THEN 0
              ELSE COALESCE(aa.no_show_agg_count,0)::numeric/aa.total_assigned_shifts*100 END,1) AS no_show_rate,
        -- New Drop Rate Metric: Dropped / Total initially accepted
        ROUND(CASE WHEN COALESCE(ba.total_accepted,0)=0 THEN 0
              ELSE COALESCE(aa.dropped_count,0)::numeric/ba.total_accepted*100 END,1) AS drop_rate
    FROM all_emps ae
    LEFT JOIN profiles      prof ON prof.id   = ae.emp_id
    LEFT JOIN bid_agg       ba   ON ba.emp_id = ae.emp_id
    LEFT JOIN asgn_agg      aa   ON aa.emp_id = ae.emp_id
    LEFT JOIN swap_agg      sa   ON sa.emp_id = ae.emp_id
    ORDER BY employee_name;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- RPC: get_insights_summary
-- Single JSON object of org-level KPIs for a date range.
-- Called by useInsightsSummary() — OverviewTab + WorkforceTab.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_insights_summary(
    p_start_date   date,
    p_end_date     date,
    p_org_ids      uuid[] DEFAULT NULL,
    p_dept_ids     uuid[] DEFAULT NULL,
    p_subdept_ids  uuid[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
    v_total       int; v_published   int; v_assigned    int;
    v_cancelled   int; v_completed   int; v_no_show     int;
    v_emergency   int; v_sched_hrs   numeric; v_cost      numeric;
    v_comp_over   int; v_avg_rel     numeric; v_avg_swap  numeric;
BEGIN
    SELECT
        COUNT(*)                                                             ,
        COUNT(*) FILTER (WHERE s.is_published = true)                       ,
        COUNT(*) FILTER (WHERE s.assignment_source = 'offer')               ,
        COUNT(*) FILTER (WHERE s.is_cancelled = true)                       ,
        COUNT(*) FILTER (WHERE s.lifecycle_status = 'Completed')            ,
        COUNT(*) FILTER (WHERE s.attendance_status = 'no_show'
                            OR s.assignment_outcome = 'no_show')            ,
        COUNT(*) FILTER (WHERE s.assignment_source = 'direct')              ,
        COALESCE(SUM(COALESCE(s.net_length_minutes,0)::numeric / 60)
            FILTER (WHERE s.assigned_employee_id IS NOT NULL), 0)           ,
        COALESCE(SUM(
            COALESCE(s.net_length_minutes,0)::numeric / 60
            * COALESCE(s.remuneration_rate, 0))
            FILTER (WHERE s.assigned_employee_id IS NOT NULL), 0)
    INTO
        v_total, v_published, v_assigned, v_cancelled,
        v_completed, v_no_show, v_emergency, v_sched_hrs, v_cost
    FROM shifts s
    WHERE s.shift_date BETWEEN p_start_date AND p_end_date
      AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
      AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
      AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids));

    -- compliance_override = true means a manager approved despite a compliance warning
    SELECT COUNT(*) FILTER (WHERE s.compliance_override = true)
    INTO v_comp_over
    FROM shifts s
    WHERE s.shift_date BETWEEN p_start_date AND p_end_date
      AND (p_org_ids     IS NULL OR s.organization_id    = ANY(p_org_ids))
      AND (p_dept_ids    IS NULL OR s.department_id      = ANY(p_dept_ids))
      AND (p_subdept_ids IS NULL OR s.sub_department_id  = ANY(p_subdept_ids));

    -- Pull avg reliability + swap rate from pre-computed snapshots when available
    SELECT
        COALESCE(ROUND(AVG(m.reliability_score), 1), 0),
        COALESCE(ROUND(AVG(m.swap_ratio), 1), 0)
    INTO v_avg_rel, v_avg_swap
    FROM employee_performance_metrics m
    WHERE m.period_start >= p_start_date AND m.period_end <= p_end_date;

    RETURN json_build_object(
        'shifts_total',          COALESCE(v_total, 0),
        'shifts_published',      COALESCE(v_published, 0),
        'shifts_assigned',       COALESCE(v_assigned, 0),
        'shifts_unassigned',     GREATEST(0, COALESCE(v_total,0) - COALESCE(v_assigned,0) - COALESCE(v_cancelled,0)),
        'shifts_cancelled',      COALESCE(v_cancelled, 0),
        'shifts_completed',      COALESCE(v_completed, 0),
        'shifts_no_show',        COALESCE(v_no_show, 0),
        'shifts_emergency',      COALESCE(v_emergency, 0),
        'scheduled_hours',       COALESCE(v_sched_hrs, 0),
        'estimated_cost',        COALESCE(v_cost, 0),
        'shift_fill_rate',       CASE WHEN COALESCE(v_total,0) = 0 THEN 0
                                      ELSE ROUND(v_assigned::numeric / v_total * 100, 1) END,
        'last_minute_changes',   COALESCE(v_emergency, 0),
        'compliance_failures',   0,
        'compliance_overrides',  COALESCE(v_comp_over, 0),
        'no_show_rate',          CASE WHEN COALESCE(v_assigned,0) = 0 THEN 0
                                      ELSE ROUND(v_no_show::numeric / v_assigned * 100, 1) END,
        'avg_reliability_score', v_avg_rel,
        'avg_swap_rate',         v_avg_swap
    );
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- RPC: get_insights_trend
-- One row per (day × department) for trend line charts.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_insights_trend(
    p_start_date  date,
    p_end_date    date,
    p_org_ids     uuid[] DEFAULT NULL,
    p_dept_ids    uuid[] DEFAULT NULL
)
RETURNS TABLE (
    period_date     date,
    dept_id         uuid,
    dept_name       text,
    shifts_total    int,
    shifts_assigned int,
    fill_rate       numeric,
    estimated_cost  numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.shift_date                                                                 AS period_date,
        s.department_id                                                              AS dept_id,
        d.name                                                                       AS dept_name,
        COUNT(*)::int                                                                AS shifts_total,
        COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL)::int             AS shifts_assigned,
        ROUND(CASE WHEN COUNT(*) = 0 THEN 0
              ELSE COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL)::numeric
                   / COUNT(*) * 100 END, 1)                                         AS fill_rate,
        COALESCE(SUM(
            COALESCE(s.net_length_minutes,0)::numeric / 60
            * COALESCE(s.remuneration_rate, 0))
            FILTER (WHERE s.assigned_employee_id IS NOT NULL), 0)                   AS estimated_cost
    FROM shifts s
    LEFT JOIN departments d ON d.id = s.department_id
    WHERE s.shift_date BETWEEN p_start_date AND p_end_date
      AND s.lifecycle_status != 'Draft'
      AND (p_org_ids  IS NULL OR s.organization_id = ANY(p_org_ids))
      AND (p_dept_ids IS NULL OR s.department_id   = ANY(p_dept_ids))
    GROUP BY s.shift_date, s.department_id, d.name
    ORDER BY s.shift_date, d.name;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- RPC: get_dept_insights_breakdown
-- Per-department aggregates for the breakdown table.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dept_insights_breakdown(
    p_start_date  date,
    p_end_date    date,
    p_org_ids     uuid[] DEFAULT NULL,
    p_dept_ids    uuid[] DEFAULT NULL
)
RETURNS TABLE (
    dept_id         uuid,
    dept_name       text,
    shifts_total    int,
    shifts_assigned int,
    fill_rate       numeric,
    estimated_cost  numeric,
    no_show_count   int,
    emergency_count int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.department_id                                                              AS dept_id,
        d.name                                                                       AS dept_name,
        COUNT(*)::int                                                                AS shifts_total,
        COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL)::int             AS shifts_assigned,
        ROUND(CASE WHEN COUNT(*) = 0 THEN 0
              ELSE COUNT(*) FILTER (WHERE s.assigned_employee_id IS NOT NULL)::numeric
                   / COUNT(*) * 100 END, 1)                                         AS fill_rate,
        COALESCE(SUM(
            COALESCE(s.net_length_minutes,0)::numeric / 60
            * COALESCE(s.remuneration_rate, 0))
            FILTER (WHERE s.assigned_employee_id IS NOT NULL), 0)                   AS estimated_cost,
        COUNT(*) FILTER (
            WHERE s.attendance_status = 'no_show'
               OR s.assignment_outcome = 'no_show'
        )::int                                                                       AS no_show_count,
        COUNT(*) FILTER (WHERE s.emergency_assigned_at IS NOT NULL)::int            AS emergency_count
    FROM shifts s
    LEFT JOIN departments d ON d.id = s.department_id
    WHERE s.shift_date BETWEEN p_start_date AND p_end_date
      AND s.lifecycle_status != 'Draft'
      AND (p_org_ids  IS NULL OR s.organization_id = ANY(p_org_ids))
      AND (p_dept_ids IS NULL OR s.department_id   = ANY(p_dept_ids))
    GROUP BY s.department_id, d.name
    ORDER BY d.name;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- FUNCTION: compute_employee_quarter_metrics
--
-- Upserts a snapshot into employee_performance_metrics for one
-- employee for one quarter. Respects is_locked (won't overwrite
-- locked historical periods).
--
-- Call from a pg_cron job or Edge Function.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_employee_quarter_metrics(
    p_employee_id  uuid,
    p_quarter_year text    -- 'Q2_2026' or 'ALL_TIME'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_start       date; v_end         date;
    v_year        int;  v_quarter     int;
    v_offered     int := 0; v_accepted int := 0; v_rejected int := 0; v_expired  int := 0;
    v_assigned    int := 0; v_emergency int := 0; v_worked   int := 0; v_swapped  int := 0;
    v_std_cancel  int := 0; v_late_cancel int := 0; v_no_show int := 0;
    v_late_in     int := 0; v_early_out int := 0;
BEGIN
    IF p_quarter_year = 'ALL_TIME' THEN
        v_start := '2000-01-01'; v_end := '2099-12-31';
    ELSE
        v_quarter := replace(split_part(p_quarter_year, '_', 1), 'Q', '')::int;
        v_year    := split_part(p_quarter_year, '_', 2)::int;
        SELECT qdr.v_start, qdr.v_end INTO v_start, v_end
        FROM quarter_date_range(v_year, v_quarter) qdr;
    END IF;

    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE status = 'accepted'),
           COUNT(*) FILTER (WHERE status = 'rejected'),
           COUNT(*) FILTER (WHERE status IN ('pending','withdrawn'))
    INTO v_offered, v_accepted, v_rejected, v_expired
    FROM shift_bids sb JOIN shifts s ON s.id = sb.shift_id
    WHERE sb.employee_id = p_employee_id AND s.shift_date BETWEEN v_start AND v_end;

    SELECT COUNT(*) FILTER (WHERE assignment_source = 'offer'),
           COUNT(*) FILTER (WHERE assignment_source = 'direct'),
           COUNT(*) FILTER (WHERE lifecycle_status = 'Completed'),
           COUNT(*) FILTER (WHERE is_cancelled AND cancelled_at IS NOT NULL AND scheduled_start IS NOT NULL
                              AND (scheduled_start - cancelled_at) > interval '24 hours'),
           COUNT(*) FILTER (WHERE is_cancelled AND cancelled_at IS NOT NULL AND scheduled_start IS NOT NULL
                              AND (scheduled_start - cancelled_at) <= interval '24 hours'),
           COUNT(*) FILTER (WHERE attendance_status = 'no_show' OR assignment_outcome = 'no_show')
    INTO v_assigned, v_emergency, v_worked, v_std_cancel, v_late_cancel, v_no_show
    FROM shifts WHERE assigned_employee_id = p_employee_id
      AND shift_date BETWEEN v_start AND v_end AND lifecycle_status != 'Draft';

    SELECT COUNT(*) INTO v_swapped
    FROM shift_swaps ss JOIN shifts s ON s.id = ss.requester_shift_id
    WHERE ss.requester_id = p_employee_id AND s.shift_date BETWEEN v_start AND v_end
      AND ss.status IN ('OPEN','OFFER_SELECTED','MANAGER_PENDING','APPROVED');

    SELECT COUNT(*) FILTER (WHERE t.clock_in  > s.scheduled_start + interval '5 minutes'),
           COUNT(*) FILTER (WHERE t.clock_out < s.scheduled_end   - interval '5 minutes')
    INTO v_late_in, v_early_out
    FROM timesheets t JOIN shifts s ON s.id = t.shift_id
    WHERE t.employee_id = p_employee_id AND s.shift_date BETWEEN v_start AND v_end
      AND t.clock_in IS NOT NULL AND t.clock_out IS NOT NULL;

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
        CASE WHEN v_offered=0 THEN 0 ELSE ROUND(v_accepted::numeric/v_offered*100,2) END,
        CASE WHEN v_offered=0 THEN 0 ELSE ROUND(v_rejected::numeric/v_offered*100,2) END,
        CASE WHEN v_offered=0 THEN 0 ELSE ROUND(v_expired::numeric /v_offered*100,2) END,
        CASE WHEN (v_assigned + v_emergency)=0 THEN 0 ELSE ROUND(v_std_cancel::numeric /(v_assigned + v_emergency)*100,2) END,
        CASE WHEN (v_assigned + v_emergency)=0 THEN 0 ELSE ROUND(v_late_cancel::numeric/(v_assigned + v_emergency)*100,2) END,
        CASE WHEN (v_assigned + v_emergency)=0 THEN 0 ELSE ROUND(v_swapped::numeric   /(v_assigned + v_emergency)*100,2) END,
        GREATEST(0,LEAST(100,ROUND(100
            - CASE WHEN (v_assigned + v_emergency)=0 THEN 0 ELSE (v_std_cancel+v_late_cancel)::numeric/(v_assigned + v_emergency)*30 END
            - CASE WHEN (v_assigned + v_emergency)=0 THEN 0 ELSE v_late_cancel::numeric/(v_assigned + v_emergency)*20 END
            - CASE WHEN (v_assigned + v_emergency)=0 THEN 0 ELSE v_no_show::numeric   /(v_assigned + v_emergency)*40 END
            - CASE WHEN v_worked=0   THEN 0 ELSE v_late_in::numeric   /v_worked  *5  END
            - CASE WHEN v_worked=0   THEN 0 ELSE v_early_out::numeric /v_worked  *5  END
        ,2))),
        CASE WHEN v_worked=0   THEN 0 ELSE ROUND(v_late_in::numeric   /v_worked  *100,2) END,
        CASE WHEN v_worked=0   THEN 0 ELSE ROUND(v_early_out::numeric /v_worked  *100,2) END,
        CASE WHEN (v_assigned + v_emergency)=0 THEN 0 ELSE ROUND(v_no_show::numeric   /(v_assigned + v_emergency)*100,2) END,
        now()
    )
    ON CONFLICT (employee_id, quarter_year) DO UPDATE SET
        period_start=EXCLUDED.period_start, period_end=EXCLUDED.period_end,
        shifts_offered=EXCLUDED.shifts_offered, shifts_accepted=EXCLUDED.shifts_accepted,
        shifts_rejected=EXCLUDED.shifts_rejected, offer_expirations=EXCLUDED.offer_expirations,
        shifts_assigned=EXCLUDED.shifts_assigned, emergency_assignments=EXCLUDED.emergency_assignments,
        shifts_worked=EXCLUDED.shifts_worked, shifts_swapped=EXCLUDED.shifts_swapped,
        standard_cancellations=EXCLUDED.standard_cancellations,
        late_cancellations=EXCLUDED.late_cancellations, no_shows=EXCLUDED.no_shows,
        late_clock_ins=EXCLUDED.late_clock_ins, early_clock_outs=EXCLUDED.early_clock_outs,
        acceptance_rate=EXCLUDED.acceptance_rate, rejection_rate=EXCLUDED.rejection_rate,
        offer_expiration_rate=EXCLUDED.offer_expiration_rate,
        cancellation_rate_standard=EXCLUDED.cancellation_rate_standard,
        cancellation_rate_late=EXCLUDED.cancellation_rate_late,
        swap_ratio=EXCLUDED.swap_ratio, reliability_score=EXCLUDED.reliability_score,
        late_clock_in_rate=EXCLUDED.late_clock_in_rate,
        early_clock_out_rate=EXCLUDED.early_clock_out_rate,
        no_show_rate=EXCLUDED.no_show_rate, calculated_at=now()
    WHERE NOT employee_performance_metrics.is_locked;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- FUNCTION: refresh_all_performance_metrics
-- Refreshes the current quarter for every active employee.
-- Schedule via pg_cron: '0 2 * * *' (nightly at 2am).
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_all_performance_metrics()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_qy  text;
    v_emp record;
BEGIN
    v_qy := 'Q' || date_part('quarter', now())::int || '_' || date_part('year', now())::int;
    FOR v_emp IN
        SELECT DISTINCT assigned_employee_id AS id
        FROM shifts
        WHERE assigned_employee_id IS NOT NULL AND lifecycle_status != 'Draft'
    LOOP
        PERFORM compute_employee_quarter_metrics(v_emp.id, v_qy);
    END LOOP;
END;
$$;

-- ── Grants ─────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_quarterly_performance_report(int,int,uuid[],uuid[],uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_insights_summary(date,date,uuid[],uuid[],uuid[])           TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_insights_trend(date,date,uuid[],uuid[])                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dept_insights_breakdown(date,date,uuid[],uuid[])           TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_employee_quarter_metrics(uuid,text)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_all_performance_metrics()                              TO authenticated;
GRANT SELECT ON employee_performance_metrics TO authenticated;
