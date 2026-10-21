-- LOCAL TEST DB ONLY. Run after 01_fixtures.sql; everything here rolls back.
-- Contract dates drive the contract (migration *_contract_dates_drive_the_contract):
-- Upcoming / Active / Expired from the start date and the inclusive last day, on the
-- Sydney calendar; an expired contract can be corrected or reopened; and the guardrails around
-- it. Prints one line per case. Dates are relative to today so the file never goes stale.
\set QUIET on
BEGIN;
DO $t$
DECLARE
    today constant date := (now() AT TIME ZONE 'Australia/Sydney')::date;
    o     constant uuid := '00000000-0000-0000-0000-000000000001';
    d1    constant uuid := '54c4c466-8d56-41c1-bf36-98ee4d7364f3';
    s1    constant uuid := '707b57f8-77f5-4751-8bfd-5f652ef84fcd';
    s2    constant uuid := 'ed004483-7cb4-40cf-a151-57053e009ea8';
    x     constant uuid := 'a0000000-0000-4000-8000-000000000006';
    g2    constant uuid := 'a0000000-0000-4000-8000-00000000000a';
    z     constant uuid := 'a0000000-0000-4000-8000-000000000005';
    k_x   constant uuid := 'c0c00000-0000-4000-8000-000000000001';   -- X, alpha @ S1
    k_z   constant uuid := 'c0c00000-0000-4000-8000-000000000014';   -- Z, zeta @ S1
    rl    uuid := (SELECT id FROM hr.roles ORDER BY id LIMIT 1);
    rl2   uuid := (SELECT id FROM hr.roles ORDER BY id OFFSET 1 LIMIT 1);
    rl3   uuid := (SELECT id FROM hr.roles ORDER BY id OFFSET 2 LIMIT 1);
    k     uuid;
    k2    uuid;
    n     int;
    res   text;
