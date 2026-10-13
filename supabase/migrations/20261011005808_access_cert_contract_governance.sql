-- ============================================================================
-- Access matrix, step 2d: contracts by place; certificate governance.
--
-- ── 1. CONTRACTS ARE MANAGED WHERE THEY ARE (decision 5) ────────────────────
-- can_write_contract asked only for the writer's ORGANIZATION-level ceiling, so
-- a delta of one department wrote contracts in any other; contracts_select_delta
-- let any delta, anywhere, read every contract. Both are now the matrix action
-- over the contract's own organization / department / sub-department:
-- contract.manage to write, contract.view to read (pay terms follow their
-- contract). Nobody writes their own contract, except a zeta.
--
-- ── 2. WHO MAY GRANT, CHANGE AND SEE ACCESS (decisions 6, 7) ────────────────
--   grant   an epsilon, inside their own organization, up to epsilon, never to
--           themselves; a zeta, anything
--   change  the same, except an epsilon certificate (or a zeta) can be changed
--           or revoked only by a zeta
--   read    a zeta, every certificate; an epsilon, those in their own
--           organization (they used to see every organization's)
-- The legacy profile flag no longer grants any of this (decision 12): it was
-- accepted by auth_can_manage_certificates and mapped to zeta by
-- caller_access_ceiling. Both helpers are now unreferenced and lose client
-- EXECUTE. The level checks become user_has_action_in_scope('access.grant', …)
-- when that action is added; the rule they state is the same.
--
-- ── 3. REVOKING KEEPS HISTORY (decision 13) ─────────────────────────────────
-- Revocation is is_active = false. DELETE is zeta-only, and logged like
-- everything else. access_certificate_events records every grant, change,
-- revocation, reactivation and delete with the actor (auth.uid(); NULL =
-- system or SQL editor) and the row before and after. created_by is stamped
-- from the JWT — the app never sent it — and updated_at is maintained.
--
-- ── 4. THE LAST ZETA STAYS ──────────────────────────────────────────────────
-- Removing, deactivating or downgrading the last active zeta certificate is
-- refused, so the system cannot be left with no one who can grant access. The
-- recovery path is docs/operations/access-break-glass.md.
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.rewrite_policy(p_schema text, p_table text, p_policy text, p_from text, p_to text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record; v_qual text; v_check text; v_sql text;
BEGIN
    SELECT * INTO r FROM pg_policies WHERE schemaname = p_schema AND tablename = p_table AND policyname = p_policy;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'policy %.% / % not found', p_schema, p_table, p_policy;
    END IF;
    IF coalesce(r.qual, '') !~ p_from AND coalesce(r.with_check, '') !~ p_from THEN
        RAISE EXCEPTION 'policy %.% / % does not contain %', p_schema, p_table, p_policy, p_from;
    END IF;
    v_qual  := regexp_replace(r.qual, p_from, p_to, 'g');
    v_check := regexp_replace(r.with_check, p_from, p_to, 'g');
    EXECUTE format('DROP POLICY %I ON %I.%I', p_policy, p_schema, p_table);
    v_sql := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
                    p_policy, p_schema, p_table, r.permissive, r.cmd, array_to_string(r.roles, ', '));
    IF v_qual  IS NOT NULL THEN v_sql := v_sql || format(' USING (%s)', v_qual); END IF;
    IF v_check IS NOT NULL THEN v_sql := v_sql || format(' WITH CHECK (%s)', v_check); END IF;
    EXECUTE v_sql;
END $$;

-- ── 1. Contracts ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_manage_contract(p_user_id uuid, p_org_id uuid, p_dept_id uuid, p_sub_dept_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT auth.uid() IS NOT NULL
       AND (p_user_id IS DISTINCT FROM auth.uid() OR public.is_zeta())
       AND public.user_has_action_in_scope('contract.manage', p_org_id, p_dept_id, p_sub_dept_id);
$function$;

CREATE OR REPLACE FUNCTION public.can_view_contract(p_contract_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM hr.user_contracts uc
         WHERE uc.id = p_contract_id
           AND public.user_has_action_in_scope('contract.view', uc.organization_id, uc.department_id, uc.sub_department_id));
$function$;

SELECT pg_temp.rewrite_policy('hr', 'user_contracts', p, 'can_write_contract\(user_id, organization_id, access_level\)',
                              'public.can_manage_contract(user_id, organization_id, department_id, sub_department_id)')
  FROM unnest(ARRAY['contracts_delete_manager', 'contracts_insert_manager', 'contracts_update_manager']) AS p;
SELECT pg_temp.rewrite_policy('hr', 'user_contracts', 'contracts_select_delta', 'user_has_delta_access\(\( SELECT auth\.uid\(\) AS uid\)\)',
                              'public.user_has_action_in_scope(''contract.view''::text, organization_id, department_id, sub_department_id)');
ALTER POLICY contracts_select_delta ON hr.user_contracts RENAME TO contracts_select_manager;
SELECT pg_temp.rewrite_policy('hr', 'contract_pay_terms', 'contract_pay_terms_select', 'user_has_delta_access\(\( SELECT auth\.uid\(\) AS uid\)\)',
                              'public.can_view_contract(contract_pay_terms.contract_id)');

-- ── 2. Certificates: grant / change / read ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_grant_certificate(p_user_id uuid, p_org_id uuid, p_level access_level)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT auth.uid() IS NOT NULL AND (
           public.is_zeta()
        OR (    p_user_id IS DISTINCT FROM auth.uid()
            AND p_org_id IS NOT NULL
            AND p_level <= 'epsilon'
            AND EXISTS (SELECT 1 FROM public.app_access_certificates ac
                         WHERE ac.user_id = auth.uid() AND ac.is_active
                           AND ac.access_level = 'epsilon' AND ac.organization_id = p_org_id)));
$function$;

CREATE OR REPLACE FUNCTION public.can_change_certificate(p_user_id uuid, p_org_id uuid, p_level access_level)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT public.is_zeta()
        OR (p_level < 'epsilon' AND public.can_grant_certificate(p_user_id, p_org_id, p_level));
$function$;

CREATE OR REPLACE FUNCTION public.can_read_certificates_in(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT public.is_zeta()
        OR (p_org_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.app_access_certificates ac
                 WHERE ac.user_id = auth.uid() AND ac.is_active
                   AND ac.access_level = 'epsilon' AND ac.organization_id = p_org_id));
$function$;

DROP POLICY certificates_select_manager ON public.app_access_certificates;
CREATE POLICY certificates_select_manager ON public.app_access_certificates
    AS PERMISSIVE FOR SELECT TO authenticated
    USING (public.can_read_certificates_in(organization_id));

DROP POLICY certificates_update_manager ON public.app_access_certificates;
CREATE POLICY certificates_update_manager ON public.app_access_certificates
    AS PERMISSIVE FOR UPDATE TO authenticated
    USING (public.can_change_certificate(user_id, organization_id, access_level))
    WITH CHECK (public.can_grant_certificate(user_id, organization_id, access_level));

DROP POLICY certificates_delete_manager ON public.app_access_certificates;
CREATE POLICY certificates_delete_zeta ON public.app_access_certificates
    AS PERMISSIVE FOR DELETE TO authenticated
    USING (public.is_zeta());
-- certificates_insert_manager is unchanged: WITH CHECK can_grant_certificate(...)

-- ── 3. History ──────────────────────────────────────────────────────────────
CREATE TABLE public.access_certificate_events (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    certificate_id  uuid        NOT NULL,
    subject_id      uuid        NOT NULL,
    organization_id uuid,
    action          text        NOT NULL CHECK (action IN ('baseline', 'granted', 'changed', 'revoked', 'reactivated', 'deleted')),
    actor_id        uuid,
    before          jsonb,
    after           jsonb,
    occurred_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.access_certificate_events IS
    'Append-only history of app_access_certificates: who granted, changed, revoked, reactivated or deleted which access, when. actor_id NULL = system / SQL editor. No foreign keys on purpose: the history outlives the certificate and the profile. Written only by the trg_access_certificate_log trigger.';
CREATE INDEX idx_access_certificate_events_subject ON public.access_certificate_events (subject_id, occurred_at DESC);
CREATE INDEX idx_access_certificate_events_org     ON public.access_certificate_events (organization_id, occurred_at DESC);
ALTER TABLE public.access_certificate_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.access_certificate_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.access_certificate_events TO authenticated;
CREATE POLICY access_certificate_events_read ON public.access_certificate_events
    AS PERMISSIVE FOR SELECT TO authenticated
    USING (subject_id = (SELECT auth.uid()) OR public.can_read_certificates_in(organization_id));

CREATE OR REPLACE FUNCTION public.access_certificate_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF auth.uid() IS NOT NULL THEN
            NEW.created_by := auth.uid();
        END IF;
        NEW.created_at := COALESCE(NEW.created_at, now());
    ELSE
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.access_certificate_keep_last_zeta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF OLD.access_level = 'zeta' AND OLD.is_active
       AND (TG_OP = 'DELETE' OR NOT NEW.is_active OR NEW.access_level <> 'zeta') THEN
        -- serialise concurrent removals of zeta certificates
        PERFORM 1 FROM public.app_access_certificates
         WHERE access_level = 'zeta' AND is_active FOR UPDATE;
        IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates
                        WHERE access_level = 'zeta' AND is_active AND id <> OLD.id) THEN
            RAISE EXCEPTION 'The last active zeta certificate cannot be removed. Grant another zeta first; see docs/operations/access-break-glass.md.'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.access_certificate_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_action text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_action := 'granted';
    ELSIF TG_OP = 'DELETE' THEN
        v_action := 'deleted';
    ELSE
        IF (OLD.user_id, OLD.certificate_type, OLD.access_level, OLD.organization_id, OLD.department_id, OLD.sub_department_id, OLD.is_active)
           IS NOT DISTINCT FROM
           (NEW.user_id, NEW.certificate_type, NEW.access_level, NEW.organization_id, NEW.department_id, NEW.sub_department_id, NEW.is_active) THEN
            RETURN NULL;  -- bookkeeping only (updated_at)
        END IF;
        v_action := CASE WHEN OLD.is_active AND NOT NEW.is_active THEN 'revoked'
                         WHEN NOT OLD.is_active AND NEW.is_active THEN 'reactivated'
                         ELSE 'changed' END;
    END IF;
    INSERT INTO public.access_certificate_events (certificate_id, subject_id, organization_id, action, actor_id, before, after)
    VALUES (CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
            CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END,
            CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END,
            v_action,
            auth.uid(),
            CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END);
    RETURN NULL;
END;
$function$;

CREATE TRIGGER trg_access_certificate_stamp
    BEFORE INSERT OR UPDATE ON public.app_access_certificates
    FOR EACH ROW EXECUTE FUNCTION public.access_certificate_stamp();
CREATE TRIGGER trg_access_certificate_keep_last_zeta
    BEFORE UPDATE OR DELETE ON public.app_access_certificates
    FOR EACH ROW EXECUTE FUNCTION public.access_certificate_keep_last_zeta();
CREATE TRIGGER trg_access_certificate_log
    AFTER INSERT OR UPDATE OR DELETE ON public.app_access_certificates
    FOR EACH ROW EXECUTE FUNCTION public.access_certificate_log();

-- The history starts with the access that exists today.
INSERT INTO public.access_certificate_events (certificate_id, subject_id, organization_id, action, actor_id, after, occurred_at)
SELECT c.id, c.user_id, c.organization_id, 'baseline', NULL, to_jsonb(c), now()
  FROM public.app_access_certificates c;

-- ── ACLs ────────────────────────────────────────────────────────────────────
DO $acl$
DECLARE f text;
BEGIN
    FOREACH f IN ARRAY ARRAY['public.can_manage_contract(uuid,uuid,uuid,uuid)', 'public.can_view_contract(uuid)',
                             'public.can_change_certificate(uuid,uuid,access_level)', 'public.can_read_certificates_in(uuid)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
    END LOOP;
    -- trigger bodies, and helpers nothing calls any more
    FOREACH f IN ARRAY ARRAY['public.access_certificate_stamp()', 'public.access_certificate_keep_last_zeta()',
                             'public.access_certificate_log()', 'public.auth_can_manage_certificates()',
                             'public.caller_access_ceiling(uuid)', 'public.can_write_contract(uuid,uuid,access_level)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
END
$acl$;

-- ── Verify ──────────────────────────────────────────────────────────────────
DO $verify$
DECLARE v_failures text := '';
BEGIN
    IF EXISTS (SELECT 1 FROM pg_policies
                WHERE (schemaname, tablename) IN (('hr', 'user_contracts'), ('hr', 'contract_pay_terms'), ('public', 'app_access_certificates'))
                  AND coalesce(qual, '') || ' ' || coalesce(with_check, '')
                      ~ '(can_write_contract|user_has_delta_access|auth_can_manage_certificates|caller_access_ceiling)\(') THEN
        v_failures := v_failures || 'a contract/certificate policy still uses a retired helper ; ';
    END IF;
    IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.app_access_certificates'::regclass
          AND tgname IN ('trg_access_certificate_stamp', 'trg_access_certificate_keep_last_zeta', 'trg_access_certificate_log')) <> 3 THEN
        v_failures := v_failures || 'certificate triggers missing ; ';
    END IF;
    IF pg_get_functiondef('public.can_grant_certificate(uuid,uuid,access_level)'::regprocedure) ~ '(legacy_system_role|caller_access_ceiling|auth_can_manage_certificates)' THEN
        v_failures := v_failures || 'can_grant_certificate still reads a legacy path ; ';
    END IF;
    IF has_table_privilege('anon', 'public.access_certificate_events', 'SELECT')
       OR has_table_privilege('authenticated', 'public.access_certificate_events', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
        v_failures := v_failures || 'access_certificate_events writable or anon-readable ; ';
    END IF;
    IF has_function_privilege('authenticated', 'public.auth_can_manage_certificates()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.caller_access_ceiling(uuid)', 'EXECUTE') THEN
        v_failures := v_failures || 'retired helpers still client-callable ; ';
    END IF;
    IF (SELECT count(*) FROM public.access_certificate_events WHERE action = 'baseline')
       <> (SELECT count(*) FROM public.app_access_certificates) THEN
        v_failures := v_failures || 'baseline history incomplete ; ';
    END IF;
    IF v_failures <> '' THEN
        RAISE EXCEPTION 'access matrix step 2d verification failed: %', v_failures;
    END IF;
END
$verify$;
