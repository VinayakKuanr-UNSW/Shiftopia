-- LOCAL TEST DB ONLY. Run after 01_fixtures.sql; everything here rolls back.
-- Contracts carry access (migration *_contracts_carry_access): each contract row holds
-- the access its position gives, reaching the row's own place; app_access_certificates
-- mirrors the contracts and nobody writes it directly. Also the contracted-hours rules
-- by employment type (EBA cl 12.2–12.5, 35.3). Prints one line per case.
\set QUIET on
BEGIN;
DO $t$
DECLARE
    o    constant uuid := '00000000-0000-0000-0000-000000000001';
    d1   constant uuid := '54c4c466-8d56-41c1-bf36-98ee4d7364f3';
    s1   constant uuid := '707b57f8-77f5-4751-8bfd-5f652ef84fcd';
    s2   constant uuid := 'ed004483-7cb4-40cf-a151-57053e009ea8';
    d2   constant uuid := 'c0000000-0000-0000-0000-000000000003';
    s3   constant uuid := '6fefad95-9cf9-468c-8724-424cc2f7b640';
    x    constant uuid := 'a0000000-0000-4000-8000-000000000006';
    b    constant uuid := 'a0000000-0000-4000-8000-00000000000b';
    g    constant uuid := 'a0000000-0000-4000-8000-000000000002';
    g2   constant uuid := 'a0000000-0000-4000-8000-00000000000a';
    z    constant uuid := 'a0000000-0000-4000-8000-000000000005';
    k_x  constant uuid := 'c0c00000-0000-4000-8000-000000000001';
    k_z  constant uuid := 'c0c00000-0000-4000-8000-000000000014';
    rl   uuid := (SELECT id FROM hr.roles ORDER BY id LIMIT 1);
    rl2  uuid := (SELECT id FROM hr.roles ORDER BY id OFFSET 1 LIMIT 1);
    k    uuid;
    res  text;
    j    jsonb;

