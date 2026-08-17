-- Implicit roster activation + merged Schedule-from-Template — behavioural suite for:
--   sm_resolve_roster / sm_create_shift / sm_move_shift /
--   apply_template_to_date_range_v2 / add_roster_subgroup_range /
--   seed_standard_roster_groups + backfill / sm_ensure_rosters_for_range
--
-- Run against a database built from the baseline plus every migration. Every
-- check RAISEs on failure, so a clean run means all 29 assertions held.
-- Last green: 2026-08-05, PostgreSQL 17.
--
-- Seed prerequisites (org / dept / sub-dept / profiles / rbac / certificate):
--   -- Minimal scope seed for sm_resolve_roster / sm_create_shift / sm_move_shift tests.
--   BEGIN;
--   
--   INSERT INTO auth.users (id, email) VALUES
--     ('11111111-1111-1111-1111-111111111111', 'mgr@example.com'),
--     ('22222222-2222-2222-2222-222222222222', 'outsider@example.com')
--   ON CONFLICT DO NOTHING;
--   
--   INSERT INTO public.organizations (id, name) VALUES
--     ('aaaaaaaa-0000-0000-0000-000000000001', 'ICC Sydney')
--   ON CONFLICT DO NOTHING;
--   
--   INSERT INTO public.departments (id, organization_id, name) VALUES
--     ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Operations')
--   ON CONFLICT DO NOTHING;
--   
--   INSERT INTO public.sub_departments (id, department_id, name) VALUES
--     ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Security')
--   ON CONFLICT DO NOTHING;
--   
--   INSERT INTO public.profiles (id, email, first_name, last_name)
--   VALUES ('11111111-1111-1111-1111-111111111111', 'mgr@example.com', 'Morgan', 'Manager'),
--          ('22222222-2222-2222-2222-222222222222', 'outsider@example.com', 'Odd', 'Outsider')
--   ON CONFLICT (id) DO NOTHING;
--   
--   -- rbac_permissions is DATA in prod, not migration output, so the fresh local DB
--   -- has none. Mirror prod's roster.edit grants exactly (verified 2026-08-05):
--   --   delta:ORG, epsilon:ORG, gamma:SUB_DEPT, zeta:ORG
--   INSERT INTO public.rbac_actions (code, description) VALUES ('roster.edit', 'Edit rosters') ON CONFLICT DO NOTHING;
--   
--   INSERT INTO public.rbac_permissions (access_level, action_code, scope) VALUES
--     ('delta',   'roster.edit', 'ORG'),
--     ('epsilon', 'roster.edit', 'ORG'),
--     ('gamma',   'roster.edit', 'SUB_DEPT'),
--     ('zeta',    'roster.edit', 'ORG')
--   ON CONFLICT DO NOTHING;
--   
--   -- Manager: delta @ ORG scope -> holds roster.edit anywhere in the org.
--   -- Type Y is the tier that carries gamma/delta/epsilon/zeta (validate_certificate_on_change).
--   -- delta requires department_id set and sub_department_id null (chk_scope_nullability).
--   INSERT INTO public.app_access_certificates
--     (user_id, organization_id, department_id, access_level, certificate_type, is_active)
--   VALUES
--     ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'delta', 'Y', true)
--   ON CONFLICT DO NOTHING;
--   
--   -- Outsider gets NO certificate at all -> must be denied.
--   
--   COMMIT;
--   
--   SELECT 'seed_ok' AS status,
--          (SELECT count(*) FROM public.rbac_permissions WHERE action_code='roster.edit') AS rbac_rows,
--          (SELECT count(*) FROM public.app_access_certificates) AS certs;

\set ON_ERROR_STOP on
\pset pager off

-- Run as a real authenticated user, not superuser, so grants are exercised.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

\echo '================ sm_resolve_roster ================'

-- T1: future date -> creates roster + the four venue groups
DO $$
DECLARE r1 uuid; n int;
BEGIN
    r1 := public.sm_resolve_roster(
        'aaaaaaaa-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000001',
        'cccccccc-0000-0000-0000-000000000001',
        (now() AT TIME ZONE 'Australia/Sydney')::date + 10);
    IF r1 IS NULL THEN RAISE EXCEPTION 'T1 FAIL: null roster'; END IF;
    SELECT count(*) INTO n FROM roster_groups WHERE roster_id = r1;
    IF n <> 4 THEN RAISE EXCEPTION 'T1 FAIL: expected 4 groups, got %', n; END IF;
    RAISE NOTICE 'T1 PASS: created roster % with 4 groups', r1;
END $$;

-- T2: idempotent -- same id, no duplicate groups
DO $$
DECLARE a uuid; b uuid; n int;
BEGIN
    a := public.sm_resolve_roster('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',(now() AT TIME ZONE 'Australia/Sydney')::date + 10);
    b := public.sm_resolve_roster('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',(now() AT TIME ZONE 'Australia/Sydney')::date + 10);
    IF a <> b THEN RAISE EXCEPTION 'T2 FAIL: not idempotent (% vs %)', a, b; END IF;
    SELECT count(*) INTO n FROM roster_groups WHERE roster_id = a;
    IF n <> 4 THEN RAISE EXCEPTION 'T2 FAIL: groups duplicated, got %', n; END IF;
    RAISE NOTICE 'T2 PASS: idempotent, still 4 groups';
END $$;

