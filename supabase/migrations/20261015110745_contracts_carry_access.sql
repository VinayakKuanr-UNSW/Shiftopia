-- Contracts carry access.
--
-- One row per position: a person's contract (organization, department, sub-department,
-- role, employment type, remuneration) now also carries the ACCESS LEVEL that position
-- gives, and that access reaches the row's own place:
--
--   alpha    the row's sub-department, own data only (every contract; nothing to issue)
--   beta     the row's sub-department: its Timesheets, read-only (team leads)
--   gamma    the row's sub-department, full
--   delta    the row's department and all its sub-departments, read-only
--   epsilon  the row's organization, read-only
--   zeta     everything, plus the Admin suite
--
-- A person's access is the union of their active contracts (EBA cl 13 multi-hiring:
-- several positions, each with its own place). Access is set by zeta only.
--
-- app_access_certificates stays, as a READ-ONLY MIRROR of the contracts: one row per
-- contract whose access is above alpha, written only by hr.apply_contract_access().
-- Every policy and function that reads certificates (~70) keeps working unchanged, as
-- do the audit log (access_certificate_events), the last-zeta guard and the
-- place guards; ending or lowering a contract revokes its mirror row, which the audit
-- log records. Type X / Type Y survive only as a derived column (beta = X).
--
-- Also here, as database backstops for rules the contract wizard already applies:
--   * contracted hours by employment type (EBA cl 12.2–12.5, 35.3);
--   * the retired helper auth_can_manage_certificates() is dropped (no caller; it still
--     honoured the retired legacy_system_role flag).

-- ── 0. The names people see for each level ───────────────────────────────────
-- Levels stay alpha–zeta in the data; messages and screens use these names
-- (src/platform/auth/constants.ts ACCESS_LEVEL_CONFIG carries the same ones).
CREATE OR REPLACE FUNCTION public.access_level_label(p_level public.access_level)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
    SELECT CASE p_level
        WHEN 'alpha'   THEN 'Employee'
        WHEN 'beta'    THEN 'Team Lead'
        WHEN 'gamma'   THEN 'Manager'
        WHEN 'delta'   THEN 'Department Viewer'
        WHEN 'epsilon' THEN 'Organisation Viewer'
        WHEN 'zeta'    THEN 'Administrator'
    END;
$function$;

-- ── 1. Beta reaches its own row's sub-department, not every contracted one ──────
UPDATE public.rbac_permissions SET scope = 'SUB_DEPT'
 WHERE access_level = 'beta' AND scope = 'CONTRACTED';
ALTER TABLE public.rbac_permissions
    ADD CONSTRAINT rbac_permissions_no_contracted_scope CHECK (scope <> 'CONTRACTED');

CREATE OR REPLACE FUNCTION public.user_has_action_in_scope(p_action_code text, p_org_id uuid, p_dept_id uuid DEFAULT NULL::uuid, p_sub_dept_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM app_access_certificates ac
        JOIN rbac_permissions rp ON rp.access_level = ac.access_level
        WHERE ac.user_id = auth.uid()
          AND ac.is_active = true
          AND rp.action_code = p_action_code
          AND (
              ac.access_level = 'zeta' -- Global bypass for Zeta certs
              OR (ac.organization_id = p_org_id AND (
                  rp.scope = 'ORG'
                  OR (rp.scope = 'DEPT' AND ac.department_id = p_dept_id)
                  OR (rp.scope = 'SUB_DEPT' AND ac.sub_department_id = p_sub_dept_id)
              ))
          )
    );
$function$;

-- ── 2. The access level on each contract ─────────────────────────────────────
ALTER TABLE hr.user_contracts DROP CONSTRAINT user_contracts_no_access_level;
UPDATE hr.user_contracts SET access_level = 'alpha' WHERE access_level IS NULL;
ALTER TABLE hr.user_contracts
    ALTER COLUMN access_level SET DEFAULT 'alpha',
    ALTER COLUMN access_level SET NOT NULL;