BEGIN
    -- 1. zeta raises X's contract (S1) to gamma: the mirror row appears, scoped to S1
    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    UPDATE hr.user_contracts SET access_level = 'gamma' WHERE id = k_x;
    SELECT ac.certificate_type || ' ' || ac.access_level || ' sub=' || (ac.sub_department_id = s1) || ' active=' || ac.is_active
      INTO res FROM public.app_access_certificates ac WHERE ac.contract_id = k_x;
    RAISE NOTICE 'raise X to gamma: mirror %', res;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
    RAISE NOTICE 'X as gamma: shift.edit S1=% S2=%',
        public.user_has_action_in_scope('shift.edit', o, d1, s1), public.user_has_action_in_scope('shift.edit', o, d1, s2);

    -- 2. raise to delta: the same row follows, now the department
    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    UPDATE hr.user_contracts SET access_level = 'delta' WHERE id = k_x;
    SELECT ac.access_level || ' dept=' || (ac.department_id = d1) || ' sub=' || coalesce(ac.sub_department_id::text, 'none')
      INTO res FROM public.app_access_certificates ac WHERE ac.contract_id = k_x;
    RAISE NOTICE 'change X to delta: mirror %', res;

    -- 3. lower to alpha: the mirror is revoked, and the audit log has the whole story
    UPDATE hr.user_contracts SET access_level = 'alpha' WHERE id = k_x;
    SELECT 'active=' || ac.is_active || ' events=' || (
              SELECT string_agg(e.action, ',' ORDER BY e.occurred_at, e.id)
                FROM public.access_certificate_events e WHERE e.certificate_id = ac.id)
      INTO res FROM public.app_access_certificates ac WHERE ac.contract_id = k_x;
    RAISE NOTICE 'lower X to alpha: mirror %', res;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
    RAISE NOTICE 'X as alpha: shift.edit S1=%', public.user_has_action_in_scope('shift.edit', o, d1, s1);

    -- 4. a team lead's reach is the row it holds: B leads in S1, works in S3
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    RAISE NOTICE 'B (beta S1, alpha S3): timesheet.view S1=% S3=%',
        public.user_has_action_in_scope('timesheet.view', o, d1, s1), public.user_has_action_in_scope('timesheet.view', o, d2, s3);

    -- 5. two managerial contracts: G2 (gamma S2) gains gamma in S1 — both are theirs
    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    INSERT INTO hr.user_contracts (user_id, role_id, organization_id, department_id, sub_department_id, status, employment_status, pay_basis, remuneration_level, access_level)
    VALUES (g2, rl, o, d1, s1, 'Active', 'Casual', 'eba_level', 2, 'gamma') RETURNING id INTO k;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', g2, 'role', 'authenticated')::text, true);
    j := public.resolve_user_permissions();
    RAISE NOTICE 'G2 with gamma S1 + S2: shift.edit S1=% S2=% typeYs=% tree subs=%',
        public.user_has_action_in_scope('shift.edit', o, d1, s1), public.user_has_action_in_scope('shift.edit', o, d1, s2),
        jsonb_array_length(j->'typeYs'),
        (SELECT count(*) FROM jsonb_array_elements(j->'allowed_scope_tree'->'organizations') org,
                              jsonb_array_elements(org->'departments') dep,
                              jsonb_array_elements(dep->'subdepartments') sub);

    -- 6. deleting a contract takes its access with it
    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    DELETE FROM hr.user_contracts WHERE id = k;
    RAISE NOTICE 'delete G2''s S1 contract: mirror rows left=%, deleted events=%',
        (SELECT count(*) FROM public.app_access_certificates WHERE contract_id = k),
        (SELECT count(*) FROM public.access_certificate_events e WHERE e.action = 'deleted' AND (e.before->>'contract_id')::uuid = k);

    -- 7. only zeta sets access: G holds no access.manage (bypassing RLS to reach the guard)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
    BEGIN
        UPDATE hr.user_contracts SET access_level = 'zeta' WHERE id = k_x;
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'gamma sets access on a contract: %', res;

    -- 8. certificates are not written directly, even with no session
    PERFORM set_config('request.jwt.claims', '', true);
    BEGIN
        INSERT INTO public.app_access_certificates (user_id, certificate_type, access_level, organization_id, department_id, sub_department_id)
        VALUES (x, 'Y', 'gamma', o, d1, s1);
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'certificate without a contract: %', res;

    -- 9. the last zeta: its contract can be neither lowered nor ended
    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    BEGIN
        UPDATE hr.user_contracts SET status = 'Expired' WHERE id = k_z;
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'end the last zeta contract: %', res;

    -- 10. access needs a place on the row: beta with no sub-department
    BEGIN
        INSERT INTO hr.user_contracts (user_id, role_id, organization_id, department_id, status, employment_status, pay_basis, remuneration_level, access_level)
        VALUES (x, rl2, o, d1, 'Active', 'Casual', 'eba_level', 2, 'beta');
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'beta with no sub-department: %', res;

    -- 11. contracted hours follow the employment type (EBA)
    BEGIN
        INSERT INTO hr.user_contracts (user_id, role_id, organization_id, department_id, sub_department_id, status, employment_status, pay_basis, remuneration_level, contracted_weekly_hours)
        VALUES (x, rl2, o, d1, s2, 'Active', 'Part-Time', 'eba_level', 2, 38);
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'Part-Time at 38h: %', res;
    BEGIN
        INSERT INTO hr.user_contracts (user_id, role_id, organization_id, department_id, sub_department_id, status, employment_status, pay_basis, remuneration_level, contracted_weekly_hours, annual_guaranteed_hours)
        VALUES (x, rl2, o, d1, s2, 'Active', 'Flexible Part-Time', 'eba_level', 2, 0, 500);
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'Flexible Part-Time at 500h a year: %', res;
    BEGIN
        INSERT INTO hr.user_contracts (user_id, role_id, organization_id, department_id, sub_department_id, status, employment_status, pay_basis, remuneration_level, contracted_weekly_hours)
        VALUES (g, rl2, o, d1, s2, 'Active', 'Full-Time', 'eba_level', 2, 30);
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'Full-Time at 30h: %', res;
    INSERT INTO hr.user_contracts (user_id, role_id, organization_id, department_id, sub_department_id, status, employment_status, pay_basis, remuneration_level, contracted_weekly_hours)
    VALUES (x, rl2, o, d1, s2, 'Active', 'Casual', 'eba_level', 2, 38) RETURNING id INTO k;
    RAISE NOTICE 'Casual given 38h: stored % (no contracted hours)',
        (SELECT contracted_weekly_hours FROM hr.user_contracts WHERE id = k);
END
$t$;
ROLLBACK;