-- T3: NULL sub_department_id -- THE BUG FIX. Old code did `= NULL`, missed, then
-- collided with uk_rosters_date_dept_subdept on the second call.
DO $$
DECLARE a uuid; b uuid; n int;
BEGIN
    a := public.sm_resolve_roster('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001', NULL, (now() AT TIME ZONE 'Australia/Sydney')::date + 11);
    b := public.sm_resolve_roster('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001', NULL, (now() AT TIME ZONE 'Australia/Sydney')::date + 11);
    IF a <> b THEN RAISE EXCEPTION 'T3 FAIL: NULL sub-dept not idempotent (% vs %)', a, b; END IF;
    SELECT count(*) INTO n FROM rosters WHERE start_date = (now() AT TIME ZONE 'Australia/Sydney')::date + 11 AND sub_department_id IS NULL;
    IF n <> 1 THEN RAISE EXCEPTION 'T3 FAIL: expected exactly 1 roster, got %', n; END IF;
    RAISE NOTICE 'T3 PASS: NULL sub-dept resolves idempotently (bug fixed)';
END $$;

-- T3b: prove the OLD predicate really was broken, so T3 is not vacuous
DO $$
DECLARE found uuid;
BEGIN
    SELECT id INTO found FROM rosters
     WHERE start_date = (now() AT TIME ZONE 'Australia/Sydney')::date + 11
       AND department_id = 'bbbbbbbb-0000-0000-0000-000000000001'
       AND sub_department_id = NULL;          -- the old, NULL-unsafe predicate
    IF found IS NOT NULL THEN RAISE EXCEPTION 'T3b FAIL: old predicate unexpectedly matched'; END IF;
    RAISE NOTICE 'T3b PASS: old `= NULL` predicate finds nothing (would have re-INSERTed -> 23505)';
END $$;

-- T4: past date refused
DO $$
DECLARE r uuid;
BEGIN
    BEGIN
        r := public.sm_resolve_roster('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',(now() AT TIME ZONE 'Australia/Sydney')::date - 3);
        RAISE EXCEPTION 'T4 FAIL: past date was allowed';
    EXCEPTION WHEN sqlstate '22007' THEN
        RAISE NOTICE 'T4 PASS: past date refused (22007)';
    END;
END $$;

-- T5: an EXISTING past roster still resolves (read, not create)
DO $$
DECLARE r uuid; got uuid; d date := (now() AT TIME ZONE 'Australia/Sydney')::date - 4;
BEGIN
    r := public.sm_resolve_roster('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001', d, true);  -- allow_past
    got := public.sm_resolve_roster('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001', d);        -- no allow_past
    IF got <> r THEN RAISE EXCEPTION 'T5 FAIL: existing past roster did not resolve'; END IF;
    RAISE NOTICE 'T5 PASS: existing past roster resolves without allow_past';
END $$;

-- T6: caller without roster.edit is denied
DO $$
DECLARE r uuid;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
    BEGIN
        r := public.sm_resolve_roster('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',(now() AT TIME ZONE 'Australia/Sydney')::date + 20);
        RAISE EXCEPTION 'T6 FAIL: unauthorized caller created a roster';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'T6 PASS: unauthorized caller denied (42501)';
    END;
    PERFORM set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
END $$;

-- T7a: the trigger seeds all FOUR venue groups. It seeded only three until
-- 20260805140000, which is why prod read 163/163/163/160. Regression guard.
DO $$
DECLARE r uuid; n int; has_cutaway boolean;
        d date := (now() AT TIME ZONE 'Australia/Sydney')::date + 30;
BEGIN
    INSERT INTO rosters (organization_id, department_id, sub_department_id, start_date, end_date, status, is_locked)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001', d, d, 'draft', false)
    RETURNING id INTO r;

    SELECT count(*) INTO n FROM roster_groups WHERE roster_id = r;
    SELECT EXISTS(SELECT 1 FROM roster_groups WHERE roster_id = r AND external_id = 'the_cutaway') INTO has_cutaway;
    IF n <> 4 OR NOT has_cutaway THEN
        RAISE EXCEPTION 'T7a FAIL: trigger seeded % groups, the_cutaway present = %', n, has_cutaway;
    END IF;
    RAISE NOTICE 'T7a PASS: trigger seeds all four venue groups incl. the_cutaway';
END $$;

-- T7: a LEGACY roster (pre-20260805140000 shape, missing the_cutaway) is repaired
-- by the resolve path. Simulated by deleting the group the old trigger never made.
DO $$
DECLARE r uuid; got uuid; n int; has_cutaway boolean;
        d date := (now() AT TIME ZONE 'Australia/Sydney')::date + 30;
BEGIN
    SELECT id INTO r FROM rosters WHERE start_date = d
       AND department_id = 'bbbbbbbb-0000-0000-0000-000000000001';
    DELETE FROM roster_groups WHERE roster_id = r AND external_id = 'the_cutaway';

    SELECT count(*) INTO n FROM roster_groups WHERE roster_id = r;
    IF n <> 3 THEN RAISE EXCEPTION 'T7 SETUP: expected 3 groups after delete, got %', n; END IF;

    got := public.sm_resolve_roster('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001', d);
    IF got <> r THEN RAISE EXCEPTION 'T7 FAIL: resolved a different roster'; END IF;
    SELECT count(*) INTO n FROM roster_groups WHERE roster_id = r;
    SELECT EXISTS(SELECT 1 FROM roster_groups WHERE roster_id = r AND external_id = 'the_cutaway') INTO has_cutaway;
    IF n <> 4 OR NOT has_cutaway THEN RAISE EXCEPTION 'T7 FAIL: the_cutaway not repaired (% groups)', n; END IF;
    RAISE NOTICE 'T7 PASS: resolve path repairs a legacy roster missing the_cutaway';
END $$;

