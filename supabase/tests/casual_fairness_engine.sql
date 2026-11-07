-- ============================================================================
-- Casual opportunity-adjusted fairness engine
-- ============================================================================
--
-- For each approved, billed casual shift s with pool E_s (casuals eligible AND
-- available when the shift was snapshotted, plus whoever actually worked it):
--     Expected_i = Σ_{s : i ∈ E_s} H_s / |E_s|        Debt_i = Actual_i − Expected_i
-- per metric (total / Saturday / Sunday / public holiday / night / overtime
-- hours). Overtime uses its own pool: members whose availability ran past the
-- rostered end by at least the overtime billed.
--
-- Self-contained: fixture rows go in with triggers and FK checks off
-- (session_replication_role = replica) and everything rolls back. Run by
-- tests/integration/flows/casual-fairness.int.test.ts against the CI stack;
-- safe to run against the development database for the same reason.
--
-- The category-minutes cases (section 1) are mirrored in
-- src/modules/rosters/domain/__tests__/fairness-ledger.test.ts. Change one,
-- change the other.
-- ============================================================================

BEGIN;
SET LOCAL session_replication_role = replica;
SET LOCAL client_min_messages = notice;

-- ── 1. Category minutes ─────────────────────────────────────────────────────
DO $$
DECLARE
    r record;
    v_bad text := '';
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            -- label,                         date,         start,   end,     net, total, sat,  sun,  ph,   night
            ('Sunday day',                    '2026-12-06', '09:00', '17:00', 480, 480,   0,    480,  0,    0),
            ('Sat→Sun overnight, 30m break',  '2026-12-05', '20:00', '04:00', 450, 450,   225,  225,  0,    337.5),
            ('Christmas (Fri)',               '2026-12-25', '10:00', '14:00', 240, 240,   0,    0,    240,  0),
            ('Boxing Day is a Saturday',      '2026-12-26', '10:00', '14:00', 240, 240,   240,  0,    240,  0),
            ('evening reaches 22:00',         '2026-12-07', '20:00', '23:00', 180, 180,   0,    0,    0,    60),
            ('early morning before 06:00',    '2026-12-07', '05:00', '07:00', 120, 120,   0,    0,    0,    60),
            ('Christmas Eve night into PH',   '2026-12-24', '22:00', '06:00', 480, 480,   0,    0,    360,  480)
        ) AS t(label, d, t0, t1, net, total, sat, sun, ph, night)
    LOOP
        PERFORM 1
           FROM public.fairness_category_minutes(r.d::date, r.t0::time, r.t1::time, r.net, 'AU-NSW') c
          WHERE c.total = r.total AND c.saturday = r.sat AND c.sunday = r.sun
            AND c.public_holiday = r.ph AND c.night = r.night;
        IF NOT FOUND THEN
            v_bad := v_bad || format(E'\n  %s: got %s', r.label,
                (SELECT row_to_json(c)::text
                   FROM public.fairness_category_minutes(r.d::date, r.t0::time, r.t1::time, r.net, 'AU-NSW') c));
        END IF;
    END LOOP;
    IF v_bad <> '' THEN
        RAISE EXCEPTION 'category minutes wrong:%', v_bad;
    END IF;
    RAISE NOTICE 'category minutes: OK';
END $$;