BEGIN
    -- 1. a start date in the past: in force now, with its access
    INSERT INTO hr.user_contracts (user_id, role_id, organization_id, department_id, sub_department_id, employment_status, pay_basis, remuneration_level, access_level, start_date)
    VALUES (g2, rl, o, d1, s1, 'Casual', 'eba_level', 2, 'gamma', today - 90) RETURNING id INTO k;
    RAISE NOTICE 'start 90 days ago: % · access mirrored=%',
        (SELECT status FROM hr.user_contracts WHERE id = k),
        (SELECT is_active FROM public.app_access_certificates WHERE contract_id = k);

    -- 2. a start date ahead: Upcoming, and no access until it starts
    INSERT INTO hr.user_contracts (user_id, role_id, organization_id, department_id, sub_department_id, employment_status, pay_basis, remuneration_level, access_level, start_date)
    VALUES (g2, rl2, o, d1, s1, 'Casual', 'eba_level', 2, 'beta', today + 14) RETURNING id INTO k2;
    RAISE NOTICE 'start in 14 days: % · access mirrored=%',
        (SELECT status FROM hr.user_contracts WHERE id = k2),
        coalesce((SELECT is_active::text FROM public.app_access_certificates WHERE contract_id = k2), 'none');

    -- 3. the hourly sweep: a start date that has come, and a last day that has passed
    --    (rows written stale with triggers off, as if the dates had moved on since)
    SET LOCAL session_replication_role = replica;
    UPDATE hr.user_contracts SET start_date = today - 1, status = 'Upcoming' WHERE id = k2;
    UPDATE hr.user_contracts SET end_date = today - 1, status = 'Active' WHERE id = k;
    SET LOCAL session_replication_role = origin;
    n := hr.run_contract_lifecycle();
    RAISE NOTICE 'sweep moved %: started → % (access %), last day passed → % (access %)', n,
        (SELECT status FROM hr.user_contracts WHERE id = k2),
        (SELECT CASE WHEN is_active THEN 'granted' ELSE 'off' END FROM public.app_access_certificates WHERE contract_id = k2),
        (SELECT status FROM hr.user_contracts WHERE id = k),
        (SELECT CASE WHEN is_active THEN 'on' ELSE 'revoked' END FROM public.app_access_certificates WHERE contract_id = k);

    -- 4. an expired contract can be corrected, and a later last day reopens it
    BEGIN
        UPDATE hr.user_contracts SET remuneration_level = 3 WHERE id = k;
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || regexp_replace(SQLERRM, 'expired on [0-9]+ [A-Za-z]+ [0-9]+', 'expired on <date>');
    END;
    RAISE NOTICE 'edit an expired contract: %', res;
    BEGIN
        UPDATE hr.user_contracts SET end_date = NULL, status = 'Active' WHERE id = k;
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || ')';
    END;
    RAISE NOTICE 'reinstate an expired contract: %', res;

    -- 5. end now: a last day of today ends it at once, and its access with it
    UPDATE hr.user_contracts SET status = 'Expired' WHERE id = k2;
    RAISE NOTICE 'end now: % · last day today=% · access %',
        (SELECT status FROM hr.user_contracts WHERE id = k2),
        (SELECT end_date = today FROM hr.user_contracts WHERE id = k2),
        (SELECT CASE WHEN is_active THEN 'on' ELSE 'revoked' END FROM public.app_access_certificates WHERE contract_id = k2);

    -- 6. a last day ahead: stays Active until then
    INSERT INTO hr.user_contracts (user_id, role_id, organization_id, department_id, sub_department_id, employment_status, pay_basis, remuneration_level, start_date, end_date)
    VALUES (g2, rl3, o, d1, s2, 'Casual', 'eba_level', 2, today - 7, today + 30) RETURNING id INTO k;
    RAISE NOTICE 'last day in 30 days: %', (SELECT status FROM hr.user_contracts WHERE id = k);

    -- 7. the dates must run forwards
    BEGIN
        UPDATE hr.user_contracts SET end_date = start_date - 1 WHERE id = k;
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'last day before the start: %', regexp_replace(res, '[0-9]{1,2} [A-Z][a-z]{2} [0-9]{4}', '<date>', 'g');

    -- 8. an upcoming contract is cancelled, not ended; old statuses are refused
    INSERT INTO hr.user_contracts (user_id, role_id, organization_id, department_id, sub_department_id, employment_status, pay_basis, remuneration_level, start_date)
    VALUES (x, rl2, o, d1, s2, 'Casual', 'eba_level', 2, today + 7) RETURNING id INTO k2;
    BEGIN
        UPDATE hr.user_contracts SET status = 'Expired' WHERE id = k2;
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'end an upcoming contract: %', res;
    BEGIN
        UPDATE hr.user_contracts SET status = 'Inactive' WHERE id = k_x;
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'old status Inactive: %', res;

    -- 9. any contract with no shift rostered under it can be deleted, whatever its status
    --    (as zeta, through RLS); one with a shift can't (shift 1: X, S1, 2026-12-01)
    SET LOCAL session_replication_role = replica;
    UPDATE public.shifts SET user_contract_id = k_x WHERE id = 'b1000000-0000-4000-8000-000000000001';
    SET LOCAL session_replication_role = origin;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
        DELETE FROM public.user_contracts WHERE id = k_x;
        GET DIAGNOSTICS n = ROW_COUNT;
        res := 'with a shift: deleted ' || n;
    EXCEPTION WHEN OTHERS THEN res := 'with a shift: refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    DELETE FROM public.user_contracts WHERE id = k;
    GET DIAGNOSTICS n = ROW_COUNT;
    res := res || ' · in force, no shifts: deleted ' || n;
    DELETE FROM public.user_contracts WHERE id = k2;
    GET DIAGNOSTICS n = ROW_COUNT;
    res := res || ' · upcoming: deleted ' || n;
    RESET ROLE;
    RAISE NOTICE 'delete as zeta — %', res;

    -- 10. assigned shifts stay inside the contract's dates (shift 1, linked above)
    BEGIN
        UPDATE hr.user_contracts SET end_date = '2026-11-30' WHERE id = k_x;
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'last day before an assigned shift: %', res;
    BEGIN
        UPDATE hr.user_contracts SET start_date = '2026-12-02' WHERE id = k_x;
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'start after an assigned shift: %', res;

    -- 11. the 38-hour rule compares contracts whose dates overlap
    INSERT INTO hr.user_contracts (user_id, role_id, organization_id, department_id, sub_department_id, employment_status, pay_basis, remuneration_level, contracted_weekly_hours, start_date, end_date)
    VALUES (g2, (SELECT id FROM hr.roles ORDER BY id OFFSET 3 LIMIT 1), o, d1, s2, 'Part-Time', 'eba_level', 2, 25, today - 30, today + 30);
    BEGIN
        INSERT INTO hr.user_contracts (user_id, role_id, organization_id, department_id, sub_department_id, employment_status, pay_basis, remuneration_level, contracted_weekly_hours, start_date)
        VALUES (g2, (SELECT id FROM hr.roles ORDER BY id OFFSET 4 LIMIT 1), o, d1, s2, 'Part-Time', 'eba_level', 2, 20, today + 14);
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'Part-Time 20h upcoming, overlapping a 25h one: %', res;
    BEGIN
        INSERT INTO hr.user_contracts (user_id, role_id, organization_id, department_id, sub_department_id, employment_status, pay_basis, remuneration_level, contracted_weekly_hours, start_date)
        VALUES (g2, (SELECT id FROM hr.roles ORDER BY id OFFSET 4 LIMIT 1), o, d1, s2, 'Part-Time', 'eba_level', 2, 20, today + 31);
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'Part-Time 20h starting after the 25h one ends: %', res;

    -- 12. the only Administrator contract keeps no end date
    BEGIN
        UPDATE hr.user_contracts SET end_date = today + 60 WHERE id = k_z;
        res := 'allowed';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
              WHEN OTHERS THEN res := 'refused(' || SQLSTATE || '): ' || SQLERRM;
    END;
    RAISE NOTICE 'end date on the only Administrator: %', res;
END
$t$;
ROLLBACK;