-- T7b: and a Cutaway shift on such a day now actually works
DO $$
DECLARE sid uuid; g uuid; d date := (now() AT TIME ZONE 'Australia/Sydney')::date + 30;
BEGIN
    sid := public.sm_create_shift(jsonb_build_object(
        'organization_id','aaaaaaaa-0000-0000-0000-000000000001',
        'department_id','bbbbbbbb-0000-0000-0000-000000000001',
        'sub_department_id','cccccccc-0000-0000-0000-000000000001',
        'shift_date', d::text, 'start_time','09:00','end_time','17:00',
        'group_type','the_cutaway','sub_group_name','General',
        'target_employment_type','Casual'
    ), '11111111-1111-1111-1111-111111111111');
    SELECT shift_group_id INTO g FROM shifts WHERE id = sid;
    IF g IS NULL THEN RAISE EXCEPTION 'T7b FAIL: the_cutaway group not resolved'; END IF;
    RAISE NOTICE 'T7b PASS: Cutaway shift creatable on a trigger-seeded roster';
END $$;

\echo '================ sm_create_shift ================'

-- T8: no roster_id -> resolves the day, fills shift_group_id + roster_subgroup_id
DO $$
DECLARE sid uuid; s record; d date := (now() AT TIME ZONE 'Australia/Sydney')::date + 40;
BEGIN
    sid := public.sm_create_shift(jsonb_build_object(
        'organization_id',  'aaaaaaaa-0000-0000-0000-000000000001',
        'department_id',    'bbbbbbbb-0000-0000-0000-000000000001',
        'sub_department_id','cccccccc-0000-0000-0000-000000000001',
        'shift_date',       d::text,
        'start_time',       '09:00',
        'end_time',         '17:00',
        'group_type',       'convention_centre',
        'sub_group_name',   'General',
        'target_employment_type', 'Casual'
    ), '11111111-1111-1111-1111-111111111111');

    SELECT * INTO s FROM shifts WHERE id = sid;
    IF s.roster_id IS NULL          THEN RAISE EXCEPTION 'T8 FAIL: roster_id null'; END IF;
    IF s.shift_group_id IS NULL     THEN RAISE EXCEPTION 'T8 FAIL: shift_group_id not resolved'; END IF;
    IF s.roster_subgroup_id IS NULL THEN RAISE EXCEPTION 'T8 FAIL: roster_subgroup_id not resolved'; END IF;
    PERFORM 1 FROM rosters WHERE id = s.roster_id AND start_date = d;
    IF NOT FOUND THEN RAISE EXCEPTION 'T8 FAIL: roster date mismatch'; END IF;
    RAISE NOTICE 'T8 PASS: shift created with no roster_id; roster/group/subgroup all resolved';
END $$;

-- T9: past date is refused through sm_create_shift too
DO $$
DECLARE sid uuid;
BEGIN
    BEGIN
        sid := public.sm_create_shift(jsonb_build_object(
            'organization_id','aaaaaaaa-0000-0000-0000-000000000001',
            'department_id','bbbbbbbb-0000-0000-0000-000000000001',
            'sub_department_id','cccccccc-0000-0000-0000-000000000001',
            'shift_date', ((now() AT TIME ZONE 'Australia/Sydney')::date - 5)::text,
            'start_time','09:00','end_time','17:00',
            'group_type','theatre','sub_group_name','General',
            'target_employment_type','Casual'
        ), '11111111-1111-1111-1111-111111111111');
        RAISE EXCEPTION 'T9 FAIL: created a shift in the past';
    EXCEPTION WHEN sqlstate '22007' THEN
        RAISE NOTICE 'T9 PASS: past-date shift refused (22007)';
    END;
END $$;

-- T10: explicit roster_id path unchanged
DO $$
DECLARE r uuid; sid uuid; got uuid; d date := (now() AT TIME ZONE 'Australia/Sydney')::date + 41;
BEGIN
    r := public.sm_resolve_roster('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001', d);
    sid := public.sm_create_shift(jsonb_build_object(
        'roster_id', r,
        'organization_id','aaaaaaaa-0000-0000-0000-000000000001',
        'department_id','bbbbbbbb-0000-0000-0000-000000000001',
        'sub_department_id','cccccccc-0000-0000-0000-000000000001',
        'shift_date', d::text, 'start_time','09:00','end_time','17:00',
        'group_type','theatre','sub_group_name','Ushers',
        'target_employment_type','Casual'
    ), '11111111-1111-1111-1111-111111111111');
    SELECT roster_id INTO got FROM shifts WHERE id = sid;
    IF got <> r THEN RAISE EXCEPTION 'T10 FAIL: explicit roster_id not honoured'; END IF;
    RAISE NOTICE 'T10 PASS: explicit roster_id honoured unchanged';
END $$;

\echo '================ sm_move_shift ================'

-- T11: cross-date move re-points roster_id (the bug being fixed)
DO $$
DECLARE sid uuid; before_r uuid; after_r uuid; res jsonb;
        d1 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 50;
        d2 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 51;
        rd date;
