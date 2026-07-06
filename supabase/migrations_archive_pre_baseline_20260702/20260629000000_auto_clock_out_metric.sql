-- =====================================================================
-- Auto Clock-Out attendance metric
-- =====================================================================
-- Adds Auto-ClockOut % to the snapshot/RPC pipeline so Insights › Performance
-- shows it alongside the other attendance metrics (full parity with the
-- client-side scorecard on My Attendance + Timesheets).
--
-- Signal: shifts.attendance_status = 'auto_clock_out' (set by the
-- auto-clock-out housekeeping when an employee attended but never clocked out).
-- It is a quality flag on a *worked* shift, so its denominator is worked snapshots.
--
-- Carries forward the ±7.5 min on-time grace from 20260628020000 and the
-- aggregation shape from 20260628010000 — only the new flag/column are added.
-- =====================================================================

-- 1. Schema additions ------------------------------------------------------------
ALTER TABLE public.assignment_snapshots
ADD COLUMN IF NOT EXISTS auto_clock_out boolean NOT NULL DEFAULT false;

ALTER TABLE public.employee_performance_metrics
ADD COLUMN IF NOT EXISTS auto_clock_outs integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS auto_clock_out_rate numeric NOT NULL DEFAULT 0;


-- 2. Recreate public.v_shift_assignment_episodes (carry attendance_status) -------
CREATE OR REPLACE VIEW public.v_shift_assignment_episodes AS
WITH
late_cancel_threshold AS (
    SELECT interval '4 hours' AS val
),
ordered_events AS (
    SELECT
        se.id           AS event_id,
        se.shift_id,
        se.employee_id,
        se.event_type,
        se.event_time,
        se.metadata,
        ROW_NUMBER() OVER (PARTITION BY se.shift_id ORDER BY se.event_time, se.id) AS rn
    FROM public.shift_events se
    WHERE se.employee_id IS NOT NULL
),
classified AS (
    SELECT
        oe.*,
        (oe.event_type IN ('ASSIGNED','OFFERED','EMERGENCY_ASSIGNED','SWAPPED_IN')) AS is_opening_type,
        (oe.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                           'SWAPPED_OUT','NO_SHOW','UNASSIGNED'))                    AS is_closing_type
    FROM ordered_events oe
),
boundary_events AS (
    SELECT
        c.shift_id,
        c.event_id,
        c.event_time,
        c.employee_id,
        c.is_opening_type,
        LAG(c.is_closing_type) OVER w AS prev_boundary_was_closing,
        LAG(c.employee_id)     OVER w AS prev_boundary_employee
    FROM classified c
    WHERE c.is_opening_type OR c.is_closing_type
    WINDOW w AS (PARTITION BY c.shift_id ORDER BY c.event_time, c.event_id)
),
boundary_starts AS (
    SELECT
        be.shift_id,
        be.event_id,
        CASE
            WHEN be.is_opening_type AND (
                     be.prev_boundary_employee IS NULL
                  OR be.prev_boundary_was_closing
                  OR be.employee_id IS DISTINCT FROM be.prev_boundary_employee
                 )
            THEN 1 ELSE 0
        END AS starts_new_episode
    FROM boundary_events be
),
episode_assigned AS (
    SELECT
        c.*,
        SUM(COALESCE(bs.starts_new_episode, 0))
            OVER (PARTITION BY c.shift_id ORDER BY c.event_time, c.event_id
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS episode_seq
    FROM classified c
    LEFT JOIN boundary_starts bs
           ON bs.shift_id = c.shift_id AND bs.event_id = c.event_id
),
episode_agg AS (
    SELECT
        ea.shift_id,
        ea.episode_seq,
        (ARRAY_AGG(ea.employee_id ORDER BY ea.event_time, ea.event_id))[1] AS employee_id,
        MIN(ea.event_time) AS opened_at,
        MIN(ea.event_time) FILTER (
            WHERE ea.event_type IN ('ACCEPTED','EMERGENCY_ASSIGNED','SWAPPED_IN')
        ) AS became_active_at,
        BOOL_OR(ea.event_type = 'OFFERED')              AS had_offer,
        BOOL_OR(ea.event_type = 'ACCEPTED')             AS had_accept,
        BOOL_OR(ea.event_type = 'ASSIGNED')             AS had_assign,
        BOOL_OR(ea.event_type = 'EMERGENCY_ASSIGNED')    AS had_emergency,
        BOOL_OR(ea.event_type = 'SWAPPED_IN')            AS had_swap_in,
        BOOL_OR(ea.event_type = 'CHECKED_IN')            AS had_checked_in,
        BOOL_OR(ea.event_type = 'LATE_IN')               AS had_late_in_event,
        BOOL_OR(ea.event_type = 'EARLY_OUT')             AS had_early_out_event,
        (ARRAY_AGG(ea.event_type ORDER BY ea.event_time DESC, ea.event_id DESC)
            FILTER (WHERE ea.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                                             'SWAPPED_OUT','NO_SHOW','UNASSIGNED')))[1]
            AS closing_event_type,
        (ARRAY_AGG(ea.event_time ORDER BY ea.event_time DESC, ea.event_id DESC)
            FILTER (WHERE ea.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                                             'SWAPPED_OUT','NO_SHOW','UNASSIGNED')))[1]
            AS closing_event_time
    FROM episode_assigned ea
    WHERE ea.episode_seq > 0
    GROUP BY ea.shift_id, ea.episode_seq
),
episode_with_shift AS (
    SELECT
        ep.*,
        MAX(ep.episode_seq) OVER (PARTITION BY ep.shift_id) AS max_episode_seq,
        s.shift_date,
        s.organization_id,
        s.department_id,
        s.sub_department_id,
        s.lifecycle_status,
        s.deleted_at,
        s.scheduled_start,
        s.scheduled_end,
        s.attendance_status,
        lct.val AS late_cancel_threshold
    FROM episode_agg ep
    JOIN public.shifts s ON s.id = ep.shift_id
    CROSS JOIN late_cancel_threshold lct
),
episode_final AS (
    SELECT
        ews.shift_id,
        ews.episode_seq,
        ews.employee_id,
        ews.opened_at,
        ews.became_active_at,
        ews.closing_event_time AS closed_at,
        CASE
            WHEN ews.had_emergency   THEN 'EMERGENCY_ASSIGNED'::text
            WHEN ews.had_swap_in     THEN 'SWAPPED_IN'::text
            WHEN ews.had_assign      THEN 'ASSIGNED'::text
            WHEN ews.had_offer       THEN 'OFFERED'::text
            ELSE 'ASSIGNED'::text
        END AS opening_event,
        CASE
            WHEN ews.deleted_at IS NOT NULL THEN 'shift_deleted'
            WHEN ews.closing_event_type = 'REJECTED'       THEN 'rejected'
            WHEN ews.closing_event_type = 'IGNORED'        THEN 'ignored'
            WHEN ews.closing_event_type = 'SWAPPED_OUT'    THEN 'swapped_out'
            WHEN ews.closing_event_type = 'NO_SHOW'        THEN 'no_show'
            WHEN ews.closing_event_type = 'UNASSIGNED'     THEN 'unassigned'
            WHEN ews.closing_event_type IN ('CANCELLED', 'LATE_CANCELLED') THEN
                CASE
                    WHEN ews.scheduled_start IS NOT NULL
                         AND ews.closing_event_time IS NOT NULL
                         AND (ews.scheduled_start - ews.closing_event_time) <= ews.late_cancel_threshold
                    THEN 'cancelled_late'
                    ELSE 'cancelled_standard'
                END
            WHEN ews.closing_event_type IS NULL
                 AND ews.lifecycle_status = 'Completed'
                 AND ews.episode_seq = ews.max_episode_seq THEN 'fulfilled'
            ELSE 'open'
        END AS terminal_outcome,
        ews.had_offer,
        ews.had_accept,
        ews.had_assign,
        ews.had_emergency,
        ews.had_swap_in,
        COALESCE(ews.had_checked_in, FALSE) AS attended_from_events,
        COALESCE(ews.had_late_in_event, FALSE) AS late_in_from_events,
        COALESCE(ews.had_early_out_event, FALSE) AS early_out_from_events,
        ews.shift_date,
        ews.organization_id,
        ews.department_id,
        ews.sub_department_id,
        ews.scheduled_start,
        ews.scheduled_end,
        ews.lifecycle_status,
        ews.attendance_status
    FROM episode_with_shift ews
),
ts_agg AS (
    SELECT
        ts.shift_id,
        ts.employee_id,
        MIN(ts.clock_in)  AS clock_in,
        MAX(ts.clock_out) AS clock_out,
        MIN(
            CASE
                WHEN ts.clock_in IS NOT NULL AND ts.clock_out IS NOT NULL THEN ts.clock_in
                ELSE (ts.work_date + ts.start_time) AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
            END
        ) AS effective_clock_in,
        MAX(
            CASE
                WHEN ts.clock_in IS NOT NULL AND ts.clock_out IS NOT NULL THEN ts.clock_out
                ELSE (CASE WHEN ts.end_time < ts.start_time THEN ts.work_date + interval '1 day' + ts.end_time ELSE ts.work_date + ts.end_time END) AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
            END
        ) AS effective_clock_out
    FROM public.timesheets ts
    JOIN public.shifts s ON s.id = ts.shift_id
    GROUP BY ts.shift_id, ts.employee_id
)
SELECT
    ef.shift_id,
    ef.episode_seq,
    ef.employee_id,
    ef.opened_at,
    ef.closed_at,
    ef.opening_event,
    ef.terminal_outcome,
    ef.had_offer,
    ef.had_accept,
    ef.had_assign,
    ef.had_emergency,
    ef.had_swap_in,
    -- Attendance: OR event-based flags with timesheet-derived flags
    (ef.attended_from_events OR t.clock_in IS NOT NULL) AS attended,
    (ef.late_in_from_events
        OR (t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
            AND t.effective_clock_in > ef.scheduled_start + interval '7.5 minutes')
    ) AS late_in,
    (ef.early_out_from_events
        OR (t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
            AND t.effective_clock_out < ef.scheduled_end - interval '7.5 minutes')
    ) AS early_out,
    ef.shift_date,
    ef.organization_id,
    ef.department_id,
    ef.sub_department_id,
    ef.became_active_at,
    ef.scheduled_start,
    -- Attendance additions
    (t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
     AND t.effective_clock_in < ef.scheduled_start - interval '7.5 minutes'
    ) AS early_in,
    (t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
     AND t.effective_clock_out > ef.scheduled_end + interval '7.5 minutes'
    ) AS late_out,
    (t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
     AND t.effective_clock_in >= ef.scheduled_start - interval '7.5 minutes'
     AND t.effective_clock_in <= ef.scheduled_start + interval '7.5 minutes'
    ) AS on_time_in,
    (t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
     AND t.effective_clock_out >= ef.scheduled_end - interval '7.5 minutes'
     AND t.effective_clock_out <= ef.scheduled_end + interval '7.5 minutes'
    ) AS on_time_out,
    (ef.attendance_status = 'auto_clock_out') AS auto_clock_out
