-- =====================================================================
--  Revoke EXECUTE on every SECURITY DEFINER function in `public` from
--  the implicit PUBLIC grant. Closes 187 advisor warnings:
--  `anon_security_definer_function_executable`.
--
--  Why revoke from PUBLIC and not from anon directly
--   PostgreSQL's default behavior is to GRANT EXECUTE on new functions
--   TO PUBLIC. The implicit PUBLIC grant is what gives `anon` access —
--   not a direct anon GRANT. REVOKE FROM anon is a no-op when access
--   flows through PUBLIC. We must REVOKE FROM PUBLIC to remove it.
--
--  Effect on each role
--   - PUBLIC: implicit grant removed.
--   - anon:   loses EXECUTE (no other grant path).
--   - authenticated: keeps EXECUTE (explicit grant in proacl).
--   - service_role:  keeps EXECUTE (explicit grant in proacl).
--   - postgres (owner): keeps EXECUTE.
--
--  Why this is safe
--   - None of the 187 functions has a legitimate anonymous use case.
--     Password-reset / signup go through Supabase Auth's own endpoints.
--   - All "auth_helper" functions (is_admin, has_permission, user_has_*)
--     read auth.uid() internally; anon calls were already useless,
--     just unnecessarily exposed.
--   - "trigger_function" entries (trg_*, fn_*) are fired by Postgres on
--     row events; they're never invoked directly by API clients.
--
--  Behavior change for clients
--   - A logged-out user invoking any of these RPCs now gets 403
--     permission_denied immediately, instead of a confusing internal
--     "auth.uid() is null" error. Same end result, cleaner failure mode.
--
--  Idempotent: skips functions where anon already has no privilege.
-- =====================================================================

DO $$
DECLARE
    fn record;
    revoked int := 0;
BEGIN
    FOR fn IN
        SELECT
            p.oid,
            p.proname,
            p.prokind,
            pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef = true
          AND p.prokind IN ('f', 'p')
          AND has_function_privilege('anon', p.oid, 'EXECUTE')
    LOOP
        IF fn.prokind = 'p' THEN
            EXECUTE format(
                'REVOKE EXECUTE ON PROCEDURE public.%I(%s) FROM PUBLIC',
                fn.proname, fn.args
            );
        ELSE
            EXECUTE format(
                'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC',
                fn.proname, fn.args
            );
        END IF;
        revoked := revoked + 1;
    END LOOP;

    RAISE NOTICE 'Revoked EXECUTE from PUBLIC on % SECURITY DEFINER object(s)', revoked;
END
$$;
