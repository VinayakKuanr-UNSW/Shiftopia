-- ============================================================================
-- Phase 3 — five answers to "is this person a manager", collapsed onto one.
--
-- They are not five questions. They are one question asked at three different
-- thresholds, plus two scoped variants, each written out as a hand-maintained
-- list of enum members:
--
--     is_admin                          IN ('zeta','epsilon')          → >= epsilon
--     user_has_delta_access             IN ('delta','epsilon','zeta')  → >= delta
--     is_manager_or_above               IN ('gamma',...,'zeta')        → >= gamma
--     aa_user_manages_org               IN ('gamma',...,'zeta') + org  → >= gamma in org
--     user_has_gamma_access_for_subdept IN ('gamma','delta','epsilon') + subdept
--
-- THE ORDERING ALREADY EXISTED AND NOBODY USED IT. `access_level` is a Postgres
-- enum declared alpha, beta, gamma, delta, epsilon, zeta, so `>=` on it is the
-- ladder, natively, and `access_level >= 'gamma'` is the whole of
-- is_manager_or_above's list. Every one of those IN-lists is a threshold
-- comparison written the long way — which is why adding zeta to the enum meant
-- editing five lists, and why one of them could be missed.
--
-- Note the fourth list above: `user_has_gamma_access_for_subdept` stops at
-- epsilon and handles zeta in a separate disjunct. That is exactly the drift an
-- enumerated list invites and a `>=` cannot express.
--
-- ── WHAT THIS DOES AND DOES NOT CHANGE ──────────────────────────────────────
--
-- Behaviour: nothing. Each of the four surviving functions keeps its own
-- threshold, its own legacy_system_role handling, its own volatility,
-- search_path, security attributes and grants. Only the shared body moves into
-- `sm_cert_at_least` and `sm_legacy_manager`. The pass condition is an empty
-- diff, and the self-test below additionally proves old-equals-new for every
-- profile in the database rather than trusting the diff's four principals.
--
-- `user_has_gamma_access_for_subdept` is DROPPED: zero callers, no policy, no
-- function, no application code. It is also the one carrying the drifted list,
-- so deleting it removes the bug rather than fixing it.
--
-- ── WHY THE CANONICAL PAIR IS LOCKED DOWN AND THE WRAPPERS ARE NOT ──────────
--
-- The four wrappers keep EXECUTE for `authenticated`, because RLS policies call
-- them and a policy expression is evaluated with the privileges of the invoking
-- user — revoke that and every policy calling them fails closed, locking users
-- out. The canonical pair needs no such grant: it is only ever reached from
-- inside a SECURITY DEFINER wrapper, where the current user is already the
-- owner. So the shared primitive stays unreachable from a request.
-- ============================================================================

-- ── 1. The canonical pair ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sm_cert_at_least(
    p_min  public.access_level,
    p_user uuid DEFAULT auth.uid(),
    p_org  uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.app_access_certificates ac
     WHERE ac.user_id = p_user
       AND ac.is_active = true
       -- The ladder, as the type system already states it.
       AND ac.access_level >= p_min
       -- p_org NULL asks the unscoped question. Given an organization, a
       -- certificate with a NULL organization still matches: per
       -- chk_scope_nullability only zeta may hold one, and zeta is global.
       AND (p_org IS NULL OR ac.organization_id = p_org OR ac.organization_id IS NULL)
  );
$function$;

COMMENT ON FUNCTION public.sm_cert_at_least(public.access_level, uuid, uuid) IS
    'Does this user hold an ACTIVE certificate at or above a level, optionally within an '
    'organization? The single definition behind is_admin, is_manager_or_above, '
    'user_has_delta_access and aa_user_manages_org, which differ only in the threshold they pass. '
    'Uses >= on the access_level enum, whose declaration order IS the ladder. Not granted to '
    'authenticated: it is reached only from inside SECURITY DEFINER wrappers.';

REVOKE ALL ON FUNCTION public.sm_cert_at_least(public.access_level, uuid, uuid)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sm_legacy_manager(p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_user
       AND p.legacy_system_role IN ('admin'::public.system_role, 'manager'::public.system_role)
  );
$function$;

COMMENT ON FUNCTION public.sm_legacy_manager(uuid) IS
    'The legacy_system_role escape hatch, stated once. Three of the four manager predicates carry '
    'an identical disjunct on this column; it is preserved rather than removed because removing it '
    'is a behaviour change and Phase 3 is not one. It remains the last place where a role column '
    'beats a certificate, and is the natural candidate for retirement after Phase 4.';

REVOKE ALL ON FUNCTION public.sm_legacy_manager(uuid) FROM PUBLIC, anon, authenticated;

-- ── 2. The wrappers — attributes preserved exactly ──────────────────────────
-- VOLATILE (no STABLE): matches the original, which was not marked.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RETURN public.sm_legacy_manager() OR public.sm_cert_at_least('epsilon');
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_manager_or_above()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RETURN public.sm_legacy_manager() OR public.sm_cert_at_least('gamma');
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$function$;

