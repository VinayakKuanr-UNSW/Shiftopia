-- =====================================================================
-- Assignment Episodes View — derives per-(shift, employee, attempt)
-- episodes from the immutable shift_events ledger using gaps-and-islands.
-- =====================================================================
--
-- EPISODE BOUNDARY RULES (shared contract with TS deriveEpisodes):
--
--  OPENING events: ASSIGNED, OFFERED, EMERGENCY_ASSIGNED, SWAPPED_IN
--    - Start a NEW episode when no episode is currently open for the shift,
--      OR the event's employee_id differs from the currently-open episode holder.
--    - Consecutive opening events for the SAME employee while an episode is
--      open stay in the SAME episode (set within-episode flags only).
--
--  CLOSING events → terminal_outcome:
--    - REJECTED           → 'rejected'
--    - IGNORED            → 'ignored'
--    - CANCELLED/LATE_CANCELLED → 'cancelled_late'  if (scheduled_start - event_time) <= 4h
--                                 'cancelled_standard' otherwise
--    - SWAPPED_OUT        → 'swapped_out'
--    - NO_SHOW            → 'no_show'
--    - UNASSIGNED         → 'unassigned'
--
--  No closing event + shift Completed with holder present → 'fulfilled'
--  No closing event otherwise → 'open' (closed_at IS NULL)
--  shift.deleted_at IS NOT NULL → 'shift_deleted'
--
--  POLICY DECISIONS (locked):
--    EMERGENCY_ASSIGNED = positive (counted as fill, not penalized)
--    SWAPPED_OUT = neutral (feeds swap_ratio only, excluded from reliability)
--    Late-cancel threshold = 4 hours (unified constant)
--
-- Within-episode flags: had_offer, had_accept, had_assign, had_emergency,
--   had_swap_in, attended, late_in, early_out
-- =====================================================================

CREATE OR REPLACE VIEW public.v_shift_assignment_episodes AS
WITH
-- ─── Constants ──────────────────────────────────────────────────────────────
late_cancel_threshold AS (
    SELECT interval '4 hours' AS val
),

-- ─── Ordered events with per-shift sequencing ──────────────────────────────
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

-- ─── Classify each event as opening / closing ─────────────────────────────
classified AS (
    SELECT
        oe.*,
        (oe.event_type IN ('ASSIGNED','OFFERED','EMERGENCY_ASSIGNED','SWAPPED_IN')) AS is_opening_type,
        (oe.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                           'SWAPPED_OUT','NO_SHOW','UNASSIGNED'))                    AS is_closing_type
    FROM ordered_events oe
),

-- ─── Boundary detection over OPENING/CLOSING events only ───────────────────
-- Episode boundaries are decided using only "boundary" (opening/closing) events,
-- so intra-episode events (ACCEPTED, CHECKED_IN, LATE_IN, …) cannot break the
-- "previous boundary was a close" signal. This makes the gaps-and-islands logic
-- robust to a non-boundary event wedged between a close and a same-employee
-- re-open, matching the stateful TS deriver exactly.
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
                     be.prev_boundary_employee IS NULL          -- first holder
                  OR be.prev_boundary_was_closing               -- re-open after a close
                  OR be.employee_id IS DISTINCT FROM be.prev_boundary_employee  -- holder change
                 )
            THEN 1 ELSE 0
        END AS starts_new_episode
    FROM boundary_events be
),

-- ─── Assign episode_seq: cumulative sum of start-markers over ALL events ────
-- Intra events contribute 0, so each event inherits the episode_seq of the
-- boundary that opened its episode.
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

-- ─── Aggregate per episode ─────────────────────────────────────────────────
episode_agg AS (
    SELECT
        ea.shift_id,
        ea.episode_seq,
        -- The holder is the employee_id from the opening event
        (ARRAY_AGG(ea.employee_id ORDER BY ea.event_time, ea.event_id))[1] AS employee_id,
        -- opened_at = first event time in the episode
        MIN(ea.event_time) AS opened_at,
        -- Within-episode flags (any event in the episode matches)
        BOOL_OR(ea.event_type = 'OFFERED')              AS had_offer,
        BOOL_OR(ea.event_type = 'ACCEPTED')              AS had_accept,
        BOOL_OR(ea.event_type = 'ASSIGNED')              AS had_assign,
        BOOL_OR(ea.event_type = 'EMERGENCY_ASSIGNED')    AS had_emergency,
        BOOL_OR(ea.event_type = 'SWAPPED_IN')            AS had_swap_in,
        BOOL_OR(ea.event_type = 'CHECKED_IN')            AS had_checked_in,
        BOOL_OR(ea.event_type = 'LATE_IN')               AS had_late_in_event,
        BOOL_OR(ea.event_type = 'EARLY_OUT')             AS had_early_out_event,
        -- Closing event (last closing event determines outcome)
        (ARRAY_AGG(ea.event_type ORDER BY ea.event_time DESC, ea.event_id DESC)
            FILTER (WHERE ea.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                                             'SWAPPED_OUT','NO_SHOW','UNASSIGNED')))[1]
            AS closing_event_type,
        (ARRAY_AGG(ea.event_time ORDER BY ea.event_time DESC, ea.event_id DESC)
            FILTER (WHERE ea.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                                             'SWAPPED_OUT','NO_SHOW','UNASSIGNED')))[1]
            AS closing_event_time
    FROM episode_assigned ea
    WHERE ea.episode_seq > 0  -- exclude events before first opening
    GROUP BY ea.shift_id, ea.episode_seq
),