-- ── 2. Fixtures ─────────────────────────────────────────────────────────────
-- One organization (the seeded one), one department / sub-department / role.
--   A, B, C  casual, eligible (C holds two matching contracts: must appear once)
--   D        Full-Time in the same job   → never in a casual pool
--   E        casual, different role      → not eligible
--   F        casual, contract starts 2027 → not eligible yet
CREATE TEMP TABLE fx (k text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO fx VALUES
    ('org',  '00000000-0000-0000-0000-000000000001'),
    ('dept', 'fa0d0000-0000-4000-8000-000000000001'),
    ('sub',  'fa050000-0000-4000-8000-000000000001'),
    ('sub2', 'fa050000-0000-4000-8000-000000000002'),
    ('role', 'fa0e0000-0000-4000-8000-000000000001'),
    ('role2','fa0e0000-0000-4000-8000-000000000002'),
    ('A',    'fa0a0000-0000-4000-8000-00000000000a'),
    ('B',    'fa0a0000-0000-4000-8000-00000000000b'),
    ('C',    'fa0a0000-0000-4000-8000-00000000000c'),
    ('D',    'fa0a0000-0000-4000-8000-00000000000d'),
    ('E',    'fa0a0000-0000-4000-8000-00000000000e'),
    ('F',    'fa0a0000-0000-4000-8000-00000000000f');

CREATE FUNCTION pg_temp.fx(p_k text) RETURNS uuid
    LANGUAGE sql STABLE AS $$ SELECT id FROM fx WHERE k = p_k $$;

INSERT INTO hr.user_contracts
    (user_id, role_id, organization_id, department_id, sub_department_id,
     status, employment_status, pay_basis, remuneration_level, contracted_weekly_hours,
     access_level, start_date, end_date)
VALUES
    (pg_temp.fx('A'), pg_temp.fx('role'),  pg_temp.fx('org'), pg_temp.fx('dept'), pg_temp.fx('sub'), 'Active',   'Casual',    'eba_level', 2, 0,  'alpha', '2026-01-01', NULL),
    (pg_temp.fx('B'), pg_temp.fx('role'),  pg_temp.fx('org'), pg_temp.fx('dept'), pg_temp.fx('sub'), 'Active',   'Casual',    'eba_level', 2, 0,  'alpha', '2026-01-01', NULL),
    (pg_temp.fx('C'), pg_temp.fx('role'),  pg_temp.fx('org'), pg_temp.fx('dept'), pg_temp.fx('sub'), 'Active',   'Casual',    'eba_level', 2, 0,  'alpha', '2026-01-01', NULL),
    (pg_temp.fx('C'), pg_temp.fx('role'),  pg_temp.fx('org'), pg_temp.fx('dept'), NULL,              'Active',   'Casual',    'eba_level', 2, 0,  'alpha', '2026-01-01', NULL),
    (pg_temp.fx('D'), pg_temp.fx('role'),  pg_temp.fx('org'), pg_temp.fx('dept'), pg_temp.fx('sub'), 'Active',   'Full-Time', 'eba_level', 2, 38, 'alpha', '2026-01-01', NULL),
    (pg_temp.fx('E'), pg_temp.fx('role2'), pg_temp.fx('org'), pg_temp.fx('dept'), pg_temp.fx('sub'), 'Active',   'Casual',    'eba_level', 2, 0,  'alpha', '2026-01-01', NULL),
    (pg_temp.fx('F'), pg_temp.fx('role'),  pg_temp.fx('org'), pg_temp.fx('dept'), pg_temp.fx('sub'), 'Upcoming', 'Casual',    'eba_level', 2, 0,  'alpha', '2027-01-01', NULL);

-- S1–S4 are the four Sundays of the worked example; S5 is a weekday with
-- overtime; S6 targets Full-Time; S7 is cancelled; S8 falls outside the
-- capture range (so it has no snapshot); S9 is billed but never approved.
-- Full shifts are 09:00–17:30 with a 13:00–13:30 unpaid meal break (8 net
-- hours; the EBA shape rules require the timed break and a paid rest pause).
INSERT INTO public.shifts
    (id, roster_id, roster_subgroup_id, organization_id, department_id, sub_department_id, role_id,
     shift_date, start_time, end_time, unpaid_break_minutes, break_start, break_end, paid_break_minutes,
     target_employment_type, lifecycle_status, assigned_employee_id, assignment_status)
SELECT s.id::uuid, 'fa0f0000-0000-4000-8000-000000000001', 'fa0f1000-0000-4000-8000-000000000001',
       pg_temp.fx('org'), pg_temp.fx('dept'), pg_temp.fx('sub'), pg_temp.fx('role'),
       s.d::date, s.t0::time, s.t1::time,
       CASE WHEN s.full_day THEN 30 ELSE 0 END,
       CASE WHEN s.full_day THEN '13:00'::time END,
       CASE WHEN s.full_day THEN '13:30'::time END,
       CASE WHEN s.full_day THEN 30 ELSE 15 END,
       s.target, s.lc::public.shift_lifecycle, pg_temp.fx(s.who), 'assigned'
  FROM (VALUES
    ('fa5f0000-0000-4000-8000-000000000001', '2026-12-06', '09:00', '17:30', true,  'Casual', 'Completed', 'A'),
    ('fa5f0000-0000-4000-8000-000000000002', '2026-12-13', '09:00', '17:30', true,  'Casual', 'Completed', 'B'),
    ('fa5f0000-0000-4000-8000-000000000003', '2026-12-20', '09:00', '17:30', true,  'Casual', 'Completed', 'C'),
    ('fa5f0000-0000-4000-8000-000000000004', '2026-12-27', '09:00', '17:30', true,  'Casual', 'Completed', 'A'),
    ('fa5f0000-0000-4000-8000-000000000005', '2026-12-07', '09:00', '17:30', true,  'Casual', 'Completed', 'B'),
    ('fa5f0000-0000-4000-8000-000000000006', '2026-12-08', '09:00', '17:30', true,  'FT',     'Completed', 'D'),
    ('fa5f0000-0000-4000-8000-000000000007', '2026-12-09', '09:00', '17:30', true,  'Casual', 'Cancelled', 'A'),
    ('fa5f0000-0000-4000-8000-000000000008', '2026-12-29', '09:00', '13:00', false, 'Casual', 'Completed', 'A'),
    ('fa5f0000-0000-4000-8000-000000000009', '2026-12-10', '09:00', '17:30', true,  'Casual', 'Completed', 'C')
  ) AS s(id, d, t0, t1, full_day, target, lc, who);

-- Availability. A: every Sunday 08:00–18:30 (60 min past the end), Monday
-- 08:00–20:30 with NO sub-department (applies to every job; 180 min past).
-- B: Sundays 1–2 exactly 09:00–17:30, Sunday 3 only for ANOTHER
-- sub-department, Monday exactly. C: Sunday 2 from 10:00 (does not cover the
-- start), Sunday 3 07:00–19:30 (120 min past), Sunday 4 the same but on
-- approved leave.
INSERT INTO public.availability_slots (profile_id, slot_date, start_time, end_time, sub_department_id)
SELECT pg_temp.fx(a.who), a.d::date, a.t0::time, a.t1::time, pg_temp.fx(a.scope)
  FROM (VALUES
    ('A', '2026-12-06', '08:00', '18:30', 'sub'),
    ('A', '2026-12-13', '08:00', '18:30', 'sub'),
    ('A', '2026-12-20', '08:00', '18:30', 'sub'),
    ('A', '2026-12-27', '08:00', '18:30', 'sub'),
    ('A', '2026-12-07', '08:00', '20:30', NULL),
    ('B', '2026-12-06', '09:00', '17:30', 'sub'),
    ('B', '2026-12-13', '09:00', '17:30', 'sub'),
    ('B', '2026-12-20', '08:00', '18:30', 'sub2'),
    ('B', '2026-12-07', '09:00', '17:30', 'sub'),
    ('C', '2026-12-13', '10:00', '17:30', 'sub'),
    ('C', '2026-12-20', '07:00', '19:30', 'sub'),
    ('C', '2026-12-27', '07:00', '19:30', 'sub')
  ) AS a(who, d, t0, t1, scope);

-- Approved leave removes C from Sunday 4. A PENDING request is not a decision
-- and must not remove A from Sunday 1.
INSERT INTO public.leave_requests (employee_id, leave_type, start_date, end_date, status)
VALUES (pg_temp.fx('C'), 'annual', '2026-12-27 00:00+00', '2026-12-27 00:00+00', 'approved'),
       (pg_temp.fx('A'), 'annual', '2026-12-06 00:00+00', '2026-12-06 00:00+00', 'pending');

-- ── 3. Capture: who could have worked each shift ────────────────────────────
DO $$
DECLARE
    v_n   integer;
    v_bad text;
BEGIN
    PERFORM public.capture_fairness_opportunities(pg_temp.fx('org'), '2026-12-06', '2026-12-27');

    SELECT string_agg(format('%s/%s: got available=%s ext=%s, expected available=%s ext=%s',
                             e.shift_no, e.who, o.is_available, o.extension_minutes, e.avail, e.ext), E'\n  ')
      INTO v_bad
      FROM (VALUES
            (1, 'A', true,  60), (1, 'B', true,  0), (1, 'C', false, 0),
            (2, 'A', true,  60), (2, 'B', true,  0), (2, 'C', false, 0),
            (3, 'A', true,  60), (3, 'B', false, 0), (3, 'C', true, 120),
            (4, 'A', true,  60), (4, 'B', false, 0), (4, 'C', false, 0),
            (5, 'A', true, 180), (5, 'B', true,  0), (5, 'C', false, 0),
            (9, 'A', false,  0), (9, 'B', false, 0), (9, 'C', false, 0)
           ) AS e(shift_no, who, avail, ext)
      LEFT JOIN public.fairness_opportunities o
             ON o.shift_id = ('fa5f0000-0000-4000-8000-00000000000' || e.shift_no)::uuid
            AND o.employee_id = pg_temp.fx(e.who)
     WHERE o.shift_id IS NULL OR o.is_available <> e.avail OR o.extension_minutes <> e.ext;
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION E'capture wrong:\n  %', v_bad;
    END IF;

    SELECT count(*) INTO v_n
      FROM public.fairness_opportunities
     WHERE shift_id::text LIKE 'fa5f0000-%';
    IF v_n <> 18 THEN
        RAISE EXCEPTION 'capture: expected 18 fixture rows (6 shifts x A,B,C), got % — '
                        'D (Full-Time), E (other role), F (not started), the FT-target, '
                        'cancelled and out-of-range shifts must have none', v_n;
    END IF;

    -- Inside the look-ahead a snapshot is refreshed: A declares for S9 late
    -- and becomes part of its pool. Outside the captured range nothing moves:
    -- A withdrawing S1's availability does not rewrite S1 (the nightly job
    -- only ever captures from today, so a past shift is frozen).
    INSERT INTO public.availability_slots (profile_id, slot_date, start_time, end_time, sub_department_id)
    VALUES (pg_temp.fx('A'), '2026-12-10', '08:00', '18:00', pg_temp.fx('sub'));
    DELETE FROM public.availability_slots
     WHERE profile_id = pg_temp.fx('A') AND slot_date = '2026-12-06';
    PERFORM public.capture_fairness_opportunities(pg_temp.fx('org'), '2026-12-10', '2026-12-10');
    IF NOT EXISTS (SELECT 1 FROM public.fairness_opportunities
                    WHERE shift_id = 'fa5f0000-0000-4000-8000-000000000009'
                      AND employee_id = pg_temp.fx('A') AND is_available AND extension_minutes = 30) THEN
        RAISE EXCEPTION 'a re-capture inside the look-ahead must pick up late availability';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.fairness_opportunities
                    WHERE shift_id = 'fa5f0000-0000-4000-8000-000000000001'
                      AND employee_id = pg_temp.fx('A') AND is_available) THEN
        RAISE EXCEPTION 'a capture must not touch shifts outside its range';
    END IF;
    IF (SELECT count(*) FROM public.fairness_opportunities WHERE shift_id::text LIKE 'fa5f0000-%') <> 18 THEN
        RAISE EXCEPTION 'a refresh must replace a shift''s rows, not add to them';
    END IF;

    RAISE NOTICE 'capture: OK';
