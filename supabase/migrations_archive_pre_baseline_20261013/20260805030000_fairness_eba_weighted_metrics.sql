-- ============================================================================
-- Fairness metric set: EBA-weighted days + unfarmable denial rate
-- (stakeholder decisions Q5, Q6, Q9)
-- ============================================================================
--
-- Three decisions land together because they all change the shape of what the
-- ledger stores, and the earlier migrations in this series have not been
-- applied yet. Making them now costs one edited function; making them after
-- 20260804040000 reaches production costs a metric rename plus a backfill of
-- every historical generation.
--
-- Q6 — SATURDAY AND SUNDAY ARE NOT THE SAME BURDEN
--   `weekend_shifts` counted both identically. The agreement does not: cl 41
--   prices Saturday at +25% and Sunday at +50%, and a public holiday at +150%.
--   The ledger now records `saturday_shifts` and `sunday_shifts` separately and
--   the 1:2:6 weighting is applied at READ time by DEFAULT_COEFFICIENTS in
--   src/modules/rosters/domain/fairness-ledger.ts.
--
--   Storing counts and weighting on read is deliberate: it keeps this table
--   observational, so a renegotiated EBA changes one TS table rather than
--   requiring history to be rewritten.
--
-- Q5 — `denied_preferences` REWARDED BIDDING VOLUME
--   It was a raw COUNT of rejected bids, and the solver applies the resulting
--   bonus one-sidedly (only positive debt boosts the preference discount —
--   model_builder.py SC-1). So the dominant strategy was to bid on everything:
--   more bids, more denials, bigger discount. Once one employee worked that
--   out, everyone had to bid defensively and the metric measured nothing.
--
--   Replaced by `denial_rate` — the share of an employee's OWN bids that were
--   rejected, shrunk toward the org-wide rate by 5 virtual bids so a thin
--   record (one bid, one loss) does not read as 100% denied. Someone who never
--   bids lands exactly on the org rate and therefore carries zero debt, which
--   is correct: not bidding is neither owed nor owing.
--
-- Q9 — A DECISION MUST BE ABLE TO NAME THE LEDGER THAT PRODUCED IT
--   `fairness_ledger.updated_by_run` has existed since the baseline schema and
--   has only ever been written as NULL. If a roster decision is disputed, the
--   employee is entitled to know which numbers drove it. Every recompute now
--   stamps a run id, so a generation is identifiable rather than merely dated.
-- ============================================================================

-- ── Retire the superseded metric rows ───────────────────────────────────────
--
-- `weekend_shifts` / `denied_preferences` rows can never be produced again and
-- would otherwise sit in the table forever: `get_fairness_debts_latest` picks
-- the newest generation per (employee, metric), so a dead metric's last
-- generation is immortal and would keep being served.
--
-- Safe to delete rather than migrate. Both are exactly reconstructable from
-- shift/bid history by re-running the recompute, which the nightly cron does
-- anyway, and neither can be mapped forward: a `weekend_shifts` count cannot be
-- split into Saturday and Sunday after the fact, and a denial COUNT carries no
-- denominator to turn it into a rate.

DELETE FROM public.fairness_ledger
 WHERE metric IN ('weekend_shifts', 'denied_preferences');

-- ── recompute, with the new metric set ──────────────────────────────────────

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
    v_run_id uuid := gen_random_uuid();   -- Q9: identifies this generation
    -- Q5: prior strength, in virtual bids. Must equal
    -- DENIAL_RATE_PRIOR_STRENGTH in fairness-ledger.ts.
    v_prior_k numeric := 5;
    v_org_denial_rate numeric;
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

    -- Org-wide denial rate: the baseline a thin individual record shrinks
    -- toward. NULL-safe — an org with no bids at all yields 0.
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
            -- Q6: Saturday (DOW 6) and Sunday (DOW 0) tracked separately.
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
    -- Q5: BOTH outcomes, not just rejections — a rate needs its denominator.
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
            cm.employee_id,
            COALESCE(pe.saturday_shifts, 0)::numeric       AS saturday_shifts,
            COALESCE(pe.sunday_shifts, 0)::numeric         AS sunday_shifts,
            COALESCE(pe.night_shifts, 0)::numeric          AS night_shifts,
            COALESCE(pe.public_holiday_shifts, 0)::numeric AS public_holiday_shifts,
            GREATEST(
                0,
                COALESCE(pe.total_minutes, 0) - (cm.contracted_weekly * 60 * v_window_weeks)
            ) AS overtime_minutes,
            ROUND(COALESCE(pe.total_minutes, 0) / 60.0, 2) AS total_hours,
            ROUND(
                (COALESCE(b.denied, 0) + v_prior_k * v_org_denial_rate)
                    / (COALESCE(b.submitted, 0) + v_prior_k),
                4) AS denial_rate
        FROM cohort_members cm
        LEFT JOIN per_employee pe ON pe.employee_id = cm.employee_id
        LEFT JOIN bids         b  ON b.employee_id  = cm.employee_id

        UNION ALL

        SELECT
            COALESCE(pe.employee_id, b.employee_id),
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
            SELECT employee_id FROM cohort_members
        )
    ),
    unpivoted AS (
        SELECT employee_id, metric, value
        FROM cohort
        CROSS JOIN LATERAL (VALUES
            ('saturday_shifts',       saturday_shifts),
            ('sunday_shifts',         sunday_shifts),
            ('night_shifts',          night_shifts),
            ('public_holiday_shifts', public_holiday_shifts),
            ('overtime_minutes',      overtime_minutes),
            ('total_hours',           total_hours),
            ('denial_rate',           denial_rate)
        ) AS m(metric, value)
    ),
    scored AS (
        SELECT
            employee_id,
            metric,
            value AS rolling_value,
            ROUND(AVG(value) OVER (PARTITION BY metric), 4) AS team_average,
            ROUND(value - AVG(value) OVER (PARTITION BY metric), 4) AS debt
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
    'Authoritative F1 fairness-ledger rebuild for one org. Cohort is every active-contract employee (F-05); overtime uses hr.user_contracts.contracted_weekly_hours (F-15); the public-holiday jurisdiction resolves from organizations.jurisdiction unless overridden (F-21). Saturday/Sunday are separate metrics weighted from EBA cl 41 at read time (Q6); denial_rate is a smoothed share, not a farmable count (Q5); every generation is stamped with a run id (Q9). Classification must stay in step with src/modules/rosters/domain/fairness-ledger.ts.';