-- Carry the existing certificates over to contracts. A managerial certificate goes on
-- one contract in its place (the most permanent there); beta, which used to reach every
-- contracted sub-department, goes on every active contract. A certificate with no
-- contract in its place cannot be carried and stops the migration: fix the data first.
DO $carry$
DECLARE
    c          record;
    v_contract uuid;
BEGIN
    FOR c IN SELECT * FROM public.app_access_certificates
              WHERE is_active AND access_level > 'alpha'
              ORDER BY access_level DESC LOOP
        IF c.access_level = 'beta' THEN
            UPDATE hr.user_contracts SET access_level = 'beta'
             WHERE user_id = c.user_id AND status = 'Active' AND access_level = 'alpha'
               AND sub_department_id IS NOT NULL;
            CONTINUE;
        END IF;
        SELECT uc.id INTO v_contract
          FROM hr.user_contracts uc
         WHERE uc.user_id = c.user_id AND uc.status = 'Active' AND uc.access_level = 'alpha'
           AND (c.access_level = 'zeta' OR uc.organization_id = c.organization_id)
           AND (c.access_level NOT IN ('delta', 'gamma') OR uc.department_id = c.department_id)
           AND (c.access_level <> 'gamma' OR uc.sub_department_id = c.sub_department_id)
         ORDER BY CASE uc.employment_status WHEN 'Full-Time' THEN 0 WHEN 'Part-Time' THEN 1
                                            WHEN 'Flexible Part-Time' THEN 2 ELSE 3 END,
                  uc.engagement_kind = 'multi_hire', uc.created_at, uc.id
         LIMIT 1;
        IF v_contract IS NULL THEN
            RAISE EXCEPTION 'Certificate % (% for user %) has no active contract in its place to move onto. Add the contract, or revoke the certificate, then re-run.',
                c.id, c.access_level, c.user_id;
        END IF;
        UPDATE hr.user_contracts SET access_level = c.access_level WHERE id = v_contract;
    END LOOP;
END
$carry$;

-- Access names a place the row must have.
ALTER TABLE hr.user_contracts ADD CONSTRAINT user_contracts_access_has_place CHECK (
    status <> 'Active' OR CASE access_level
        WHEN 'beta'    THEN sub_department_id IS NOT NULL
        WHEN 'gamma'   THEN sub_department_id IS NOT NULL
        WHEN 'delta'   THEN department_id IS NOT NULL
        WHEN 'epsilon' THEN organization_id IS NOT NULL
        ELSE true END);
COMMENT ON COLUMN hr.user_contracts.access_level IS
    'Access this position gives, reaching the row''s own place (alpha/beta/gamma: its sub-department; delta: its department; epsilon: its organization; zeta: everything + Admin). Set by zeta only. Mirrored into app_access_certificates.';

-- ── 3. Certificates become the mirror of contracts ───────────────────────────
ALTER TABLE public.app_access_certificates
    ADD COLUMN contract_id uuid REFERENCES hr.user_contracts(id) ON DELETE CASCADE;
DROP INDEX public.idx_unique_type_x_per_user;
DROP INDEX public.idx_unique_type_y_per_user;
ALTER TABLE public.app_access_certificates DROP CONSTRAINT chk_scope_nullability;

