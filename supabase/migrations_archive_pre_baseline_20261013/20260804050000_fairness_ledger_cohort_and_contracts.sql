-- ============================================================================
-- Fairness ledger: full cohort + real contracted hours  (audit F-05, F-15)
-- ============================================================================
--
-- F-05 — ZERO-SHIFT EMPLOYEES WERE INVISIBLE TO FAIRNESS
--   The cohort was "employees with a shift or a denied preference in the
--   window", so anyone who worked nothing got no ledger row at all. Two
--   consequences, both bad in the same direction:
--
--     1. The team average divided by the count of employees who WORKED, not
--        the count on the team. With 20 staff of whom 12 worked, every average
--        was 1.67x too high and every worker's debt correspondingly understated.
--     2. Both solver blocks begin `if not debts: continue`. An employee with
--        ONE shift has a negative total_hours debt and gets a bonus; an employee
--        with ZERO has no debts at all and gets nothing. The incentive was
--        non-monotonic — it rewarded working slightly-below-average but not
--        working nothing — so the person the ledger most needed to rescue was
--        precisely the one it could not see. Classic starvation: once someone
--        fell out, no force pulled them back.
--
--   The cohort is now every employee with an ACTIVE contract in the org, via a
--   RIGHT JOIN, with zero-filled metrics. Debt for a zero-shift employee is now
--   strictly more negative than for a one-shift employee, which is the
--   monotonicity the solver's bias relies on.
--
-- F-15 — CONTRACTED HOURS WERE A HARDCODED 38
--   Overtime was measured against 38h/week for everyone, mirroring the TS
--   `fetchContractedHours` stub. A 20h/week part-timer had to work 494 hours in
--   the quarter — nearly double their contract — before registering any
--   overtime debt, and casuals were held to a standard they never agreed to.
--   The distortion was regressive: it under-counted overtime precisely for the
--   lowest-hours, least-protected cohort.
--
--   Now read from `hr.user_contracts.contracted_weekly_hours` (the same source
--   the AutoScheduler already uses), falling back to 38 only when no active
--   contract row exists.
--
-- NOTE ON SCOPE
--   `p_department_id` still filters SHIFTS but the cohort is org-wide, matching
--   the org-wide read path the solver uses (audit F-14). Passing a department
--   would otherwise produce a team average over a different population than the
--   one the debts are compared against.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recompute_fairness_ledger(
    p_org_id       uuid,
    p_as_of        date DEFAULT CURRENT_DATE,
    p_window_days  integer DEFAULT 91,
    p_department_id uuid DEFAULT NULL,
    p_jurisdiction text DEFAULT 'AU-NSW'
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
BEGIN
    WITH cohort_members AS (
        -- Everyone with an ACTIVE contract in this org, and the contracted
        -- weekly hours their overtime threshold is measured against (F-15).
        -- DISTINCT ON: an employee may hold several role contracts; the ledger
        -- needs one weekly-hours figure, so take the largest (the most
        -- generous overtime threshold — never manufacture overtime from a
        -- secondary contract).
        SELECT DISTINCT ON (uc.user_id)
               uc.user_id AS employee_id,
               COALESCE(uc.contracted_weekly_hours, 38)::numeric AS contracted_weekly
          FROM hr.user_contracts uc
         WHERE uc.organization_id = p_org_id
           AND uc.status = 'Active'
           AND (uc.start_date IS NULL OR uc.start_date <= p_as_of)
           AND (uc.end_date   IS NULL OR uc.end_date   >= v_window_start)
         ORDER BY uc.user_id, COALESCE(uc.contracted_weekly_hours, 38) DESC
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
            (EXTRACT(DOW FROM s.shift_date) IN (0, 6)) AS is_weekend,
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
              AND ph.jurisdiction = p_jurisdiction
        WHERE s.organization_id = p_org_id
          AND s.assigned_employee_id IS NOT NULL
          AND s.lifecycle_status <> 'Cancelled'::public.shift_lifecycle
          AND s.shift_date BETWEEN v_window_start AND p_as_of
          AND (p_department_id IS NULL OR s.department_id = p_department_id)
    ),
    per_employee AS (
        SELECT
            employee_id,
            COUNT(*) FILTER (WHERE is_weekend)        AS weekend_shifts,
            COUNT(*) FILTER (WHERE is_night)          AS night_shifts,
            COUNT(*) FILTER (WHERE is_public_holiday) AS public_holiday_shifts,
            SUM(net_minutes)                          AS total_minutes
        FROM windowed
        GROUP BY employee_id
    ),
    denied AS (
        SELECT b.employee_id, COUNT(*)::numeric AS denied_preferences
        FROM public.shift_bids b
        JOIN public.shifts s ON s.id = b.shift_id
        WHERE b.status = 'rejected'
          AND s.organization_id = p_org_id
          AND s.shift_date BETWEEN v_window_start AND p_as_of
          AND (p_department_id IS NULL OR s.department_id = p_department_id)
        GROUP BY b.employee_id
    ),
    cohort AS (
        -- RIGHT-side driver is the full roster (F-05). An employee who worked
        -- nothing now yields a real all-zero row instead of vanishing, so they
        -- are BOTH in the average denominator AND visible to the solver's
        -- `if not debts: continue` guard.
        SELECT
            cm.employee_id,
            COALESCE(pe.weekend_shifts, 0)::numeric        AS weekend_shifts,
            COALESCE(pe.night_shifts, 0)::numeric          AS night_shifts,
            COALESCE(pe.public_holiday_shifts, 0)::numeric AS public_holiday_shifts,
            GREATEST(
                0,
                COALESCE(pe.total_minutes, 0) - (cm.contracted_weekly * 60 * v_window_weeks)
            ) AS overtime_minutes,
            ROUND(COALESCE(pe.total_minutes, 0) / 60.0, 2) AS total_hours,
            COALESCE(d.denied_preferences, 0)              AS denied_preferences
        FROM cohort_members cm
        LEFT JOIN per_employee pe ON pe.employee_id = cm.employee_id
        LEFT JOIN denied       d  ON d.employee_id  = cm.employee_id

        UNION ALL

        -- Safety net: anyone with shifts or bids in the window but NO active
        -- contract row (contract lapsed mid-window, data gap). Better to score
        -- them on the 38h default than to drop work that actually happened.
        SELECT
            COALESCE(pe.employee_id, d.employee_id),
            COALESCE(pe.weekend_shifts, 0)::numeric,
            COALESCE(pe.night_shifts, 0)::numeric,
            COALESCE(pe.public_holiday_shifts, 0)::numeric,
            GREATEST(0, COALESCE(pe.total_minutes, 0) - (38 * 60 * v_window_weeks)),
            ROUND(COALESCE(pe.total_minutes, 0) / 60.0, 2),
            COALESCE(d.denied_preferences, 0)
        FROM per_employee pe
        FULL OUTER JOIN denied d ON d.employee_id = pe.employee_id
        WHERE COALESCE(pe.employee_id, d.employee_id) NOT IN (
            SELECT employee_id FROM cohort_members
        )
    ),
    unpivoted AS (
        SELECT employee_id, metric, value
        FROM cohort
        CROSS JOIN LATERAL (VALUES
            ('weekend_shifts',        weekend_shifts),
            ('night_shifts',          night_shifts),
            ('public_holiday_shifts', public_holiday_shifts),
            ('overtime_minutes',      overtime_minutes),
            ('total_hours',           total_hours),
            ('denied_preferences',    denied_preferences)
        ) AS m(metric, value)
    ),
    scored AS (
        SELECT
            employee_id,
            metric,
            value AS rolling_value,
            ROUND(AVG(value) OVER (PARTITION BY metric), 2) AS team_average,
            ROUND(value - AVG(value) OVER (PARTITION BY metric), 2) AS debt
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
            now(), NULL
        FROM scored
        ON CONFLICT (organization_id, employee_id, metric, window_end)
        DO UPDATE SET
            window_start    = EXCLUDED.window_start,
            rolling_value   = EXCLUDED.rolling_value,
            team_average    = EXCLUDED.team_average,
            debt            = EXCLUDED.debt,
            last_updated_at = now(),
            updated_by_run  = NULL
        RETURNING employee_id
    )
    SELECT COUNT(*), COALESCE(array_agg(DISTINCT employee_id), '{}')
      INTO v_rows, v_written
      FROM written;

    -- Employees who left the cohort (contract ended, every shift cancelled)
    -- must not keep a stale row asserting a debt they no longer carry — it
    -- would still be returned by `get_fairness_debts_latest` for any later
    -- as-of date. Keyed on exactly who we just wrote, so it is correct
    -- regardless of how close together two runs land.
    DELETE FROM public.fairness_ledger fl
     WHERE fl.organization_id = p_org_id
       AND fl.window_end = p_as_of
       AND NOT (fl.employee_id = ANY (v_written));

    RETURN v_rows;
END $$;

COMMENT ON FUNCTION public.recompute_fairness_ledger(uuid, date, integer, uuid, text) IS
    'Authoritative F1 fairness-ledger rebuild for one org over a rolling window. Cohort is every active-contract employee (audit F-05) and overtime is measured against hr.user_contracts.contracted_weekly_hours (audit F-15). Classification must stay in step with src/modules/rosters/domain/fairness-ledger.ts.';
