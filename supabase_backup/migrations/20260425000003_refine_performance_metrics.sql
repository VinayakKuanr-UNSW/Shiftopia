-- Update get_quarterly_performance_report to differentiate between Rostering and Emergency
-- and update sm_emergency_assign to set assignment_source = 'direct'.

-- 1. Update sm_emergency_assign (Overload 1)
CREATE OR REPLACE FUNCTION public.sm_emergency_assign(
    p_shift_id uuid, 
    p_employee_id uuid, 
    p_reason text DEFAULT 'Emergency assignment'::text, 
    p_user_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE v_shift RECORD; v_state text; v_tts int; v_name text; v_role text;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); END IF;
  
  SELECT COALESCE(first_name||' '||COALESCE(last_name,''), email), COALESCE(left(lower(legacy_system_role::text),50),'manager')
    INTO v_name, v_role FROM public.profiles WHERE id = p_user_id;
  v_name := COALESCE(v_name, 'System'); v_role := COALESCE(v_role, 'system');
  
  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);
  
  IF v_state NOT IN ('S4', 'S5') THEN 
    RETURN jsonb_build_object('success', false, 'error', format('sm_emergency_assign requires state S4 or S5, current state is %s', v_state)); 
  END IF;
  
  v_tts := EXTRACT(EPOCH FROM (v_shift.scheduled_start - NOW()))::int;
  
  UPDATE public.shifts SET
    assigned_employee_id = p_employee_id, 
    assigned_at = NOW(),
    assignment_status = 'assigned'::public.shift_assignment_status, 
    assignment_outcome = 'confirmed'::public.shift_assignment_outcome,
    assignment_source = 'direct', -- Set source to direct
    emergency_source = public.set_emergency_source('EMERGENCY_ASSIGN', v_tts, v_shift.emergency_source),
    bidding_status = 'not_on_bidding'::public.shift_bidding_status, 
    is_on_bidding = FALSE,
    fulfillment_status = 'scheduled'::public.shift_fulfillment_status, 
    confirmed_at = NOW(),
    compliance_checked_at = NOW(), 
    last_modified_by = p_user_id, 
    updated_at = NOW()
  WHERE id = p_shift_id;
  
  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S4', 'assigned_to', p_employee_id);
END; $function$;

-- 2. Update sm_emergency_assign (Overload 2)
CREATE OR REPLACE FUNCTION public.sm_emergency_assign(
    p_shift_id uuid, 
    p_employee_id uuid, 
    p_user_id uuid DEFAULT auth.uid(), 
    p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE 
    v_shift RECORD; 
    v_state TEXT; 
    v_compliance RECORD;
BEGIN
    SELECT * INTO v_shift FROM shifts WHERE id=p_shift_id AND deleted_at IS NULL FOR UPDATE;
    v_state := get_shift_state_id(p_shift_id);
    
    IF v_state NOT IN ('S5', 'S6', 'S8', 'S15') THEN 
        RETURN jsonb_build_object('success', false, 'error', format('Cannot from %s', v_state)); 
    END IF;
    
    SELECT * INTO v_compliance FROM check_shift_compliance(v_shift.roster_shift_id, p_employee_id);
    
    IF v_compliance.compliance_status = 'blocked' THEN 
        RETURN jsonb_build_object('success', false, 'error', 'Compliance blocked'); 
    END IF;
    
    UPDATE shifts 
    SET lifecycle_status='Published', 
        is_published=TRUE, 
        is_cancelled=FALSE,
        assigned_employee_id=p_employee_id, 
        assigned_at=NOW(), 
        assignment_status='assigned',
        assignment_outcome='emergency_assigned', 
        assignment_source='direct', -- Set source to direct
        fulfillment_status='fulfilled', 
        confirmed_at=NOW(),
        is_on_bidding=FALSE, 
        bidding_status='not_on_bidding',
        eligibility_snapshot=v_compliance.eligibility_snapshot, 
        compliance_checked_at=NOW(),
        updated_at=NOW(), 
        last_modified_by=p_user_id 
    WHERE id=p_shift_id;
    
    RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S7');
END; 
$function$;

-- 3. Update get_quarterly_performance_report
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
    drop_rate numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $function$
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
$function$;

-- 4. Backfill existing shifts
UPDATE shifts SET assignment_source = 'direct' WHERE emergency_assigned_at IS NOT NULL AND assignment_source IS NULL;
