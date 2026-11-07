-- Casual opportunity-adjusted fairness engine.
--
-- Fairness now applies to casual work only. For each approved, billed casual
-- shift s, the pool E_s is every casual who was eligible for it AND available
-- when it was snapshotted, plus whoever actually worked it:
--
--     Expected_i = Σ_{s : i ∈ E_s} H_s / |E_s|        Debt_i = Actual_i − Expected_i
--
-- per metric: total, Saturday, Sunday, public-holiday, night (22:00–06:00) and
-- overtime hours. Overtime has its own pool — members whose declared
-- availability ran past the rostered end by at least the overtime billed.
-- Contracted hours play no part.
--
-- Additive: the old fairness_ledger engine keeps running until a follow-up
-- migration retires it.
--
-- Design: docs/design/fairness/casual-opportunity-fairness.md
-- Test:   supabase/tests/casual_fairness_engine.sql

-- ── Cutover ─────────────────────────────────────────────────────────────────
-- Availability and eligibility were never snapshotted before this date, and
-- reconstructing them from today's settings would rewrite history. The engine
-- therefore starts empty here instead of backfilling.
CREATE OR REPLACE FUNCTION public.casual_fairness_cutover()
RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$ SELECT DATE '2026-11-07' $$;

-- ── Who could have worked each shift ────────────────────────────────────────
CREATE TABLE public.fairness_opportunities (
    shift_id          uuid        NOT NULL REFERENCES public.shifts(id)        ON DELETE CASCADE,
    employee_id       uuid        NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,
    organization_id   uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    shift_date        date        NOT NULL,
    is_available      boolean     NOT NULL,
    extension_minutes integer     NOT NULL DEFAULT 0 CHECK (extension_minutes >= 0),
    captured_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (shift_id, employee_id)
);
CREATE INDEX fairness_opportunities_employee_idx ON public.fairness_opportunities (employee_id);
CREATE INDEX fairness_opportunities_org_date_idx ON public.fairness_opportunities (organization_id, shift_date);

COMMENT ON TABLE public.fairness_opportunities IS
    'One row per (casual shift, eligible casual), written once by capture_fairness_opportunities '
    'and never rewritten: later availability changes must not alter history. Server-only.';
COMMENT ON COLUMN public.fairness_opportunities.extension_minutes IS
    'How far the covering availability slot ran past the rostered end — who could have taken overtime.';

ALTER TABLE public.fairness_opportunities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fairness_opportunities FROM anon, authenticated;

-- ── The ledger: one current generation per organization ─────────────────────
-- Recompute replaces an organization's rows wholesale. History is reproducible
-- by re-running recompute_casual_fairness with an earlier p_as_of, so no
-- per-day copies are kept.
CREATE TABLE public.casual_fairness_ledger (
    organization_id   uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id       uuid          NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,
    metric            text          NOT NULL CHECK (metric IN (
                          'total_hours', 'saturday_hours', 'sunday_hours',
                          'public_holiday_hours', 'night_hours', 'overtime_hours')),
    window_start      date          NOT NULL,
    window_end        date          NOT NULL,
    actual_hours      numeric(12,4) NOT NULL,
    expected_hours    numeric(12,4) NOT NULL,
    debt_hours        numeric(12,4) NOT NULL,
    opportunity_count integer       NOT NULL CHECK (opportunity_count > 0),
    confidence        numeric(4,3)  NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    run_id            uuid          NOT NULL,
    computed_at       timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, employee_id, metric)
);
CREATE INDEX casual_fairness_ledger_employee_idx ON public.casual_fairness_ledger (employee_id);

COMMENT ON TABLE public.casual_fairness_ledger IS
    'Opportunity-adjusted fairness standing of casual employees. debt_hours = actual − expected; '
    'positive = above their fair share. A metric with no opportunity has no row (no debt). '
    'confidence = min(1, opportunity_count / 10).';

ALTER TABLE public.casual_fairness_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.casual_fairness_ledger FROM anon, authenticated;
GRANT SELECT ON public.casual_fairness_ledger TO authenticated;

CREATE POLICY casual_fairness_ledger_scoped_read ON public.casual_fairness_ledger
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM hr.user_contracts uc
         WHERE uc.user_id = casual_fairness_ledger.employee_id
           AND uc.organization_id = casual_fairness_ledger.organization_id
           AND public.user_has_action_in_scope('roster.view', uc.organization_id,
                                               uc.department_id, uc.sub_department_id)));