FROM episode_final ef
LEFT JOIN ts_agg t
    ON t.shift_id = ef.shift_id
    AND t.employee_id = ef.employee_id
    AND t.effective_clock_in >= ef.opened_at
    AND (ef.closed_at IS NULL OR t.effective_clock_in <= ef.closed_at);


-- 3. Recreate public.sm_refresh_shift_snapshots (populate auto_clock_out) --------
CREATE OR REPLACE FUNCTION public.sm_refresh_shift_snapshots(p_shift_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 AS $function$
BEGIN
    IF p_shift_id IS NULL THEN
        RETURN;
    END IF;

    DELETE FROM public.assignment_snapshots WHERE shift_id = p_shift_id;

    INSERT INTO public.assignment_snapshots (
        shift_id, episode_seq, employee_id, source,
        became_active_at, ended_at, end_reason,
        attended, late_in, early_out, is_current,
        organization_id, department_id, sub_department_id,
        shift_date, scheduled_start, refreshed_at,
        early_in, late_out, on_time_in, on_time_out, auto_clock_out
    )
    WITH
    late_cancel_threshold AS (
        SELECT interval '4 hours' AS val
    ),
    ordered_events AS (
        SELECT
            se.id           AS event_id,
            se.shift_id,
            se.employee_id,
            se.event_type,
            se.event_time,
            se.metadata
        FROM public.shift_events se
        WHERE se.shift_id = p_shift_id          -- ← pushed to the lowest scan
          AND se.employee_id IS NOT NULL
    ),
    classified AS (
        SELECT
            oe.*,
            (oe.event_type IN ('ASSIGNED','OFFERED','EMERGENCY_ASSIGNED','SWAPPED_IN')) AS is_opening_type,
            (oe.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                               'SWAPPED_OUT','NO_SHOW','UNASSIGNED'))                    AS is_closing_type
        FROM ordered_events oe
    ),
    boundary_events AS (
        SELECT
            c.shift_id,
            c.event_id,
            c.event_time,
            c.employee_id,
            c.is_opening_type,
            LAG(c.is_closing_type) OVER w AS prev_boundary_was_closing,
            LAG(c.employee_id)     OVER w AS prev_boundary_employee
        FROM classified c
        WHERE c.is_opening_type OR c.is_closing_type
        WINDOW w AS (PARTITION BY c.shift_id ORDER BY c.event_time, c.event_id)
    ),
    boundary_starts AS (
        SELECT
            be.shift_id,
            be.event_id,
            CASE
                WHEN be.is_opening_type AND (
                         be.prev_boundary_employee IS NULL
                      OR be.prev_boundary_was_closing
                      OR be.employee_id IS DISTINCT FROM be.prev_boundary_employee
                     )
                THEN 1 ELSE 0
            END AS starts_new_episode
        FROM boundary_events be
    ),
    episode_assigned AS (
        SELECT
            c.*,
            SUM(COALESCE(bs.starts_new_episode, 0))
                OVER (PARTITION BY c.shift_id ORDER BY c.event_time, c.event_id
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS episode_seq
        FROM classified c
        LEFT JOIN boundary_starts bs
               ON bs.shift_id = c.shift_id AND bs.event_id = c.event_id
    ),
    episode_agg AS (
        SELECT
            ea.shift_id,
            ea.episode_seq,
            (ARRAY_AGG(ea.employee_id ORDER BY ea.event_time, ea.event_id))[1] AS employee_id,
            MIN(ea.event_time) AS opened_at,
            MIN(ea.event_time) FILTER (
                WHERE ea.event_type IN ('ACCEPTED','EMERGENCY_ASSIGNED','SWAPPED_IN')
            ) AS became_active_at,
            BOOL_OR(ea.event_type = 'OFFERED')              AS had_offer,
            BOOL_OR(ea.event_type = 'ACCEPTED')             AS had_accept,
            BOOL_OR(ea.event_type = 'ASSIGNED')             AS had_assign,
            BOOL_OR(ea.event_type = 'EMERGENCY_ASSIGNED')    AS had_emergency,
            BOOL_OR(ea.event_type = 'SWAPPED_IN')            AS had_swap_in,
            BOOL_OR(ea.event_type = 'CHECKED_IN')            AS had_checked_in,
            BOOL_OR(ea.event_type = 'LATE_IN')               AS had_late_in_event,
            BOOL_OR(ea.event_type = 'EARLY_OUT')             AS had_early_out_event,
            (ARRAY_AGG(ea.event_type ORDER BY ea.event_time DESC, ea.event_id DESC)
                FILTER (WHERE ea.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                                                 'SWAPPED_OUT','NO_SHOW','UNASSIGNED')))[1]
                AS closing_event_type,
            (ARRAY_AGG(ea.event_time ORDER BY ea.event_time DESC, ea.event_id DESC)
                FILTER (WHERE ea.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                                                 'SWAPPED_OUT','NO_SHOW','UNASSIGNED')))[1]
                AS closing_event_time
        FROM episode_assigned ea
        WHERE ea.episode_seq > 0
        GROUP BY ea.shift_id, ea.episode_seq
    ),
    episode_with_shift AS (
        SELECT
            ep.*,
            MAX(ep.episode_seq) OVER (PARTITION BY ep.shift_id) AS max_episode_seq,
            s.shift_date,
            s.organization_id,
            s.department_id,
            s.sub_department_id,
            s.lifecycle_status,
            s.deleted_at,
            s.scheduled_start,
            s.scheduled_end,
            s.attendance_status,
            lct.val AS late_cancel_threshold
        FROM episode_agg ep
        JOIN public.shifts s ON s.id = ep.shift_id
        CROSS JOIN late_cancel_threshold lct
    ),
    episode_final AS (
        SELECT
            ews.shift_id,
            ews.episode_seq,
            ews.employee_id,
            ews.opened_at,
            ews.became_active_at,
            ews.closing_event_time AS closed_at,
            CASE
                WHEN ews.deleted_at IS NOT NULL THEN 'shift_deleted'
                WHEN ews.closing_event_type = 'REJECTED'       THEN 'rejected'
                WHEN ews.closing_event_type = 'IGNORED'        THEN 'ignored'
                WHEN ews.closing_event_type = 'SWAPPED_OUT'    THEN 'swapped_out'
                WHEN ews.closing_event_type = 'NO_SHOW'        THEN 'no_show'
                WHEN ews.closing_event_type = 'UNASSIGNED'     THEN 'unassigned'
                WHEN ews.closing_event_type IN ('CANCELLED', 'LATE_CANCELLED') THEN
                    CASE
                        WHEN ews.scheduled_start IS NOT NULL
                             AND ews.closing_event_time IS NOT NULL
                             AND (ews.scheduled_start - ews.closing_event_time) <= ews.late_cancel_threshold
                        THEN 'cancelled_late'
                        ELSE 'cancelled_standard'
                    END
                WHEN ews.closing_event_type IS NULL
                     AND ews.lifecycle_status = 'Completed'
                     AND ews.episode_seq = ews.max_episode_seq THEN 'fulfilled'
                ELSE 'open'
            END AS terminal_outcome,
            ews.had_accept,
            ews.had_emergency,
            ews.had_swap_in,
            COALESCE(ews.had_checked_in, FALSE) AS attended_from_events,
            COALESCE(ews.had_late_in_event, FALSE) AS late_in_from_events,
            COALESCE(ews.had_early_out_event, FALSE) AS early_out_from_events,
            ews.shift_date,
            ews.organization_id,
            ews.department_id,
            ews.sub_department_id,
            ews.scheduled_start,
            ews.scheduled_end,
            ews.attendance_status
        FROM episode_with_shift ews
    ),
    ts_agg AS (
        SELECT
            ts.shift_id,
            ts.employee_id,
            MIN(ts.clock_in)  AS clock_in,
            MAX(ts.clock_out) AS clock_out,
            MIN(
                CASE
                    WHEN ts.clock_in IS NOT NULL AND ts.clock_out IS NOT NULL THEN ts.clock_in
                    ELSE (ts.work_date + ts.start_time) AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
                END
            ) AS effective_clock_in,
            MAX(
                CASE
                    WHEN ts.clock_in IS NOT NULL AND ts.clock_out IS NOT NULL THEN ts.clock_out
                    ELSE (CASE WHEN ts.end_time < ts.start_time THEN ts.work_date + interval '1 day' + ts.end_time ELSE ts.work_date + ts.end_time END) AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney')
                END
            ) AS effective_clock_out
        FROM public.timesheets ts
        JOIN public.shifts s ON s.id = ts.shift_id
        WHERE ts.shift_id = p_shift_id          -- ← pushed to the lowest scan
        GROUP BY ts.shift_id, ts.employee_id
    ),
    episodes_for_shift AS (
        SELECT
            ef.shift_id,
            ef.episode_seq,
            ef.employee_id,
            ef.opened_at,
            ef.closed_at,
            ef.terminal_outcome,
            ef.had_accept,
            ef.had_emergency,
            ef.had_swap_in,
            (ef.attended_from_events OR t.clock_in IS NOT NULL) AS attended,
            (ef.late_in_from_events
                OR (t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
                    AND t.effective_clock_in > ef.scheduled_start + interval '7.5 minutes')
            ) AS late_in,
            (ef.early_out_from_events
                OR (t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
                    AND t.effective_clock_out < ef.scheduled_end - interval '7.5 minutes')
            ) AS early_out,
            ef.shift_date,
            ef.organization_id,
            ef.department_id,
            ef.sub_department_id,
            ef.became_active_at,
            ef.scheduled_start,
            -- Attendance additions
            (t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
             AND t.effective_clock_in < ef.scheduled_start - interval '7.5 minutes'
            ) AS early_in,
            (t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
             AND t.effective_clock_out > ef.scheduled_end + interval '7.5 minutes'
            ) AS late_out,
            (t.effective_clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
             AND t.effective_clock_in >= ef.scheduled_start - interval '7.5 minutes'
             AND t.effective_clock_in <= ef.scheduled_start + interval '7.5 minutes'
            ) AS on_time_in,
            (t.effective_clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
             AND t.effective_clock_out >= ef.scheduled_end - interval '7.5 minutes'
             AND t.effective_clock_out <= ef.scheduled_end + interval '7.5 minutes'
            ) AS on_time_out,
            ef.attendance_status
        FROM episode_final ef
        LEFT JOIN ts_agg t
            ON t.shift_id = ef.shift_id
            AND t.employee_id = ef.employee_id
            AND t.effective_clock_in >= ef.opened_at
            AND (ef.closed_at IS NULL OR t.effective_clock_in <= ef.closed_at)
    )
    SELECT
        ep.shift_id,
        ep.episode_seq,
        ep.employee_id,
        CASE
            WHEN ep.had_emergency THEN 'emergency'
            WHEN ep.had_swap_in   THEN 'trade_approve'
            WHEN EXISTS (
                SELECT 1
                FROM public.shift_events se
                WHERE se.shift_id = ep.shift_id
                  AND se.event_type = 'ASSIGNED'
                  AND se.metadata->>'op' = 'select_winner'
                  AND se.event_time >= ep.opened_at
                  AND (ep.closed_at IS NULL OR se.event_time <= ep.closed_at)
            ) THEN 'bid_win'
            ELSE 'publish_confirm'
        END AS source,
        COALESCE(ep.became_active_at, ep.opened_at) AS became_active_at,
        ep.closed_at AS ended_at,
        CASE
            WHEN ep.terminal_outcome = 'fulfilled'          THEN 'worked'
            WHEN ep.terminal_outcome = 'cancelled_standard' THEN 'dropped_std'
            WHEN ep.terminal_outcome = 'cancelled_late'     THEN 'dropped_late'
            WHEN ep.terminal_outcome = 'no_show'            THEN 'no_show'
            WHEN ep.terminal_outcome = 'swapped_out'        THEN 'traded_out'
            WHEN ep.terminal_outcome = 'unassigned'         THEN 'reassigned'
            WHEN ep.terminal_outcome = 'open'
                 AND ep.episode_seq < MAX(ep.episode_seq) OVER (PARTITION BY ep.shift_id)
                                                             THEN 'reassigned'
            WHEN ep.terminal_outcome = 'open'               THEN NULL
            ELSE NULL
        END AS end_reason,
        ep.attended,
        ep.late_in,
        ep.early_out,
        (ep.terminal_outcome = 'open'
            AND ep.episode_seq = MAX(ep.episode_seq) OVER (PARTITION BY ep.shift_id))
                                                            AS is_current,
        ep.organization_id,
        ep.department_id,
        ep.sub_department_id,
        ep.shift_date,
        ep.scheduled_start,
        now() AS refreshed_at,
        ep.early_in,
        ep.late_out,
        ep.on_time_in,
        ep.on_time_out,
        (ep.attendance_status = 'auto_clock_out') AS auto_clock_out
    FROM episodes_for_shift ep
    WHERE (ep.had_accept OR ep.had_emergency OR ep.had_swap_in)
      AND ep.terminal_outcome <> 'shift_deleted';
