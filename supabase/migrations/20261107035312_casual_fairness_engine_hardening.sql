-- Casual fairness engine: review fixes to 20261107030325.
--
-- 1. Visibility no longer depends on the caller being able to read
--    hr.user_contracts: the policy's subquery ran under that table's own RLS,
--    so a roster viewer without contract.view saw no fairness rows at all.
--    Expired contracts no longer grant visibility.
-- 2. Snapshots are refreshed every night until the shift's own date, then
--    frozen. A casual who declares availability (or whose leave is approved)
--    after the shift first entered the 7-day window is now reflected; a past
--    shift is never rewritten.
-- 3. Overtime is time billed past the rostered end — what extension_minutes
--    measures — not billed net minus rostered net, which turned a skipped
--    unpaid break into overtime nobody's availability could match.
-- 4. Opportunities (and so confidence) count only snapshotted shifts. A shift
--    created too late to be snapshotted has a pool of just its worker: no debt
--    either way, and now no false confidence either.
-- 5. Concurrent recomputes of one organization serialize instead of colliding
--    on the primary key; debt is exactly the stored actual − expected.
-- 6. The nightly job captures and recomputes in separate sub-transactions, so
--    a recompute failure no longer discards that night's snapshots.
-- 7. The prune has an index to use.

CREATE OR REPLACE FUNCTION public.casual_fairness_visible(p_employee_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM hr.user_contracts uc
         WHERE uc.user_id = p_employee_id
           AND uc.organization_id = p_org_id
           AND uc.status <> 'Expired'
           AND public.user_has_action_in_scope('roster.view', uc.organization_id,
                                               uc.department_id, uc.sub_department_id));
$$;
REVOKE ALL ON FUNCTION public.casual_fairness_visible(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.casual_fairness_visible(uuid, uuid) TO authenticated;

DROP POLICY casual_fairness_ledger_scoped_read ON public.casual_fairness_ledger;
CREATE POLICY casual_fairness_ledger_scoped_read ON public.casual_fairness_ledger
    FOR SELECT TO authenticated
    USING (public.casual_fairness_visible(employee_id, organization_id));

DROP INDEX public.fairness_opportunities_org_date_idx;
CREATE INDEX fairness_opportunities_shift_date_idx ON public.fairness_opportunities (shift_date);

COMMENT ON TABLE public.fairness_opportunities IS
    'One row per (casual shift, eligible casual). Refreshed nightly while the shift is in the '
    '7-day look-ahead, frozen from its date on: later availability changes never alter history. Server-only.';

CREATE OR REPLACE FUNCTION public.capture_fairness_opportunities(
    p_org_id uuid,
    p_from   date,
    p_to     date)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_from date := GREATEST(p_from, public.casual_fairness_cutover());
    v_rows integer;
BEGIN
    DELETE FROM public.fairness_opportunities o
     USING public.shifts s
     WHERE o.shift_id = s.id
       AND s.organization_id = p_org_id
       AND s.shift_date BETWEEN v_from AND p_to;

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
           AND s.shift_date BETWEEN v_from AND p_to
           AND s.target_employment_type = 'Casual'
           AND s.lifecycle_status <> 'Cancelled'
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
    )
    INSERT INTO public.fairness_opportunities
        (shift_id, employee_id, organization_id, shift_date, is_available, extension_minutes)
    SELECT shift_id, employee_id, organization_id, shift_date,
           slack IS NOT NULL AND NOT on_leave,
           CASE WHEN slack IS NOT NULL AND NOT on_leave THEN slack::integer ELSE 0 END
      FROM assessed;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END $$;

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
    IF p_window_days < 1 OR p_confidence_shifts < 1 THEN
        RAISE EXCEPTION 'recompute_casual_fairness: window and confidence must be at least 1';
    END IF;
    SELECT o.jurisdiction INTO v_jurisdiction FROM public.organizations o WHERE o.id = p_org_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'recompute_casual_fairness: unknown organization %', p_org_id;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('casual_fairness:' || p_org_id::text));
    DELETE FROM public.casual_fairness_ledger WHERE organization_id = p_org_id;

    WITH work AS (
        SELECT b.id AS work_id, b.employee_id AS worker, b.shift_id,
               c.total, c.saturday, c.sunday, c.public_holiday, c.night,
               LEAST(billed.net, GREATEST(0,
                   EXTRACT(EPOCH FROM bt.t1) / 60 + CASE WHEN bt.t1 <= bt.t0 THEN 1440 ELSE 0 END
                 - EXTRACT(EPOCH FROM s.end_time) / 60
                 - CASE WHEN s.end_time <= s.start_time THEN 1440 ELSE 0 END)) AS overtime,
               EXISTS (SELECT 1 FROM public.fairness_opportunities o0
                        WHERE o0.shift_id = b.shift_id) AS snapshotted
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
        SELECT w.work_id, w.worker, w.snapshotted, v.metric, v.minutes, v.is_overtime
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
               CASE WHEN p.snapshotted THEN 1 ELSE 0 END AS opportunities
          FROM per_metric p
          JOIN members m   ON m.work_id = p.work_id AND (NOT p.is_overtime OR m.in_overtime_pool)
          JOIN pool_size z ON z.work_id = p.work_id
        UNION ALL
        SELECT p.worker, p.metric, 0, p.minutes, 0
          FROM per_metric p
    ), totals AS (
        SELECT employee_id, metric,
               round(sum(actual_min) / 60, 4)   AS actual_h,
               round(sum(expected_min) / 60, 4) AS expected_h,
               sum(opportunities)               AS opportunities
          FROM shares
         GROUP BY employee_id, metric
        HAVING sum(opportunities) > 0
    )
    INSERT INTO public.casual_fairness_ledger
        (organization_id, employee_id, metric, window_start, window_end,
         actual_hours, expected_hours, debt_hours, opportunity_count, confidence, run_id)
    SELECT p_org_id, employee_id, metric, v_from, p_as_of,
           actual_h, expected_h, actual_h - expected_h, opportunities,
           round(LEAST(1, opportunities::numeric / p_confidence_shifts), 3),
           v_run
      FROM totals;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END $$;

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
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'casual fairness capture failed for organization %: %', v_org, SQLERRM;
        END;
        BEGIN
            v_rows := v_rows + public.recompute_casual_fairness(v_org, v_today);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'casual fairness recompute failed for organization %: %', v_org, SQLERRM;
        END;
    END LOOP;

    DELETE FROM public.fairness_opportunities WHERE shift_date < v_today - 182;
    RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION public.capture_fairness_opportunities(uuid, date, date)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_casual_fairness(uuid, date, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_casual_fairness_nightly()                           FROM PUBLIC, anon, authenticated;
