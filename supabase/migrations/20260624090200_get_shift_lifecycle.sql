-- =====================================================================
-- get_shift_lifecycle RPC — ordered lifecycle events for a shift, with
-- employee names, for the timeline visualization.
-- =====================================================================
-- Episode grouping happens in the TS deriveEpisodes module, not here.
--
-- Attendance parity: sm_clock_in / sm_clock_out_shift do NOT reliably emit
-- CHECKED_IN / LATE_IN / EARLY_OUT to the ledger, but the metrics view
-- (v_shift_assignment_episodes) reads attendance from `timesheets`. To keep the
-- timeline consistent with the metrics, this RPC SYNTHESISES those attendance
-- events from `timesheets` — but only when the ledger does not already carry
-- them (the ledger stays the source of truth when present). Synthetic rows get
-- a deterministic id (md5-based) so React keys are stable across refetches and
-- carry metadata->>'synthetic' = true for transparency.
-- =====================================================================

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
        -- Arrival: LATE_IN if clocked in >5m after scheduled start, else CHECKED_IN.
        SELECT
            md5('attn-in:'  || p_shift_id::text || ':' || ts.employee_id::text)::uuid AS event_id,
            CASE WHEN v_scheduled_start IS NOT NULL
                      AND ts.clock_in > v_scheduled_start + interval '5 minutes'
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

        -- Early departure: clocked out >5m before scheduled end.
        SELECT
            md5('attn-out:' || p_shift_id::text || ':' || ts.employee_id::text)::uuid,
            'EARLY_OUT'::public.shift_event_type,
            ts.clock_out,
            ts.employee_id,
            jsonb_build_object('source','timesheet','synthetic',true)
        FROM ts
        WHERE ts.clock_out IS NOT NULL
          AND v_scheduled_end IS NOT NULL
          AND ts.clock_out < v_scheduled_end - interval '5 minutes'
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