CREATE OR REPLACE FUNCTION public.validate_certificate_on_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    -- A certificate mirrors one contract (contracts carry access). It is written only
    -- by hr.apply_contract_access(), and stays tied to the contract it mirrors.
    IF NEW.contract_id IS NULL THEN
        RAISE EXCEPTION 'Access is set on a contract, not issued as a certificate.'
            USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.contract_id IS NOT NULL AND NEW.contract_id IS DISTINCT FROM OLD.contract_id THEN
        RAISE EXCEPTION 'A certificate stays with the contract it mirrors.'
            USING ERRCODE = '42501';
    END IF;

    IF NEW.certificate_type = 'X' AND NEW.access_level > 'beta' THEN
        RAISE EXCEPTION 'Type X certificates must have alpha or beta level.';
    END IF;

    IF NEW.certificate_type = 'Y' AND NEW.access_level < 'gamma' THEN
        RAISE EXCEPTION 'Type Y certificates must be gamma or above.';
    END IF;

    IF NEW.is_active AND (
           EXISTS (SELECT 1 FROM organizations   WHERE id = NEW.organization_id   AND NOT is_active)
        OR EXISTS (SELECT 1 FROM departments     WHERE id = NEW.department_id     AND NOT is_active)
        OR EXISTS (SELECT 1 FROM sub_departments WHERE id = NEW.sub_department_id AND NOT is_active)) THEN
        RAISE EXCEPTION 'Access cannot be granted in a retired organization, department or sub-department.'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.department_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM departments
            WHERE id = NEW.department_id AND organization_id = NEW.organization_id
        ) THEN
            RAISE EXCEPTION 'Department does not belong to the specified organization.';
        END IF;
    END IF;

    IF NEW.sub_department_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM sub_departments
            WHERE id = NEW.sub_department_id AND department_id = NEW.department_id
        ) THEN
            RAISE EXCEPTION 'Sub-department does not belong to the specified department.';
        END IF;
    END IF;

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
            RAISE EXCEPTION 'This is the last Administrator: their access cannot be lowered, ended or removed until another contract carries Administrator access. See docs/operations/access-break-glass.md.'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
CREATE OR REPLACE FUNCTION public.place_keep_access_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_kind  text := CASE TG_TABLE_NAME WHEN 'organizations' THEN 'organization'
                                       WHEN 'departments'   THEN 'department'
                                       ELSE 'sub-department' END;
    v_verb  text := CASE TG_OP WHEN 'DELETE' THEN 'delete' ELSE 'retire' END;
    v_count int;
    v_who   text;
