-- ============================================================================
-- F1 Fairness Ledger — server-side recompute + nightly cron  (audit F-04, part 2)
-- ============================================================================
--
-- PROBLEM
--   `recomputeLedger` lived in the browser and its ONLY trigger was a
--   fire-and-forget call in the `usePublishRoster` success handler. No pg_cron
--   job, no edge function, no server-side scheduler. So the ledger was only as
--   fresh as the last time a human clicked Publish, and on a quiet week it went
--   stale or was never built at all. Part 1 of this fix made READS survive that;
--   this part stops it happening.
--
--   It also could not be ported to SQL before now: classification needs a
--   public-holiday calendar, and there wasn't one in the database. See
--   20260804030000_public_holidays_table.sql.
--
-- DESIGN
--   This function is the AUTHORITATIVE recompute. `fairnessLedgerService
--   .recomputeLedger` becomes a thin wrapper that calls it, so there is exactly
--   ONE implementation of the write path rather than a TS copy and a SQL copy
--   drifting apart (the failure mode audit F-13 documents for the coefficient
--   tables).
--
--   Classification MUST stay byte-compatible with
--   `src/modules/rosters/domain/fairness-ledger.ts`, which still owns the
--   read-only what-if preview (`projectFairnessImpact`):
--     - weekend : Saturday or Sunday          (DOW 6 or 0)
--     - night   : window overlaps 00:00-06:00, incl. the cross-midnight tail
--     - PH      : date present in public_holidays for the jurisdiction
--     - hours   : (end - start, +24h if end <= start) - unpaid_break, floored at 0
--     - OT      : max(0, total_minutes - contracted_weekly * 60 * window_weeks)
--     - debt    : value - AVG(value) across the cohort
--
-- KNOWN GAP CARRIED FORWARD (audit F-05)
--   The cohort is "employees with a shift or a denied preference in the window",
--   matching the TS behaviour this replaces. Employees with ZERO shifts get no
--   row, so they are invisible to the solver's fairness terms and are excluded
--   from the team-average denominator. Fixing that is a one-line change here
--   (RIGHT JOIN the org's active employees), but it moves every team average, so
--   it is deliberately left to F-05 rather than smuggled into F-04.
--
-- CONTRACTED HOURS (audit F-15)
--   Hardcoded 38h/week, matching the TS `fetchContractedHours` stub this
--   replaces. Wiring `hr.user_contracts` is F-15 and belongs in one change that
--   updates both paths together.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recompute_fairness_ledger(
    p_org_id       uuid,
    p_as_of        date DEFAULT CURRENT_DATE,
    p_window_days  integer DEFAULT 91,
    p_department_id uuid DEFAULT NULL,
    p_jurisdiction text DEFAULT 'AU-NSW'
)
RETURNS integer          -- number of ledger rows written
LANGUAGE plpgsql
SECURITY DEFINER         -- runs from pg_cron with no auth.uid(); see grants below
SET search_path TO 'public'
AS $$
DECLARE
    v_window_start date := p_as_of - (p_window_days - 1);
    v_window_weeks numeric := p_window_days::numeric / 7;
    v_contracted_minutes numeric := 38 * 60 * (p_window_days::numeric / 7);
    v_rows integer := 0;
BEGIN
    -- Per-employee aggregates over the window, then debts against the cohort
    -- average, then one upsert. Single statement so a concurrent writer cannot
    -- observe a half-built window (audit F-20 covers the read-modify-write race
    -- on the incremental path, which is separate).
    WITH windowed AS (
        SELECT
            s.assigned_employee_id AS employee_id,
            -- Net paid minutes, cross-midnight aware, never negative.
            GREATEST(
                0,
                (CASE
                    WHEN s.end_time <= s.start_time
                        THEN EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60 + 1440
                        ELSE EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60
                 END) - COALESCE(s.unpaid_break_minutes, 0)
            ) AS net_minutes,
            (EXTRACT(DOW FROM s.shift_date) IN (0, 6)) AS is_weekend,
            -- Night = the shift window overlaps 00:00-06:00. Mirrors
            -- `isNightShift` / `_is_night`: start < 360, or a cross-midnight
            -- shift whose tail reaches past the next midnight.
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
            COUNT(*) FILTER (WHERE is_weekend)          AS weekend_shifts,
            COUNT(*) FILTER (WHERE is_night)            AS night_shifts,
            COUNT(*) FILTER (WHERE is_public_holiday)   AS public_holiday_shifts,
            SUM(net_minutes)                            AS total_minutes
        FROM windowed
        GROUP BY employee_id
    ),
    denied AS (
        -- A "denied preference" is a bid that lost. Same predicate as the TS
        -- `fetchDeniedPreferences`: rejected bids on in-window shifts.
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
        -- Employees with shifts OR denied preferences (see F-05 note above).
        SELECT
            COALESCE(pe.employee_id, d.employee_id) AS employee_id,
            COALESCE(pe.weekend_shifts, 0)::numeric        AS weekend_shifts,
            COALESCE(pe.night_shifts, 0)::numeric          AS night_shifts,
            COALESCE(pe.public_holiday_shifts, 0)::numeric AS public_holiday_shifts,
            GREATEST(0, COALESCE(pe.total_minutes, 0) - v_contracted_minutes) AS overtime_minutes,
            ROUND(COALESCE(pe.total_minutes, 0) / 60.0, 2) AS total_hours,
            COALESCE(d.denied_preferences, 0)              AS denied_preferences
        FROM per_employee pe
        FULL OUTER JOIN denied d ON d.employee_id = pe.employee_id
    ),
    -- Long-form so the debt maths is written once for all six metrics rather
    -- than six near-identical expressions.
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
        INSERT INTO public.fairness_ledger AS fl (
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
            window_start  = EXCLUDED.window_start,
            rolling_value = EXCLUDED.rolling_value,
            team_average  = EXCLUDED.team_average,
            debt          = EXCLUDED.debt,
            last_updated_at = now(),
            updated_by_run  = NULL
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_rows FROM written;

    RETURN v_rows;
END $$;

ALTER FUNCTION public.recompute_fairness_ledger(uuid, date, integer, uuid, text) OWNER TO postgres;

COMMENT ON FUNCTION public.recompute_fairness_ledger(uuid, date, integer, uuid, text) IS
    'Authoritative F1 fairness-ledger rebuild for one org over a rolling window. Replaces the browser-side recomputeLedger so there is one write implementation (audit F-04). Classification must stay in step with src/modules/rosters/domain/fairness-ledger.ts.';

-- ── Nightly sweep across every active org ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.recompute_all_fairness_ledgers()
RETURNS integer          -- total ledger rows written across all orgs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_org  record;
    v_rows integer := 0;
    v_total integer := 0;
BEGIN
    FOR v_org IN
        SELECT id FROM public.organizations WHERE COALESCE(is_active, true)
    LOOP
        BEGIN
            v_rows := public.recompute_fairness_ledger(v_org.id);
            v_total := v_total + v_rows;
        EXCEPTION WHEN OTHERS THEN
            -- One bad org must not abort the sweep for every other org.
            -- pg_cron discards return values, so log rather than re-raise.
            RAISE WARNING 'recompute_fairness_ledger failed for org %: %',
                v_org.id, SQLERRM;
        END;
    END LOOP;

    RETURN v_total;
END $$;

ALTER FUNCTION public.recompute_all_fairness_ledgers() OWNER TO postgres;

COMMENT ON FUNCTION public.recompute_all_fairness_ledgers() IS
    'pg_cron entry point: rebuilds the fairness ledger for every active organization. Per-org failures are logged and skipped so one bad org cannot stall the sweep.';

-- Both functions are SECURITY DEFINER because pg_cron runs them with no
-- auth.uid(), so RLS on shifts/shift_bids/fairness_ledger would otherwise
-- return nothing. They take an explicit org and expose no caller-controlled
-- read, but they must NOT be callable by end users — the client reaches the
-- per-org rebuild through recompute_fairness_ledger only, gated below.
REVOKE ALL ON FUNCTION public.recompute_fairness_ledger(uuid, date, integer, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_fairness_ledger(uuid, date, integer, uuid, text) FROM anon;
-- Supabase's default privileges grant EXECUTE on new public-schema functions
-- DIRECTLY to `authenticated` — so revoking PUBLIC and anon is NOT enough. This
-- was caught by get_advisors after the production apply: without it, any signed-
-- in user could rebuild ANY organization's ledger by passing its uuid, bypassing
-- the gate below entirely. The known gotcha has two edges, not one.
REVOKE ALL ON FUNCTION public.recompute_fairness_ledger(uuid, date, integer, uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.recompute_all_fairness_ledgers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_all_fairness_ledgers() FROM anon;
REVOKE ALL ON FUNCTION public.recompute_all_fairness_ledgers() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_fairness_ledger(uuid, date, integer, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_all_fairness_ledgers() TO service_role;

-- The client-callable rebuild is a SECURITY INVOKER gate that checks the caller
-- actually manages the org before delegating. Without this an authenticated user
-- could rebuild any org's ledger by passing its uuid.
CREATE OR REPLACE FUNCTION public.request_fairness_ledger_recompute(
    p_org_id uuid,
    p_as_of  date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE plpgsql
-- SECURITY DEFINER, deliberately: `authenticated` may not call the privileged
-- recompute directly (see the REVOKE above), so this gate is their only path
-- and must be able to reach it. It authorises FIRST, and auth.uid() reads the
-- JWT claim from the session, which SECURITY DEFINER does not change.
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_rows integer;
BEGIN
    -- A definer function with no auth.uid() would otherwise fall through to the
    -- predicate below with a NULL subject.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;

    -- Mirrors the fairness_ledger_org_scoped RLS predicate: legacy admins
    -- cross-org, otherwise an active gamma+ certificate for THIS org.
    IF NOT (
        EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = auth.uid()
                   AND p.legacy_system_role = 'admin'::public.system_role)
        OR EXISTS (SELECT 1 FROM public.app_access_certificates c
                    WHERE c.user_id = auth.uid()
                      AND c.is_active = true
                      AND c.organization_id = p_org_id
                      AND c.access_level = ANY (
                            ARRAY['gamma','delta','epsilon','zeta']::public.access_level[]))
    ) THEN
        RAISE EXCEPTION 'not authorised to recompute the fairness ledger for this organization'
            USING ERRCODE = '42501';
    END IF;

    SELECT public.recompute_fairness_ledger(p_org_id, p_as_of) INTO v_rows;
    RETURN v_rows;
END $$;

ALTER FUNCTION public.request_fairness_ledger_recompute(uuid, date) OWNER TO postgres;

COMMENT ON FUNCTION public.request_fairness_ledger_recompute(uuid, date) IS
    'Client-callable fairness-ledger rebuild. SECURITY DEFINER: authorises the caller against the same predicate as fairness_ledger_org_scoped (and rejects an absent auth.uid()) BEFORE delegating to the privileged recompute, which authenticated may not call directly.';

REVOKE ALL ON FUNCTION public.request_fairness_ledger_recompute(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_fairness_ledger_recompute(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_fairness_ledger_recompute(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_fairness_ledger_recompute(uuid, date) TO service_role;

-- ── Schedule (guarded, mirroring nightly_leave_accrual / dead_shift_cleanup) ──
--
-- 16:00 UTC ~= 02:00 AEST / 03:00 AEDT the next day — off-peak for a Sydney
-- venue. NOTE: pg_cron evaluates schedules in the DATABASE timezone. Supabase
-- projects default to UTC; if `SHOW timezone;` reports otherwise, adjust this
-- entry. The exact hour is not load-bearing — running once a day is.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('nightly_fairness_recompute')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nightly_fairness_recompute');

    PERFORM cron.schedule(
        'nightly_fairness_recompute',
        '0 16 * * *',
        'SELECT public.recompute_all_fairness_ledgers()'
    );
  ELSE
    RAISE WARNING 'pg_cron not installed — nightly_fairness_recompute NOT scheduled. The fairness ledger will only refresh on publish/commit.';
  END IF;
END $$;
