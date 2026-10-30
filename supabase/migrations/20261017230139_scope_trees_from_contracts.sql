-- The global scope filter reads contracts.
--
-- Since 2026-10-15 access is set on contracts (hr.user_contracts.access_level), and
-- app_access_certificates is only their mirror. resolve_user_permissions() still built
-- the managerial scope tree from that mirror. The two agree today because a trigger
-- keeps them in step, but the filter should rest on the table people edit on the Users
-- page. So every tree it returns is now built from hr.user_contracts:
--
--   allowed_scope_tree     managerial pages: what the gamma-and-above contracts reach
--                          (gamma its sub-department, delta its department, epsilon its
--                          organization, zeta everything). Unchanged in content.
--   timesheet_scope_tree   NEW. The Timesheets page: the same, plus each Team Lead
--                          (beta) contract's sub-department. Beta's timesheet.view is
--                          SUB_DEPT on the beta contract, so a team lead in Bar who is
--                          ordinary staff in Kitchen sees Bar here, not Kitchen. The page
--                          used the personal tree for beta, which offered both.
--   contracted_scope_tree  personal pages: every sub-department with an active contract.
--                          Same places as before; sub-departments now sort by name (the
--                          DISTINCT aggregate sorted them by id), so the first one a
--                          single-choice page lands on is predictable.
--
-- typeX / typeY / typeYs are unchanged: other readers want the certificate rows (ids,
-- audit). The scope filter no longer reads them.

-- The places a person's contracts at p_min_level or above reach, shaped as the scope
-- filter's tree. Contracts in force today (status Active) only; retired places left out.
-- Takes a user id, so clients must not call it: resolve_user_permissions() passes auth.uid().
CREATE OR REPLACE FUNCTION hr.contract_scope_tree(p_user_id uuid, p_min_level public.access_level)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
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
        SELECT o.id, o.name FROM public.organizations o
         WHERE o.is_active
           AND EXISTS (SELECT 1 FROM k WHERE k.access_level = 'zeta' OR k.organization_id = o.id)
    ),
    subs AS (
        SELECT sd.id, sd.name, sd.department_id, d.organization_id
          FROM public.sub_departments sd
          JOIN public.departments d ON d.id = sd.department_id
          JOIN orgs ON orgs.id = d.organization_id
         WHERE sd.is_active AND d.is_active
           AND EXISTS (SELECT 1 FROM k
                        WHERE k.access_level = 'zeta'
                           OR (k.access_level = 'epsilon' AND k.organization_id = d.organization_id)
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
                            WHERE k.access_level = 'zeta'
                               OR (k.access_level = 'epsilon' AND k.organization_id = d.organization_id)
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
REVOKE ALL ON FUNCTION hr.contract_scope_tree(uuid, public.access_level) FROM PUBLIC, anon, authenticated;

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
    v_type_ys JSONB;
    v_contracted_tree JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- =============================================
    -- 1. typeX: the active Type X (beta) mirror rows
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
    -- 2. typeY: the highest managerial mirror row; typeYs: every one
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
    )
    INTO v_type_y
    FROM app_access_certificates ac
    LEFT JOIN organizations o ON o.id = ac.organization_id
    LEFT JOIN departments d ON d.id = ac.department_id
    LEFT JOIN sub_departments sd ON sd.id = ac.sub_department_id
    WHERE ac.user_id = v_user_id
      AND ac.certificate_type = 'Y'
      AND ac.is_active = true
    ORDER BY ac.access_level DESC, ac.created_at, ac.id
    LIMIT 1;

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

    -- =============================================
    -- 3. Personal scope: every sub-department with an active contract, any level.
    --    Retired places stay: a person's own records there must remain reachable.
    -- =============================================
    WITH subs AS (
        SELECT DISTINCT sd.id, sd.name, sd.department_id
          FROM hr.user_contracts uc
          JOIN sub_departments sd ON sd.id = uc.sub_department_id
         WHERE uc.user_id = v_user_id
           AND uc.status = 'Active'
    ),
    depts AS (
        SELECT DISTINCT d.id, d.name, d.organization_id
          FROM departments d JOIN subs ON subs.department_id = d.id
    ),
    orgs AS (
        SELECT DISTINCT o.id, o.name
          FROM organizations o JOIN depts ON depts.organization_id = o.id
    )
    SELECT jsonb_build_object('organizations', COALESCE(jsonb_agg(
               jsonb_build_object('id', o.id, 'name', o.name, 'departments', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'subdepartments', COALESCE((
                              SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                                FROM subs s WHERE s.department_id = d.id), '[]'::jsonb)) ORDER BY d.name)
                     FROM depts d WHERE d.organization_id = o.id), '[]'::jsonb)) ORDER BY o.name), '[]'::jsonb))
      INTO v_contracted_tree
      FROM orgs o;

    RETURN jsonb_build_object(
        'typeX', v_type_x,
        'typeY', v_type_y,
        'typeYs', v_type_ys,
        -- 4. Managerial and Timesheets scope, from the contracts' access.
        'allowed_scope_tree', hr.contract_scope_tree(v_user_id, 'gamma'),
        'timesheet_scope_tree', hr.contract_scope_tree(v_user_id, 'beta'),
        'contracted_scope_tree', v_contracted_tree
    );
END;
$function$;
REVOKE ALL ON FUNCTION public.resolve_user_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_user_permissions() TO authenticated, service_role;
