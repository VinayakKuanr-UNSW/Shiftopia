-- ============================================================================
-- Access matrix, step 2e: the legacy profile flag grants nothing (decision 12).
--
-- profiles.legacy_system_role ('admin' / 'manager') granted authority outside
-- the certificate system: sm_legacy_manager() fed is_admin, is_manager_or_above,
-- user_has_delta_access, auth_can_manage_templates and sm_require_scope (the
-- guard on 29 RPCs); five more functions and one policy read it directly. The
-- decision made retirement conditional on a written zeta break-glass procedure:
-- docs/operations/access-break-glass.md, plus the last-zeta trigger from step 2d.
--
--   sm_legacy_manager          returns false (signature kept for its callers)
--   sm_require_scope           certificate scope only
--   enforce_role_change_authority   only a zeta may change the flag itself
--   request_fairness_ledger_recompute, auth_can_create_template
--                              legacy-admin bypasses removed
--   is_broadcast_system_manager, get_broadcast_group_role
--                              'system manager' is now a zeta certificate
--   roster_templates_delete    legacy-admin delete policy dropped
--
-- Untouched: the column itself, and the ~14 shift RPCs that copy it into the
-- audit trail as the actor's role label. Those labels grant nothing.
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.patch(p_fn regprocedure, p_pattern text, p_replacement text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE d text; n int;
BEGIN
    d := pg_get_functiondef(p_fn);
    SELECT count(*) INTO n FROM regexp_matches(d, p_pattern, 'g');
    IF n <> 1 THEN
        RAISE EXCEPTION '%: pattern matched % times, expected 1: %', p_fn, n, p_pattern;
    END IF;
    EXECUTE regexp_replace(d, p_pattern, p_replacement);
END $$;

CREATE TEMP TABLE _acl_before ON COMMIT DROP AS
SELECT p.oid, p.proacl::text AS acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('sm_legacy_manager', 'sm_require_scope', 'enforce_role_change_authority',
                     'request_fairness_ledger_recompute', 'auth_can_create_template',
                     'is_broadcast_system_manager', 'get_broadcast_group_role');

CREATE OR REPLACE FUNCTION public.sm_legacy_manager(p_user uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  -- Retired 20261011 (decision 12): the legacy profile flag grants nothing.
  -- Kept, answering false, so its remaining callers read certificates only.
  SELECT false;
$function$;

SELECT pg_temp.patch('public.sm_require_scope(text,uuid,uuid,uuid)',
    '\s+OR public\.sm_legacy_manager\(auth\.uid\(\)\)',
    '');

SELECT pg_temp.patch('public.enforce_role_change_authority()',
    'and not exists \(\s+select 1 from public\.profiles p\s+where p\.id = auth\.uid\(\)\s+and p\.legacy_system_role = ''admin''\s+\)\s+',
    '');
SELECT pg_temp.patch('public.enforce_role_change_authority()',
    '''Role changes are administrator-controlled \(admin / zeta\)\.''',
    '''Only a zeta can change the legacy role flag; it grants nothing since 20261011.''');

SELECT pg_temp.patch('public.request_fairness_ledger_recompute(uuid,date)',
    'EXISTS \(SELECT 1 FROM public\.profiles p\s+WHERE p\.id = auth\.uid\(\)\s+AND p\.legacy_system_role = ''admin''::public\.system_role\)\s+OR ',
    '');

SELECT pg_temp.patch('public.auth_can_create_template(uuid,uuid,uuid)',
    '-- 1\. Check if user is legacy admin \(always allowed\)\s+IF EXISTS \(\s+SELECT 1 FROM profiles\s+WHERE id = auth\.uid\(\)\s+AND legacy_system_role = ''admin''\s+\) THEN\s+RETURN TRUE;\s+END IF;',
    '-- (legacy-admin bypass retired 20261011)');

CREATE OR REPLACE FUNCTION public.is_broadcast_system_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Was the legacy admin/manager flag; retired 20261011 (decision 12).
  SELECT public.is_zeta();
$function$;

SELECT pg_temp.patch('public.get_broadcast_group_role(uuid)',
    'IF EXISTS \(\s+SELECT 1 FROM profiles\s+WHERE id = auth\.uid\(\)\s+AND legacy_system_role IN \(''admin'', ''manager''\)\s+\) THEN',
    'IF public.is_zeta() THEN  -- was the legacy admin/manager flag, retired 20261011');

DROP POLICY roster_templates_delete ON public.roster_templates;

-- ── Verify ──────────────────────────────────────────────────────────────────
DO $verify$
DECLARE v_failures text := ''; v_list text; r record;
BEGIN
    FOR r IN SELECT p.oid::regprocedure AS fn, p.proacl::text AS acl, b.acl AS acl_before
               FROM pg_proc p JOIN _acl_before b ON b.oid = p.oid LOOP
        IF r.acl IS DISTINCT FROM r.acl_before THEN
            v_failures := v_failures || format('%s ACL changed ; ', r.fn);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ 'legacy_system_role') THEN
        v_failures := v_failures || 'a policy still reads legacy_system_role ; ';
    END IF;
    -- a client-callable function that still DECIDES on the flag (labels copy it, they never compare it)
    SELECT string_agg(p.proname, ', ') INTO v_list
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'hr') AND p.prokind = 'f'
       AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~* 'legacy_system_role\s*(=|in\s*\()';  -- comments stripped
    IF v_list IS NOT NULL THEN
        v_failures := v_failures || 'still decides on the flag: ' || v_list || ' ; ';
    END IF;
    IF v_failures <> '' THEN
        RAISE EXCEPTION 'access matrix step 2e verification failed: %', v_failures;
    END IF;
END
$verify$;