-- ─── Join with shifts for context and terminal_outcome derivation ──────────
-- max_episode_seq lets us gate 'fulfilled' to the FINAL episode only: a
-- closeless episode that was later superseded by another episode for the same
-- shift must NOT be credited as worked just because the shift completed.
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

-- ─── Derive terminal_outcome and attendance from timesheets ────────────────
episode_final AS (
    SELECT
        ews.shift_id,
        ews.episode_seq,
        ews.employee_id,
        ews.opened_at,
        ews.closing_event_time AS closed_at,
        -- Opening event (first opening event type in the episode)
        CASE
            WHEN ews.had_emergency   THEN 'EMERGENCY_ASSIGNED'::text
            WHEN ews.had_swap_in     THEN 'SWAPPED_IN'::text
            WHEN ews.had_assign      THEN 'ASSIGNED'::text
            WHEN ews.had_offer       THEN 'OFFERED'::text
            ELSE 'ASSIGNED'::text
        END AS opening_event,
        -- Terminal outcome
        CASE
            -- Deleted shift
            WHEN ews.deleted_at IS NOT NULL THEN 'shift_deleted'
            -- Closing event determines outcome
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
            -- No closing event on the FINAL episode of a completed shift → worked.
            -- (Earlier, superseded closeless episodes fall through to 'open' — they
            --  were replaced by a later episode and must not be credited as worked.)
            WHEN ews.closing_event_type IS NULL
                 AND ews.lifecycle_status = 'Completed'
                 AND ews.episode_seq = ews.max_episode_seq THEN 'fulfilled'
            -- Still open / superseded without an explicit close
            ELSE 'open'
        END AS terminal_outcome,
        -- Within-episode flags
        ews.had_offer,
        ews.had_accept,
        ews.had_assign,
        ews.had_emergency,
        ews.had_swap_in,
        -- Attendance: combine event-based flags with timesheet data
        -- attended = checked_in event OR has a timesheet record for this episode
        COALESCE(ews.had_checked_in, FALSE) AS attended_from_events,
        COALESCE(ews.had_late_in_event, FALSE) AS late_in_from_events,
        COALESCE(ews.had_early_out_event, FALSE) AS early_out_from_events,
        -- Shift context for timesheet join
        ews.shift_date,
        ews.organization_id,
        ews.department_id,
        ews.sub_department_id,
        ews.scheduled_start,
        ews.scheduled_end,
        ews.lifecycle_status
    FROM episode_with_shift ews
),

-- ─── One timesheet row per (shift, employee) ───────────────────────────────
-- Pre-aggregate so the final LEFT JOIN cannot FAN OUT (which would duplicate
-- episode rows and double-count metrics when a (shift, employee) has >1
-- timesheet). MIN(clock_in)/MAX(clock_out) collapse to a single span.
ts_agg AS (
    SELECT
        ts.shift_id,
        ts.employee_id,
        MIN(ts.clock_in)  AS clock_in,
        MAX(ts.clock_out) AS clock_out
    FROM public.timesheets ts
    WHERE ts.clock_in IS NOT NULL
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
        OR (t.clock_in IS NOT NULL AND ef.scheduled_start IS NOT NULL
            AND t.clock_in > ef.scheduled_start + interval '5 minutes')
    ) AS late_in,
    (ef.early_out_from_events
        OR (t.clock_out IS NOT NULL AND ef.scheduled_end IS NOT NULL
            AND t.clock_out < ef.scheduled_end - interval '5 minutes')
    ) AS early_out,
    ef.shift_date,
    ef.organization_id,
    ef.department_id,
    ef.sub_department_id
FROM episode_final ef
-- Attach the timesheet to the episode whose window contains the clock-in, so a
-- holder's earlier (e.g. cancelled) episode on the same shift is NOT credited
-- with attendance — only the episode that was open at clock-in time is.
LEFT JOIN ts_agg t
    ON t.shift_id = ef.shift_id
    AND t.employee_id = ef.employee_id
    AND t.clock_in >= ef.opened_at
    AND (ef.closed_at IS NULL OR t.clock_in <= ef.closed_at);

-- Index to speed up the view's core query
CREATE INDEX IF NOT EXISTS idx_shift_events_shift_employee_time
    ON public.shift_events (shift_id, employee_id, event_time, id);

COMMENT ON VIEW public.v_shift_assignment_episodes IS
    'Derives per-(shift, employee, attempt) assignment episodes from the immutable '
    'shift_events ledger using gaps-and-islands. Each episode represents one contiguous '
    'span where a single employee held or was offered a shift. Metrics aggregate over '
    'episodes, not over current shift rows.';
