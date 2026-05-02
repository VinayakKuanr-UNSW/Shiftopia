-- ==========================================
-- FIX AUTH SCHEMA DEPENDENCIES
-- ==========================================

-- 1. ENHANCE user_contracts table
ALTER TABLE public.user_contracts 
ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.roles(id),
ADD COLUMN IF NOT EXISTS rem_level_id uuid REFERENCES public.remuneration_levels(id),
ADD COLUMN IF NOT EXISTS start_date date,
ADD COLUMN IF NOT EXISTS end_date date,
ADD COLUMN IF NOT EXISTS custom_hourly_rate numeric,
ADD COLUMN IF NOT EXISTS notes text,
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
ADD COLUMN IF NOT EXISTS created_by uuid,
ADD COLUMN IF NOT EXISTS employment_status text; -- Using text for now to avoid enum conflicts

-- 2. CREATE app_access_certificates table
CREATE TABLE IF NOT EXISTS public.app_access_certificates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id),
    access_level access_level NOT NULL,
    organization_id uuid REFERENCES public.organizations(id),
    department_id uuid REFERENCES public.departments(id),
    sub_department_id uuid REFERENCES public.sub_departments(id),
    certificate_type character varying NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 3. CREATE resolve_user_permissions function
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
    -- 2. Build typeY object (single active Type Y cert, or null)
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

    -- =============================================
    -- 3. Build allowed_scope_tree based on Type Y level
    -- =============================================
    IF v_type_y IS NULL THEN
        -- No Type Y certificate: empty managerial scope
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

    RETURN jsonb_build_object(
        'typeX', v_type_x,
        'typeY', v_type_y,
        'allowed_scope_tree', v_scope_tree
    );
END;
$function$;

-- 4. SEED Type Y Certificate for Admins
INSERT INTO public.app_access_certificates (user_id, access_level, certificate_type, is_active)
SELECT id, 'zeta', 'Y', true
FROM public.profiles
WHERE id IN (
    SELECT user_id FROM public.user_contracts WHERE access_level = 'zeta'
)
ON CONFLICT DO NOTHING;
