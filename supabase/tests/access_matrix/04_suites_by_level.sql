-- LOCAL TEST DB ONLY. Run after 01_fixtures.sql; everything here rolls back.
-- Access suites (2026-10-14): what each level can see and do on the surfaces 02 does not
-- probe — availability, budgets, KPI, payroll, templates, the Admin Suite tables,
-- clocking in on someone's behalf, and open-bid visibility.
--
-- Reading a line:  y = allowed / visible,  . = refused by policy (or row not visible),
--                  F = the RPC refused the caller,  ! = unexpected error.
--   av    read X's availability exception / add a HARD one for X
--   bud   read / change department D1's budget
--   kpi   read X's performance metrics; X's quarterly performance (RPC)
--   pay   read the payroll record of shift 1 (S1)
--   tpl   see a draft template in S1 / edit it / create one in S1
--   adm   write demand_templates, start a synthesis run in S1, read X's compliance
--         rejection, rename department D1  (Admin Suite: zeta only)
--   clk   clock X in on shift 1 (on X's behalf unless the caller is X)
--   bids  which open (on_bidding) shifts are visible: 2 = S2, 5 = S1
--   pt    pay terms of shift 1 (S1, X's contract) come back non-null
--   fair  recompute the organization's fairness ledger (Admin suite)
--   grp   role in a broadcast group placed in S3: a = admin, m = member by contract, . = none
\set QUIET on
BEGIN;

SET session_replication_role = replica;
INSERT INTO public.availability_exceptions (id, profile_id, exception_date, start_time, end_time, severity)
VALUES ('a7000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000006', '2026-12-05', '09:00', '17:00', 'SOFT');
INSERT INTO public.department_budgets (id, dept_id, period_start, period_end, budgeted_hours)
VALUES ('bd000000-0000-4000-8000-000000000001', '54c4c466-8d56-41c1-bf36-98ee4d7364f3', '2026-12-01', '2026-12-31', 100);
INSERT INTO public.employee_performance_metrics (id, employee_id, period_start, period_end, quarter_year)
VALUES ('9e000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000006', '2026-10-01', '2026-12-31', '2026-Q4');
INSERT INTO public.shift_payroll_records (id, shift_id)
VALUES ('9a000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001')
ON CONFLICT (shift_id) DO NOTHING;  -- the integration suite's clock-out flow may have left one
INSERT INTO public.roster_templates (id, name, status, organization_id, department_id, sub_department_id)
VALUES ('7e000000-0000-4000-8000-000000000001', 'Probe draft', 'draft',
        '00000000-0000-0000-0000-000000000001', '54c4c466-8d56-41c1-bf36-98ee4d7364f3', '707b57f8-77f5-4751-8bfd-5f652ef84fcd');
INSERT INTO public.compliance_rejections (id, employee_id, operation_type, mode, rule_id, rule_status, summary)
VALUES ('c7000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000006', 'assign', 'probe', 'R_PROBE', 'BLOCKING', 'probe');
-- shift 1 priced on X's contract, so pay terms resolve
UPDATE public.shifts SET user_contract_id = 'c0c00000-0000-4000-8000-000000000001' WHERE id = 'b1000000-0000-4000-8000-000000000001';
-- open bids: shift 2 (S2) goes on bidding; shift 5 is a new open shift in S1
UPDATE public.shifts SET bidding_status = 'on_bidding' WHERE id = 'b1000000-0000-4000-8000-000000000002';
INSERT INTO public.shifts (id, roster_id, roster_subgroup_id, organization_id, department_id, sub_department_id, shift_date, start_time, end_time, target_employment_type, assignment_status, bidding_status, version)
VALUES ('b1000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
        '00000000-0000-0000-0000-000000000001', '54c4c466-8d56-41c1-bf36-98ee4d7364f3', '707b57f8-77f5-4751-8bfd-5f652ef84fcd',
        '2026-12-04', '09:00', '12:00', 'Casual', 'unassigned', 'on_bidding', 1);
-- a broadcast group placed in S3 (D2)
INSERT INTO public.broadcast_groups (id, name, created_by, organization_id, department_id, sub_department_id)
VALUES ('6b000000-0000-4000-8000-000000000003', 'Probe S3 group', 'a0000000-0000-4000-8000-000000000005',
        '00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', '6fefad95-9cf9-468c-8724-424cc2f7b640');
RESET session_replication_role;

DO $t$
DECLARE
    p    record;
    r    text;
    n    int;
    res  text;
    j    jsonb;
    x    constant uuid := 'a0000000-0000-4000-8000-000000000006';
    o    constant uuid := '00000000-0000-0000-0000-000000000001';
    d1   constant uuid := '54c4c466-8d56-41c1-bf36-98ee4d7364f3';
    s1   constant uuid := '707b57f8-77f5-4751-8bfd-5f652ef84fcd';
BEGIN
    FOR p IN SELECT * FROM public._t_persona ORDER BY n LOOP
        r := rpad(p.n, 3);
        PERFORM set_config('request.jwt.claims', json_build_object('sub', p.id, 'role', 'authenticated')::text, true);
        SET LOCAL session_replication_role = replica;
        SET LOCAL ROLE authenticated;

        -- availability
        r := r || 'av=' || CASE WHEN EXISTS (SELECT 1 FROM public.availability_exceptions WHERE id = 'a7000000-0000-4000-8000-000000000001') THEN 'y' ELSE '.' END;
        BEGIN
            INSERT INTO public.availability_exceptions (profile_id, exception_date, start_time, end_time, severity)
            VALUES (x, '2026-12-06', '09:00', '17:00', 'HARD');
            res := 'y';
            RAISE EXCEPTION USING ERRCODE = 'P0099';
        EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
                  WHEN insufficient_privilege THEN res := '.';
                  WHEN OTHERS THEN res := '!';
        END;
        r := r || res;

        -- budgets
        r := r || ' bud=' || CASE WHEN EXISTS (SELECT 1 FROM public.department_budgets WHERE id = 'bd000000-0000-4000-8000-000000000001') THEN 'y' ELSE '.' END;
        n := 0;
        BEGIN
            UPDATE public.department_budgets SET budgeted_hours = 1 WHERE id = 'bd000000-0000-4000-8000-000000000001';
            GET DIAGNOSTICS n = ROW_COUNT;
            RAISE EXCEPTION USING ERRCODE = 'P0099';
        EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; WHEN OTHERS THEN n := -1;
        END;
        r := r || CASE n WHEN 1 THEN 'y' WHEN 0 THEN '.' ELSE '!' END;

        -- KPI
        r := r || ' kpi=' || CASE WHEN EXISTS (SELECT 1 FROM public.employee_performance_metrics WHERE id = '9e000000-0000-4000-8000-000000000001') THEN 'y' ELSE '.' END;
        BEGIN
            PERFORM * FROM public.get_employee_quarterly_performance(x, 2026, 4);
            res := 'y';
        EXCEPTION WHEN OTHERS THEN
            res := CASE WHEN SQLERRM LIKE 'insufficient_privilege%' THEN 'F' ELSE '!' END;
        END;
        r := r || res;

        -- payroll
        r := r || ' pay=' || CASE WHEN EXISTS (SELECT 1 FROM public.shift_payroll_records WHERE shift_id = 'b1000000-0000-4000-8000-000000000001') THEN 'y' ELSE '.' END;

        -- templates
        r := r || ' tpl=' || CASE WHEN EXISTS (SELECT 1 FROM public.roster_templates WHERE id = '7e000000-0000-4000-8000-000000000001') THEN 'y' ELSE '.' END;
        n := 0;
        BEGIN
            UPDATE public.roster_templates SET description = 'probe' WHERE id = '7e000000-0000-4000-8000-000000000001';
            GET DIAGNOSTICS n = ROW_COUNT;
            RAISE EXCEPTION USING ERRCODE = 'P0099';
        EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; WHEN OTHERS THEN n := -1;
        END;
        r := r || CASE n WHEN 1 THEN 'y' WHEN 0 THEN '.' ELSE '!' END;
        BEGIN
            INSERT INTO public.roster_templates (name, status, organization_id, department_id, sub_department_id)
            VALUES ('Probe new', 'draft', o, d1, s1);
            res := 'y';
            RAISE EXCEPTION USING ERRCODE = 'P0099';
        EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
                  WHEN insufficient_privilege THEN res := '.';
                  WHEN OTHERS THEN res := '!';
        END;
        r := r || res;

        -- Admin Suite tables
        r := r || ' adm=';
        BEGIN
            INSERT INTO public.demand_templates (template_code, cluster_key, shifts) VALUES ('probe', '{}'::jsonb, '[]'::jsonb);
            res := 'y';
            RAISE EXCEPTION USING ERRCODE = 'P0099';
        EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
                  WHEN insufficient_privilege THEN res := '.';
                  WHEN OTHERS THEN res := '!';
        END;
        r := r || res;
        BEGIN
            INSERT INTO public.synthesis_runs (organization_id, department_id, sub_department_id, roster_id, shift_date, created_by)
            VALUES (o, d1, s1, 'f0000000-0000-4000-8000-000000000001', '2026-12-01', p.id);
            res := 'y';
            RAISE EXCEPTION USING ERRCODE = 'P0099';
        EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
                  WHEN insufficient_privilege THEN res := '.';
                  WHEN OTHERS THEN res := '!';
        END;
        r := r || res;
        r := r || CASE WHEN EXISTS (SELECT 1 FROM public.compliance_rejections WHERE id = 'c7000000-0000-4000-8000-000000000001') THEN 'y' ELSE '.' END;
        n := 0;
        BEGIN
            UPDATE public.departments SET name = name WHERE id = d1;
            GET DIAGNOSTICS n = ROW_COUNT;
            RAISE EXCEPTION USING ERRCODE = 'P0099';
        EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; WHEN OTHERS THEN n := -1;
        END;
        r := r || CASE n WHEN 1 THEN 'y' WHEN 0 THEN '.' ELSE '!' END;

        -- clock X in (the auth check runs before the shift-state check)
        BEGIN
            j := public.sm_clock_in('b1000000-0000-4000-8000-000000000001', x);
            res := CASE WHEN j->>'error' ILIKE 'Not authorized%' THEN 'F' ELSE 'y' END;
            RAISE EXCEPTION USING ERRCODE = 'P0099';
        EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
                  WHEN OTHERS THEN res := '!';
        END;
        r := r || ' clk=' || res;

        -- open bids
        r := r || ' bids=' || coalesce((SELECT string_agg(right(id::text, 1), '' ORDER BY id) FROM public.shifts
                                         WHERE id IN ('b1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000005')), '-');

        -- pay terms (computed column; NULL when the caller may not see them)
        BEGIN
            r := r || ' pt=' || CASE WHEN (SELECT public.shift_pay_terms(s) FROM public.shifts s
                                            WHERE s.id = 'b1000000-0000-4000-8000-000000000001') IS NOT NULL
                                     THEN 'y' ELSE '.' END;
        EXCEPTION WHEN OTHERS THEN r := r || ' pt=!';
        END;

        -- fairness recompute
        BEGIN
            PERFORM public.request_fairness_ledger_recompute(o);
            res := 'y';
            RAISE EXCEPTION USING ERRCODE = 'P0099';
        EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
                  WHEN insufficient_privilege THEN res := 'F';
                  WHEN OTHERS THEN res := '!';
        END;
        r := r || ' fair=' || res;

        -- broadcast group membership by contract (every contract, not one)
        r := r || ' grp=' || CASE public.get_broadcast_group_role('6b000000-0000-4000-8000-000000000003')
                                  WHEN 'admin' THEN 'a' WHEN 'member' THEN 'm' WHEN 'broadcaster' THEN 'b'
                                  ELSE '.' END;

        RESET ROLE;
        RAISE NOTICE '%', r;
    END LOOP;
END
$t$;
ROLLBACK;
