-- =====================================================================
-- Episode Metrics Parity Script
-- =====================================================================
-- PURPOSE: Compare OLD shifts-row-based metrics against NEW episode-based
-- metrics for the current quarter, per employee. Shows deltas so a human
-- can verify which previously-lost episodes the new logic recovers.
--
-- INSTRUCTIONS: Run by hand against prod AFTER applying both migrations.
-- Do NOT include this in the migration apply path.
--
-- Expected deltas: shifts with >1 assignment attempt (re-offered, swapped,
-- re-assigned) will show differences because the old logic only counted the
-- last holder. Late-cancel reclassification (24h→4h threshold change) will
-- also show differences.
-- =====================================================================

WITH
-- ── Current quarter window ────────────────────────────────────────────────
qtr AS (
    SELECT
        qdr.v_start,
        qdr.v_end
    FROM quarter_date_range(
        date_part('year', now())::int,
        date_part('quarter', now())::int
    ) qdr
),

-- ── OLD-style aggregation (from current shifts rows, matching the pre-rewrite logic) ──
old_style AS (
    SELECT
        s.assigned_employee_id AS employee_id,
        -- Offer counts from events (same as old function)
        COUNT(DISTINCT e_offer.id) FILTER (WHERE e_offer.event_type = 'OFFERED')  AS old_offered,
        COUNT(DISTINCT e_offer.id) FILTER (WHERE e_offer.event_type = 'ACCEPTED') AS old_accepted,
        COUNT(DISTINCT e_offer.id) FILTER (WHERE e_offer.event_type = 'REJECTED') AS old_rejected,
        COUNT(DISTINCT e_offer.id) FILTER (WHERE e_offer.event_type = 'IGNORED')  AS old_expired,
        -- Assignment counts from shifts row
        COUNT(*) FILTER (WHERE s.lifecycle_status != 'Draft')                     AS old_assigned_total,
        COUNT(*) FILTER (WHERE s.lifecycle_status = 'Completed')                  AS old_worked,
        COUNT(*) FILTER (WHERE s.is_cancelled AND s.cancelled_at IS NOT NULL
            AND s.scheduled_start IS NOT NULL
            AND (s.scheduled_start - s.cancelled_at) > interval '24 hours')       AS old_std_cancel,
        COUNT(*) FILTER (WHERE s.is_cancelled AND s.cancelled_at IS NOT NULL
            AND s.scheduled_start IS NOT NULL
            AND (s.scheduled_start - s.cancelled_at) <= interval '24 hours')      AS old_late_cancel,
        COUNT(*) FILTER (WHERE s.attendance_status = 'no_show'
            OR s.assignment_outcome = 'no_show')                                   AS old_no_show
    FROM shifts s
    CROSS JOIN qtr
    LEFT JOIN shift_events e_offer ON e_offer.shift_id = s.id
        AND e_offer.employee_id = s.assigned_employee_id
        AND e_offer.event_type IN ('OFFERED','ACCEPTED','REJECTED','IGNORED')
    WHERE s.assigned_employee_id IS NOT NULL
      AND s.shift_date BETWEEN qtr.v_start AND qtr.v_end
      AND s.lifecycle_status != 'Draft'
    GROUP BY s.assigned_employee_id
),

