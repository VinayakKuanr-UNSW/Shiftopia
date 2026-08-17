-- ============================================================================
-- organizations.jurisdiction  (audit F-21, remaining half)
-- ============================================================================
--
-- `public_holidays` is keyed by (holiday_date, jurisdiction) precisely so a
-- multi-org deployment can hold more than one calendar — but nothing set a
-- jurisdiction, so every caller passed the 'AU-NSW' default. The table was
-- multi-jurisdiction in shape and single-jurisdiction in practice, which is the
-- kind of half-built abstraction that reads as done and is not.
--
-- This closes it: organizations carry their jurisdiction, and
-- `recompute_fairness_ledger` resolves it from the org instead of taking a
-- caller-supplied default. The parameter stays for explicit overrides (tests,
-- backfills), but it is now an override rather than the only source.
--
-- Every existing row is AU-NSW — the deployment is ICC Sydney — so the backfill
-- is a straight default and no behaviour changes today. What changes is that
-- adding a second jurisdiction is now a data change, not a code change.
--
-- STILL SINGLE-JURISDICTION PER ORG: an org operating across state lines would
-- need per-department or per-venue jurisdiction. Not modelled, and not needed
-- until a second venue exists.
-- ============================================================================

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS jurisdiction text NOT NULL DEFAULT 'AU-NSW';

COMMENT ON COLUMN public.organizations.jurisdiction IS
    'Public-holiday / award jurisdiction key, matching public_holidays.jurisdiction (e.g. AU-NSW). Resolved by recompute_fairness_ledger. Audit F-21.';

-- Guard against a typo silently producing an org with NO holidays: a
-- jurisdiction must actually exist in the calendar. Deferred-safe (checked at
-- write time only) and cheap.
CREATE OR REPLACE FUNCTION public.jurisdiction_is_known(p_jurisdiction text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.public_holidays WHERE jurisdiction = p_jurisdiction
    );
$$;

ALTER FUNCTION public.jurisdiction_is_known(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.jurisdiction_is_known(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jurisdiction_is_known(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.jurisdiction_is_known(text) TO authenticated, service_role;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'organizations_jurisdiction_known'
    ) THEN
        ALTER TABLE public.organizations
            ADD CONSTRAINT organizations_jurisdiction_known
            CHECK (public.jurisdiction_is_known(jurisdiction)) NOT VALID;
    END IF;
END $$;

-- ── recompute now resolves the jurisdiction from the org ────────────────────
--
-- Only the signature default and one lookup change; the body is otherwise
-- identical to 20260804050000. `p_jurisdiction => NULL` (the new default) means
-- "ask the organization"; passing a value explicitly still overrides.

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
BEGIN
    SELECT COALESCE(p_jurisdiction, o.jurisdiction, 'AU-NSW')
      INTO v_jurisdiction
      FROM public.organizations o
     WHERE o.id = p_org_id;

    -- Unknown org: nothing to recompute, and inventing a jurisdiction would
    -- quietly classify every PH as a non-PH.
    IF v_jurisdiction IS NULL THEN
        RETURN 0;
    END IF;

    WITH cohort_members AS (
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

    DELETE FROM public.fairness_ledger fl
     WHERE fl.organization_id = p_org_id
       AND fl.window_end = p_as_of
       AND NOT (fl.employee_id = ANY (v_written));

    RETURN v_rows;
END $$;

COMMENT ON FUNCTION public.recompute_fairness_ledger(uuid, date, integer, uuid, text) IS
    'Authoritative F1 fairness-ledger rebuild for one org. Cohort is every active-contract employee (F-05); overtime uses hr.user_contracts.contracted_weekly_hours (F-15); the public-holiday jurisdiction is resolved from organizations.jurisdiction unless overridden (F-21). Classification must stay in step with src/modules/rosters/domain/fairness-ledger.ts.';