BEGIN
    sid := public.sm_create_shift(jsonb_build_object(
        'organization_id','aaaaaaaa-0000-0000-0000-000000000001',
        'department_id','bbbbbbbb-0000-0000-0000-000000000001',
        'sub_department_id','cccccccc-0000-0000-0000-000000000001',
        'shift_date', d1::text, 'start_time','09:00','end_time','17:00',
        'group_type','exhibition_centre','sub_group_name','General',
        'target_employment_type','Casual'
    ), '11111111-1111-1111-1111-111111111111');
    SELECT roster_id INTO before_r FROM shifts WHERE id = sid;

    res := public.sm_move_shift(sid, NULL, NULL, NULL, NULL, d2, '11111111-1111-1111-1111-111111111111');
    IF NOT (res->>'success')::boolean THEN RAISE EXCEPTION 'T11 FAIL: move failed %', res; END IF;

    SELECT roster_id INTO after_r FROM shifts WHERE id = sid;
    IF after_r = before_r THEN RAISE EXCEPTION 'T11 FAIL: roster_id NOT re-pointed (the old bug)'; END IF;
    SELECT start_date INTO rd FROM rosters WHERE id = after_r;
    IF rd <> d2 THEN RAISE EXCEPTION 'T11 FAIL: new roster date % <> shift date %', rd, d2; END IF;
    RAISE NOTICE 'T11 PASS: cross-date move re-pointed roster_id to the target day';
END $$;

-- T11b: the moved shift's subgroup belongs to the DESTINATION roster, not the source
DO $$
DECLARE sid uuid; sg uuid; owner_roster uuid; r uuid;
        d1 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 60;
        d2 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 61;
BEGIN
    sid := public.sm_create_shift(jsonb_build_object(
        'organization_id','aaaaaaaa-0000-0000-0000-000000000001',
        'department_id','bbbbbbbb-0000-0000-0000-000000000001',
        'sub_department_id','cccccccc-0000-0000-0000-000000000001',
        'shift_date', d1::text, 'start_time','09:00','end_time','17:00',
        'group_type','theatre','sub_group_name','Ushers',
        'target_employment_type','Casual'
    ), '11111111-1111-1111-1111-111111111111');
    PERFORM public.sm_move_shift(sid, NULL, NULL, NULL, NULL, d2, '11111111-1111-1111-1111-111111111111');

    SELECT roster_subgroup_id, roster_id INTO sg, r FROM shifts WHERE id = sid;
    SELECT rg.roster_id INTO owner_roster
      FROM roster_subgroups rsg JOIN roster_groups rg ON rg.id = rsg.roster_group_id
     WHERE rsg.id = sg;
    IF owner_roster <> r THEN
        RAISE EXCEPTION 'T11b FAIL: subgroup belongs to roster % but shift is on %', owner_roster, r;
    END IF;
    RAISE NOTICE 'T11b PASS: group/subgroup re-resolved onto the destination roster';
END $$;

-- T12: same-date move leaves roster_id alone
DO $$
DECLARE sid uuid; before_r uuid; after_r uuid; res jsonb;
        d date := (now() AT TIME ZONE 'Australia/Sydney')::date + 52;
BEGIN
    sid := public.sm_create_shift(jsonb_build_object(
        'organization_id','aaaaaaaa-0000-0000-0000-000000000001',
        'department_id','bbbbbbbb-0000-0000-0000-000000000001',
        'sub_department_id','cccccccc-0000-0000-0000-000000000001',
        'shift_date', d::text, 'start_time','09:00','end_time','17:00',
        'group_type','the_cutaway','sub_group_name','General',
        'target_employment_type','Casual'
    ), '11111111-1111-1111-1111-111111111111');
    SELECT roster_id INTO before_r FROM shifts WHERE id = sid;
    res := public.sm_move_shift(sid, 'theatre', 'Ushers', NULL, NULL, NULL, '11111111-1111-1111-1111-111111111111');
    SELECT roster_id INTO after_r FROM shifts WHERE id = sid;
    IF after_r <> before_r THEN RAISE EXCEPTION 'T12 FAIL: same-date move changed roster_id'; END IF;
    RAISE NOTICE 'T12 PASS: same-date move leaves roster_id untouched';
END $$;

-- T13: NULL group/subgroup params mean "unchanged", not "set to NULL".
-- This is the drop-into-Unassigned path that used to 23502 on roster_subgroup_id.
DO $$
DECLARE sid uuid; before_sg uuid; after_sg uuid; before_g uuid; after_g uuid; res jsonb;
        d date := (now() AT TIME ZONE 'Australia/Sydney')::date + 53;
BEGIN
    sid := public.sm_create_shift(jsonb_build_object(
        'organization_id','aaaaaaaa-0000-0000-0000-000000000001',
        'department_id','bbbbbbbb-0000-0000-0000-000000000001',
        'sub_department_id','cccccccc-0000-0000-0000-000000000001',
        'shift_date', d::text, 'start_time','09:00','end_time','17:00',
        'group_type','convention_centre','sub_group_name','General',
        'target_employment_type','Casual'
    ), '11111111-1111-1111-1111-111111111111');
    SELECT roster_subgroup_id, shift_group_id INTO before_sg, before_g FROM shifts WHERE id = sid;

    -- every optional param NULL, exactly as the Unassigned drop sends it
    res := public.sm_move_shift(sid, NULL, NULL, NULL, NULL, NULL, '11111111-1111-1111-1111-111111111111');
    IF NOT (res->>'success')::boolean THEN RAISE EXCEPTION 'T13 FAIL: %', res; END IF;

    SELECT roster_subgroup_id, shift_group_id INTO after_sg, after_g FROM shifts WHERE id = sid;
    IF after_sg IS DISTINCT FROM before_sg THEN RAISE EXCEPTION 'T13 FAIL: subgroup was clobbered'; END IF;
    IF after_g  IS DISTINCT FROM before_g  THEN RAISE EXCEPTION 'T13 FAIL: group was clobbered'; END IF;
    RAISE NOTICE 'T13 PASS: NULL params preserve group/subgroup (no 23502)';
END $$;