-- No exception handler: the original had none, so a read error must keep
-- propagating rather than silently becoming "no access".
CREATE OR REPLACE FUNCTION public.user_has_delta_access(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RETURN public.sm_cert_at_least('delta', _user_id)
      OR public.sm_legacy_manager(_user_id);
END;
$function$;

-- is_admin() here is deliberately auth.uid()-based while the certificate test is
-- p_user-based. That asymmetry is in the original and is preserved; it is not
-- obviously intended, but changing it is a behaviour change.
CREATE OR REPLACE FUNCTION public.aa_user_manages_org(p_user uuid, p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT public.is_admin()
      OR public.sm_cert_at_least('gamma', p_user, p_org);
$function$;

-- ── 3. Drop the dead one ────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.user_has_gamma_access_for_subdept(uuid, uuid);

-- ── 4. Self-test: old must equal new, for every profile ─────────────────────
-- The access diff covers four principals. This covers all of them, by
-- evaluating the ORIGINAL predicate inline and comparing it to the rewritten
-- function for each profile in turn.
DO $selftest$
DECLARE
    r          record;
    v_failures text := '';
    v_old      boolean;
    v_new      boolean;
    v_org      uuid;
    n_checked  int := 0;
BEGIN
    SELECT id INTO v_org FROM public.organizations ORDER BY id LIMIT 1;

    FOR r IN SELECT id, email FROM public.profiles ORDER BY id LOOP
        PERFORM set_config('request.jwt.claims',
                           json_build_object('sub', r.id, 'role','authenticated')::text, true);

        -- is_admin: legacy(admin|manager) OR active cert IN (zeta, epsilon)
        v_old := EXISTS (SELECT 1 FROM public.profiles p
                          WHERE p.id = r.id
                            AND (p.legacy_system_role = 'admin' OR p.legacy_system_role = 'manager'))
              OR EXISTS (SELECT 1 FROM public.app_access_certificates c
                          WHERE c.user_id = r.id AND c.is_active = true
                            AND c.access_level IN ('zeta','epsilon'));
        v_new := public.is_admin();
        IF v_old IS DISTINCT FROM v_new THEN
            v_failures := v_failures || format('is_admin differs for %s ; ', r.email);
        END IF;

        -- is_manager_or_above: legacy OR active cert IN (gamma..zeta)
        v_old := EXISTS (SELECT 1 FROM public.profiles p
                          WHERE p.id = r.id AND p.legacy_system_role IN ('admin','manager'))
              OR EXISTS (SELECT 1 FROM public.app_access_certificates c
                          WHERE c.user_id = r.id AND c.is_active = true
                            AND c.access_level IN ('gamma','delta','epsilon','zeta'));
        v_new := public.is_manager_or_above();
        IF v_old IS DISTINCT FROM v_new THEN
            v_failures := v_failures || format('is_manager_or_above differs for %s ; ', r.email);
        END IF;

        -- user_has_delta_access: active cert IN (delta,epsilon,zeta) OR legacy
        v_old := EXISTS (SELECT 1 FROM public.app_access_certificates c
                          WHERE c.user_id = r.id AND c.is_active = true
                            AND c.access_level IN ('delta','epsilon','zeta'))
              OR EXISTS (SELECT 1 FROM public.profiles p
                          WHERE p.id = r.id AND p.legacy_system_role IN ('admin','manager'));
        v_new := public.user_has_delta_access(r.id);
        IF v_old IS DISTINCT FROM v_new THEN
            v_failures := v_failures || format('user_has_delta_access differs for %s ; ', r.email);
        END IF;

        -- aa_user_manages_org: is_admin() OR active gamma+ cert in that org
        v_old := public.is_admin()
              OR EXISTS (SELECT 1 FROM public.app_access_certificates c
                          WHERE c.user_id = r.id AND c.is_active = true
                            AND c.access_level IN ('gamma','delta','epsilon','zeta')
                            AND (c.organization_id = v_org OR c.organization_id IS NULL));
        v_new := public.aa_user_manages_org(r.id, v_org);
        IF v_old IS DISTINCT FROM v_new THEN
            v_failures := v_failures || format('aa_user_manages_org differs for %s ; ', r.email);
        END IF;

        n_checked := n_checked + 1;
        EXIT WHEN v_failures <> '';
    END LOOP;

    PERFORM set_config('request.jwt.claims', '', true);

    IF n_checked = 0 THEN
        v_failures := v_failures || 'no profiles to compare against — the test is vacuous ; ';
    END IF;

    -- The dead function is gone.
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname='public' AND p.proname='user_has_gamma_access_for_subdept') THEN
        v_failures := v_failures || 'user_has_gamma_access_for_subdept still exists ; ';
    END IF;

    -- The wrappers kept the grant their callers depend on.
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname='public'
           AND p.proname IN ('is_admin','is_manager_or_above','user_has_delta_access','aa_user_manages_org')
           AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) THEN
        v_failures := v_failures
            || 'a wrapper lost EXECUTE for authenticated — its policies would fail closed ; ';
    END IF;

    IF v_failures <> '' THEN
        RAISE EXCEPTION 'rbac_phase3_one_threshold selftest FAILED (% profiles checked): %',
                        n_checked, v_failures;
    END IF;

    RAISE NOTICE 'rbac_phase3_one_threshold selftest PASSED — old = new for % profiles', n_checked;
END
$selftest$;