END;
$function$;


-- 4. Recreate public.compute_employee_quarter_metrics (write auto_clock_out) -----
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
    v_early_in    int := 0; v_late_out  int := 0;
    v_on_time_in  int := 0; v_on_time_out int := 0;
    v_auto_clock_out int := 0;
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
        COUNT(*) FILTER (WHERE snap.early_in AND snap.end_reason = 'worked'),
        COUNT(*) FILTER (WHERE snap.late_out AND snap.end_reason = 'worked'),
        COUNT(*) FILTER (WHERE snap.on_time_in AND snap.end_reason = 'worked'),
        COUNT(*) FILTER (WHERE snap.on_time_out AND snap.end_reason = 'worked'),
        COUNT(*) FILTER (WHERE snap.auto_clock_out AND snap.end_reason = 'worked'),
        COUNT(*)
    INTO v_assigned, v_emergency, v_worked, v_swapped,
         v_std_cancel, v_late_cancel, v_no_show,
         v_late_in, v_early_out, v_early_in, v_late_out,
         v_on_time_in, v_on_time_out, v_auto_clock_out, v_held
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
        late_clock_in_rate, early_clock_out_rate, no_show_rate, calculated_at,
        early_clock_ins, late_clock_outs, early_clock_in_rate, late_clock_out_rate,
        on_time_in, on_time_out, on_time_in_rate, on_time_out_rate,
        auto_clock_outs, auto_clock_out_rate
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
        -- Reliability score: snapshot-based denominators
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
        now(),
        -- Attendance fields
        v_early_in,
        v_late_out,
        CASE WHEN v_worked=0 THEN 0 ELSE ROUND(v_early_in::numeric /v_worked  *100,2) END,
        CASE WHEN v_worked=0 THEN 0 ELSE ROUND(v_late_out::numeric /v_worked  *100,2) END,
        v_on_time_in,
        v_on_time_out,
        CASE WHEN v_worked=0 THEN 0 ELSE ROUND(v_on_time_in::numeric /v_worked  *100,2) END,
        CASE WHEN v_worked=0 THEN 0 ELSE ROUND(v_on_time_out::numeric /v_worked  *100,2) END,
        -- Auto clock-out: denominator = worked snapshots
        v_auto_clock_out,
        CASE WHEN v_worked=0 THEN 0 ELSE ROUND(v_auto_clock_out::numeric /v_worked  *100,2) END
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
        no_show_rate=EXCLUDED.no_show_rate, calculated_at=now(),
        early_clock_ins=EXCLUDED.early_clock_ins, late_clock_outs=EXCLUDED.late_clock_outs,
        early_clock_in_rate=EXCLUDED.early_clock_in_rate, late_clock_out_rate=EXCLUDED.late_clock_out_rate,
        on_time_in=EXCLUDED.on_time_in, on_time_out=EXCLUDED.on_time_out,
        on_time_in_rate=EXCLUDED.on_time_in_rate, on_time_out_rate=EXCLUDED.on_time_out_rate,
        auto_clock_outs=EXCLUDED.auto_clock_outs, auto_clock_out_rate=EXCLUDED.auto_clock_out_rate
    WHERE NOT employee_performance_metrics.is_locked;
