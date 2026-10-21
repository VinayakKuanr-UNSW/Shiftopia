-- LOCAL TEST DB ONLY. Run after 01_fixtures.sql; everything here rolls back.
-- Access and the places it names (migrations *_access_certificate_place_guards and
-- *_contracts_carry_access): a place with ACTIVE access scoped to it can be neither
-- deleted nor retired; revoked access goes with its place (history stays in
-- access_certificate_events); no access is set in a retired place. Access is set on
-- contracts, and the certificate rows mirror them. Prints one line per case.
\set QUIET on
BEGIN;
DO $t$
DECLARE
    o   constant uuid := '00000000-0000-0000-0000-000000000001';
    pd  constant uuid := 'dd000000-0000-4000-8000-0000000000aa';  -- probe department
    ps  constant uuid := '5d000000-0000-4000-8000-0000000000aa';  -- probe sub-department
    a   constant uuid := 'a0000000-0000-4000-8000-000000000001';  -- persona A
    x   constant uuid := 'a0000000-0000-4000-8000-000000000006';  -- persona X
    ka  uuid;
    kx  uuid;
    ca  uuid;
    cx  uuid;
    rl  uuid := (SELECT id FROM hr.roles ORDER BY id LIMIT 1);
    res text;
BEGIN
    INSERT INTO public.departments (id, organization_id, name, is_active) VALUES (pd, o, 'Probe Dept', true);
    INSERT INTO public.sub_departments (id, department_id, name, is_active) VALUES (ps, pd, 'Probe Sub', true);
    INSERT INTO hr.user_contracts (user_id, role_id, organization_id, department_id, sub_department_id, status, employment_status, pay_basis, remuneration_level, access_level)
    VALUES (a, rl, o, pd, ps, 'Active', 'Casual', 'eba_level', 2, 'gamma') RETURNING id INTO ka;
    SELECT id INTO ca FROM public.app_access_certificates WHERE contract_id = ka;

    -- 1. retire / delete with one active holder
    BEGIN
        UPDATE public.sub_departments SET is_active = false WHERE id = ps;
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'retire sub-dept, 1 holder: %', res;

    BEGIN
        DELETE FROM public.sub_departments WHERE id = ps;
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'delete sub-dept, 1 holder: %', res;

    BEGIN
        UPDATE public.departments SET is_active = false WHERE id = pd;
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'retire department, 1 holder: %', res;

    -- 2. two holders: the message counts and names both
    INSERT INTO hr.user_contracts (user_id, role_id, organization_id, department_id, sub_department_id, status, employment_status, pay_basis, remuneration_level, access_level)
    VALUES (x, rl, o, pd, ps, 'Active', 'Casual', 'eba_level', 2, 'gamma') RETURNING id INTO kx;
    SELECT id INTO cx FROM public.app_access_certificates WHERE contract_id = kx;
    BEGIN
        DELETE FROM public.sub_departments WHERE id = ps;
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'delete sub-dept, 2 holders: %', res;

    -- 3. revoked access does not block a retirement; a place with contracts recorded is retired, never deleted
    --    (A's contract ends; X's stays, lowered to alpha)
    UPDATE hr.user_contracts SET status = 'Expired' WHERE id = ka;
    UPDATE hr.user_contracts SET access_level = 'alpha' WHERE id = kx;
    BEGIN
        DELETE FROM public.sub_departments WHERE id = ps;
        res := 'allowed; certificates left=' || (SELECT count(*) FROM public.app_access_certificates WHERE id IN (ca, cx))
            || ' deleted-events=' || (SELECT count(*) FROM public.access_certificate_events WHERE certificate_id IN (ca, cx) AND action = 'deleted');
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'delete sub-dept, contracts recorded: %', res;

    BEGIN
        UPDATE public.sub_departments SET is_active = false WHERE id = ps;
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'retire sub-dept, only revoked: %', res;

    -- 4. no access set, or set again, in a retired place
    UPDATE public.sub_departments SET is_active = false WHERE id = ps;
    BEGIN
        INSERT INTO hr.user_contracts (user_id, role_id, organization_id, department_id, sub_department_id, status, employment_status, pay_basis, remuneration_level, access_level)
        VALUES ('a0000000-0000-4000-8000-00000000000b', rl, o, pd, ps, 'Active', 'Casual', 'eba_level', 2, 'gamma');
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'grant in retired sub-dept: %', res;

    BEGIN
        UPDATE hr.user_contracts SET access_level = 'gamma' WHERE id = kx;
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'reactivate in retired sub-dept: %', res;

    -- 5. reshaping that touches no access is unaffected
    BEGIN
        UPDATE public.sub_departments SET name = 'Probe Sub (renamed)', is_active = true WHERE id = ps;
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'rename and restore sub-dept: %', res;
END
$t$;
ROLLBACK;