-- T13b: a group/subgroup id belonging to ANOTHER day's roster is rejected and
-- re-resolved on this shift's own roster. This is what GroupModeView actually
-- sends, because its visual rows collapse ids across the whole date range.
DO $$
DECLARE sid uuid; other_r uuid; foreign_sg uuid; own_r uuid; after_sg uuid; owner_r uuid; res jsonb;
        d  date := (now() AT TIME ZONE 'Australia/Sydney')::date + 70;
        d2 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 71;
BEGIN
    sid := public.sm_create_shift(jsonb_build_object(
        'organization_id','aaaaaaaa-0000-0000-0000-000000000001',
        'department_id','bbbbbbbb-0000-0000-0000-000000000001',
        'sub_department_id','cccccccc-0000-0000-0000-000000000001',
        'shift_date', d::text, 'start_time','09:00','end_time','17:00',
        'group_type','theatre','sub_group_name','Ushers',
        'target_employment_type','Casual'
    ), '11111111-1111-1111-1111-111111111111');
    SELECT roster_id INTO own_r FROM shifts WHERE id = sid;

    -- a different day's roster, with its own Theatre/Ushers subgroup
    other_r := public.sm_resolve_roster('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001', d2);
    INSERT INTO roster_subgroups (roster_group_id, name, sort_order)
    SELECT id, 'Ushers', 0 FROM roster_groups WHERE roster_id = other_r AND external_id = 'theatre'
    RETURNING id INTO foreign_sg;

    -- same-date move, but handed the FOREIGN subgroup id
    res := public.sm_move_shift(sid, 'theatre', 'Ushers', NULL, foreign_sg, NULL, '11111111-1111-1111-1111-111111111111');
    IF NOT (res->>'success')::boolean THEN RAISE EXCEPTION 'T13b FAIL: %', res; END IF;

    SELECT roster_subgroup_id INTO after_sg FROM shifts WHERE id = sid;
    IF after_sg = foreign_sg THEN RAISE EXCEPTION 'T13b FAIL: accepted a foreign-roster subgroup id'; END IF;
    SELECT rg.roster_id INTO owner_r FROM roster_subgroups rsg JOIN roster_groups rg ON rg.id = rsg.roster_group_id WHERE rsg.id = after_sg;
    IF owner_r <> own_r THEN RAISE EXCEPTION 'T13b FAIL: subgroup owned by roster %, shift on %', owner_r, own_r; END IF;
    RAISE NOTICE 'T13b PASS: foreign-roster subgroup id rejected and re-resolved locally';
END $$;

RESET ROLE;
\echo '================ ALL TESTS PASSED ================'

\echo '================ apply_template_to_date_range_v2 ================'

-- Fixture built as owner: roster_templates RLS is not what is under test here.
RESET ROLE;
DO $$
DECLARE t uuid; g uuid; sg uuid;
BEGIN
    INSERT INTO roster_templates (name, organization_id, department_id, sub_department_id, description)
    VALUES ('Fixture Template', 'aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','fixture')
    RETURNING id INTO t;
    INSERT INTO template_groups (template_id, name, sort_order) VALUES (t, 'Theatre', 2) RETURNING id INTO g;
    INSERT INTO template_subgroups (group_id, name, sort_order) VALUES (g, 'Ushers', 0) RETURNING id INTO sg;
    INSERT INTO template_shifts (subgroup_id, name, start_time, end_time, day_of_week, target_employment_type)
    VALUES (sg, 'Usher', '09:00', '17:00', NULL, 'Casual');
    PERFORM set_config('test.template_id', t::text, false);
END $$;

-- Second fixture with NO sub-department of its own. apply_template does
-- COALESCE(p_target_sub_department_id, template.sub_department_id), so the NULL
-- path is only reachable when BOTH are null.
DO $$
DECLARE t uuid; g uuid; sg uuid;
BEGIN
    INSERT INTO roster_templates (name, organization_id, department_id, sub_department_id, description)
    VALUES ('Fixture No SubDept', 'aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001', NULL, 'fixture')
    RETURNING id INTO t;
    INSERT INTO template_groups (template_id, name, sort_order) VALUES (t, 'Theatre', 2) RETURNING id INTO g;
    INSERT INTO template_subgroups (group_id, name, sort_order) VALUES (g, 'Ushers', 0) RETURNING id INTO sg;
    INSERT INTO template_shifts (subgroup_id, name, start_time, end_time, day_of_week, target_employment_type)
    VALUES (sg, 'Usher', '09:00', '17:00', NULL, 'Casual');
    PERFORM set_config('test.template_nosub_id', t::text, false);
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- T14: apply to a COLD future range -- no rosters exist for any of those days
DO $$
DECLARE t uuid := current_setting('test.template_id')::uuid; res jsonb; n int;
        d1 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 100;
        d2 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 102;
BEGIN
    SELECT count(*) INTO n FROM rosters WHERE start_date BETWEEN d1 AND d2;
    IF n <> 0 THEN RAISE EXCEPTION 'T14 SETUP: range is not cold'; END IF;

    res := public.apply_template_to_date_range_v2(t, d1, d2, '11111111-1111-1111-1111-111111111111',
                                                  'roster_modal',
                                                  'bbbbbbbb-0000-0000-0000-000000000001',
                                                  'cccccccc-0000-0000-0000-000000000001', false);
    IF NOT (res->>'success')::boolean THEN RAISE EXCEPTION 'T14 FAIL: %', res; END IF;
    IF (res->>'shifts_created')::int <> 3 THEN RAISE EXCEPTION 'T14 FAIL: expected 3 shifts, got %', res->>'shifts_created'; END IF;
    SELECT count(*) INTO n FROM rosters WHERE start_date BETWEEN d1 AND d2;
    IF n <> 3 THEN RAISE EXCEPTION 'T14 FAIL: expected 3 rosters created, got %', n; END IF;
    RAISE NOTICE 'T14 PASS: template applied to a cold range (3 rosters + 3 shifts, no activation)';
