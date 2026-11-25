-- Tenant isolation foundation: Administrator (zeta) = admin of its OWN organization.
--
-- Decided 2026-11-25: the app will hold several organizations. Until now zeta was
-- global — its certificate had no organization (chk_scope_nullability) and
-- user_has_action_in_scope let any zeta act in every organization — so one
-- customer's Administrator would have run every other customer. rbac_permissions
-- already says zeta:ORG; this makes the data and the checks agree with it.
-- Work across organizations (creating one, support) goes through the service role.
--
-- What changes:
--   1. user_has_action_in_scope: no global bypass.
--   2. zeta certificates carry their contract's organization; the constraint
--      requires it.
--   3. The scope tree, certificate reads, "last Administrator" guards, contract
--      self-management, colleague visibility and the shift-dropped notification
--      all work per organization.
--   4. New is_org_member(org): any contract in that organization.
--   5. The org tree (organizations / departments / sub_departments) and events:
--      reads limited to members, writes to that organization's Administrator.
--   6. can_grant_certificate / can_change_certificate dropped (no callers).
--
-- Deliberately NOT here (still "Administrator anywhere"; each is fixed in its own
-- table review once the table carries organization_id): pay_periods, system_config,
-- work_rules (is_admin), demand_templates (holds_action), performance metrics and
-- snapshots (is_zeta), roster template edits (auth_can_manage_templates), broadcasts
-- and their storage (is_broadcast_system_manager / get_broadcast_group_role).
--
-- Checked against live data 2026-11-25: one active zeta certificate (contract in
-- ICC Sydney); no row any policy checks has a NULL organization_id.

