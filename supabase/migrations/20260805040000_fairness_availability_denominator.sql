-- ============================================================================
-- Fairness availability denominator  (stakeholder decision Q4)
-- ============================================================================
--
-- THE BUG
--   Debt was `value − team_average` over a fixed 91 calendar days. Anyone who
--   was not AVAILABLE for all 91 days was measured against a denominator that
--   assumed they were. Four symptoms, one defect:
--
--     - back from two weeks' leave  → large negative debt → the solver
--       aggressively over-schedules them to "catch up"
--     - unavailable                 → same mechanism
--     - new starter                 → near-total negative debt → every
--       available shift funnels to the newest employee
--     - contract ended but left Active → a zero-hour employee drags the team
--       average down for a full quarter, making everyone else look overworked
--
--   All four are the same thing: THE DENOMINATOR IS CALENDAR TIME WHEN IT
--   SHOULD BE AVAILABILITY TIME.
--
--   This is not a corner case on the live dataset. At the time of writing, 137
--   of 140 active contracts start inside the current window — so essentially
--   the whole workforce has partial availability, and unscaled debts would be
--   dominated by tenure rather than by burden borne.
--
-- THE FIX
--   Compare RATES rather than TOTALS:
--
--       availability = (contract days in window − approved leave days) / window
--       team_rate    = Σ value / Σ availability
--       expected_i   = team_rate × availability_i
--       debt_i       = value_i − expected_i
--
--   Two employees working at the same rate now both carry zero debt, whatever
--   share of the window each was present for.
--
--   Reduces EXACTLY to the previous behaviour when everyone is fully available
--   (Σavailability = n ⇒ team_rate = plain mean), so a stable workforce sees no
--   change. Verified by the parity fixture, which is fully-available throughout
--   and whose expected numbers are unchanged by this migration.
--
--   `denial_rate` is deliberately NOT scaled: it is already normalised by the
--   employee's own bid count, so scaling it again would double-count absence.
--
--   `team_average` stores the employee's EXPECTED share rather than the raw
--   cohort mean, preserving `debt = rolling_value − team_average` exactly. That
--   invariant is what lets a debt be explained to the person it describes (Q9);
--   for a fully-available employee the two definitions coincide.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recompute_fairness_ledger(
    p_org_id       uuid,
    p_as_of        date DEFAULT CURRENT_DATE,
    p_window_days  integer DEFAULT 91,
    p_department_id uuid DEFAULT NULL,
    p_jurisdiction text DEFAULT NULL      -- NULL = resolve from organizations
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_window_start date := p_as_of - (p_window_days - 1);
    v_window_weeks numeric := p_window_days::numeric / 7;
    v_rows integer := 0;
    v_written uuid[];
    v_jurisdiction text;
    v_run_id uuid := gen_random_uuid();
    v_prior_k numeric := 5;
    v_org_denial_rate numeric;
BEGIN
    SELECT COALESCE(p_jurisdiction, o.jurisdiction, 'AU-NSW')
      INTO v_jurisdiction
      FROM public.organizations o
     WHERE o.id = p_org_id;

    IF v_jurisdiction IS NULL THEN
        RETURN 0;
    END IF;

    SELECT COALESCE(
               SUM(CASE WHEN b.status = 'rejected' THEN 1 ELSE 0 END)::numeric
                   / NULLIF(COUNT(*), 0),
               0)
      INTO v_org_denial_rate
      FROM public.shift_bids b
      JOIN public.shifts s ON s.id = b.shift_id
     WHERE s.organization_id = p_org_id
       AND s.shift_date BETWEEN v_window_start AND p_as_of
       AND (p_department_id IS NULL OR s.department_id = p_department_id);

    WITH cohort_members AS (
        SELECT DISTINCT ON (uc.user_id)
               uc.user_id AS employee_id,
               COALESCE(uc.contracted_weekly_hours, 38)::numeric AS contracted_weekly,
               -- Inclusive day count of the contract's overlap with the window.
               GREATEST(
                   0,
                   (LEAST(p_as_of, COALESCE(uc.end_date, p_as_of))
                    - GREATEST(v_window_start, COALESCE(uc.start_date, v_window_start))) + 1
               )::numeric AS contract_days
          FROM hr.user_contracts uc
         WHERE uc.organization_id = p_org_id
           AND uc.status = 'Active'
           AND (uc.start_date IS NULL OR uc.start_date <= p_as_of)
           AND (uc.end_date   IS NULL OR uc.end_date   >= v_window_start)
         ORDER BY uc.user_id, COALESCE(uc.contracted_weekly_hours, 38) DESC
    ),
    -- Approved leave days falling inside the window. DISTINCT because
    -- overlapping requests must not double-subtract a day.
    leave_days AS (
        SELECT lr.employee_id,
               count(DISTINCT g.d::date)::numeric AS days
          FROM public.leave_requests lr
          CROSS JOIN LATERAL generate_series(
                  GREATEST(lr.start_date::date, v_window_start),
                  LEAST(lr.end_date::date, p_as_of),
                  interval '1 day') AS g(d)
         WHERE lower(COALESCE(lr.status, '')) = 'approved'
           AND lr.start_date::date <= p_as_of
           AND lr.end_date::date   >= v_window_start
         GROUP BY lr.employee_id
    ),
    availability AS (
        SELECT cm.employee_id,
               cm.contracted_weekly,
               LEAST(1.0, GREATEST(0.0,
                   (cm.contract_days - COALESCE(ld.days, 0)) / p_window_days::numeric
               )) AS availability
          FROM cohort_members cm
          LEFT JOIN leave_days ld ON ld.employee_id = cm.employee_id
    ),
    windowed AS (
        SELECT
            s.assigned_employee_id AS employee_id,
            GREATEST(
                0,
                (CASE
                    WHEN s.end_time <= s.start_time
                        THEN EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60 + 1440
                        ELSE EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60
                 END) - COALESCE(s.unpaid_break_minutes, 0)
            ) AS net_minutes,
            (EXTRACT(DOW FROM s.shift_date) = 6) AS is_saturday,
            (EXTRACT(DOW FROM s.shift_date) = 0) AS is_sunday,
            (
                EXTRACT(EPOCH FROM s.start_time) / 60 < 360
                OR (
                    s.end_time <= s.start_time
                    AND EXTRACT(EPOCH FROM s.end_time) / 60 > 0
                )
            ) AS is_night,
            (ph.holiday_date IS NOT NULL) AS is_public_holiday
        FROM public.shifts s
        LEFT JOIN public.public_holidays ph
               ON ph.holiday_date = s.shift_date
              AND ph.jurisdiction = v_jurisdiction
        WHERE s.organization_id = p_org_id
          AND s.assigned_employee_id IS NOT NULL
          AND s.lifecycle_status <> 'Cancelled'::public.shift_lifecycle
          AND s.shift_date BETWEEN v_window_start AND p_as_of
          AND (p_department_id IS NULL OR s.department_id = p_department_id)
    ),
    per_employee AS (
        SELECT
            employee_id,
            COUNT(*) FILTER (WHERE is_saturday)       AS saturday_shifts,
            COUNT(*) FILTER (WHERE is_sunday)         AS sunday_shifts,
            COUNT(*) FILTER (WHERE is_night)          AS night_shifts,
            COUNT(*) FILTER (WHERE is_public_holiday) AS public_holiday_shifts,
            SUM(net_minutes)                          AS total_minutes
        FROM windowed
        GROUP BY employee_id
    ),
    bids AS (
        SELECT
            b.employee_id,
            COUNT(*)::numeric AS submitted,
            COUNT(*) FILTER (WHERE b.status = 'rejected')::numeric AS denied
        FROM public.shift_bids b
        JOIN public.shifts s ON s.id = b.shift_id
        WHERE s.organization_id = p_org_id
          AND s.shift_date BETWEEN v_window_start AND p_as_of
          AND (p_department_id IS NULL OR s.department_id = p_department_id)
        GROUP BY b.employee_id
    ),
    cohort AS (
        SELECT
            av.employee_id,
            av.availability,
            COALESCE(pe.saturday_shifts, 0)::numeric       AS saturday_shifts,
            COALESCE(pe.sunday_shifts, 0)::numeric         AS sunday_shifts,
            COALESCE(pe.night_shifts, 0)::numeric          AS night_shifts,
            COALESCE(pe.public_holiday_shifts, 0)::numeric AS public_holiday_shifts,
            -- Overtime threshold is pro-rated too: an employee present for half
            -- the window owes half the contracted hours, else they would show
            -- overtime debt of zero no matter how hard they worked while there.
            GREATEST(
                0,
                COALESCE(pe.total_minutes, 0)
                    - (av.contracted_weekly * 60 * v_window_weeks * av.availability)
            ) AS overtime_minutes,
            ROUND(COALESCE(pe.total_minutes, 0) / 60.0, 2) AS total_hours,
            ROUND(
                (COALESCE(b.denied, 0) + v_prior_k * v_org_denial_rate)
                    / (COALESCE(b.submitted, 0) + v_prior_k),
                4) AS denial_rate
        FROM availability av
        LEFT JOIN per_employee pe ON pe.employee_id = av.employee_id
        LEFT JOIN bids         b  ON b.employee_id  = av.employee_id

        UNION ALL

        -- Worked or bid but has no active contract: nothing better is known
        -- about their availability, so treat them as fully available.
        SELECT
            COALESCE(pe.employee_id, b.employee_id),
            1.0,
            COALESCE(pe.saturday_shifts, 0)::numeric,
            COALESCE(pe.sunday_shifts, 0)::numeric,
            COALESCE(pe.night_shifts, 0)::numeric,
            COALESCE(pe.public_holiday_shifts, 0)::numeric,
            GREATEST(0, COALESCE(pe.total_minutes, 0) - (38 * 60 * v_window_weeks)),
            ROUND(COALESCE(pe.total_minutes, 0) / 60.0, 2),
            ROUND(
                (COALESCE(b.denied, 0) + v_prior_k * v_org_denial_rate)
                    / (COALESCE(b.submitted, 0) + v_prior_k),
                4)
        FROM per_employee pe
        FULL OUTER JOIN bids b ON b.employee_id = pe.employee_id
        WHERE COALESCE(pe.employee_id, b.employee_id) NOT IN (
            SELECT employee_id FROM availability
        )
    ),
    unpivoted AS (
        SELECT employee_id, availability, metric, value, scales
        FROM cohort
        CROSS JOIN LATERAL (VALUES
            ('saturday_shifts',       saturday_shifts,       true),
            ('sunday_shifts',         sunday_shifts,         true),
            ('night_shifts',          night_shifts,          true),
            ('public_holiday_shifts', public_holiday_shifts, true),
            ('overtime_minutes',      overtime_minutes,      true),
            ('total_hours',           total_hours,           true),
            -- already a rate: scaling by availability would double-count absence
            ('denial_rate',           denial_rate,           false)
        ) AS m(metric, value, scales)
    ),
    scored AS (
        SELECT
            employee_id,
            metric,
            value AS rolling_value,
            ROUND(
                CASE
                    WHEN scales THEN
                        COALESCE(
                            SUM(value)      OVER (PARTITION BY metric)
                          / NULLIF(SUM(availability) OVER (PARTITION BY metric), 0),
                            0) * availability
                    ELSE AVG(value) OVER (PARTITION BY metric)
                END, 4) AS team_average,
            ROUND(
                value -
                CASE
                    WHEN scales THEN
                        COALESCE(
                            SUM(value)      OVER (PARTITION BY metric)
                          / NULLIF(SUM(availability) OVER (PARTITION BY metric), 0),
                            0) * availability
                    ELSE AVG(value) OVER (PARTITION BY metric)
                END, 4) AS debt
        FROM unpivoted
    ),
    written AS (
        INSERT INTO public.fairness_ledger (
            organization_id, employee_id, metric,
            window_start, window_end,
            rolling_value, team_average, debt,
            last_updated_at, updated_by_run
        )
        SELECT
            p_org_id, employee_id, metric,
            v_window_start, p_as_of,
            rolling_value, team_average, debt,
            now(), v_run_id
        FROM scored
        ON CONFLICT (organization_id, employee_id, metric, window_end)
        DO UPDATE SET
            window_start    = EXCLUDED.window_start,
            rolling_value   = EXCLUDED.rolling_value,
            team_average    = EXCLUDED.team_average,
            debt            = EXCLUDED.debt,
            last_updated_at = now(),
            updated_by_run  = EXCLUDED.updated_by_run
        RETURNING employee_id
    )
    SELECT COUNT(*), COALESCE(array_agg(DISTINCT employee_id), '{}')
      INTO v_rows, v_written
      FROM written;

    DELETE FROM public.fairness_ledger fl
     WHERE fl.organization_id = p_org_id
       AND fl.window_end = p_as_of
       AND NOT (fl.employee_id = ANY (v_written));

    RETURN v_rows;
END $$;

COMMENT ON FUNCTION public.recompute_fairness_ledger(uuid, date, integer, uuid, text) IS
    'Authoritative F1 fairness-ledger rebuild for one org. Cohort is every active-contract employee (F-05); the public-holiday jurisdiction resolves from organizations.jurisdiction unless overridden (F-21). Saturday/Sunday are separate metrics weighted from EBA cl 41 at read time (Q6); denial_rate is a smoothed share, not a farmable count (Q5); every generation is stamped with a run id (Q9); expected share is scaled by availability so leave, new starters and part-window contracts are not treated as under-worked (Q4). team_average holds the employee''s EXPECTED share, so debt = rolling_value - team_average always holds. Classification must stay in step with src/modules/rosters/domain/fairness-ledger.ts.';
