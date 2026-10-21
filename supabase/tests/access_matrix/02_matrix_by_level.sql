-- LOCAL TEST DB ONLY. Run inside BEGIN ... ROLLBACK.
-- Shift fixtures: 1 = S1 (assigned X), 2 = S2 (same dept), 3 = D2/S3 (assigned X), 4 = other org.
\set QUIET on
BEGIN;
DO $t$
DECLARE
    p record;
    r text;
    n int;
    res text;
    k int;
    sid uuid;
    j jsonb;
    k_x  constant uuid := 'c0c00000-0000-4000-8000-000000000001';  -- X's alpha contract (S1)
    k_d  constant uuid := 'c0c00000-0000-4000-8000-000000000012';  -- D's delta contract
    k_e2 constant uuid := 'c0c00000-0000-4000-8000-000000000015';  -- E2's epsilon contract
    k_z  constant uuid := 'c0c00000-0000-4000-8000-000000000014';  -- Z's zeta contract
    x    constant uuid := 'a0000000-0000-4000-8000-000000000006';
BEGIN
    FOR p IN SELECT * FROM public._t_persona ORDER BY n LOOP
        r := rpad(p.n, 3);
        PERFORM set_config('request.jwt.claims', json_build_object('sub', p.id, 'role', 'authenticated')::text, true);

        -- ── reads ──────────────────────────────────────────────────────────
        SET LOCAL session_replication_role = replica;
        SET LOCAL ROLE authenticated;
        r := r || 'see[sh=' || coalesce((SELECT string_agg(right(id::text, 1), '' ORDER BY id) FROM public.shifts WHERE id::text LIKE 'b1000000-%'), '-')
               || ' ts=' || coalesce((SELECT string_agg(right(id::text, 1), '' ORDER BY id) FROM public.timesheets WHERE id::text LIKE '70000000-%'), '-')
               || ' bid=' || coalesce((SELECT string_agg(right(id::text, 1), '' ORDER BY id) FROM public.shift_bids WHERE id::text LIKE 'b0b00000-%'), '-')
               || ' swp=' || coalesce((SELECT string_agg(right(id::text, 1), '' ORDER BY id) FROM public.shift_swaps WHERE id::text LIKE '5a000000-%'), '-')
               || ' ctr=' || (SELECT count(*) FROM public.user_contracts WHERE user_id = x)
               || ' cert=' || (SELECT count(*) FROM public.app_access_certificates c WHERE c.user_id <> p.id AND c.user_id IN (SELECT id FROM public._t_persona))
               || ']';

        -- ── table writes (RLS only; triggers off) ───────────────────────────
        r := r || ' upd=';
        FOR k IN 1..4 LOOP
            sid := ('b1000000-0000-4000-8000-00000000000' || k)::uuid;
            n := 0;
            BEGIN
                UPDATE public.shifts SET notes = 'probe' WHERE id = sid;
                GET DIAGNOSTICS n = ROW_COUNT;
                RAISE EXCEPTION USING ERRCODE = 'P0099';
            EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
                      WHEN OTHERS THEN n := -1;
            END;
            r := r || CASE n WHEN 1 THEN k::text WHEN 0 THEN '.' ELSE '!' END;
        END LOOP;
        n := 0;
        BEGIN
            DELETE FROM public.shifts WHERE id = 'b1000000-0000-4000-8000-000000000002';
            GET DIAGNOSTICS n = ROW_COUNT;
            RAISE EXCEPTION USING ERRCODE = 'P0099';
        EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; WHEN OTHERS THEN n := -1;
        END;
        r := r || ' del2=' || n;

        -- ── RPCs ─────────────────────────────────────────────────────────────
        r := r || ' op=';
        FOREACH k IN ARRAY ARRAY[1, 3] LOOP
            sid := ('b1000000-0000-4000-8000-00000000000' || k)::uuid;
            BEGIN
                j := public.sm_apply_shift_op(sid, 1, 'edit', '{}'::jsonb);
                res := CASE WHEN j->>'code' = 'FORBIDDEN' THEN 'F' ELSE 'y' END;
                RAISE EXCEPTION USING ERRCODE = 'P0099';
            EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
                      WHEN insufficient_privilege THEN res := 'F';
                      WHEN OTHERS THEN res := 'y';  -- got past the guard
            END;
            r := r || k || res;
        END LOOP;
        BEGIN
            j := to_jsonb(public.sm_delete_shift('b1000000-0000-4000-8000-000000000002'));
            res := CASE WHEN j->>'code' = 'FORBIDDEN' THEN 'F' ELSE 'y' END;
            RAISE EXCEPTION USING ERRCODE = 'P0099';
        EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
                  WHEN insufficient_privilege THEN res := 'F';
                  WHEN OTHERS THEN res := 'y';
        END;
        r := r || ' rdel2=' || res;
        BEGIN
            j := public.sm_bulk_assign(ARRAY['b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003']::uuid[], x);
            res := CASE WHEN j->>'error' ILIKE 'Not authorized%' THEN 'F' ELSE 'y' END;
            RAISE EXCEPTION USING ERRCODE = 'P0099';
        EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
                  WHEN insufficient_privilege THEN res := 'F';
                  WHEN OTHERS THEN res := 'y';
        END;
        r := r || ' bulk13=' || res;
        BEGIN
            j := to_jsonb(public.sm_cancel_swap_request('5a000000-0000-4000-8000-000000000003'));
            res := CASE WHEN j->>'code' = 'FORBIDDEN' THEN 'F' ELSE 'y' END;
            RAISE EXCEPTION USING ERRCODE = 'P0099';
        EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
                  WHEN insufficient_privilege THEN res := 'F';
                  WHEN OTHERS THEN res := 'y';
        END;
        r := r || ' cxl3=' || res;

        -- ── contract write: X gets a contract in S2 ─────────────────────────
        BEGIN
            INSERT INTO public.user_contracts (user_id, role_id, organization_id, department_id, sub_department_id, status, employment_status, pay_basis, remuneration_level)
            VALUES (x, 'e0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001',
                    '54c4c466-8d56-41c1-bf36-98ee4d7364f3', 'ed004483-7cb4-40cf-a151-57053e009ea8', 'Active', 'Casual', 'eba_level', 2);
            res := 'y';
            RAISE EXCEPTION USING ERRCODE = 'P0099';
        EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
                  WHEN insufficient_privilege THEN res := '.';
                  WHEN OTHERS THEN res := '!' || SQLSTATE;
        END;
        r := r || ' ctrS2=' || res;

        -- ── access, set on contracts (triggers ON: mirror, validation, audit, last-zeta guard) ──
        RESET ROLE;
        SET LOCAL session_replication_role = origin;
        SET LOCAL ROLE authenticated;
        -- raise X's contract to gamma
        n := 0;
        BEGIN
            UPDATE public.user_contracts SET access_level = 'gamma' WHERE id = k_x;
            GET DIAGNOSTICS n = ROW_COUNT;
            RAISE EXCEPTION USING ERRCODE = 'P0099';
        EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; WHEN OTHERS THEN n := -1;
        END;
        r := r || ' grantX=' || n;
        -- lower D's and E2's contracts to alpha (revoking their access)
        FOR k IN 1..2 LOOP
            sid := CASE k WHEN 1 THEN k_d ELSE k_e2 END;
            n := 0;
            BEGIN
                UPDATE public.user_contracts SET access_level = 'alpha' WHERE id = sid;
                GET DIAGNOSTICS n = ROW_COUNT;
                RAISE EXCEPTION USING ERRCODE = 'P0099';
            EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; WHEN OTHERS THEN n := -1;
            END;
            r := r || CASE k WHEN 1 THEN ' revD=' ELSE ' revE2=' END || n;
        END LOOP;
        -- delete D's contract (its access goes with it)
        n := 0;
        BEGIN
            DELETE FROM public.user_contracts WHERE id = k_d;
            GET DIAGNOSTICS n = ROW_COUNT;
            RAISE EXCEPTION USING ERRCODE = 'P0099';
        EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; WHEN OTHERS THEN n := -1;
        END;
        r := r || ' delD=' || n;
        -- write a certificate directly: refused for everyone, zeta included
        BEGIN
            INSERT INTO public.app_access_certificates (user_id, certificate_type, access_level, organization_id, department_id, sub_department_id, contract_id)
            VALUES (x, 'Y', 'gamma', '00000000-0000-0000-0000-000000000001', '54c4c466-8d56-41c1-bf36-98ee4d7364f3', '707b57f8-77f5-4751-8bfd-5f652ef84fcd', k_x);
            res := 'y';
            RAISE EXCEPTION USING ERRCODE = 'P0099';
        EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
                  WHEN insufficient_privilege THEN res := '.';
                  WHEN OTHERS THEN res := '!' || SQLSTATE;
        END;
        r := r || ' certW=' || res;
        IF p.n = 'Z' THEN
            BEGIN
                UPDATE public.user_contracts SET access_level = 'alpha' WHERE id = k_z;
                GET DIAGNOSTICS n = ROW_COUNT;
                res := 'lowered(' || n || ')';
                RAISE EXCEPTION USING ERRCODE = 'P0099';
            EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
                      WHEN OTHERS THEN res := 'refused:' || left(SQLERRM, 40);
            END;
            r := r || ' lastZeta=' || res;
        END IF;

        RESET ROLE;
        RAISE NOTICE '%', r;
    END LOOP;
END
$t$;
ROLLBACK;
