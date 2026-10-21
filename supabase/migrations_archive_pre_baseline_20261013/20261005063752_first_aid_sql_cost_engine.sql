-- ─────────────────────────────────────────────────────────────────────────────
-- APPLIED TO PROD 2026-10-05 via the Supabase MCP (ledger version
-- 20261005063752, name first_aid_sql_cost_engine). Do not re-run against
-- production. Rollback-only dry-run beforehand: first-aid deltas exact to the
-- cent against standard.ts (7h casual $4.13; 1h floored to 3h $1.77; 8 ord +
-- 2 OT $4.72; FY25/26 rate $4.48), 8-arg calls still resolve, and a 7.6h FT
-- appointee shift moved $273.07 -> $277.55 identically in fn_eba_shift_cost
-- and get_roster_planner_stats.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- cl 28.2 first aid in the SQL cost engine — parity with standard.ts.
--
-- 20261005060327 gave first aid a real data source (`first_aid_appointments`,
-- surfaced per row as the computed field `shifts.is_first_aid_duty`) and both
-- TS engines price it. The SQL port (20260807100000) did not, so the Roster
-- Planner footer and every insights cost figure sat $0.56–0.59/h below the
-- cards for an appointee's shifts.
--
--   * fn_eba_estimate_shift_cost gains `p_first_aid boolean DEFAULT false`,
--     priced as the effective-dated `eba_allowance.first_aid_per_hour` rate on
--     PAID ordinary hours — after the cl 12/56.2 floor, overtime excluded —
--     exactly as standard.ts does (audit fix L-1). Adding a defaulted parameter
--     via CREATE OR REPLACE would leave the 8-arg overload in place and make
--     every 8-arg call ambiguous, so the old signature is dropped first. Its
--     two callers are non-atomic SQL bodies that resolve the name at run time.
--   * fn_eba_shift_cost(shifts) — the row wrapper behind rpc_shift_coverage_stats
--     and the insights family — passes the row's computed flag.
--   * get_roster_planner_stats passes it for both scheduled and actual cost.
--
-- The SQL engine still has no Schedule 3 security branch (a documented,
-- pre-existing omission), so annualised FT security is not special-cased here.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION public.fn_eba_estimate_shift_cost(date, time without time zone, integer, integer, numeric, text, boolean, boolean);

CREATE FUNCTION public.fn_eba_estimate_shift_cost(
    p_shift_date date,
    p_start_time time without time zone,
    p_net_minutes integer,
    p_scheduled_minutes integer,
    p_base_rate numeric,
    p_employment_type text,
    p_requires_flexible boolean DEFAULT false,
    p_is_training boolean DEFAULT false,
    p_first_aid boolean DEFAULT false)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_is_casual   boolean := (p_employment_type = 'Casual');
    v_base_mult   numeric := CASE WHEN p_employment_type = 'Casual' THEN 1.25 ELSE 1.0 END;
    v_ord_rate    numeric;
    v_net_h       numeric;
    v_sched_h     numeric;
    v_ot_h        numeric;
    v_ord_h       numeric;
    v_start_mins  int;
    v_ord_end     numeric;
    v_ot_end      numeric;
    v_dow         int;
    v_next_dow    int;
    v_is_ph       boolean;
    v_next_is_ph  boolean;
    v_conclusion  int;
    v_night_over  numeric;
    v_ord_cost    numeric := 0;
    v_night_cost  numeric := 0;
    v_ot_cost     numeric := 0;
    v_allow_cost  numeric := 0;
    v_seg_from    numeric;
    v_seg_to      numeric;
    v_seg_dow     int;
    v_seg_ph      boolean;
    v_seg_h       numeric;
    v_seg_pen     numeric;
    v_seg_night_h numeric;
    v_start_pen_rate numeric;
    v_floor_mins  int;
    v_floor_h     numeric;
    v_paid_ord_h  numeric;
    v_cum         numeric := 0;
    v_seg_ot_h    numeric;
    v_tiered      numeric;
    v_meal_trig   numeric;
    i             int;
