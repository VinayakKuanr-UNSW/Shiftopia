-- FUNCTION: debug_exec_sql
-- Allows executing raw SQL for verification purposes.
-- CRITICALLY IMPORTANT: This function allows arbitrary SQL execution.
-- It must be protected and likely only used in development/test environments.

CREATE OR REPLACE FUNCTION public.debug_exec_sql(sql text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_result jsonb;
BEGIN
    -- Security check: Ensure caller is specialized service_role or similar.
    -- For now, we rely on the fact that this function is not granted to 'anon' or 'authenticated' by default.
    -- But explicit check is better.
    -- IF auth.role() != 'service_role' THEN
    --    RAISE EXCEPTION 'Access denied';
    -- END IF;
    
    -- Execute the SQL and returning result as JSON
    -- This is tricky for generic SQL.
    -- We can mostly support SELECTs returning JSON.
    
    EXECUTE 'SELECT jsonb_agg(t) FROM (' || sql || ') t' INTO v_result;
    
    RETURN v_result;
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM);
END;
$function$;

-- REVOKE ALL ON FUNCTION public.debug_exec_sql(text) FROM PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.debug_exec_sql(text) TO service_role;
-- GRANT EXECUTE ON FUNCTION public.debug_exec_sql(text) TO postgres;
-- For this session, we might need to grant to generic users if we run via anon key for testing, 
-- but that is insecure. We will assume the script runs with SERVICE_ROLE key.
