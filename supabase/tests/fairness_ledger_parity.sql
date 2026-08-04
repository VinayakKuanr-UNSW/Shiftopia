-- ============================================================================
-- Parity harness: recompute_fairness_ledger (SQL)  ==  fairness-ledger.ts (TS)
-- ============================================================================
--
-- Audit F-04 moved the authoritative ledger rebuild into SQL so it could be
-- scheduled. The TS domain module still owns the read-only what-if preview
-- (`projectFairnessImpact`), so BOTH implementations classify shifts — and if
-- they drift, a manager's bid preview stops matching the ledger the solver
-- actually uses. This fixture pins them together.
--
-- The SAME fixture and the SAME expected numbers are asserted from TS in
--   src/modules/rosters/services/__tests__/fairnessLedger.sqlParity.test.ts
-- Change one, change the other.
--
-- HOW TO RUN (throwaway container — never point this at a real database; it
-- writes to public.shifts / public.fairness_ledger):
--
--   docker run -d --name fairparity-pg -e POSTGRES_PASSWORD=pw \
--     -p 55433:5432 postgres:15-alpine
--   # load a schema stub (organizations/profiles/shifts/shift_bids/
--   # fairness_ledger + the shift_lifecycle, access_level, system_role enums
--   # and an auth.uid() stub), then the three 20260804* migrations, then:
--   docker exec -i fairparity-pg psql -U postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/fairness_ledger_parity.sql
--   docker rm -f fairparity-pg
-- ============================================================================

BEGIN;

\set ORG '11111111-1111-1111-1111-111111111111'
\set EA  'aaaaaaaa-0000-0000-0000-000000000001'
\set EB  'bbbbbbbb-0000-0000-0000-000000000002'

DELETE FROM public.fairness_ledger WHERE organization_id = :'ORG';
DELETE FROM public.shift_bids;
DELETE FROM public.shifts WHERE organization_id = :'ORG';
INSERT INTO public.organizations (id, name) VALUES (:'ORG', 'Parity Org')
    ON CONFLICT (id) DO NOTHING;

-- Employee A: one Saturday (30m break), one cross-midnight night shift, one
-- public holiday (King's Birthday NSW). Employee B: one plain weekday (60m
-- break) plus one CANCELLED shift that must be ignored, and one lost bid.
INSERT INTO public.shifts
    (organization_id, shift_date, start_time, end_time, unpaid_break_minutes,
     assigned_employee_id, lifecycle_status)
VALUES
    (:'ORG','2026-05-16','09:00','17:00', 30, :'EA','Published'),
    (:'ORG','2026-06-10','22:00','06:00',  0, :'EA','Published'),
    (:'ORG','2026-06-08','09:00','17:00',  0, :'EA','Published'),
    (:'ORG','2026-06-11','09:00','17:00', 60, :'EB','Published'),
    (:'ORG','2026-06-12','09:00','17:00',  0, :'EB','Cancelled');

-- Bid outcomes for the denial-RATE metric (decision Q5): a rate needs its
-- denominator, so both winning and losing bids are inserted.
--   A won 4 of 4 · B lost their only bid  → org rate = 1/5 = 0.2
--   A → (0 + 5*0.2) / (4 + 5) = 0.1111
--   B → (1 + 5*0.2) / (1 + 5) = 0.3333
-- Counts chosen so every intermediate is a clean repeating decimal; an average
-- landing exactly on a 5 in the 5th decimal would make this a test of Postgres
-- vs JavaScript rounding mode rather than of parity.
INSERT INTO public.shift_bids (shift_id, employee_id, status)
SELECT s.id, :'EA', 'accepted'
  FROM public.shifts s
 WHERE s.organization_id = :'ORG'
   AND s.shift_date IN ('2026-05-16','2026-06-10','2026-06-08','2026-06-11');

