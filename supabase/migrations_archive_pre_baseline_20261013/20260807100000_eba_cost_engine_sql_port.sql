-- Migration: 20260807100000_eba_cost_engine_sql_port.sql
-- Description: Ports the TypeScript EBA cost engine's award rules into SQL so the
--              Roster Planner footer's Scheduled / Actual totals carry the same
--              penalties, overtime, night allowance and minimum-engagement floor
--              the per-shift cards show — instead of a flat rate x hours.
--
-- SOURCE OF TRUTH
-- ---------------
-- `src/modules/rosters/domain/projections/utils/cost/standard.ts`. Every rule
-- below names the clause and mirrors that file's arithmetic. The TS engine stays
-- authoritative for a SINGLE shift (it is what the cards render); this port
-- exists because the footer must aggregate over a whole view, and in Bucket View
-- the client deliberately fetches NO raw shifts (the millions-of-shifts design),
-- so the total can only be computed server-side.
--
-- PORTED (cl / Schedule references as in standard.ts)
--   cl 41    weekend + public-holiday penalty loadings (Sat +25%, Sun +50%, PH +150%)
--   cl 41.4  loadings NOT cumulative — night allowance pays only its EXCESS over
--            the day's weekend/PH loading
--   cl 42    daily overtime (beyond rostered hours for FT/PT, beyond the 12h cap
--            for everyone), tiered 1.5x for the first 3h then 2.0x, with a 2.5x
--            floor on public-holiday overtime
--   cl 43    night-shift allowance over the 22:00-06:00 window, keyed off the day
--            the shift CONCLUDES, casual rates de-loaded so the 25% is not paid twice
--   cl 12/56 minimum-payment floor (PT/flexi/casual; 4h on Sunday/PH, 2h training)
--   overnight midnight split so each calendar day is priced on its own day-of-week
--            and public-holiday status
--   casual 25% loading — the PAID rate is de-loaded internally (base/1.25) exactly
--            as standard.ts does, rather than reading eba_rate.ordinary_hourly_rate
--            (34.64/1.25 = 27.712 vs the stored 27.71; the difference drifts cents)
--
-- DELIBERATELY NOT PORTED — these keep the footer an ESTIMATE, and each is a
-- conscious omission rather than an oversight:
--   * Weekly (>38h) overtime. Needs each member's prior ordinary hours for the ISO
--     week; an UNASSIGNED shift has no member to accumulate against. The TS engine
--     also defaults this OFF when `priorOrdinaryHoursThisWeek` is not supplied, so
--     both sides agree.
--   * The OPT-IN allowances (first-aid / protein-spill / split-shift, cl 28.2-28.4).
--     These are per-shift flags nothing sets today. The cl 28.1 meal allowance is
--     NOT in this list — it triggers automatically off overtime and IS ported.
--   * The Security engine (Schedule 3) and the trainee / apprentice / SWS rate
--     matrices (Schedules 4-6). These re-derive the BASE rate, not the loadings.
--   * Leave-flagged shifts (cl 44.7 / NES) and higher duties (cl 29).
-- A shift hitting any of these is priced on its ordinary classification here and
-- may differ from its card. Ordinary/weekend/PH/night/OT shifts — everything the
-- roster actually contains today — agree to the cent.

-- ── cl 41: weekend / public-holiday loading over the DE-LOADED ordinary rate ──
CREATE OR REPLACE FUNCTION public.fn_eba_penalty_loading(p_dow int, p_is_holiday boolean)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog','public' AS $$
    SELECT CASE
        WHEN p_is_holiday THEN 1.5   -- public holiday: 250% vs 100% ordinary
        WHEN p_dow = 6    THEN 0.25  -- Saturday 125%
        WHEN p_dow = 0    THEN 0.5   -- Sunday   150%
        ELSE 0                       -- Mon-Fri ordinary
    END;
$$;

-- ── cl 43.1 / 43.2: night allowance, keyed off the CONCLUSION day ─────────────
-- Casual rates (43.2) INCLUDE the 25% casual loading; the caller subtracts it.
CREATE OR REPLACE FUNCTION public.fn_eba_night_multiplier(p_conclusion_dow int, p_is_casual boolean)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog','public' AS $$
    SELECT CASE WHEN p_is_casual THEN
        CASE WHEN p_conclusion_dow BETWEEN 1 AND 4 THEN 0.45
             WHEN p_conclusion_dow = 5             THEN 0.50
             ELSE 0.75 END
    ELSE
        CASE WHEN p_conclusion_dow BETWEEN 1 AND 4 THEN 0.20
             WHEN p_conclusion_dow = 5             THEN 0.25
             ELSE 0.50 END
    END;