END;
$function$;


-- 5. Recreate get_quarterly_performance_report (return auto_clock_out_rate) ------
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
    standard_drop_rate numeric,
    urgent_drop_rate numeric,
    early_clock_in integer,
    late_clock_out integer,
    early_clock_in_rate numeric,
    late_clock_out_rate numeric,
    on_time_in integer,
    on_time_out integer,
    on_time_in_rate numeric,
    on_time_out_rate numeric,
    -- New addition
    auto_clock_out integer,
    auto_clock_out_rate numeric
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
            COUNT(*) FILTER (WHERE snap.early_in AND snap.end_reason = 'worked')::int  AS early_clock_in_count,
            COUNT(*) FILTER (WHERE snap.late_out AND snap.end_reason = 'worked')::int  AS late_clock_out_count,
            COUNT(*) FILTER (WHERE snap.on_time_in AND snap.end_reason = 'worked')::int AS on_time_in_count,
            COUNT(*) FILTER (WHERE snap.on_time_out AND snap.end_reason = 'worked')::int AS on_time_out_count,
            COUNT(*) FILTER (WHERE snap.auto_clock_out AND snap.end_reason = 'worked')::int AS auto_clock_out_count,
            COUNT(*)::int                                                             AS held_count,

            -- Assignment Changes: standard cancel, late cancel, no show, traded out, reassigned
            COUNT(*) FILTER (WHERE snap.end_reason IS NOT NULL AND snap.end_reason != 'worked')::int AS assignment_changes,
            -- Compliant count (for Attendance percentage): completed/worked AND neither late check-in nor early check-out
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

    -- Bidding metrics
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

    -- Trading metrics
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

            -- Reliability
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
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.no_show_count,0)::numeric/sa.held_count*100 END,2)::numeric AS no_show_rate,
            ROUND(CASE WHEN COALESCE(oa.total_accepted,0)=0 THEN 0
                  ELSE COALESCE(oa.dropped_count,0)::numeric/oa.total_accepted*100 END,2)::numeric AS drop_rate,

            COALESCE(ba.total_bids, 0)::int AS total_bids,
            COALESCE(ba.bids_accepted, 0)::int AS bids_accepted,
            ROUND(CASE WHEN COALESCE(ba.total_bids,0)=0 THEN 0
                  ELSE ba.bids_accepted::numeric/ba.total_bids*100 END, 2)::numeric AS bid_success_rate,

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
                  ELSE sa.urgent_drop_count::numeric/sa.held_count*100 END,2)::numeric AS urgent_drop_rate,

            COALESCE(sa.early_clock_in_count, 0)::int AS early_clock_in,
            COALESCE(sa.late_clock_out_count, 0)::int AS late_clock_out,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.early_clock_in_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS early_clock_in_rate,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.late_clock_out_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS late_clock_out_rate,

            -- New attendance fields
            COALESCE(sa.on_time_in_count, 0)::int AS on_time_in,
            COALESCE(sa.on_time_out_count, 0)::int AS on_time_out,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.on_time_in_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS on_time_in_rate,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.on_time_out_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS on_time_out_rate,

            -- Auto clock-out: denominator = worked snapshots
            COALESCE(sa.auto_clock_out_count, 0)::int AS auto_clock_out,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.auto_clock_out_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS auto_clock_out_rate
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
        -- engagement_score: marketplace activity
        GREATEST(0, LEAST(100, ROUND(
            (rm.total_bids * 8) +
            (rm.trade_requests * 12) +
            (rm.total_offers * 10),
            2
        )))::numeric AS engagement_score,

        rm.standard_drop_rate,
        rm.urgent_drop_rate,

        rm.early_clock_in,
        rm.late_clock_out,
        rm.early_clock_in_rate,
        rm.late_clock_out_rate,

        -- New attendance fields
        rm.on_time_in,
        rm.on_time_out,
        rm.on_time_in_rate,
        rm.on_time_out_rate,

        -- Auto clock-out
        rm.auto_clock_out,
        rm.auto_clock_out_rate
    FROM raw_metrics rm
    ORDER BY employee_name;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_quarterly_performance_report(integer, integer, uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_quarterly_performance_report(integer, integer, uuid[], uuid[], uuid[]) TO authenticated, service_role;


-- 6. Backfill auto_clock_out on existing snapshots, then recompute scorecards ----
UPDATE public.assignment_snapshots snap
SET auto_clock_out = (s.attendance_status = 'auto_clock_out')
FROM public.shifts s
WHERE s.id = snap.shift_id
  AND snap.auto_clock_out IS DISTINCT FROM (s.attendance_status = 'auto_clock_out');

DO $backfill$
DECLARE
    v_rec record;
BEGIN
    FOR v_rec IN
        SELECT DISTINCT employee_id, quarter_year FROM public.employee_performance_metrics
    LOOP
        PERFORM public.compute_employee_quarter_metrics(v_rec.employee_id, v_rec.quarter_year);
    END LOOP;
END;
$backfill$;