END $$;

-- ── 4. Approved billed work ─────────────────────────────────────────────────
INSERT INTO public.billables
    (shift_id, employee_id, organization_id, billable_start, billable_end,
     unpaid_break_minutes, paid_break_minutes, net_length_minutes, status)
SELECT b.shift_id::uuid, pg_temp.fx(b.who), pg_temp.fx('org'), b.t0::time, b.t1::time,
       b.unpaid, 0, b.net, b.status::public.timesheet_status
  FROM (VALUES
    ('fa5f0000-0000-4000-8000-000000000001', 'A', '09:00', '17:30', 30, 480, 'approved'),
    ('fa5f0000-0000-4000-8000-000000000002', 'B', '09:00', '17:30', 30, 480, 'approved'),
    ('fa5f0000-0000-4000-8000-000000000003', 'C', '09:00', '17:30', 30, 480, 'approved'),
    ('fa5f0000-0000-4000-8000-000000000004', 'A', '09:00', '17:30', 30, 480, 'approved'),
    -- B stays two hours past the 17:30 end and skips the meal break: 120 min
    -- of overtime (time past the end), NOT 150 (billed net − rostered net).
    ('fa5f0000-0000-4000-8000-000000000005', 'B', '09:00', '19:30',  0, 630, 'approved'),
    ('fa5f0000-0000-4000-8000-000000000006', 'D', '09:00', '17:30', 30, 480, 'approved'),
    ('fa5f0000-0000-4000-8000-000000000007', 'A', '09:00', '17:30', 30, 480, 'approved'),
    ('fa5f0000-0000-4000-8000-000000000008', 'A', '09:00', '13:00',  0, 240, 'approved'),
    ('fa5f0000-0000-4000-8000-000000000009', 'C', '09:00', '17:30', 30, 480, 'submitted')
  ) AS b(shift_id, who, t0, t1, unpaid, net, status);