$$;

-- ── Minutes of [p_from, p_to) inside the 22:00-06:00 night window ─────────────
-- Mirrors fastNightMinutes() in award-context.ts, including the next-day windows
-- an overnight span reaches.
CREATE OR REPLACE FUNCTION public.fn_eba_night_minutes(p_from int, p_to int)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog','public' AS $$
    SELECT GREATEST(0, LEAST(p_to, 360)  - GREATEST(p_from, 0))     -- 00:00-06:00
         + GREATEST(0, LEAST(p_to, 1440) - GREATEST(p_from, 1320))  -- 22:00-24:00
         + GREATEST(0, LEAST(p_to, 1800) - GREATEST(p_from, 1440))  -- next 00:00-06:00
         + GREATEST(0, LEAST(p_to, 2880) - GREATEST(p_from, 2760)); -- next 22:00-24:00
$$;

-- ── cl 12.3(e)/12.4(c)/12.5(c)/56.2: minimum PAID engagement ──────────────────
-- Mirrors resolvePaymentMinEngagementMinutes(). NULL = no floor (full-time are
-- weekly-salaried). cl 56.2's 4h public-holiday minimum is UNCONDITIONAL; the
-- Sunday 4h is employment-type-scoped and excludes plain (non-flexible) PT.
CREATE OR REPLACE FUNCTION public.fn_eba_min_engagement_minutes(
    p_employment_type text, p_requires_flexible boolean,
    p_is_training boolean, p_is_sunday boolean, p_is_public_holiday boolean)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog','public' AS $$
    SELECT CASE
        WHEN p_employment_type = 'FT'        THEN NULL
        WHEN COALESCE(p_is_training, false)  THEN 120
        WHEN p_is_public_holiday             THEN 240
        WHEN p_is_sunday AND NOT (p_employment_type = 'PT'
                                  AND NOT COALESCE(p_requires_flexible, false)) THEN 240
        ELSE 180
    END;
$$;


-- ── The engine ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_eba_estimate_shift_cost(date, time, int, int, numeric, text, boolean, boolean);

CREATE OR REPLACE FUNCTION public.fn_eba_estimate_shift_cost(
    p_shift_date         date,
    p_start_time         time,
    p_net_minutes        int,
    p_scheduled_minutes  int,
    p_base_rate          numeric,   -- the PAID rate (casual rate already loaded)
    p_employment_type    text,      -- 'FT' | 'PT' | 'Casual'
    p_requires_flexible  boolean DEFAULT false,
    p_is_training        boolean DEFAULT false
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog','public'
AS $$
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

    RETURN ROUND(v_ord_cost + v_night_cost + v_ot_cost + v_allow_cost, 2);
END;
$$;

ALTER FUNCTION public.fn_eba_penalty_loading(int, boolean)                       OWNER TO postgres;
ALTER FUNCTION public.fn_eba_night_multiplier(int, boolean)                      OWNER TO postgres;
ALTER FUNCTION public.fn_eba_night_minutes(int, int)                             OWNER TO postgres;
ALTER FUNCTION public.fn_eba_min_engagement_minutes(text, boolean, boolean, boolean, boolean) OWNER TO postgres;
ALTER FUNCTION public.fn_eba_estimate_shift_cost(date, time, int, int, numeric, text, boolean, boolean) OWNER TO postgres;

COMMENT ON FUNCTION public.fn_eba_estimate_shift_cost(date, time, int, int, numeric, text, boolean, boolean) IS
    'SQL port of the TypeScript EBA cost engine (utils/cost/standard.ts) for roster aggregate totals. p_base_rate is the PAID rate (casual already loaded); it is de-loaded internally exactly as the TS engine does. Applies cl 41 weekend/PH penalties, cl 41.4 non-cumulative loadings, cl 42 tiered overtime with the PH floor, cl 43 night allowance, cl 28.1 meal allowance, the cl 12/56.2 minimum engagement, and the overnight midnight split.';