END $$;

-- T15: NULL sub-department -- the 23505 that the old `= NULL` predicate produced
DO $$
DECLARE t uuid := current_setting('test.template_nosub_id')::uuid; res jsonb; n int;
        d1 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 110;
BEGIN
    res := public.apply_template_to_date_range_v2(t, d1, d1, '11111111-1111-1111-1111-111111111111',
                                                  'roster_modal',
                                                  'bbbbbbbb-0000-0000-0000-000000000001',
                                                  NULL, false);
    IF NOT (res->>'success')::boolean THEN RAISE EXCEPTION 'T15 FAIL: %', res; END IF;

    -- apply twice: the second pass is where the old code re-INSERTed and blew up
    res := public.apply_template_to_date_range_v2(t, d1, d1, '11111111-1111-1111-1111-111111111111',
                                                  'roster_modal',
                                                  'bbbbbbbb-0000-0000-0000-000000000001',
                                                  NULL, false);
    IF NOT (res->>'success')::boolean THEN RAISE EXCEPTION 'T15 FAIL on re-apply: %', res; END IF;

    SELECT count(*) INTO n FROM rosters WHERE start_date = d1 AND sub_department_id IS NULL;
    IF n <> 1 THEN RAISE EXCEPTION 'T15 FAIL: expected 1 roster, got %', n; END IF;
    RAISE NOTICE 'T15 PASS: NULL sub-dept apply is idempotent (old code raised 23505 here)';
END $$;

-- T16: past days are soft-skipped, not created, when force_stack is false
DO $$
DECLARE t uuid := current_setting('test.template_id')::uuid; res jsonb; n int;
        d1 date := (now() AT TIME ZONE 'Australia/Sydney')::date - 3;
        d2 date := (now() AT TIME ZONE 'Australia/Sydney')::date - 1;
BEGIN
    res := public.apply_template_to_date_range_v2(t, d1, d2, '11111111-1111-1111-1111-111111111111',
                                                  'roster_modal',
                                                  'bbbbbbbb-0000-0000-0000-000000000001',
                                                  'cccccccc-0000-0000-0000-000000000001', false);
    IF NOT (res->>'success')::boolean THEN RAISE EXCEPTION 'T16 FAIL: %', res; END IF;
    IF (res->>'shifts_created')::int <> 0 THEN RAISE EXCEPTION 'T16 FAIL: created % past shifts', res->>'shifts_created'; END IF;
    IF (res->>'shifts_skipped')::int <> 3 THEN RAISE EXCEPTION 'T16 FAIL: expected 3 skipped, got %', res->>'shifts_skipped'; END IF;
    SELECT count(*) INTO n FROM shifts WHERE shift_date BETWEEN d1 AND d2;
    IF n <> 0 THEN RAISE EXCEPTION 'T16 FAIL: % shifts exist in the past', n; END IF;
    RAISE NOTICE 'T16 PASS: past shifts soft-skipped (0 created, 3 skipped)';
END $$;

RESET ROLE;
\echo '================ TEMPLATE TESTS PASSED ================'

\echo '================ add_roster_subgroup_range ================'

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- T17: cold future day -> roster created with all four groups + the subgroup
DO $$
DECLARE r uuid; n int; d date := (now() AT TIME ZONE 'Australia/Sydney')::date + 120;
BEGIN
    SELECT count(*) INTO n FROM rosters WHERE start_date = d;
    IF n <> 0 THEN RAISE EXCEPTION 'T17 SETUP: day is not cold'; END IF;

    PERFORM public.add_roster_subgroup_range(
        'aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
        'cccccccc-0000-0000-0000-000000000001','the_cutaway','Riggers', d, d);

    SELECT id INTO r FROM rosters WHERE start_date = d
       AND department_id = 'bbbbbbbb-0000-0000-0000-000000000001'
       AND sub_department_id = 'cccccccc-0000-0000-0000-000000000001';
    IF r IS NULL THEN RAISE EXCEPTION 'T17 FAIL: no roster created'; END IF;

    -- used to create ONLY the one group it needed
    SELECT count(*) INTO n FROM roster_groups WHERE roster_id = r;
    IF n <> 4 THEN RAISE EXCEPTION 'T17 FAIL: expected 4 groups, got %', n; END IF;

    SELECT count(*) INTO n FROM roster_subgroups rsg
      JOIN roster_groups rg ON rg.id = rsg.roster_group_id
     WHERE rg.roster_id = r AND rsg.name = 'Riggers';
    IF n <> 1 THEN RAISE EXCEPTION 'T17 FAIL: subgroup not created'; END IF;
    RAISE NOTICE 'T17 PASS: cold day gets a roster with all four groups + the subgroup';
END $$;

-- T18: past days are SKIPPED, not raised on, and no past roster is created
-- Counted as a BEFORE/AFTER delta: earlier tests legitimately leave past rosters
-- behind (apply_template creates containers across its whole range by design), so
-- an absolute count would measure them rather than this call.
DO $$
DECLARE n int; before_n int;
        d1 date := (now() AT TIME ZONE 'Australia/Sydney')::date - 2;
        d2 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 121;
        yesterday date := (now() AT TIME ZONE 'Australia/Sydney')::date - 1;