-- ── 1. user_has_action_in_scope: no global bypass ────────────────────────────
CREATE OR REPLACE FUNCTION public.user_has_action_in_scope(p_action_code text, p_org_id uuid, p_dept_id uuid DEFAULT NULL::uuid, p_sub_dept_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    -- Every level, zeta included, acts only inside the organization on its
    -- certificate. zeta's scope is ORG in rbac_permissions.
    SELECT EXISTS (
        SELECT 1
        FROM app_access_certificates ac
        JOIN rbac_permissions rp ON rp.access_level = ac.access_level
        WHERE ac.user_id = auth.uid()
          AND ac.is_active = true
          AND rp.action_code = p_action_code
          AND ac.organization_id = p_org_id
          AND (
              rp.scope = 'ORG'
              OR (rp.scope = 'DEPT' AND ac.department_id = p_dept_id)
              OR (rp.scope = 'SUB_DEPT' AND ac.sub_department_id = p_sub_dept_id)
          )
    );
$function$;

-- ── 2. zeta certificates carry their organization ────────────────────────────
ALTER TABLE public.app_access_certificates DROP CONSTRAINT IF EXISTS chk_scope_nullability;

CREATE OR REPLACE FUNCTION hr.apply_contract_access(p_contract_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
DECLARE
    k         hr.user_contracts%ROWTYPE;
    v_cert    public.app_access_certificates%ROWTYPE;
    v_level   public.access_level;
BEGIN
    SELECT * INTO k FROM hr.user_contracts WHERE id = p_contract_id;
    SELECT * INTO v_cert FROM public.app_access_certificates
     WHERE contract_id = p_contract_id FOR UPDATE;

    IF k.id IS NOT NULL AND k.status = 'Active' AND k.access_level > 'alpha' THEN
        v_level := k.access_level;
        -- Every managerial level, zeta included, reaches the contract's organization.
        IF v_cert.id IS NULL THEN
            INSERT INTO public.app_access_certificates
                   (user_id, certificate_type, access_level, organization_id, department_id,
                    sub_department_id, is_active, contract_id)
            VALUES (k.user_id,
                    CASE WHEN v_level = 'beta' THEN 'X' ELSE 'Y' END,
                    v_level,
                    k.organization_id,
                    CASE WHEN v_level IN ('beta', 'gamma', 'delta') THEN k.department_id END,
                    CASE WHEN v_level IN ('beta', 'gamma') THEN k.sub_department_id END,
                    true, k.id);
        ELSE
            UPDATE public.app_access_certificates
               SET user_id           = k.user_id,
                   certificate_type  = CASE WHEN v_level = 'beta' THEN 'X' ELSE 'Y' END,
                   access_level      = v_level,
                   organization_id   = k.organization_id,
                   department_id     = CASE WHEN v_level IN ('beta', 'gamma', 'delta') THEN k.department_id END,
                   sub_department_id = CASE WHEN v_level IN ('beta', 'gamma') THEN k.sub_department_id END,
                   is_active         = true
             WHERE id = v_cert.id;
        END IF;
    ELSIF v_cert.id IS NOT NULL AND v_cert.is_active THEN
        -- Ended, or lowered to alpha: revoke the mirror (the audit log records it).
        UPDATE public.app_access_certificates SET is_active = false WHERE id = v_cert.id;
    END IF;
END;
$function$;

-- Re-mirror every active zeta contract so its certificate gains the organization.
-- (Runs before the per-organization "last Administrator" trigger below, which
-- would otherwise read the move from NULL as leaving an organization.)
SELECT hr.apply_contract_access(uc.id)
  FROM hr.user_contracts uc
 WHERE uc.access_level = 'zeta' AND uc.status = 'Active';

ALTER TABLE public.app_access_certificates
  ADD CONSTRAINT chk_scope_nullability CHECK (
CASE access_level
    WHEN 'zeta'::access_level    THEN ((organization_id IS NOT NULL) AND (department_id IS NULL) AND (sub_department_id IS NULL))
    WHEN 'epsilon'::access_level THEN ((organization_id IS NOT NULL) AND (department_id IS NULL) AND (sub_department_id IS NULL))
    WHEN 'delta'::access_level   THEN ((organization_id IS NOT NULL) AND (department_id IS NOT NULL) AND (sub_department_id IS NULL))
    WHEN 'gamma'::access_level   THEN ((organization_id IS NOT NULL) AND (department_id IS NOT NULL) AND (sub_department_id IS NOT NULL))
    WHEN 'beta'::access_level    THEN ((organization_id IS NOT NULL) AND (department_id IS NOT NULL) AND (sub_department_id IS NOT NULL))
    ELSE false
END);

-- ── 3. Per-organization guards and helpers ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.access_certificate_keep_last_zeta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    -- Every organization keeps at least one Administrator. Moving the certificate
    -- to another organization also leaves this one.
    IF OLD.access_level = 'zeta' AND OLD.is_active
       AND (TG_OP = 'DELETE' OR NOT NEW.is_active OR NEW.access_level <> 'zeta'
            OR NEW.organization_id IS DISTINCT FROM OLD.organization_id) THEN
        -- serialise concurrent removals of this organization's zeta certificates
        PERFORM 1 FROM public.app_access_certificates
         WHERE access_level = 'zeta' AND is_active AND organization_id = OLD.organization_id FOR UPDATE;
        IF NOT EXISTS (SELECT 1 FROM public.app_access_certificates
                        WHERE access_level = 'zeta' AND is_active
                          AND organization_id = OLD.organization_id AND id <> OLD.id) THEN
            RAISE EXCEPTION 'This is the last Administrator: their access cannot be lowered, ended or removed until another contract carries Administrator access. See docs/operations/access-break-glass.md.'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

CREATE OR REPLACE FUNCTION hr.contract_access_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
BEGIN
    -- Access is set by the Administrator of the contract's organization (and, when
    -- a contract moves, of the one it leaves).
    IF (TG_OP = 'INSERT' AND NEW.access_level > 'alpha')
       OR (TG_OP = 'UPDATE' AND NEW.access_level IS DISTINCT FROM OLD.access_level) THEN
        IF auth.uid() IS NOT NULL AND NOT (
               public.user_has_action_in_scope('access.manage', NEW.organization_id)
           AND (TG_OP = 'INSERT' OR public.user_has_action_in_scope('access.manage', OLD.organization_id))) THEN
            RAISE EXCEPTION 'Only an Administrator can set the access on a contract.'
                USING ERRCODE = '42501';
        END IF;
    END IF;
    -- An end date on the organization's only Administrator contract would expire it
    -- and leave nobody there able to manage access.
    IF NEW.access_level = 'zeta' AND NEW.end_date IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.end_date IS DISTINCT FROM NEW.end_date OR OLD.access_level IS DISTINCT FROM NEW.access_level)
       AND NOT EXISTS (
            SELECT 1 FROM hr.user_contracts c
             WHERE c.id <> NEW.id AND c.access_level = 'zeta' AND c.status = 'Active'
               AND c.organization_id = NEW.organization_id
               AND (c.end_date IS NULL OR c.end_date > NEW.end_date)) THEN
        RAISE EXCEPTION 'This contract carries the only Administrator access, so it can''t have an end date: it would expire and leave nobody to manage access. Give another contract Administrator access first.'
            USING ERRCODE = '23514';
    END IF;
    -- The place the access reaches must be on the row (user_contracts_access_has_place
    -- is the backstop; this says it in words).
    IF NEW.status <> 'Expired' AND (
           (NEW.access_level IN ('beta', 'gamma') AND NEW.sub_department_id IS NULL)
        OR (NEW.access_level = 'delta' AND NEW.department_id IS NULL)
        OR (NEW.access_level = 'epsilon' AND NEW.organization_id IS NULL)) THEN
        RAISE EXCEPTION '% access reaches the contract''s %, and this contract has none.',
            public.access_level_label(NEW.access_level),
            CASE NEW.access_level WHEN 'delta' THEN 'department' WHEN 'epsilon' THEN 'organization' ELSE 'sub-department' END
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION hr.contract_scope_tree(p_user_id uuid, p_min_level access_level)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
    WITH k AS (
        SELECT uc.access_level, uc.organization_id, uc.department_id, uc.sub_department_id
          FROM hr.user_contracts uc
         WHERE uc.user_id = p_user_id
           AND uc.status = 'Active'
           AND uc.access_level >= p_min_level
           AND uc.access_level > 'alpha'          -- alpha reaches nothing beyond own data
    ),
    orgs AS (
        -- Every level reaches only the organization its contract is in.
        SELECT o.id, o.name FROM public.organizations o
         WHERE o.is_active
           AND EXISTS (SELECT 1 FROM k WHERE k.organization_id = o.id)
    ),
    subs AS (
        SELECT sd.id, sd.name, sd.department_id, d.organization_id
          FROM public.sub_departments sd
          JOIN public.departments d ON d.id = sd.department_id
          JOIN orgs ON orgs.id = d.organization_id
         WHERE sd.is_active AND d.is_active
           AND EXISTS (SELECT 1 FROM k
                        WHERE (k.access_level IN ('epsilon', 'zeta') AND k.organization_id = d.organization_id)
                           OR (k.access_level = 'delta' AND k.department_id = d.id)
                           OR (k.access_level IN ('beta', 'gamma') AND k.sub_department_id = sd.id))
    ),
    depts AS (
        -- A department is listed when the reach covers it whole (delta and above), or
        -- when one of its live sub-departments is reached. A gamma whose sub-department
        -- was retired no longer sees a department with nothing under it.
        SELECT d.id, d.name, d.organization_id FROM public.departments d
          JOIN orgs ON orgs.id = d.organization_id
         WHERE d.is_active
           AND (EXISTS (SELECT 1 FROM subs WHERE subs.department_id = d.id)
                OR EXISTS (SELECT 1 FROM k
                            WHERE (k.access_level IN ('epsilon', 'zeta') AND k.organization_id = d.organization_id)
                               OR (k.access_level = 'delta' AND k.department_id = d.id)))
    )
    SELECT jsonb_build_object('organizations', COALESCE(jsonb_agg(
               jsonb_build_object('id', o.id, 'name', o.name, 'departments', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'subdepartments', COALESCE((
                              SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                                FROM subs s WHERE s.department_id = d.id), '[]'::jsonb)) ORDER BY d.name)
                     FROM depts d WHERE d.organization_id = o.id), '[]'::jsonb)) ORDER BY o.name), '[]'::jsonb))
      FROM orgs o;
