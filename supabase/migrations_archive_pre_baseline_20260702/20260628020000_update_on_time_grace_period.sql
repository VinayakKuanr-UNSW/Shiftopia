-- =====================================================================
-- Update ON-TIME attendance grace period to +-7.5 minutes
-- =====================================================================

-- 1. Recreate public.v_shift_assignment_episodes view with 7.5m grace
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
        ews.lifecycle_status
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
    ) AS on_time_out
FROM episode_final ef
LEFT JOIN ts_agg t
    ON t.shift_id = ef.shift_id
    AND t.employee_id = ef.employee_id
    AND t.effective_clock_in >= ef.opened_at
    AND (ef.closed_at IS NULL OR t.effective_clock_in <= ef.closed_at);


-- 2. Recreate public.sm_refresh_shift_snapshots function with 7.5m grace
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
        early_in, late_out, on_time_in, on_time_out
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
            ews.scheduled_end
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
            ) AS on_time_out
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
        ep.on_time_out
    FROM episodes_for_shift ep
    WHERE (ep.had_accept OR ep.had_emergency OR ep.had_swap_in)
      AND ep.terminal_outcome <> 'shift_deleted';
END;
$function$;


-- 3. Recreate public.get_shift_lifecycle function with 7.5m grace
CREATE OR REPLACE FUNCTION public.get_shift_lifecycle(p_shift_id uuid)
 RETURNS TABLE(
    event_id uuid,
    event_type public.shift_event_type,
    event_time timestamptz,
    employee_id uuid,
    employee_name text,
    metadata jsonb
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 AS $function$
DECLARE
    v_scheduled_start timestamptz;
    v_scheduled_end   timestamptz;
BEGIN
    SELECT s.scheduled_start, s.scheduled_end
      INTO v_scheduled_start, v_scheduled_end
    FROM public.shifts s
    WHERE s.id = p_shift_id;

    RETURN QUERY
    WITH ledger AS (
        SELECT se.id AS event_id, se.event_type, se.event_time, se.employee_id, se.metadata
        FROM public.shift_events se
        WHERE se.shift_id = p_shift_id
    ),
    -- One clock span per employee on this shift (collapse multiple timesheets).
    ts AS (
        SELECT t.employee_id,
               MIN(t.clock_in)  AS clock_in,
               MAX(t.clock_out) AS clock_out
        FROM public.timesheets t
        WHERE t.shift_id = p_shift_id
          AND t.clock_in IS NOT NULL
          AND t.employee_id IS NOT NULL
        GROUP BY t.employee_id
    ),
    -- Synthesise attendance events ONLY where the ledger lacks them.
    synth AS (
        -- Arrival: LATE_IN if clocked in >7.5m after scheduled start, else CHECKED_IN.
        SELECT
            md5('attn-in:'  || p_shift_id::text || ':' || ts.employee_id::text)::uuid AS event_id,
            CASE WHEN v_scheduled_start IS NOT NULL
                      AND ts.clock_in > v_scheduled_start + interval '7.5 minutes'
                 THEN 'LATE_IN'::public.shift_event_type
                 ELSE 'CHECKED_IN'::public.shift_event_type
            END                                                                       AS event_type,
            ts.clock_in                                                               AS event_time,
            ts.employee_id                                                            AS employee_id,
            jsonb_build_object('source','timesheet','synthetic',true)                 AS metadata
        FROM ts
        WHERE NOT EXISTS (
            SELECT 1 FROM ledger l
            WHERE l.employee_id = ts.employee_id
              AND l.event_type IN ('CHECKED_IN','LATE_IN')
        )

        UNION ALL

        -- Early departure: clocked out >7.5m before scheduled end.
        SELECT
            md5('attn-out:' || p_shift_id::text || ':' || ts.employee_id::text)::uuid,
            'EARLY_OUT'::public.shift_event_type,
            ts.clock_out,
            ts.employee_id,
            jsonb_build_object('source','timesheet','synthetic',true)
        FROM ts
        WHERE ts.clock_out IS NOT NULL
          AND v_scheduled_end IS NOT NULL
          AND ts.clock_out < v_scheduled_end - interval '7.5 minutes'
          AND NOT EXISTS (
              SELECT 1 FROM ledger l
              WHERE l.employee_id = ts.employee_id
                AND l.event_type = 'EARLY_OUT'
          )
    ),
    combined AS (
        SELECT event_id, event_type, event_time, employee_id, metadata FROM ledger
        UNION ALL
        SELECT event_id, event_type, event_time, employee_id, metadata FROM synth
    )
    SELECT
        c.event_id,
        c.event_type,
        c.event_time,
        c.employee_id,
        COALESCE(
            p.full_name,
            p.first_name || ' ' || COALESCE(p.last_name, ''),
            c.employee_id::text
        )            AS employee_name,
        c.metadata   AS metadata
    FROM combined c
    LEFT JOIN public.profiles p ON p.id = c.employee_id
    ORDER BY c.event_time, c.event_id;
END;
$function$;
