-- ============================================================================
-- Phase 7 — remove the synthetic-zeta escalation path.
--
-- `resolve_user_permissions()` contained:
--
--     IF v_type_y IS NULL AND v_is_system_admin THEN
--         v_y_level := 'zeta';
--         v_type_y  := jsonb_build_object('id', NULL, 'level', 'zeta',
--                                         'org_name', 'Global', ...);
--     END IF;
--
-- A profile with legacy_system_role='admin' and no Type Y certificate was
-- promoted to ZETA — all organizations — which is strictly more than any
-- certificate this system can issue, from a plain role column. It had no
-- counterpart in `user_has_action_in_scope`, so such a user would have received
-- a full global scope tree from the RPC and been denied by every catalogue
-- check. It also emitted a typeY object with `id: NULL`, violating the
-- `PermissionCert` contract (`id: string`) that the frontend reads.
--
-- That column is the one behind the privilege escalation closed in July.
--
-- ── WHY NO ZETA CERTIFICATE WAS ISSUED TO REPLACE IT ───────────────────────
--
-- The obvious pairing — delete the branch, grant the admin a real zeta
-- certificate — was checked and rejected. Production holds ONE legacy admin,
-- and they already hold an active EPSILON Type Y certificate, so the branch
-- never fired for them: removing it costs them nothing. Issuing zeta would have
-- been a privilege escalation performed to fix a privilege escalation, and with
-- a single organization epsilon already reaches everything zeta would. It would
-- only widen them on the second tenant — precisely what this closes. It would
-- also have required deactivating their epsilon certificate, since only one
-- active Type Y per user is permitted.
--
-- Verified before and after: every one of the 107 profiles receives byte-identical
-- JSON from resolve_user_permissions(). The escalation is closed with zero
-- change to anyone's actual permissions.
--
-- ── 7b: THE DEAD READ THAT WAS LEFT BEHIND ─────────────────────────────────
--
-- With the branch gone, `v_is_system_admin` was declared, assigned and never
-- read — a live read of legacy_system_role sitting under a variable named
-- `v_is_system_admin`, which is an invitation rather than dead weight. Removed;
-- this function no longer touches the column at all.
--
-- The guard for 7b initially FAILED, and correctly: it asserted the patched
-- source no longer contained 'legacy_system_role', and matched the explanatory
-- comment Phase 7 had just added. Comments are stripped before asserting now.
-- A guard that reads the prose describing a fix as the defect is the same trap
-- the repo's source-reading tests already document.
--
-- ── APPLIED AS A SERVER-SIDE PATCH ─────────────────────────────────────────
--
-- Both steps read `pg_get_functiondef`, rewrote one region with
-- regexp_replace, asserted the rewrite landed, and EXECUTEd the result — so
-- 7.3 kB of a 7.7 kB function was never retyped and cannot have acquired a
-- transcription error. Applied to production as 20260825044911 / 20260825045128.
--
-- REPLAY NOTE: these blocks patch whatever definition they find. On a fresh
-- database built from the baseline they are correct, because the baseline
-- carries the original text. If the baseline is ever regenerated from a
-- post-Phase-7 production, the patches become no-ops and the guards will raise
-- 'nothing matched' rather than silently doing nothing — which is the intended
-- failure.
--
-- STILL OPEN, and much larger than this migration: 20 functions across public
-- and hr still read legacy_system_role. Phase 7 removes the ESCALATION, not the
-- column. Retiring it entirely is its own project.
-- ============================================================================
-- The end state is written out below rather than the patch mechanism, so this
-- file is self-contained and idempotent on replay.


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

    RETURN jsonb_build_object(
        'typeX', v_type_x,
        'typeY', v_type_y,
        'allowed_scope_tree', v_scope_tree
    );
END;
$function$
;