$function$;

CREATE OR REPLACE FUNCTION public.can_read_certificates_in(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT public.user_has_action_in_scope('access.manage', p_org_id);
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_contract(p_user_id uuid, p_org_id uuid, p_dept_id uuid, p_sub_dept_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    -- Your own contract only as that organization's Administrator.
    SELECT auth.uid() IS NOT NULL
       AND (p_user_id IS DISTINCT FROM auth.uid() OR public.is_org_admin(p_org_id))
       AND public.user_has_action_in_scope('contract.manage', p_org_id, p_dept_id, p_sub_dept_id);
$function$;

CREATE OR REPLACE FUNCTION public.shares_organisation_with(p_other uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  -- zeta no longer matches everyone: its certificate names its organization, so
  -- the certificate branch below covers it.
  SELECT auth.uid() IS NOT NULL AND (
       p_other = auth.uid()
    OR EXISTS (
         SELECT 1 FROM public.user_contracts mine
         JOIN public.user_contracts theirs ON theirs.organization_id = mine.organization_id
          WHERE mine.user_id = auth.uid() AND mine.status = 'Active'
            AND theirs.user_id = p_other AND theirs.status = 'Active')
    OR EXISTS (
         SELECT 1 FROM public.app_access_certificates ac
         JOIN public.user_contracts theirs ON theirs.organization_id = ac.organization_id
          WHERE ac.user_id = auth.uid() AND ac.is_active
            AND theirs.user_id = p_other AND theirs.status = 'Active')
  );
$function$;

CREATE OR REPLACE FUNCTION public.trg_employee_drop_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_manager_id   UUID;
  v_dropper_name TEXT;
BEGIN
  IF (NEW.bidding_status::TEXT = 'on_bidding')
    AND (OLD.bidding_status IS DISTINCT FROM NEW.bidding_status)
    AND OLD.assigned_employee_id IS NOT NULL
    AND NEW.assigned_employee_id IS NULL
  THEN
    SELECT COALESCE(first_name || ' ' || last_name, email, 'An employee')
    INTO   v_dropper_name
    FROM   profiles
    WHERE  id = OLD.assigned_employee_id
    LIMIT  1;

    IF NEW.sub_department_id IS NOT NULL THEN
      SELECT user_id INTO v_manager_id
      FROM   app_access_certificates
      WHERE  sub_department_id = NEW.sub_department_id
        AND  access_level       = 'gamma'
        AND  is_active          = true
      LIMIT  1;
    END IF;

    -- Fall back to an Administrator of the shift's own organization.
    IF v_manager_id IS NULL THEN
      SELECT user_id INTO v_manager_id
      FROM   app_access_certificates
      WHERE  access_level     = 'zeta'
        AND  organization_id  = NEW.organization_id
        AND  is_active        = true
      ORDER  BY created_at
      LIMIT  1;
    END IF;

    IF v_manager_id IS NOT NULL THEN
      PERFORM notify_user(
        v_manager_id,
        'shift_dropped',
        'Shift dropped',
        v_dropper_name || ' dropped their shift on ' || NEW.shift_date || '. It has been re-listed for urgent bidding.',
        NEW.id,
        'shift',
        '/management/bids',
        'shift_dropped:' || NEW.id::TEXT || ':' || OLD.assigned_employee_id::TEXT
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 4. Organization membership ───────────────────────────────────────────────
-- Any contract there, in any status: people keep seeing the organization their
-- past records belong to. Platform work across organizations uses the service role.
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT auth.uid() IS NOT NULL AND p_org_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM hr.user_contracts uc
         WHERE uc.user_id = auth.uid() AND uc.organization_id = p_org_id);
$function$;
REVOKE ALL ON FUNCTION public.is_org_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated, service_role;

-- ── 5. Org tree and events: members read, the organization's Administrator writes
-- organizations
DROP POLICY IF EXISTS "Authenticated users can view organizations" ON public.organizations;
DROP POLICY IF EXISTS organizations_select ON public.organizations;
CREATE POLICY organizations_select ON public.organizations
  FOR SELECT TO authenticated USING (public.is_org_member(id));
-- organizations_update_admin (is_org_admin(id), USING and WITH CHECK) stays; the
-- any-scope is_admin() one goes.
DROP POLICY IF EXISTS organizations_update ON public.organizations;
DROP POLICY IF EXISTS organizations_delete ON public.organizations;
CREATE POLICY organizations_delete ON public.organizations
  FOR DELETE TO authenticated USING (public.is_org_admin(id));
-- New organizations are created by the platform (service role), not in the app.
DROP POLICY IF EXISTS organizations_insert ON public.organizations;

-- departments
DROP POLICY IF EXISTS "Authenticated users can view all departments" ON public.departments;
DROP POLICY IF EXISTS departments_select ON public.departments;
CREATE POLICY departments_select ON public.departments
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
DROP POLICY IF EXISTS departments_insert ON public.departments;
CREATE POLICY departments_insert ON public.departments
  FOR INSERT TO authenticated WITH CHECK (public.is_org_admin(organization_id));
DROP POLICY IF EXISTS departments_update ON public.departments;
CREATE POLICY departments_update ON public.departments
  FOR UPDATE TO authenticated
  USING (public.is_org_admin(organization_id)) WITH CHECK (public.is_org_admin(organization_id));
DROP POLICY IF EXISTS departments_delete ON public.departments;
CREATE POLICY departments_delete ON public.departments
  FOR DELETE TO authenticated USING (public.is_org_admin(organization_id));

-- sub_departments (organization via the department; columns qualified so the
-- subquery cannot bind to its own table)
DROP POLICY IF EXISTS sub_departments_select ON public.sub_departments;
CREATE POLICY sub_departments_select ON public.sub_departments
  FOR SELECT TO authenticated
  USING (public.is_org_member((SELECT d.organization_id FROM public.departments d
                                WHERE d.id = sub_departments.department_id)));
DROP POLICY IF EXISTS sub_departments_insert ON public.sub_departments;
CREATE POLICY sub_departments_insert ON public.sub_departments
  FOR INSERT TO authenticated WITH CHECK (public.can_act_in_dept('org.manage', department_id));
DROP POLICY IF EXISTS sub_departments_update ON public.sub_departments;
CREATE POLICY sub_departments_update ON public.sub_departments
  FOR UPDATE TO authenticated
  USING (public.can_act_in_dept('org.manage', department_id))
  WITH CHECK (public.can_act_in_dept('org.manage', department_id));
DROP POLICY IF EXISTS sub_departments_delete ON public.sub_departments;
CREATE POLICY sub_departments_delete ON public.sub_departments
  FOR DELETE TO authenticated USING (public.can_act_in_dept('org.manage', department_id));

-- events: the any-scope is_admin() branch goes; an Administrator has a contract
-- in their organization, so the contract branch already covers them.
DROP POLICY IF EXISTS events_select_org_scoped ON public.events;
CREATE POLICY events_select_org_scoped ON public.events
  FOR SELECT TO authenticated
  USING ((organization_id IS NULL) OR (organization_id IN (
           SELECT uc.organization_id FROM public.user_contracts uc
            WHERE uc.user_id = (SELECT auth.uid()))));

-- ── 6. Dead code ─────────────────────────────────────────────────────────────
-- No callers in the database, the app, edge functions or tests (checked 2026-11-25);
-- certificates are written only by hr.apply_contract_access().
DROP FUNCTION IF EXISTS public.can_grant_certificate(uuid, uuid, access_level);
DROP FUNCTION IF EXISTS public.can_change_certificate(uuid, uuid, access_level);