-- ── 5. Recompute ────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_bad text;
    v_n   integer;
BEGIN
    PERFORM public.recompute_casual_fairness(pg_temp.fx('org'), '2026-12-31');

    -- Sunday hours are the design's worked example: A 20/16/−4, B 8/8/0, C 4/8/+4.
    -- Total adds S5 (10.5h billed to B, pool A+B) and S8 (no snapshot ⇒ pool
    -- is just its worker ⇒ no debt either way, and no opportunity counted).
    -- Overtime: S5's 2h past the end is shared by B (who worked it) and A
    -- (available 3h past the end); C never had an overtime opportunity, so C
    -- has no overtime row at all.
    SELECT string_agg(format('%s %s: got %s/%s/%s n=%s c=%s, expected %s/%s/%s n=%s c=%s',
                             e.who, e.metric, l.expected_hours, l.actual_hours, l.debt_hours,
                             l.opportunity_count, l.confidence,
                             e.expected, e.actual, e.debt, e.n, e.conf), E'\n  ')
      INTO v_bad
      FROM (VALUES
            ('A', 'total_hours',    29.25, 20,   -9.25, 5, 0.5),
            ('A', 'sunday_hours',   20,    16,   -4,    4, 0.4),
            ('A', 'overtime_hours',  1,     0,   -1,    1, 0.1),
            ('B', 'total_hours',    13.25, 18.5,  5.25, 3, 0.3),
            ('B', 'sunday_hours',    8,   8,   0, 2, 0.2),
            ('B', 'overtime_hours',  1,   2,   1, 1, 0.1),
            ('C', 'total_hours',     4,   8,   4, 1, 0.1),
            ('C', 'sunday_hours',    4,   8,   4, 1, 0.1)
           ) AS e(who, metric, expected, actual, debt, n, conf)
      LEFT JOIN public.casual_fairness_ledger l
             ON l.organization_id = pg_temp.fx('org')
            AND l.employee_id = pg_temp.fx(e.who) AND l.metric = e.metric
     WHERE l.employee_id IS NULL
        OR l.expected_hours <> e.expected OR l.actual_hours <> e.actual
        OR l.debt_hours <> e.debt OR l.opportunity_count <> e.n OR l.confidence <> e.conf
        OR l.window_start <> '2026-11-07' OR l.window_end <> '2026-12-31';
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION E'recompute wrong:\n  %', v_bad;
    END IF;

    SELECT count(*) INTO v_n FROM public.casual_fairness_ledger
     WHERE employee_id IN (SELECT id FROM fx WHERE k IN ('A','B','C','D','E','F'));
    IF v_n <> 8 THEN
        RAISE EXCEPTION 'expected exactly 8 fixture ledger rows (no zero-opportunity '
                        'metrics, nothing for D/E/F), got %', v_n;
    END IF;

    -- Fair shares redistribute the work, never create or destroy it.
    SELECT string_agg(metric || ' sums to ' || s, ', ') INTO v_bad
      FROM (SELECT metric, sum(debt_hours) AS s FROM public.casual_fairness_ledger
             WHERE organization_id = pg_temp.fx('org') GROUP BY metric) t
     WHERE abs(s) > 0.01;
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'debts must sum to zero per metric: %', v_bad;
    END IF;

    IF (SELECT count(DISTINCT run_id) FROM public.casual_fairness_ledger
         WHERE organization_id = pg_temp.fx('org')) <> 1 THEN
        RAISE EXCEPTION 'one recompute must stamp exactly one run id';
    END IF;

    -- A narrower window replaces the ledger: C had no opportunity in it ⇒ no rows.
    PERFORM public.recompute_casual_fairness(pg_temp.fx('org'), '2026-12-13');
    IF EXISTS (SELECT 1 FROM public.casual_fairness_ledger
                WHERE organization_id = pg_temp.fx('org') AND window_end <> '2026-12-13') THEN
        RAISE EXCEPTION 'recompute must replace the previous ledger, not add to it';
    END IF;
    IF EXISTS (SELECT 1 FROM public.casual_fairness_ledger WHERE employee_id = pg_temp.fx('C')) THEN
        RAISE EXCEPTION 'C had no opportunity in the narrower window and must have no debt';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.casual_fairness_ledger
                    WHERE employee_id = pg_temp.fx('A') AND metric = 'total_hours'
                      AND expected_hours = 13.25 AND actual_hours = 8 AND debt_hours = -5.25) THEN
        RAISE EXCEPTION 'A total_hours over the narrower window should be 13.25/8/-5.25';
    END IF;

    RAISE NOTICE 'recompute: OK';