-- ── NEW-style aggregation (from episodes) ──
new_style AS (
    SELECT
        ep.employee_id,
        COUNT(*) FILTER (WHERE ep.had_offer)                              AS new_offered,
        COUNT(*) FILTER (WHERE ep.had_accept)                             AS new_accepted,
        COUNT(*) FILTER (WHERE ep.terminal_outcome = 'rejected')          AS new_rejected,
        COUNT(*) FILTER (WHERE ep.terminal_outcome = 'ignored')           AS new_expired,
        COUNT(*) FILTER (WHERE ep.had_accept OR ep.had_assign OR ep.had_emergency) AS new_held,
        COUNT(*) FILTER (WHERE ep.terminal_outcome = 'fulfilled')         AS new_worked,
        COUNT(*) FILTER (WHERE ep.terminal_outcome = 'cancelled_standard') AS new_std_cancel,
        COUNT(*) FILTER (WHERE ep.terminal_outcome = 'cancelled_late')    AS new_late_cancel,
        COUNT(*) FILTER (WHERE ep.terminal_outcome = 'no_show')           AS new_no_show,
        COUNT(*) FILTER (WHERE ep.terminal_outcome = 'swapped_out')       AS new_swapped
    FROM v_shift_assignment_episodes ep
    CROSS JOIN qtr
    WHERE ep.shift_date BETWEEN qtr.v_start AND qtr.v_end
      AND ep.terminal_outcome != 'shift_deleted'
    GROUP BY ep.employee_id
)

SELECT
    COALESCE(o.employee_id, n.employee_id) AS employee_id,
    COALESCE(p.full_name, 'Unknown')       AS employee_name,
    -- Offer deltas
    COALESCE(o.old_offered, 0)     AS old_offered,     COALESCE(n.new_offered, 0)     AS new_offered,
    COALESCE(n.new_offered, 0) - COALESCE(o.old_offered, 0) AS delta_offered,
    COALESCE(o.old_accepted, 0)    AS old_accepted,    COALESCE(n.new_accepted, 0)    AS new_accepted,
    COALESCE(n.new_accepted, 0) - COALESCE(o.old_accepted, 0) AS delta_accepted,
    -- Assignment deltas
    COALESCE(o.old_assigned_total, 0) AS old_assigned, COALESCE(n.new_held, 0)        AS new_held,
    COALESCE(n.new_held, 0) - COALESCE(o.old_assigned_total, 0) AS delta_held,
    -- Outcome deltas
    COALESCE(o.old_worked, 0)      AS old_worked,      COALESCE(n.new_worked, 0)      AS new_worked,
    COALESCE(n.new_worked, 0) - COALESCE(o.old_worked, 0) AS delta_worked,
    COALESCE(o.old_std_cancel, 0)  AS old_std_cancel,  COALESCE(n.new_std_cancel, 0)  AS new_std_cancel,
    COALESCE(n.new_std_cancel, 0) - COALESCE(o.old_std_cancel, 0) AS delta_std_cancel,
    COALESCE(o.old_late_cancel, 0) AS old_late_cancel, COALESCE(n.new_late_cancel, 0) AS new_late_cancel,
    COALESCE(n.new_late_cancel, 0) - COALESCE(o.old_late_cancel, 0) AS delta_late_cancel,
    COALESCE(o.old_no_show, 0)     AS old_no_show,     COALESCE(n.new_no_show, 0)     AS new_no_show,
    COALESCE(n.new_no_show, 0) - COALESCE(o.old_no_show, 0) AS delta_no_show,
    -- New-only columns
    COALESCE(n.new_swapped, 0)     AS new_swapped
FROM old_style o
FULL OUTER JOIN new_style n ON n.employee_id = o.employee_id
LEFT JOIN profiles p ON p.id = COALESCE(o.employee_id, n.employee_id)
-- Show only rows with at least one delta
WHERE COALESCE(n.new_offered, 0) - COALESCE(o.old_offered, 0) != 0
   OR COALESCE(n.new_accepted, 0) - COALESCE(o.old_accepted, 0) != 0
   OR COALESCE(n.new_held, 0) - COALESCE(o.old_assigned_total, 0) != 0
   OR COALESCE(n.new_worked, 0) - COALESCE(o.old_worked, 0) != 0
   OR COALESCE(n.new_std_cancel, 0) - COALESCE(o.old_std_cancel, 0) != 0
   OR COALESCE(n.new_late_cancel, 0) - COALESCE(o.old_late_cancel, 0) != 0
   OR COALESCE(n.new_no_show, 0) - COALESCE(o.old_no_show, 0) != 0
ORDER BY employee_name;