BEGIN
    SELECT count(*) INTO before_n FROM rosters WHERE start_date BETWEEN d1 AND yesterday;

    PERFORM public.add_roster_subgroup_range(
        'aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
        'cccccccc-0000-0000-0000-000000000001','theatre','Stagehands', d1, d2);

    SELECT count(*) INTO n FROM rosters WHERE start_date BETWEEN d1 AND yesterday;
    IF n <> before_n THEN RAISE EXCEPTION 'T18 FAIL: created % past rosters', n - before_n; END IF;

    -- and it added no subgroup to any past day either
    SELECT count(*) INTO n FROM roster_subgroups rsg
      JOIN roster_groups rg ON rg.id = rsg.roster_group_id
      JOIN rosters r ON r.id = rg.roster_id
     WHERE r.start_date <= yesterday AND rsg.name = 'Stagehands';
    IF n <> 0 THEN RAISE EXCEPTION 'T18 FAIL: subgroup added to % past days', n; END IF;

    SELECT count(*) INTO n FROM roster_subgroups rsg
      JOIN roster_groups rg ON rg.id = rsg.roster_group_id
      JOIN rosters r ON r.id = rg.roster_id
     WHERE r.start_date = d2 AND rsg.name = 'Stagehands';
    IF n <> 1 THEN RAISE EXCEPTION 'T18 FAIL: future day of the range was not processed'; END IF;
    RAISE NOTICE 'T18 PASS: past days skipped (range still processed), no past rosters created';
END $$;

-- T19: unauthorized caller cannot create rosters through this path either
DO $$
DECLARE d date := (now() AT TIME ZONE 'Australia/Sydney')::date + 122;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
    BEGIN
        PERFORM public.add_roster_subgroup_range(
            'aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
            'cccccccc-0000-0000-0000-000000000001','theatre','Sneaky', d, d);
        RAISE EXCEPTION 'T19 FAIL: unauthorized caller created a roster';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'T19 PASS: unauthorized caller denied (42501)';
    END;
    PERFORM set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
END $$;

-- T20: closing invariant -- after everything above, no roster anywhere is missing
-- any of the four venue groups. Covers the 20260805140000 backfill too.
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n
      FROM rosters r
     CROSS JOIN (VALUES ('convention_centre'),('exhibition_centre'),('theatre'),('the_cutaway')) AS g(ext)
     WHERE NOT EXISTS (SELECT 1 FROM roster_groups rg WHERE rg.roster_id = r.id AND rg.external_id = g.ext);
    IF n <> 0 THEN RAISE EXCEPTION 'T20 FAIL: % roster/group pairs missing', n; END IF;
    RAISE NOTICE 'T20 PASS: every roster has all four venue groups';
END $$;

-- T21: the 20260805140000 BACKFILL statement itself. It is a no-op during a
-- from-scratch replay (no rosters exist yet), so exercise it against the legacy
-- shape it was written for.
DO $$
DECLARE r uuid; n int; d date := (now() AT TIME ZONE 'Australia/Sydney')::date + 130;
BEGIN
    r := public.sm_resolve_roster('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001', d);
    DELETE FROM roster_groups WHERE roster_id = r AND external_id IN ('the_cutaway','theatre');
    SELECT count(*) INTO n FROM roster_groups WHERE roster_id = r;
    IF n <> 2 THEN RAISE EXCEPTION 'T21 SETUP: expected 2 groups, got %', n; END IF;

    -- verbatim backfill from the migration
    INSERT INTO public.roster_groups (roster_id, name, external_id, sort_order)
    SELECT r2.id, g.name, g.external_id, g.sort_order
      FROM public.rosters r2
     CROSS JOIN (VALUES
            ('Convention Centre', 'convention_centre', 0),
            ('Exhibition Centre', 'exhibition_centre', 1),
            ('Theatre',           'theatre',           2),
            ('The Cutaway',       'the_cutaway',       3)
         ) AS g(name, external_id, sort_order)
     WHERE NOT EXISTS (
         SELECT 1 FROM public.roster_groups rg
          WHERE rg.roster_id = r2.id
            AND (rg.external_id = g.external_id OR rg.name = g.name)
     )
    ON CONFLICT (roster_id, external_id) DO NOTHING;

    SELECT count(*) INTO n FROM roster_groups WHERE roster_id = r;
    IF n <> 4 THEN RAISE EXCEPTION 'T21 FAIL: backfill left % groups', n; END IF;
    RAISE NOTICE 'T21 PASS: backfill repairs a roster missing groups';
END $$;

-- T22: backfill is idempotent -- a second run inserts nothing
DO $$
DECLARE before_n int; after_n int;
BEGIN
    SELECT count(*) INTO before_n FROM roster_groups;
    INSERT INTO public.roster_groups (roster_id, name, external_id, sort_order)
    SELECT r2.id, g.name, g.external_id, g.sort_order
      FROM public.rosters r2
     CROSS JOIN (VALUES
            ('Convention Centre', 'convention_centre', 0),
            ('Exhibition Centre', 'exhibition_centre', 1),
            ('Theatre',           'theatre',           2),
            ('The Cutaway',       'the_cutaway',       3)
         ) AS g(name, external_id, sort_order)
     WHERE NOT EXISTS (
         SELECT 1 FROM public.roster_groups rg
          WHERE rg.roster_id = r2.id
            AND (rg.external_id = g.external_id OR rg.name = g.name)
     )
    ON CONFLICT (roster_id, external_id) DO NOTHING;
    SELECT count(*) INTO after_n FROM roster_groups;
    IF after_n <> before_n THEN RAISE EXCEPTION 'T22 FAIL: replay inserted % rows', after_n - before_n; END IF;
    RAISE NOTICE 'T22 PASS: backfill is idempotent on replay';