CREATE POLICY casual_fairness_ledger_self_read ON public.casual_fairness_ledger
    FOR SELECT TO authenticated
    USING (employee_id = (SELECT auth.uid()));

-- ── Minutes of a span by category ───────────────────────────────────────────
-- Wall-clock split of [start, end) on p_shift_date (end <= start ⇒ next day),
-- scaled to p_net_minutes so unpaid breaks are taken proportionally from every
-- category. Night is 22:00–06:00; Saturday, Sunday and public holiday follow
-- the calendar date each minute falls on.
CREATE OR REPLACE FUNCTION public.fairness_category_minutes(
    p_shift_date    date,
    p_start         time,
    p_end           time,
    p_net_minutes   numeric,
    p_jurisdiction  text)
RETURNS TABLE (total numeric, saturday numeric, sunday numeric, public_holiday numeric, night numeric)
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
    WITH span AS (
        SELECT p_shift_date + p_start AS t0,
               p_shift_date + p_end
                 + CASE WHEN p_end <= p_start THEN interval '1 day' ELSE interval '0' END AS t1
    ), days AS (
        SELECT g.d::date AS d,
               GREATEST(0, EXTRACT(EPOCH FROM LEAST(s.t1, g.d + interval '1 day')
                                            - GREATEST(s.t0, g.d)) / 60) AS on_day,
               GREATEST(0, EXTRACT(EPOCH FROM LEAST(s.t1, g.d + interval '30 hours')
                                            - GREATEST(s.t0, g.d + interval '22 hours')) / 60) AS night_from_d,
               EXISTS (SELECT 1 FROM public.public_holidays h
                        WHERE h.holiday_date = g.d::date AND h.jurisdiction = p_jurisdiction) AS is_ph
          FROM span s
         CROSS JOIN generate_series((p_shift_date - 1)::timestamp,
                                    (p_shift_date + 1)::timestamp,
                                    interval '1 day') AS g(d)
    ), scale AS (
        SELECT p_net_minutes / (EXTRACT(EPOCH FROM t1 - t0) / 60) AS k FROM span
    )
    SELECT p_net_minutes,
           k * COALESCE(sum(on_day) FILTER (WHERE EXTRACT(ISODOW FROM d) = 6), 0),
           k * COALESCE(sum(on_day) FILTER (WHERE EXTRACT(ISODOW FROM d) = 7), 0),
           k * COALESCE(sum(on_day) FILTER (WHERE is_ph), 0),
           k * COALESCE(sum(night_from_d), 0)
      FROM days, scale
     GROUP BY k;
$$;