BEGIN
    -- Only removing a place, or retiring it (active → inactive), can strand a grant.
    IF TG_OP = 'UPDATE' AND NOT (OLD.is_active AND NOT NEW.is_active) THEN
        RETURN NEW;
    END IF;

    SELECT count(*),
           string_agg(holder, ', ' ORDER BY rn) FILTER (WHERE rn <= 3)
      INTO v_count, v_who
      FROM (
        SELECT public.access_level_label(ac.access_level) || ' — '
               || COALESCE(NULLIF(trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
                           p.email, ac.user_id::text) AS holder,
               row_number() OVER (ORDER BY ac.access_level DESC, ac.created_at) AS rn
          FROM public.app_access_certificates ac
          LEFT JOIN public.profiles p ON p.id = ac.user_id
         WHERE ac.is_active
           AND CASE TG_TABLE_NAME
                 WHEN 'organizations' THEN ac.organization_id = OLD.id
                 WHEN 'departments'   THEN ac.department_id = OLD.id
                 ELSE ac.sub_department_id = OLD.id
               END
      ) scoped;

    IF v_count > 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = CASE TG_OP WHEN 'DELETE' THEN '23503' ELSE '23514' END,
            MESSAGE = format('Cannot %s %s "%s": %s contract%s %s access there (%s%s). Change the access on %s contract%s on the Users page first.',
                             v_verb, v_kind, OLD.name, v_count,
                             CASE WHEN v_count = 1 THEN '' ELSE 's' END,
                             CASE WHEN v_count = 1 THEN 'carries' ELSE 'carry' END,
                             v_who,
                             CASE WHEN v_count > 3 THEN format(', and %s more', v_count - 3) ELSE '' END,
                             CASE WHEN v_count = 1 THEN 'that' ELSE 'those' END,
                             CASE WHEN v_count = 1 THEN '' ELSE 's' END),
            HINT = 'Ended contracts and revoked access do not block this.';
    END IF;

    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

-- The one writer of certificates: make contract p_contract_id's mirror row match it.
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
        IF v_cert.id IS NULL THEN
            INSERT INTO public.app_access_certificates
                   (user_id, certificate_type, access_level, organization_id, department_id,
                    sub_department_id, is_active, contract_id)
            VALUES (k.user_id,
                    CASE WHEN v_level = 'beta' THEN 'X' ELSE 'Y' END,
                    v_level,
                    CASE WHEN v_level = 'zeta' THEN NULL ELSE k.organization_id END,
                    CASE WHEN v_level IN ('beta', 'gamma', 'delta') THEN k.department_id END,
                    CASE WHEN v_level IN ('beta', 'gamma') THEN k.sub_department_id END,
                    true, k.id);
        ELSE
            UPDATE public.app_access_certificates
               SET user_id           = k.user_id,
                   certificate_type  = CASE WHEN v_level = 'beta' THEN 'X' ELSE 'Y' END,
                   access_level      = v_level,
                   organization_id   = CASE WHEN v_level = 'zeta' THEN NULL ELSE k.organization_id END,
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
REVOKE ALL ON FUNCTION hr.apply_contract_access(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hr.contract_access_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
BEGIN
    -- A deleted contract takes its mirror row with it (ON DELETE CASCADE).
    PERFORM hr.apply_contract_access(NEW.id);
    RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION hr.contract_access_sync() FROM PUBLIC, anon, authenticated;

-- Only the Admin suite sets access on a contract (contract writes are zeta-only today;
-- this keeps the two independent). No session (migrations, service jobs) passes.
CREATE OR REPLACE FUNCTION hr.contract_access_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
BEGIN
    IF (TG_OP = 'INSERT' AND NEW.access_level > 'alpha')
       OR (TG_OP = 'UPDATE' AND NEW.access_level IS DISTINCT FROM OLD.access_level) THEN
        IF auth.uid() IS NOT NULL AND NOT public.holds_action('access.manage') THEN
            RAISE EXCEPTION 'Only an Administrator can set the access on a contract.'
                USING ERRCODE = '42501';
        END IF;
    END IF;
    -- The place the access reaches must be on the row (user_contracts_access_has_place
    -- is the backstop; this says it in words).
    IF NEW.status = 'Active' AND (
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
REVOKE ALL ON FUNCTION hr.contract_access_guard() FROM PUBLIC, anon, authenticated;

-- Rebuild every mirror row from the contracts: used once below, and by fixtures that
-- load contracts with triggers off.
CREATE OR REPLACE FUNCTION hr.reconcile_contract_access()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
DECLARE
    k   record;
    n   integer := 0;
BEGIN
    FOR k IN SELECT id FROM hr.user_contracts
              WHERE (status = 'Active' AND access_level > 'alpha')
                 OR EXISTS (SELECT 1 FROM public.app_access_certificates ac
                             WHERE ac.contract_id = hr.user_contracts.id AND ac.is_active)
              ORDER BY id LOOP
        PERFORM hr.apply_contract_access(k.id);
        n := n + 1;
    END LOOP;
    RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION hr.reconcile_contract_access() FROM PUBLIC, anon, authenticated;

-- Link each carried-over certificate to its contract, keeping its id and history.
DO $link$
DECLARE
    k      record;
    v_cert uuid;
BEGIN
    FOR k IN SELECT * FROM hr.user_contracts
              WHERE status = 'Active' AND access_level > 'alpha'
              ORDER BY access_level DESC, created_at, id LOOP
        SELECT id INTO v_cert FROM public.app_access_certificates
         WHERE user_id = k.user_id AND access_level = k.access_level
           AND is_active AND contract_id IS NULL
         ORDER BY created_at, id LIMIT 1;
        IF v_cert IS NOT NULL THEN
            UPDATE public.app_access_certificates SET contract_id = k.id WHERE id = v_cert;
        END IF;
        PERFORM hr.apply_contract_access(k.id);
    END LOOP;
END
$link$;

-- Whatever is left described no contract: alpha certificates (alpha needs none) and
-- revoked ones. The audit log keeps every row it deletes.
DELETE FROM public.app_access_certificates WHERE contract_id IS NULL;

ALTER TABLE public.app_access_certificates
    ALTER COLUMN contract_id SET NOT NULL,
    ADD CONSTRAINT app_access_certificates_contract_id_key UNIQUE (contract_id),
    ADD CONSTRAINT chk_scope_nullability CHECK (
        CASE access_level
            WHEN 'zeta'    THEN organization_id IS NULL     AND department_id IS NULL     AND sub_department_id IS NULL
            WHEN 'epsilon' THEN organization_id IS NOT NULL AND department_id IS NULL     AND sub_department_id IS NULL
            WHEN 'delta'   THEN organization_id IS NOT NULL AND department_id IS NOT NULL AND sub_department_id IS NULL
            WHEN 'gamma'   THEN organization_id IS NOT NULL AND department_id IS NOT NULL AND sub_department_id IS NOT NULL
            WHEN 'beta'    THEN organization_id IS NOT NULL AND department_id IS NOT NULL AND sub_department_id IS NOT NULL
            ELSE false
        END);
COMMENT ON TABLE public.app_access_certificates IS
    'Read-only mirror of contract access (hr.user_contracts.access_level): one row per contract above alpha, written only by hr.apply_contract_access(). Set access on the contract.';

CREATE TRIGGER trg_contract_access_guard
    BEFORE INSERT OR UPDATE ON hr.user_contracts
    FOR EACH ROW EXECUTE FUNCTION hr.contract_access_guard();
CREATE TRIGGER trg_contract_access_sync
    AFTER INSERT OR UPDATE OF access_level, status, user_id, organization_id, department_id, sub_department_id
    ON hr.user_contracts
    FOR EACH ROW EXECUTE FUNCTION hr.contract_access_sync();

-- Nobody writes certificates directly any more.
DROP POLICY certificates_insert_manager ON public.app_access_certificates;
DROP POLICY certificates_update_manager ON public.app_access_certificates;
DROP POLICY certificates_delete_zeta ON public.app_access_certificates;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.app_access_certificates FROM anon, authenticated;

-- ── 4. What the app is told: every managerial row, and the union of their places ──
CREATE OR REPLACE FUNCTION public.resolve_user_permissions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_user_id UUID;
    v_type_x JSONB;
    v_type_y JSONB;
    v_scope_tree JSONB;
    v_y_level access_level;
    v_y_org_id UUID;
    v_y_dept_id UUID;
    v_y_subdept_id UUID;
    v_contracted_tree JSONB;
    v_type_ys JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;


    -- =============================================
    -- 1. Build typeX array (all active Type X certs)
    -- =============================================
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ac.id,
            'level', ac.access_level::text,
            'org_id', ac.organization_id,
            'dept_id', ac.department_id,
            'subdept_id', ac.sub_department_id,
            'org_name', o.name,
            'dept_name', d.name,
            'subdept_name', sd.name
        )
    ), '[]'::jsonb)
    INTO v_type_x
    FROM app_access_certificates ac
    LEFT JOIN organizations o ON o.id = ac.organization_id
    LEFT JOIN departments d ON d.id = ac.department_id
    LEFT JOIN sub_departments sd ON sd.id = ac.sub_department_id
    WHERE ac.user_id = v_user_id
      AND ac.certificate_type = 'X'
      AND ac.is_active = true;

    -- =============================================
    -- 2. Build typeY object
    -- =============================================
    SELECT jsonb_build_object(
        'id', ac.id,
        'level', ac.access_level::text,
        'org_id', ac.organization_id,
        'dept_id', ac.department_id,
        'subdept_id', ac.sub_department_id,
        'org_name', o.name,
        'dept_name', d.name,
        'subdept_name', sd.name
    ),
    ac.access_level,
    ac.organization_id,
    ac.department_id,
    ac.sub_department_id
    INTO v_type_y, v_y_level, v_y_org_id, v_y_dept_id, v_y_subdept_id
    FROM app_access_certificates ac
    LEFT JOIN organizations o ON o.id = ac.organization_id
    LEFT JOIN departments d ON d.id = ac.department_id
    LEFT JOIN sub_departments sd ON sd.id = ac.sub_department_id
    WHERE ac.user_id = v_user_id
      AND ac.certificate_type = 'Y'
      AND ac.is_active = true
    ORDER BY ac.access_level DESC, ac.created_at, ac.id   -- the highest, when several
    LIMIT 1;

    -- Every managerial contract (a person may hold several).
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', ac.id,
        'level', ac.access_level::text,
        'org_id', ac.organization_id,
        'dept_id', ac.department_id,
        'subdept_id', ac.sub_department_id,
        'org_name', o.name,
        'dept_name', d.name,
        'subdept_name', sd.name
    ) ORDER BY ac.access_level DESC, ac.created_at, ac.id), '[]'::jsonb)
    INTO v_type_ys
    FROM app_access_certificates ac
    LEFT JOIN organizations o ON o.id = ac.organization_id
    LEFT JOIN departments d ON d.id = ac.department_id
    LEFT JOIN sub_departments sd ON sd.id = ac.sub_department_id
    WHERE ac.user_id = v_user_id
      AND ac.certificate_type = 'Y'
      AND ac.is_active = true;

    -- IF no Type Y certificate found but user is an admin, grant Zeta access
    -- Synthetic-zeta branch removed by migration 20260825220000.
    -- A legacy_system_role='admin' holding no Type Y certificate used to be
    -- promoted here to zeta — ALL organizations — which is strictly more than
    -- any certificate this system can issue, and had no counterpart in
    -- user_has_action_in_scope. It also emitted a typeY object with a NULL id,
    -- violating the PermissionCert contract the frontend reads. Such a profile
    -- now resolves to no managerial level, like anyone else without a Type Y.

    -- =============================================
    -- 3. allowed_scope_tree: the union of every place the person's managerial
    --    contracts reach (contracts carry access; a person may hold several).
    -- =============================================
    WITH y AS (
        SELECT ac.access_level, ac.organization_id, ac.department_id, ac.sub_department_id
          FROM app_access_certificates ac
         WHERE ac.user_id = v_user_id AND ac.certificate_type = 'Y' AND ac.is_active
    ),
    orgs AS (
        SELECT o.id, o.name FROM organizations o
         WHERE o.is_active
           AND EXISTS (SELECT 1 FROM y WHERE y.access_level = 'zeta' OR y.organization_id = o.id)
    ),
    depts AS (
        SELECT d.id, d.name, d.organization_id FROM departments d
          JOIN orgs ON orgs.id = d.organization_id
         WHERE d.is_active
           AND EXISTS (SELECT 1 FROM y
                        WHERE y.access_level = 'zeta'
                           OR (y.access_level = 'epsilon' AND y.organization_id = d.organization_id)
                           OR (y.access_level IN ('delta', 'gamma') AND y.department_id = d.id))
    ),
    subs AS (
        SELECT sd.id, sd.name, sd.department_id FROM sub_departments sd
          JOIN depts ON depts.id = sd.department_id
         WHERE sd.is_active
           AND EXISTS (SELECT 1 FROM y
                        WHERE y.access_level = 'zeta'
                           OR (y.access_level = 'epsilon' AND y.organization_id = depts.organization_id)
                           OR (y.access_level = 'delta' AND y.department_id = sd.department_id)
                           OR (y.access_level = 'gamma' AND y.sub_department_id = sd.id))
    )
    SELECT jsonb_build_object('organizations', COALESCE(jsonb_agg(
               jsonb_build_object('id', o.id, 'name', o.name, 'departments', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'subdepartments', COALESCE((
                              SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                                FROM subs s WHERE s.department_id = d.id), '[]'::jsonb)) ORDER BY d.name)
                     FROM depts d WHERE d.organization_id = o.id), '[]'::jsonb)) ORDER BY o.name), '[]'::jsonb))
      INTO v_scope_tree
      FROM orgs o;

    -- =============================================
    -- 4. Personal scope: every sub-department contracted to (access suites)
    -- =============================================
    SELECT jsonb_build_object('organizations', COALESCE(jsonb_agg(per_org.org ORDER BY per_org.org->>'name'), '[]'::jsonb))
      INTO v_contracted_tree
      FROM (
        SELECT jsonb_build_object('id', o.id, 'name', o.name,
                                  'departments', jsonb_agg(per_dept.dept ORDER BY per_dept.dept->>'name')) AS org
          FROM (
            SELECT d.organization_id,
                   jsonb_build_object('id', d.id, 'name', d.name,
                                      'subdepartments', jsonb_agg(DISTINCT jsonb_build_object('id', sd.id, 'name', sd.name))) AS dept
              FROM hr.user_contracts uc
              JOIN departments d ON d.id = uc.department_id
              JOIN sub_departments sd ON sd.id = uc.sub_department_id
             WHERE uc.user_id = v_user_id
               AND uc.status = 'Active'
             GROUP BY d.organization_id, d.id, d.name
          ) per_dept
          JOIN organizations o ON o.id = per_dept.organization_id
         GROUP BY o.id, o.name
      ) per_org;

    RETURN jsonb_build_object(
        'typeX', v_type_x,
        'typeY', v_type_y,
        'typeYs', v_type_ys,
        'allowed_scope_tree', v_scope_tree,
        'contracted_scope_tree', v_contracted_tree
    );
