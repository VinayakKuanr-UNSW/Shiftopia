-- Access suites, step 3 of 3: the personal scope is the person's contracts
-- (docs/architecture/access-suites-plan.md, decisions 2 and 3).
--
-- A Type X certificate (alpha or beta) stops naming a department or sub-department.
-- One per person, it says WHICH personal level they hold; their active contracts say
-- WHERE. Someone contracted to Bar and Kitchen sees both; a contract ending drops that
-- sub-department with no certificate edit. A beta's read-only Timesheets reach every
-- sub-department they are contracted to, through the new CONTRACTED scope (added by the
-- previous migration, since an enum value cannot be used in the transaction adding it).
--
-- Edited function bodies are pg_get_functiondef() copies with one change each.

-- ── 1. Beta's rows reach wherever beta is contracted ─────────────────────────
-- The actions already exist; listed so a rebuild from the baseline, where the reference
-- seed loads actions only after the migrations, can still grant them below.
INSERT INTO public.rbac_actions (code, description) VALUES
    ('timesheet.view', 'View timesheets'),
    ('shift.view',     'View shift details'),
    ('user.view',      'View user profiles')
ON CONFLICT (code) DO NOTHING;

-- An upsert, not an UPDATE: rebuilt from the baseline, this runs before the reference
-- seed loads the matrix, and the seed then leaves these rows alone (ON CONFLICT DO NOTHING).
INSERT INTO public.rbac_permissions (access_level, action_code, scope) VALUES
    ('beta', 'timesheet.view', 'CONTRACTED'),
    ('beta', 'shift.view',     'CONTRACTED'),  -- the shifts those timesheets belong to
    ('beta', 'user.view',      'CONTRACTED')   -- and the names on them
ON CONFLICT (access_level, action_code) DO UPDATE SET scope = EXCLUDED.scope;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.rbac_permissions WHERE scope = 'SUB_DEPT' AND access_level IN ('alpha', 'beta')) THEN
        RAISE EXCEPTION 'a personal level still holds a sub-department-scoped row';
    END IF;
END $$;

-- ── 2–3. Generated: functions edited in place ───────────────────────────────
-- 3a. The CONTRACTED scope: the caller holds an active contract at the target place.
--     Beta's Timesheets use it; it is how a Type X reaches every sub-department the
--     person works in without naming one.
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
                  OR (rp.scope = 'CONTRACTED' AND EXISTS (
                        SELECT 1 FROM hr.user_contracts uc
                         WHERE uc.user_id = auth.uid() AND uc.status = 'Active'
                           AND uc.organization_id = p_org_id
                           AND uc.sub_department_id = p_sub_dept_id))
              ))
          )
    );
$function$;

-- 3b. One active Type X per person, said in words before the unique index says it in a code.
CREATE OR REPLACE FUNCTION public.validate_certificate_on_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_existing_y_count INTEGER;
BEGIN
    IF NEW.certificate_type = 'Y' AND NEW.is_active = true THEN
        SELECT COUNT(*) INTO v_existing_y_count
        FROM app_access_certificates
        WHERE user_id = NEW.user_id
          AND certificate_type = 'Y'
          AND is_active = true
          AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

        IF v_existing_y_count > 0 THEN
            RAISE EXCEPTION 'User already has an active Type Y certificate. Only one is allowed.';
        END IF;
    END IF;

    IF NEW.certificate_type = 'X' AND NEW.is_active = true AND EXISTS (
        SELECT 1 FROM app_access_certificates
         WHERE user_id = NEW.user_id
           AND certificate_type = 'X'
           AND is_active = true
           AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)) THEN
        RAISE EXCEPTION 'User already has an active Type X certificate. Only one is allowed: it covers every sub-department they are contracted to.';
    END IF;

    IF NEW.certificate_type = 'X' AND NEW.access_level > 'beta' THEN
        RAISE EXCEPTION 'Type X certificates must have alpha or beta level.';
    END IF;

    IF NEW.certificate_type = 'Y' AND NEW.access_level < 'gamma' THEN
        RAISE EXCEPTION 'Type Y certificates must be gamma or above.';
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