INSERT INTO public.shift_bids (shift_id, employee_id, status)
SELECT id, :'EB', 'rejected'
  FROM public.shifts
 WHERE organization_id = :'ORG' AND shift_date = '2026-05-16';

SELECT public.recompute_fairness_ledger(:'ORG', '2026-08-04');

-- ── Assertions ──────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_org uuid := '11111111-1111-1111-1111-111111111111';
    v_a   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
    v_b   uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
    v_bad text;
BEGIN
    SELECT string_agg(
               format('%s/%s: got value=%s avg=%s debt=%s, expected value=%s avg=%s debt=%s',
                      e.emp_label, e.metric, fl.rolling_value, fl.team_average, fl.debt,
                      e.value, e.avg, e.debt),
               E'\n')
      INTO v_bad
      FROM (VALUES
            ('A', v_a, 'saturday_shifts',       1.0000,  0.5000,  0.5000),
            ('A', v_a, 'sunday_shifts',         0.0000,  0.0000,  0.0000),
            ('A', v_a, 'night_shifts',          1.0000,  0.5000,  0.5000),
            ('A', v_a, 'public_holiday_shifts', 1.0000,  0.5000,  0.5000),
            ('A', v_a, 'total_hours',          23.5000, 15.2500,  8.2500),
            ('A', v_a, 'overtime_minutes',      0.0000,  0.0000,  0.0000),
            ('A', v_a, 'denial_rate',           0.1111,  0.2222, -0.1111),
            ('B', v_b, 'saturday_shifts',       0.0000,  0.5000, -0.5000),
            ('B', v_b, 'sunday_shifts',         0.0000,  0.0000,  0.0000),
            ('B', v_b, 'night_shifts',          0.0000,  0.5000, -0.5000),
            ('B', v_b, 'public_holiday_shifts', 0.0000,  0.5000, -0.5000),
            ('B', v_b, 'total_hours',           7.0000, 15.2500, -8.2500),
            ('B', v_b, 'overtime_minutes',      0.0000,  0.0000,  0.0000),
            ('B', v_b, 'denial_rate',           0.3333,  0.2222,  0.1111)
           ) AS e(emp_label, emp_id, metric, value, avg, debt)
      JOIN public.fairness_ledger fl
        ON fl.organization_id = v_org
       AND fl.employee_id     = e.emp_id
       AND fl.metric          = e.metric
       AND fl.window_end      = '2026-08-04'
     WHERE fl.rolling_value <> e.value
        OR fl.team_average  <> e.avg
        OR fl.debt          <> e.debt;

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION E'SQL/TS ledger parity broken:\n%', v_bad;
    END IF;

    -- Cancelled shift must be excluded: B's 7.00h proves it (it would be 15.00
    -- if the cancelled 8h shift counted).
    -- Exactly 14 rows: 2 employees x 7 metrics, no duplicates.
    IF (SELECT count(*) FROM public.fairness_ledger
         WHERE organization_id = v_org AND window_end = '2026-08-04') <> 14 THEN
        RAISE EXCEPTION 'expected 14 ledger rows (2 employees x 7 metrics)';
    END IF;

    -- Q9: every row must name the run that produced it, or a disputed roster
    -- decision cannot be traced back to the numbers that drove it.
    IF EXISTS (SELECT 1 FROM public.fairness_ledger
                WHERE organization_id = v_org AND window_end = '2026-08-04'
                  AND updated_by_run IS NULL) THEN
        RAISE EXCEPTION 'ledger rows written without an updated_by_run stamp (Q9)';
    END IF;

    IF (SELECT count(DISTINCT updated_by_run) FROM public.fairness_ledger
         WHERE organization_id = v_org AND window_end = '2026-08-04') <> 1 THEN
        RAISE EXCEPTION 'one recompute must produce exactly one run id (Q9)';
    END IF;

    RAISE NOTICE 'fairness ledger SQL/TS parity: OK (14 rows, single run id)';
END $$;

ROLLBACK;
