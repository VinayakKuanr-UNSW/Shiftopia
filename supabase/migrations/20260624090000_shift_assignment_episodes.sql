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

-- ─── Classify each event as opening, closing, or intra-episode ─────────────
classified AS (
    SELECT
        oe.*,
        -- Is this an opening event type?
        CASE WHEN oe.event_type IN ('ASSIGNED','OFFERED','EMERGENCY_ASSIGNED','SWAPPED_IN')
             THEN TRUE ELSE FALSE END AS is_opening_type,
        -- Is this a closing event type?
        CASE WHEN oe.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                                     'SWAPPED_OUT','NO_SHOW','UNASSIGNED')
             THEN TRUE ELSE FALSE END AS is_closing_type,
        -- Previous event's employee for same shift (to detect holder change)
        LAG(oe.employee_id) OVER (PARTITION BY oe.shift_id ORDER BY oe.event_time, oe.id) AS prev_employee_id,
        -- Track whether previous event was a closing event
        LAG(CASE WHEN oe.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                                         'SWAPPED_OUT','NO_SHOW','UNASSIGNED')
                 THEN TRUE ELSE FALSE END)
            OVER (PARTITION BY oe.shift_id ORDER BY oe.event_time, oe.id) AS prev_was_closing
    FROM ordered_events oe
),

-- ─── Mark episode boundaries ───────────────────────────────────────────────
-- An event starts a new episode if:
-- 1. It is an opening event AND (no previous event exists OR prev was closing OR employee changed)
-- 2. OR it is any event from a different employee than the previous (non-closing) event while opening
episode_boundaries AS (
    SELECT
        c.*,
        CASE
            -- First event for this shift that is an opening event → new episode
            WHEN c.is_opening_type AND c.prev_employee_id IS NULL THEN TRUE
            -- Opening event after a close → new episode
            WHEN c.is_opening_type AND c.prev_was_closing THEN TRUE
            -- Opening event with different employee → new episode
            WHEN c.is_opening_type AND c.employee_id IS DISTINCT FROM c.prev_employee_id THEN TRUE
            ELSE FALSE
        END AS starts_new_episode
    FROM classified c
),

-- ─── Assign episode_seq using cumulative sum of boundary markers ───────────
episode_assigned AS (
    SELECT
        eb.*,
        SUM(CASE WHEN eb.starts_new_episode THEN 1 ELSE 0 END)
            OVER (PARTITION BY eb.shift_id ORDER BY eb.event_time, eb.event_id
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS episode_seq
    FROM episode_boundaries eb
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
episode_with_shift AS (
    SELECT
        ep.*,
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
            -- No closing event: check if shift completed with this holder
            WHEN ews.closing_event_type IS NULL AND ews.lifecycle_status = 'Completed' THEN 'fulfilled'
            -- Still open
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
    (ef.attended_from_events OR t.shift_id IS NOT NULL) AS attended,
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
-- LEFT JOIN timesheets for the "worked" episode (the one that covers the scheduled period)
LEFT JOIN public.timesheets t
    ON t.shift_id = ef.shift_id
    AND t.employee_id = ef.employee_id
    AND t.clock_in IS NOT NULL;

-- Index to speed up the view's core query
CREATE INDEX IF NOT EXISTS idx_shift_events_shift_employee_time
    ON public.shift_events (shift_id, employee_id, event_time, id);

COMMENT ON VIEW public.v_shift_assignment_episodes IS
    'Derives per-(shift, employee, attempt) assignment episodes from the immutable '
    'shift_events ledger using gaps-and-islands. Each episode represents one contiguous '
    'span where a single employee held or was offered a shift. Metrics aggregate over '
    'episodes, not over current shift rows.';