-- 3c. The personal scope tree: every sub-department the caller holds an active contract in.
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
    LIMIT 1;

    -- IF no Type Y certificate found but user is an admin, grant Zeta access
    -- Synthetic-zeta branch removed by migration 20260825220000.
    -- A legacy_system_role='admin' holding no Type Y certificate used to be
    -- promoted here to zeta — ALL organizations — which is strictly more than
    -- any certificate this system can issue, and had no counterpart in
    -- user_has_action_in_scope. It also emitted a typeY object with a NULL id,
    -- violating the PermissionCert contract the frontend reads. Such a profile
    -- now resolves to no managerial level, like anyone else without a Type Y.

    -- =============================================
    -- 3. Build allowed_scope_tree based on Type Y level
    -- =============================================
    IF v_y_level IS NULL THEN
        -- No Type Y access: empty managerial scope
        v_scope_tree := jsonb_build_object('organizations', '[]'::jsonb);
    ELSIF v_y_level = 'zeta' THEN
        -- Zeta: full hierarchy (all orgs, all depts, all subdepts)
        SELECT jsonb_build_object('organizations',
            COALESCE(jsonb_agg(
                jsonb_build_object(
                    'id', org.id,
                    'name', org.name,
                    'departments', COALESCE(org.depts, '[]'::jsonb)
                )
            ), '[]'::jsonb)
        )
        INTO v_scope_tree
        FROM (
            SELECT o.id, o.name,
                (SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', d.id,
                        'name', d.name,
                        'subdepartments', COALESCE(
                            (SELECT jsonb_agg(
                                jsonb_build_object('id', sd.id, 'name', sd.name)
                            ) FROM sub_departments sd WHERE sd.department_id = d.id AND sd.is_active = true),
                            '[]'::jsonb
                        )
                    )
                ) FROM departments d WHERE d.organization_id = o.id AND d.is_active = true) AS depts
            FROM organizations o
            WHERE o.is_active = true
        ) org;

    ELSIF v_y_level = 'epsilon' THEN
        -- Epsilon: fixed org, all depts under it, all subdepts
        SELECT jsonb_build_object('organizations',
            jsonb_build_array(
                jsonb_build_object(
                    'id', o.id,
                    'name', o.name,
                    'departments', COALESCE(
                        (SELECT jsonb_agg(
                            jsonb_build_object(
                                'id', d.id,
                                'name', d.name,
                                'subdepartments', COALESCE(
                                    (SELECT jsonb_agg(
                                        jsonb_build_object('id', sd.id, 'name', sd.name)
                                    ) FROM sub_departments sd WHERE sd.department_id = d.id AND sd.is_active = true),
                                    '[]'::jsonb
                                )
                            )
                        ) FROM departments d WHERE d.organization_id = o.id AND d.is_active = true),
                        '[]'::jsonb
                    )
                )
            )
        )
        INTO v_scope_tree
        FROM organizations o
        WHERE o.id = v_y_org_id;

    ELSIF v_y_level = 'delta' THEN
        -- Delta: fixed org + dept, all subdepts under that dept
        SELECT jsonb_build_object('organizations',
            jsonb_build_array(
                jsonb_build_object(
                    'id', o.id,
                    'name', o.name,
                    'departments', jsonb_build_array(
                        jsonb_build_object(
                            'id', d.id,
                            'name', d.name,
                            'subdepartments', COALESCE(
                                (SELECT jsonb_agg(
                                    jsonb_build_object('id', sd.id, 'name', sd.name)
                                ) FROM sub_departments sd WHERE sd.department_id = d.id AND sd.is_active = true),
                                '[]'::jsonb
                            )
                        )
                    )
                )
            )
        )
        INTO v_scope_tree
        FROM organizations o, departments d
        WHERE o.id = v_y_org_id
          AND d.id = v_y_dept_id;

    ELSIF v_y_level = 'gamma' THEN
        -- Gamma: fixed org + dept + subdept (fully locked)
        SELECT jsonb_build_object('organizations',
            jsonb_build_array(
                jsonb_build_object(
                    'id', o.id,
                    'name', o.name,
                    'departments', jsonb_build_array(
                        jsonb_build_object(
                            'id', d.id,
                            'name', d.name,
                            'subdepartments', jsonb_build_array(
                                jsonb_build_object('id', sd.id, 'name', sd.name)
                            )
                        )
                    )
                )
            )
        )
        INTO v_scope_tree
        FROM organizations o, departments d, sub_departments sd
        WHERE o.id = v_y_org_id
          AND d.id = v_y_dept_id
          AND sd.id = v_y_subdept_id;
    END IF;

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
        'allowed_scope_tree', v_scope_tree,
        'contracted_scope_tree', v_contracted_tree
    );