END $$;

-- ── 6. Exposure ─────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF has_table_privilege('anon', 'public.casual_fairness_ledger', 'SELECT')
       OR NOT has_table_privilege('authenticated', 'public.casual_fairness_ledger', 'SELECT')
       OR has_table_privilege('authenticated', 'public.casual_fairness_ledger', 'INSERT,UPDATE,DELETE,TRUNCATE')
       OR has_table_privilege('authenticated', 'public.fairness_opportunities', 'SELECT')
       OR has_table_privilege('anon', 'public.fairness_opportunities', 'SELECT') THEN
        RAISE EXCEPTION 'client table privileges wrong: the ledger is read-only to '
                        'authenticated, opportunities are server-only';
    END IF;
    IF EXISTS (SELECT 1
                 FROM unnest(ARRAY[
                        'public.casual_fairness_cutover()',
                        'public.fairness_category_minutes(date,time,time,numeric,text)',
                        'public.capture_fairness_opportunities(uuid,date,date)',
                        'public.recompute_casual_fairness(uuid,date,integer,integer)',
                        'public.run_casual_fairness_nightly()']) AS f(sig)
                CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r(role)
                WHERE has_function_privilege(r.role, f.sig, 'EXECUTE')) THEN
        RAISE EXCEPTION 'engine functions must not be client-executable';
    END IF;
    IF has_function_privilege('anon', 'public.casual_fairness_visible(uuid,uuid)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.casual_fairness_visible(uuid,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'the ledger visibility check is for signed-in users only';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.casual_fairness_ledger'::regclass)
       OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.fairness_opportunities'::regclass) THEN
        RAISE EXCEPTION 'RLS must be enabled on both engine tables';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'casual_fairness_nightly' AND active) THEN
        RAISE EXCEPTION 'nightly casual fairness job is not scheduled';
    END IF;
    RAISE NOTICE 'exposure: OK';
END $$;

DO $$ BEGIN RAISE NOTICE 'casual fairness engine: OK'; END $$;

ROLLBACK;
