-- PATCH: update debug_exec_sql to handle DML statements that cannot be wrapped in subqueries.
CREATE OR REPLACE FUNCTION public.debug_exec_sql(sql text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_result jsonb;
BEGIN
    -- Try executing as a wrapped subquery (Expects data return)
    BEGIN
        EXECUTE 'SELECT jsonb_agg(r) FROM (' || sql || ') r' INTO v_result;
        RETURN v_result;
    EXCEPTION WHEN OTHERS THEN
        -- If syntax error (e.g. DML in subquery), try executing RAW
        BEGIN
            EXECUTE sql;
            RETURN jsonb_build_object('success', true, 'action', 'executed_raw');
        EXCEPTION WHEN OTHERS THEN
            RETURN jsonb_build_object('error', SQLERRM);
        END;
    END;
END;
$function$;