END;
$function$;

-- 3d. Broadcast group membership by hierarchy now looks at EVERY active contract. It read one
--     (LIMIT 1, arbitrary), so someone working in two sub-departments saw only one's groups.
CREATE OR REPLACE FUNCTION public.get_broadcast_group_role(p_group_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_group_org_id uuid;
  v_group_dept_id uuid;
  v_group_sub_dept_id uuid;
BEGIN
  -- A. Check for system management permissions first
  IF public.is_zeta() THEN  -- was the legacy admin/manager flag, retired 20261011
    RETURN 'admin';
  END IF;

  -- B. Check explicit participation in the group
  SELECT role INTO v_role
  FROM group_participants
  WHERE group_id = p_group_id
    AND employee_id = auth.uid()
  LIMIT 1;

  IF v_role IS NOT NULL THEN
    RETURN v_role;
  END IF;

  -- C. Check hierarchy inheritance
  SELECT organization_id, department_id, sub_department_id 
  INTO v_group_org_id, v_group_dept_id, v_group_sub_dept_id
  FROM broadcast_groups
  WHERE id = p_group_id;

  -- Inherit 'member' from ANY active contract under the group's place:
  -- sub-department if the group names one, else department, else organization.
  IF EXISTS (
    SELECT 1 FROM user_contracts uc
     WHERE uc.user_id = auth.uid() AND uc.status = 'Active'
       AND CASE
             WHEN v_group_sub_dept_id IS NOT NULL THEN uc.sub_department_id = v_group_sub_dept_id
             WHEN v_group_dept_id IS NOT NULL THEN uc.department_id = v_group_dept_id
             WHEN v_group_org_id IS NOT NULL THEN uc.organization_id = v_group_org_id
             ELSE false
           END
  ) THEN
    RETURN 'member';
  END IF;

  RETURN NULL;
END;
$function$;

-- ── 4. Type X certificates: one per person, no department or sub-department ──
-- The old rule required both on alpha and beta, so it goes first.
ALTER TABLE public.app_access_certificates DROP CONSTRAINT chk_scope_nullability;

-- Keep each person's highest active X (beta over alpha); deactivate the others.
WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY access_level DESC, created_at) AS rn
      FROM public.app_access_certificates
     WHERE certificate_type = 'X' AND is_active
)
UPDATE public.app_access_certificates c
   SET is_active = false
  FROM ranked r
 WHERE c.id = r.id AND r.rn > 1;

UPDATE public.app_access_certificates
   SET department_id = NULL, sub_department_id = NULL
 WHERE certificate_type = 'X'
   AND (department_id IS NOT NULL OR sub_department_id IS NOT NULL);

ALTER TABLE public.app_access_certificates ADD CONSTRAINT chk_scope_nullability CHECK (
CASE access_level
    WHEN 'zeta'::access_level THEN ((organization_id IS NULL) AND (department_id IS NULL) AND (sub_department_id IS NULL))
    WHEN 'epsilon'::access_level THEN ((organization_id IS NOT NULL) AND (department_id IS NULL) AND (sub_department_id IS NULL))
    WHEN 'delta'::access_level THEN ((organization_id IS NOT NULL) AND (department_id IS NOT NULL) AND (sub_department_id IS NULL))
    WHEN 'gamma'::access_level THEN ((organization_id IS NOT NULL) AND (department_id IS NOT NULL) AND (sub_department_id IS NOT NULL))
    -- Personal levels: the organization only. WHERE comes from the person's contracts.
    WHEN 'alpha'::access_level THEN ((organization_id IS NOT NULL) AND (department_id IS NULL) AND (sub_department_id IS NULL))
    WHEN 'beta'::access_level THEN ((organization_id IS NOT NULL) AND (department_id IS NULL) AND (sub_department_id IS NULL))
    ELSE false
END);

CREATE UNIQUE INDEX idx_unique_type_x_per_user
    ON public.app_access_certificates (user_id)
 WHERE certificate_type = 'X' AND is_active = true;