END $$;

RESET ROLE;
\echo '================ SUBGROUP RANGE TESTS PASSED ================'

\echo '================ sm_ensure_rosters_for_range ================'

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- T23: cold future range, single sub-dept -> days created, all with 4 groups
DO $$
DECLARE res jsonb; n int;
        d1 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 200;
        d2 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 204;
BEGIN
    res := public.sm_ensure_rosters_for_range(
        'aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
        ARRAY['cccccccc-0000-0000-0000-000000000001']::uuid[], d1, d2);
    IF (res->>'days_created')::int <> 5 THEN RAISE EXCEPTION 'T23 FAIL: %', res; END IF;
    IF (res->>'days_skipped')::int <> 0 THEN RAISE EXCEPTION 'T23 FAIL: unexpected skips %', res; END IF;

    SELECT count(*) INTO n FROM rosters r
     WHERE r.start_date BETWEEN d1 AND d2
       AND (SELECT count(*) FROM roster_groups g WHERE g.roster_id = r.id) = 4;
    IF n <> 5 THEN RAISE EXCEPTION 'T23 FAIL: only % of 5 rosters have 4 groups', n; END IF;
    RAISE NOTICE 'T23 PASS: 5 empty days created, each with all four groups';
END $$;

-- T24: idempotent -- second call creates nothing, reports them as existing
DO $$
DECLARE res jsonb;
        d1 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 200;
        d2 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 204;
BEGIN
    res := public.sm_ensure_rosters_for_range(
        'aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
        ARRAY['cccccccc-0000-0000-0000-000000000001']::uuid[], d1, d2);
    IF (res->>'days_created')::int <> 0 THEN RAISE EXCEPTION 'T24 FAIL: re-created %', res; END IF;
    IF (res->>'days_existing')::int <> 5 THEN RAISE EXCEPTION 'T24 FAIL: existing count wrong %', res; END IF;
    RAISE NOTICE 'T24 PASS: idempotent (0 created, 5 already existing)';
END $$;

-- T25: a range that STARTS in the past skips those days and still does the rest
DO $$
DECLARE res jsonb; n int;
        d1 date := (now() AT TIME ZONE 'Australia/Sydney')::date - 3;
        d2 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 210;
        yesterday date := (now() AT TIME ZONE 'Australia/Sydney')::date - 1;
        before_past int;
BEGIN
    SELECT count(*) INTO before_past FROM rosters WHERE start_date BETWEEN d1 AND yesterday;
    res := public.sm_ensure_rosters_for_range(
        'aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
        ARRAY['cccccccc-0000-0000-0000-000000000001']::uuid[], d1, d2);

    IF (res->>'days_skipped')::int <> 3 THEN RAISE EXCEPTION 'T25 FAIL: expected 3 skipped, got %', res; END IF;
    SELECT count(*) INTO n FROM rosters WHERE start_date BETWEEN d1 AND yesterday;
    IF n <> before_past THEN RAISE EXCEPTION 'T25 FAIL: created % past rosters', n - before_past; END IF;
    PERFORM 1 FROM rosters WHERE start_date = d2;
    IF NOT FOUND THEN RAISE EXCEPTION 'T25 FAIL: future end of range not created'; END IF;
    RAISE NOTICE 'T25 PASS: 3 past days skipped, rest of range still created';
END $$;

-- T26: multiple sub-departments each get their own day container
DO $$
DECLARE res jsonb; n int; sub2 uuid;
        d date := (now() AT TIME ZONE 'Australia/Sydney')::date + 220;
BEGIN
    RESET ROLE;
    INSERT INTO sub_departments (department_id, name)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'Cleaning') RETURNING id INTO sub2;
    SET ROLE authenticated;

    res := public.sm_ensure_rosters_for_range(
        'aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
        ARRAY['cccccccc-0000-0000-0000-000000000001', sub2]::uuid[], d, d);
    IF (res->>'days_created')::int <> 2 THEN RAISE EXCEPTION 'T26 FAIL: %', res; END IF;

    SELECT count(DISTINCT sub_department_id) INTO n FROM rosters WHERE start_date = d;
    IF n <> 2 THEN RAISE EXCEPTION 'T26 FAIL: % distinct sub-depts, expected 2', n; END IF;
    RAISE NOTICE 'T26 PASS: one roster per sub-department';
END $$;

-- T27: unauthorized caller is refused (guard lives in sm_resolve_roster)
DO $$
DECLARE res jsonb; d date := (now() AT TIME ZONE 'Australia/Sydney')::date + 230;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
    BEGIN
        res := public.sm_ensure_rosters_for_range(
            'aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
            ARRAY['cccccccc-0000-0000-0000-000000000001']::uuid[], d, d);
        RAISE EXCEPTION 'T27 FAIL: unauthorized caller created rosters';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'T27 PASS: unauthorized caller denied (42501)';
    END;
    PERFORM set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
END $$;

-- T28: inverted range is rejected
DO $$
DECLARE res jsonb; d date := (now() AT TIME ZONE 'Australia/Sydney')::date + 240;
BEGIN
    BEGIN
        res := public.sm_ensure_rosters_for_range(
            'aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
            ARRAY['cccccccc-0000-0000-0000-000000000001']::uuid[], d, d - 5);
        RAISE EXCEPTION 'T28 FAIL: inverted range accepted';
    EXCEPTION WHEN sqlstate '22007' THEN
        RAISE NOTICE 'T28 PASS: inverted range rejected (22007)';
    END;
END $$;

RESET ROLE;
\echo '================ ENSURE-RANGE TESTS PASSED ================'