END;
$function$;

-- ── 5. Contracted hours by employment type (EBA) ──────────────────────────────
CREATE OR REPLACE FUNCTION hr.fn_check_user_contract_guardrails()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'hr', 'public'
AS $function$
DECLARE
    v_ft_positions  INT;
    v_pt_count      INT;
    v_pt_weekly_sum NUMERIC;
    v_new_weekly    NUMERIC;
    k_no_id CONSTANT uuid := '00000000-0000-0000-0000-000000000000'::uuid;
BEGIN
    IF NEW.status <> 'Active' THEN
        RETURN NEW;
    END IF;

    -- Serialise contract writes for this ONE employee. Replaces the
    -- concurrency guarantee of the dropped partial unique index.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));

    IF NEW.employment_status = 'Full-Time' THEN
        v_new_weekly := 38;
    ELSIF NEW.employment_status = 'Part-Time' THEN
        v_new_weekly := COALESCE(NEW.contracted_weekly_hours, 0);
    ELSIF NEW.employment_status = 'Flexible Part-Time' THEN
        IF COALESCE(NEW.contracted_weekly_hours, 0) > 0 THEN
            v_new_weekly := NEW.contracted_weekly_hours;
        ELSE
            v_new_weekly := COALESCE(NEW.annual_guaranteed_hours, 0) / 52.0;
        END IF;
    ELSE
        v_new_weekly := 0;
    END IF;

    -- 0. Contracted hours follow the employment type (EBA). The contract wizard
    --    applies the same rules (evaluateHoursRule); this is the backstop.
    IF NEW.employment_status = 'Full-Time' THEN
        NEW.contracted_weekly_hours := COALESCE(NEW.contracted_weekly_hours, 38);
        IF NEW.contracted_weekly_hours <> 38 THEN
            RAISE EXCEPTION 'Full-Time is 38 ordinary hours a week (EBA cl 12.2(b)).'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.employment_status = 'Part-Time' THEN
        IF NOT (COALESCE(NEW.contracted_weekly_hours, 0) > 0 AND NEW.contracted_weekly_hours < 38) THEN
            RAISE EXCEPTION 'Part-Time hours must be more than 0 and less than 38 a week (EBA cl 12.3(b)).'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.employment_status = 'Flexible Part-Time' THEN
        IF NEW.annual_guaranteed_hours IS NULL OR NEW.annual_guaranteed_hours NOT BETWEEN 624 AND 1976 THEN
            RAISE EXCEPTION 'Flexible Part-Time is engaged for 624 to 1,976 ordinary hours a year (EBA cl 12.4(a), 35.3(a)).'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.employment_status = 'Casual' THEN
        -- A casual is engaged by the hour with no firm commitment (cl 12.5(a)):
        -- contracted hours mean nothing, so none are kept.
        NEW.contracted_weekly_hours := 0;
        NEW.annual_guaranteed_hours := NULL;
        v_new_weekly := 0;
    END IF;

    -- 1. At most one active Full-Time POSITION (was: one row).
    IF NEW.employment_status = 'Full-Time' THEN
        SELECT COUNT(DISTINCT position_id) INTO v_ft_positions
        FROM hr.user_contracts
        WHERE user_id = NEW.user_id
          AND status = 'Active'
          AND employment_status = 'Full-Time'
          AND position_id IS DISTINCT FROM NEW.position_id
          AND id <> COALESCE(NEW.id, k_no_id);

        IF v_ft_positions > 0 THEN
            RAISE EXCEPTION 'An employee cannot hold more than one active Full-Time position.'
                USING ERRCODE = '23505';
        END IF;
    END IF;

    -- 2. Full-Time and Part-Time cannot coexist. Existence tests, unchanged.
    IF NEW.employment_status = 'Full-Time' THEN
        SELECT COUNT(*) INTO v_pt_count
        FROM hr.user_contracts
        WHERE user_id = NEW.user_id
          AND status = 'Active'
          AND employment_status IN ('Part-Time', 'Flexible Part-Time')
          AND id <> COALESCE(NEW.id, k_no_id);

        IF v_pt_count > 0 THEN
            RAISE EXCEPTION 'An employee holding a Part-Time contract cannot also hold a Full-Time contract.'
                USING ERRCODE = '23514';
        END IF;

    ELSIF NEW.employment_status IN ('Part-Time', 'Flexible Part-Time') THEN
        SELECT COUNT(*) INTO v_ft_positions
        FROM hr.user_contracts
        WHERE user_id = NEW.user_id
          AND status = 'Active'
          AND employment_status = 'Full-Time'
          AND id <> COALESCE(NEW.id, k_no_id);

        IF v_ft_positions > 0 THEN
            RAISE EXCEPTION 'An employee holding a Full-Time contract cannot also hold a Part-Time contract.'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- 3. 38h across all Part-Time POSITIONS, counting each position once.
    IF NEW.employment_status IN ('Part-Time', 'Flexible Part-Time') THEN
        WITH per_position AS (
            SELECT position_id,
                   MAX(CASE
                        WHEN employment_status = 'Part-Time'
                            THEN COALESCE(contracted_weekly_hours, 0)
                        WHEN employment_status = 'Flexible Part-Time'
                            THEN CASE WHEN COALESCE(contracted_weekly_hours, 0) > 0
                                      THEN contracted_weekly_hours
                                      ELSE COALESCE(annual_guaranteed_hours, 0) / 52.0 END
                        ELSE 0
                       END) AS weekly
              FROM hr.user_contracts
             WHERE user_id = NEW.user_id
               AND status = 'Active'
               AND employment_status IN ('Part-Time', 'Flexible Part-Time')
               AND position_id IS DISTINCT FROM NEW.position_id
               AND id <> COALESCE(NEW.id, k_no_id)
             GROUP BY position_id
        )
        SELECT COALESCE(SUM(weekly), 0) INTO v_pt_weekly_sum FROM per_position;

        IF (v_pt_weekly_sum + v_new_weekly) > 38.001 THEN
            RAISE EXCEPTION 'Total contracted hours across all Part-Time contracts cannot exceed 38 hours per week (attempted total: %h/week).',
                ROUND(v_pt_weekly_sum + v_new_weekly, 1)
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

-- ── 6. Retired helper ─────────────────────────────────────────────────────────
-- No policy, function or client calls it, and it still granted on the retired
-- legacy_system_role = 'admin' flag.
DROP FUNCTION IF EXISTS public.auth_can_manage_certificates();
