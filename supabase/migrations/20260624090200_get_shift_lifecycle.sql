-- =====================================================================
-- get_shift_lifecycle RPC — returns raw ordered events for a shift
-- with employee names for the timeline visualization.
-- =====================================================================
-- Episode grouping happens in the TS deriveEpisodes module, not here.
-- This RPC is a simple ordered-events-with-names query.
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
BEGIN
    RETURN QUERY
    SELECT
        se.id            AS event_id,
        se.event_type    AS event_type,
        se.event_time    AS event_time,
        se.employee_id   AS employee_id,
        COALESCE(
            p.full_name,
            p.first_name || ' ' || COALESCE(p.last_name, ''),
            se.employee_id::text
        )                AS employee_name,
        se.metadata      AS metadata
    FROM public.shift_events se
    LEFT JOIN public.profiles p ON p.id = se.employee_id
    WHERE se.shift_id = p_shift_id
    ORDER BY se.event_time, se.id;
END;
$function$;