-- ── Snapshot the pools ──────────────────────────────────────────────────────
-- Eligible = an unexpired Casual contract covering the shift date in the same
-- organization, department, sub-department and role (the solver's and
-- eligibility.service's rule; a NULL sub-department on either side matches).
-- Available = an in-scope availability slot on the shift date that fully
-- contains the shift (the solver's HC-5d containment rule) and no approved
-- leave that day. Shifts that already have a snapshot are skipped: the first
-- capture is the record.
CREATE OR REPLACE FUNCTION public.capture_fairness_opportunities(
    p_org_id uuid,
    p_from   date,
    p_to     date)
RETURNS integer
LANGUAGE sql VOLATILE
SET search_path = pg_catalog, public
AS $$
    WITH eligible AS (
        SELECT DISTINCT
               s.id AS shift_id, s.organization_id, s.shift_date, s.sub_department_id,
               uc.user_id AS employee_id,
               EXTRACT(EPOCH FROM s.start_time) / 60 AS s0,
               EXTRACT(EPOCH FROM s.end_time) / 60
                 + CASE WHEN s.end_time <= s.start_time THEN 1440 ELSE 0 END AS s1
          FROM public.shifts s
          JOIN hr.user_contracts uc
            ON uc.organization_id = s.organization_id
           AND uc.department_id = s.department_id
           AND (s.sub_department_id IS NULL OR uc.sub_department_id IS NULL
                OR uc.sub_department_id = s.sub_department_id)
           AND (s.role_id IS NULL OR uc.role_id = s.role_id)
           AND uc.employment_status = 'Casual'
           AND uc.status <> 'Expired'
           AND uc.start_date <= s.shift_date
           AND (uc.end_date IS NULL OR uc.end_date >= s.shift_date)
         WHERE s.organization_id = p_org_id
           AND s.target_employment_type = 'Casual'
           AND s.lifecycle_status <> 'Cancelled'
           AND s.shift_date BETWEEN GREATEST(p_from, public.casual_fairness_cutover()) AND p_to
           AND NOT EXISTS (SELECT 1 FROM public.fairness_opportunities o WHERE o.shift_id = s.id)
    ), assessed AS (
        SELECT e.*,
               (SELECT max(w.a1 - e.s1)
                  FROM (SELECT EXTRACT(EPOCH FROM sl.start_time) / 60 AS a0,
                               EXTRACT(EPOCH FROM sl.end_time) / 60
                                 + CASE WHEN sl.end_time <= sl.start_time THEN 1440 ELSE 0 END AS a1
                          FROM public.availability_slots sl
                         WHERE sl.profile_id = e.employee_id
                           AND sl.slot_date = e.shift_date
                           AND (sl.sub_department_id IS NULL OR e.sub_department_id IS NULL
                                OR sl.sub_department_id = e.sub_department_id)) w
                 WHERE w.a0 <= e.s0 AND w.a1 >= e.s1) AS slack,
               EXISTS (SELECT 1 FROM public.leave_requests lr
                        WHERE lr.employee_id = e.employee_id
                          AND lr.status = 'approved'
                          AND (lr.start_date AT TIME ZONE 'UTC')::date <= e.shift_date
                          AND (lr.end_date   AT TIME ZONE 'UTC')::date >= e.shift_date) AS on_leave
          FROM eligible e
    ), inserted AS (
        INSERT INTO public.fairness_opportunities
            (shift_id, employee_id, organization_id, shift_date, is_available, extension_minutes)
        SELECT shift_id, employee_id, organization_id, shift_date,
               slack IS NOT NULL AND NOT on_leave,
               CASE WHEN slack IS NOT NULL AND NOT on_leave THEN slack::integer ELSE 0 END
          FROM assessed
        ON CONFLICT DO NOTHING
        RETURNING 1
    )
    SELECT count(*)::integer FROM inserted;
$$;

-- ── Recompute an organization's ledger ──────────────────────────────────────
-- Actual work = approved billables on non-cancelled Casual-target shifts in
-- the window. The worker is always in the pool (they demonstrably could work
-- it), so a shift with no snapshot contributes no debt either way, and debts
-- sum to zero per metric.
CREATE OR REPLACE FUNCTION public.recompute_casual_fairness(
    p_org_id            uuid,
    p_as_of             date    DEFAULT (now() AT TIME ZONE 'Australia/Sydney')::date,
    p_window_days       integer DEFAULT 91,
    p_confidence_shifts integer DEFAULT 10)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_from         date := GREATEST(p_as_of - (p_window_days - 1), public.casual_fairness_cutover());
    v_jurisdiction text;
    v_run          uuid := gen_random_uuid();
    v_rows         integer;
BEGIN
    SELECT o.jurisdiction INTO v_jurisdiction FROM public.organizations o WHERE o.id = p_org_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'recompute_casual_fairness: unknown organization %', p_org_id;
    END IF;

    DELETE FROM public.casual_fairness_ledger WHERE organization_id = p_org_id;

    WITH work AS (
        SELECT b.id AS work_id, b.employee_id AS worker, b.shift_id,
               c.total, c.saturday, c.sunday, c.public_holiday, c.night,
               GREATEST(0, billed.net - rostered.net) AS overtime
          FROM public.billables b
          JOIN public.shifts s ON s.id = b.shift_id
         CROSS JOIN LATERAL (
               SELECT COALESCE(b.billable_start, s.start_time) AS t0,
                      COALESCE(b.billable_end,   s.end_time)   AS t1) bt
         CROSS JOIN LATERAL (
               SELECT GREATEST(0, COALESCE(b.net_length_minutes,
                          EXTRACT(EPOCH FROM bt.t1 - bt.t0) / 60
                            + CASE WHEN bt.t1 <= bt.t0 THEN 1440 ELSE 0 END
                            - COALESCE(b.unpaid_break_minutes, 0)))::numeric AS net) billed
         CROSS JOIN LATERAL (
               SELECT GREATEST(0, COALESCE(s.net_length_minutes,
                          EXTRACT(EPOCH FROM s.end_time - s.start_time) / 60
                            + CASE WHEN s.end_time <= s.start_time THEN 1440 ELSE 0 END
                            - COALESCE(s.unpaid_break_minutes, 0)))::numeric AS net) rostered
         CROSS JOIN LATERAL public.fairness_category_minutes(
               s.shift_date, bt.t0, bt.t1, billed.net, v_jurisdiction) c
         WHERE b.organization_id = p_org_id
           AND b.status = 'approved'
           AND s.target_employment_type = 'Casual'
           AND s.lifecycle_status <> 'Cancelled'
           AND s.shift_date BETWEEN v_from AND p_as_of
    ), members AS (
        SELECT w.work_id, m.employee_id,
               (m.employee_id = w.worker
                OR COALESCE(o.extension_minutes, 0) >= w.overtime) AS in_overtime_pool
          FROM work w
         CROSS JOIN LATERAL (
               SELECT o2.employee_id FROM public.fairness_opportunities o2
                WHERE o2.shift_id = w.shift_id AND o2.is_available
               UNION
               SELECT w.worker) m
          LEFT JOIN public.fairness_opportunities o
                 ON o.shift_id = w.shift_id AND o.employee_id = m.employee_id
    ), pool_size AS (
        SELECT work_id,
               count(*) AS n,
               count(*) FILTER (WHERE in_overtime_pool) AS n_overtime
          FROM members
         GROUP BY work_id
    ), per_metric AS (
        SELECT w.work_id, w.worker, v.metric, v.minutes, v.is_overtime
          FROM work w
         CROSS JOIN LATERAL (VALUES
               ('total_hours',          w.total,           false),
               ('saturday_hours',       w.saturday,        false),
               ('sunday_hours',         w.sunday,          false),
               ('public_holiday_hours', w.public_holiday,  false),
               ('night_hours',          w.night,           false),
               ('overtime_hours',       w.overtime,        true)
         ) AS v(metric, minutes, is_overtime)
         WHERE v.minutes > 0
    ), shares AS (
        SELECT m.employee_id, p.metric,
               p.minutes / CASE WHEN p.is_overtime THEN z.n_overtime ELSE z.n END AS expected_min,
               0::numeric AS actual_min,
               1 AS opportunities
          FROM per_metric p
          JOIN members m   ON m.work_id = p.work_id AND (NOT p.is_overtime OR m.in_overtime_pool)
          JOIN pool_size z ON z.work_id = p.work_id
        UNION ALL
        SELECT p.worker, p.metric, 0, p.minutes, 0
          FROM per_metric p
    )
    INSERT INTO public.casual_fairness_ledger
        (organization_id, employee_id, metric, window_start, window_end,
         actual_hours, expected_hours, debt_hours, opportunity_count, confidence, run_id)
    SELECT p_org_id, employee_id, metric, v_from, p_as_of,
           round(sum(actual_min) / 60, 4),
           round(sum(expected_min) / 60, 4),
           round((sum(actual_min) - sum(expected_min)) / 60, 4),
           sum(opportunities),
           round(LEAST(1, sum(opportunities)::numeric / p_confidence_shifts), 3),
           v_run
      FROM shares
     GROUP BY employee_id, metric;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END $$;

-- ── Nightly: snapshot the coming week, recompute, prune ─────────────────────
-- Shifts are snapshotted up to 7 days ahead, i.e. around the time they are
-- rostered and offered, and never again.
CREATE OR REPLACE FUNCTION public.run_casual_fairness_nightly()
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Australia/Sydney')::date;
    v_org   uuid;
    v_rows  integer := 0;
BEGIN
    FOR v_org IN SELECT id FROM public.organizations WHERE COALESCE(is_active, true) LOOP
        BEGIN
            PERFORM public.capture_fairness_opportunities(v_org, v_today, v_today + 7);
            v_rows := v_rows + public.recompute_casual_fairness(v_org, v_today);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'casual fairness failed for organization %: %', v_org, SQLERRM;
        END;
    END LOOP;

    DELETE FROM public.fairness_opportunities WHERE shift_date < v_today - 182;
    RETURN v_rows;
END $$;

-- ── Exposure: none of the engine is client-callable ─────────────────────────
REVOKE ALL ON FUNCTION public.casual_fairness_cutover()                                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fairness_category_minutes(date, time, time, numeric, text)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_fairness_opportunities(uuid, date, date)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_casual_fairness(uuid, date, integer, integer)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_casual_fairness_nightly()                                   FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('casual_fairness_nightly', '0 16 * * *', 'SELECT public.run_casual_fairness_nightly()');

-- Start the history today rather than at the first nightly run.
SELECT public.run_casual_fairness_nightly();