BEGIN
    IF p_base_rate IS NULL OR p_net_minutes IS NULL OR p_net_minutes <= 0 THEN
        RETURN 0;
    END IF;

    -- De-load exactly as standard.ts does: ordinaryRate = isCasual ? base/1.25 : base.
    v_ord_rate := CASE WHEN v_is_casual THEN p_base_rate / 1.25 ELSE p_base_rate END;

    v_net_h   := p_net_minutes / 60.0;
    v_sched_h := COALESCE(p_scheduled_minutes, 0) / 60.0;

    -- cl 42 daily overtime, computed BEFORE ordinary so the two never overlap.
    IF NOT v_is_casual AND v_sched_h > 0 THEN
        v_ot_h := GREATEST(0, v_net_h - v_sched_h, v_net_h - 12);
    ELSE
        v_ot_h := GREATEST(0, v_net_h - 12);
    END IF;
    v_ord_h := GREATEST(0, v_net_h - v_ot_h);

    v_start_mins := COALESCE(EXTRACT(HOUR FROM p_start_time)::int * 60
                           + EXTRACT(MINUTE FROM p_start_time)::int, 0);
    v_ord_end := v_start_mins + v_ord_h * 60;
    v_ot_end  := v_ord_end + v_ot_h * 60;

    v_dow      := EXTRACT(DOW FROM p_shift_date)::int;
    v_next_dow := (v_dow + 1) % 7;
    v_is_ph      := EXISTS (SELECT 1 FROM public.public_holidays h
                             WHERE h.holiday_date = p_shift_date AND h.jurisdiction = 'AU-NSW');
    v_next_is_ph := EXISTS (SELECT 1 FROM public.public_holidays h
                             WHERE h.holiday_date = p_shift_date + 1 AND h.jurisdiction = 'AU-NSW');

    -- cl 43: one night rate for the whole shift, from the day it CONCLUDES.
    v_conclusion := CASE WHEN v_ord_end > 1440 OR v_ot_end > 1440 THEN v_next_dow ELSE v_dow END;
    v_night_over := public.fn_eba_night_multiplier(v_conclusion, v_is_casual)
                    - CASE WHEN v_is_casual THEN 0.25 ELSE 0 END;

    -- Ordinary span, split at midnight so each calendar day is priced on its own
    -- day-of-week + public-holiday status (at most two segments: the cap is 12h).
    FOR i IN 1..2 LOOP
        IF i = 1 THEN
            v_seg_from := v_start_mins;
            v_seg_to   := LEAST(v_ord_end, 1440);
            v_seg_dow  := v_dow;   v_seg_ph := v_is_ph;
        ELSE
            CONTINUE WHEN v_ord_end <= 1440;
            v_seg_from := 1440;
            v_seg_to   := v_ord_end;
            v_seg_dow  := v_next_dow; v_seg_ph := v_next_is_ph;
        END IF;
        CONTINUE WHEN v_seg_to <= v_seg_from;

        v_seg_h   := (v_seg_to - v_seg_from) / 60.0;
        v_seg_pen := public.fn_eba_penalty_loading(v_seg_dow, v_seg_ph);
        v_ord_cost := v_ord_cost + v_seg_h * v_ord_rate * (v_base_mult + v_seg_pen);

        -- cl 41.4: only the night loading's EXCESS over the day's penalty is payable.
        v_seg_night_h := public.fn_eba_night_minutes(FLOOR(v_seg_from)::int, CEIL(v_seg_to)::int) / 60.0;
        IF v_seg_night_h > 0 THEN
            v_night_cost := v_night_cost
                + v_seg_night_h * v_ord_rate * GREATEST(0, v_night_over - v_seg_pen);
        END IF;
    END LOOP;

    -- Engagement-day rate: prices minimum-payment top-up hours (paid, not worked).
    v_start_pen_rate := v_ord_rate * (v_base_mult + public.fn_eba_penalty_loading(v_dow, v_is_ph));

    -- cl 12 / 56.2 minimum PAID engagement.
    v_paid_ord_h := v_ord_h;
    v_floor_mins := public.fn_eba_min_engagement_minutes(
        p_employment_type, p_requires_flexible, p_is_training, v_dow = 0, v_is_ph);
    IF v_floor_mins IS NOT NULL THEN
        v_floor_h := v_floor_mins / 60.0;
        IF v_paid_ord_h < v_floor_h THEN
            v_ord_cost   := v_ord_cost + (v_floor_h - v_paid_ord_h) * v_start_pen_rate;
            v_paid_ord_h := v_floor_h;
        END IF;
    END IF;

    -- cl 42 overtime: 1.5x for the first 3h of the run, 2.0x after, with a 2.5x
    -- floor on public-holiday hours. Split at midnight so only hours actually ON a
    -- holiday get the PH floor, while the 1.5/2.0 tiering stays cumulative.
    IF v_ot_h > 0 THEN
        FOR i IN 1..2 LOOP
            IF i = 1 THEN
                v_seg_ot_h := (LEAST(v_ot_end, 1440) - v_ord_end) / 60.0;
                v_seg_ph   := v_is_ph;
            ELSE
                CONTINUE WHEN v_ot_end <= 1440;
                v_seg_ot_h := (v_ot_end - GREATEST(v_ord_end, 1440)) / 60.0;
                v_seg_ph   := v_next_is_ph;
            END IF;
            CONTINUE WHEN v_seg_ot_h <= 0;

            v_tiered := GREATEST(0, LEAST(v_cum + v_seg_ot_h, 3) - LEAST(v_cum, 3)) * 1.5
                      + GREATEST(0, (v_cum + v_seg_ot_h) - GREATEST(v_cum, 3)) * 2.0;

            v_ot_cost := v_ot_cost + v_ord_rate
                * CASE WHEN v_seg_ph THEN GREATEST(v_tiered, v_seg_ot_h * 2.5) ELSE v_tiered END;
            v_cum := v_cum + v_seg_ot_h;
        END LOOP;
    END IF;

    -- cl 28.1 meal allowance. AUTOMATIC (not opt-in) once 2h+ is worked past the
    -- rostered finish. The trigger is about hours past the ROSTERED FINISH, not how
    -- they are paid, so a casual under the 12h cap still qualifies (audit fix M-5).
    v_meal_trig := CASE WHEN v_sched_h > 0
                        THEN GREATEST(v_ot_h, v_net_h - v_sched_h)
                        ELSE v_ot_h END;
    IF v_meal_trig >= 2.0 THEN
        v_allow_cost := v_allow_cost + COALESCE((
            SELECT a.amount FROM public.eba_allowance a
             WHERE a.code = 'meal' AND a.effective_from <= p_shift_date
             ORDER BY a.effective_from DESC LIMIT 1), 0);
    END IF;

    -- cl 28.2 first aid: "paid for ordinary hours". Priced on PAID ordinary hours
    -- (post-floor, overtime excluded), the same basis as standard.ts.
    IF p_first_aid THEN
        v_allow_cost := v_allow_cost + v_paid_ord_h * COALESCE((
            SELECT a.amount FROM public.eba_allowance a
             WHERE a.code = 'first_aid_per_hour' AND a.effective_from <= p_shift_date
             ORDER BY a.effective_from DESC LIMIT 1), 0);
    END IF;

    RETURN ROUND(v_ord_cost + v_night_cost + v_ot_cost + v_allow_cost, 2);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_eba_shift_cost(s shifts)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT public.fn_eba_estimate_shift_cost(
        s.shift_date,
        s.start_time,
        s.net_length_minutes,
        s.scheduled_length_minutes,
        public.fn_eba_resolve_shift_rate(
            s.remuneration_level, s.target_employment_type, s.shift_date,
            s.actual_hourly_rate, s.remuneration_rate),
        s.target_employment_type,
        COALESCE(s.target_requires_flexible, false),
        COALESCE(s.is_training, false),
        COALESCE(s.is_first_aid_duty, false)
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_roster_planner_stats(p_organization_id uuid, p_start_date date, p_end_date date, p_department_ids uuid[] DEFAULT NULL::uuid[], p_sub_department_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(total_shifts integer, assigned_shifts integer, open_shifts integer, published_shifts integer, cancelled_shifts integer, total_net_minutes bigint, unique_employees integer, est_cost numeric, budget_cost numeric, scheduled_cost numeric, actual_cost numeric, actual_net_minutes bigint, costed_shifts integer, uncosted_shifts integer, actual_shifts integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH scoped AS (
      SELECT
          s.*,
          -- cl 28.2: computed field, not a column — `s.*` does not include it.
          COALESCE(s.is_first_aid_duty, false) AS first_aid_duty,
          COALESCE(
              s.actual_hourly_rate,
              s.remuneration_rate,
              (
                  SELECT er.paid_hourly_rate
                    FROM public.eba_rate er
                   WHERE er.classification = 'LEVEL_' || s.remuneration_level::text
                     AND er.employment_basis = CASE
                             WHEN s.target_employment_type = 'Casual' THEN 'casual'
                             ELSE 'permanent'
                         END
                     AND er.effective_from <= s.shift_date
                   ORDER BY er.effective_from DESC
                   LIMIT 1
              )
          ) AS resolved_rate,
          CASE
              WHEN ts.start_time IS NOT NULL AND ts.end_time IS NOT NULL THEN
                  GREATEST(0, (EXTRACT(EPOCH FROM (
                      (s.shift_date + ts.end_time)
                        + CASE WHEN ts.end_time <= ts.start_time
                               THEN INTERVAL '1 day' ELSE INTERVAL '0' END
                        - (s.shift_date + ts.start_time)
                  )) / 60)::int - COALESCE(s.unpaid_break_minutes, 0))
              WHEN s.actual_start IS NOT NULL AND s.actual_end IS NOT NULL THEN
                  GREATEST(0, (EXTRACT(EPOCH FROM (s.actual_end - s.actual_start)) / 60)::int
                              - COALESCE(s.unpaid_break_minutes, 0))
              ELSE NULL
          END AS worked_minutes
      FROM public.shifts s
      LEFT JOIN LATERAL (
          SELECT t.start_time, t.end_time
            FROM public.timesheets t
           WHERE t.shift_id = s.id
           ORDER BY t.start_time NULLS LAST
           LIMIT 1
      ) ts ON TRUE
      WHERE s.organization_id = p_organization_id
        AND s.shift_date BETWEEN p_start_date AND p_end_date
        AND s.deleted_at IS NULL
        AND (p_department_ids IS NULL OR s.department_id = ANY(p_department_ids))
        AND (p_sub_department_ids IS NULL OR s.sub_department_id = ANY(p_sub_department_ids))
  ),
  priced AS (
      SELECT
          scoped.*,
          -- Full award pricing: cl 41 penalties, cl 41.4 non-cumulative loadings,
          -- cl 42 tiered overtime + PH floor, cl 43 night allowance, cl 28.1 meal,
          -- cl 28.2 first aid, cl 12/56.2 minimum engagement, overnight midnight split.
          public.fn_eba_estimate_shift_cost(
              shift_date, start_time, net_length_minutes, scheduled_length_minutes,
              resolved_rate, target_employment_type,
              COALESCE(target_requires_flexible, false), COALESCE(is_training, false),
              first_aid_duty
          ) AS sched_shift_cost,
          CASE WHEN worked_minutes IS NULL THEN NULL ELSE
              public.fn_eba_estimate_shift_cost(
                  shift_date, start_time, worked_minutes, scheduled_length_minutes,
                  resolved_rate, target_employment_type,
                  COALESCE(target_requires_flexible, false), COALESCE(is_training, false),
                  first_aid_duty
              )
          END AS actual_shift_cost
      FROM scoped
  )
  SELECT
      COUNT(*) FILTER (WHERE NOT is_cancelled)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND assigned_employee_id IS NOT NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND assigned_employee_id IS NULL)::int,
      COUNT(*) FILTER (WHERE lifecycle_status IN ('Published','InProgress','Completed'))::int,
      COUNT(*) FILTER (WHERE is_cancelled)::int,
      COALESCE(SUM(net_length_minutes) FILTER (WHERE NOT is_cancelled), 0)::bigint,
      COUNT(DISTINCT assigned_employee_id) FILTER (WHERE NOT is_cancelled)::int,
      COALESCE(SUM(sched_shift_cost) FILTER (WHERE NOT is_cancelled), 0)::numeric,
      (
        SELECT COALESCE(SUM(
          db.budgeted_cost
          * ( (LEAST(db.period_end, p_end_date) - GREATEST(db.period_start, p_start_date) + 1)::numeric
              / NULLIF((db.period_end - db.period_start + 1), 0) )
        ), 0)::numeric
        FROM public.department_budgets db
        JOIN public.departments d ON d.id = db.dept_id AND d.organization_id = p_organization_id
        WHERE db.period_start <= p_end_date AND db.period_end >= p_start_date
          AND (p_department_ids IS NULL OR db.dept_id = ANY(p_department_ids))
      ),
      COALESCE(SUM(sched_shift_cost) FILTER (WHERE NOT is_cancelled), 0)::numeric,
      COALESCE(SUM(actual_shift_cost) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL), 0)::numeric,
      COALESCE(SUM(worked_minutes) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL), 0)::bigint,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND resolved_rate IS NOT NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND resolved_rate IS NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL)::int
  FROM priced;
$function$;

-- The engine is a pure calculator; only signed-in callers (and the definer
-- functions that wrap it) need it. The dropped version was executable by
-- PUBLIC and anon for no reason; do not carry that forward.
REVOKE ALL ON FUNCTION public.fn_eba_estimate_shift_cost(date, time without time zone, integer, integer, numeric, text, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_eba_estimate_shift_cost(date, time without time zone, integer, integer, numeric, text, boolean, boolean, boolean) TO authenticated, service_role;
