-- ============================================================================
-- SQL pay engine prices the hours WORKED around the rostered meal break.
--
-- Phase 2 of the shift-break-window plan (see 20261025102855_shift_break_window).
--
-- WHY: cl 43 pays the night rate on ordinary hours WORKED 22:00–06:00, and
-- cl 41 pays the weekend / public-holiday loading on hours worked ON that day.
-- fn_eba_estimate_shift_cost laid every worked minute from start_time and put
-- the unpaid break at the END, so Thu 14:00–22:30 with the break at 18:00
-- priced 0 night hours instead of 0.5. A team member could also move their
-- break to change their pay without the estimate noticing.
--
-- WHAT:
--   * fn_eba_estimate_shift_cost gains p_break_start time DEFAULT NULL and
--     p_unpaid_break_minutes int DEFAULT 0. Worked minutes are laid ordinary
--     first, then overtime (cl 42), skipping the break, and each span is split
--     at midnight. This mirrors layWorkedMinutes() in
--     src/modules/rosters/domain/projections/utils/cost/standard.ts exactly.
--   * With no break (the defaults) the layout is the legacy one, so any caller
--     that doesn't pass the window prices exactly as before.
--   * internal.shift_cost passes s.break_start / s.unpaid_break_minutes.
--     The annualised-security path is unchanged (Sch 3: paid meal break, the
--     full span is priced, so placement cannot change pay).
--
-- Adding parameters changes the signature: DROP + CREATE, grants re-issued
-- exactly as they were (authenticated, service_role; not anon / PUBLIC).
-- internal.shift_cost is the only SQL caller (plpgsql: no hard dependency).
-- ============================================================================

BEGIN;

DROP FUNCTION public.fn_eba_estimate_shift_cost(date, time without time zone, integer, integer, numeric, text, boolean, boolean, boolean, boolean);

CREATE FUNCTION public.fn_eba_estimate_shift_cost(
    p_shift_date date,
    p_start_time time without time zone,
    p_net_minutes integer,
    p_scheduled_minutes integer,
    p_base_rate numeric,
    p_employment_type text,
    p_requires_flexible boolean DEFAULT false,
    p_is_training boolean DEFAULT false,
    p_first_aid boolean DEFAULT false,
    p_higher_duties boolean DEFAULT false,
    p_break_start time without time zone DEFAULT NULL,
    p_unpaid_break_minutes integer DEFAULT 0)
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
    v_hole        int;
    v_before      numeric;
    v_ord_m       numeric;
    v_ot_m        numeric;
    v_ord_from    numeric[] := '{}';
    v_ord_to      numeric[] := '{}';
    v_otf         numeric[] := '{}';
    v_ott         numeric[] := '{}';
    v_end         numeric;
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
    j             int;
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

    -- Where the worked minutes fall on the clock (layWorkedMinutes in standard.ts).
    -- The unpaid break is a hole `v_before` worked minutes after the start,
    -- resolved across midnight; no break ⇒ no hole ⇒ the legacy single span.
    v_hole := CASE WHEN p_break_start IS NOT NULL AND p_start_time IS NOT NULL
                        AND COALESCE(p_unpaid_break_minutes, 0) > 0
                   THEN p_unpaid_break_minutes ELSE 0 END;
    v_before := CASE WHEN v_hole > 0
                     THEN ((EXTRACT(HOUR FROM p_break_start)::int * 60
                            + EXTRACT(MINUTE FROM p_break_start)::int
                            - v_start_mins + 1440) % 1440)
                     ELSE 'Infinity'::numeric END;
    v_ord_m := v_ord_h * 60;
    v_ot_m  := v_ot_h * 60;

    -- Ordinary: work [0, ord_m).
    IF 0 < v_before THEN
        v_ord_from := v_ord_from || (v_start_mins + 0::numeric);
        v_ord_to   := v_ord_to   || (v_start_mins + LEAST(v_ord_m, v_before));
    END IF;
    IF v_ord_m > v_before THEN
        v_ord_from := v_ord_from || (v_start_mins + v_before + v_hole);
        v_ord_to   := v_ord_to   || (v_start_mins + v_ord_m + v_hole);
    END IF;
    -- Overtime: work [ord_m, ord_m + ot_m).
    IF v_ord_m < v_before THEN
        v_otf := v_otf || (v_start_mins + v_ord_m);
        v_ott := v_ott || (v_start_mins + LEAST(v_ord_m + v_ot_m, v_before));
    END IF;
    IF v_ord_m + v_ot_m > v_before THEN
        v_otf := v_otf || (v_start_mins + GREATEST(v_ord_m, v_before) + v_hole);
        v_ott := v_ott || (v_start_mins + v_ord_m + v_ot_m + v_hole);
    END IF;

    -- Where the worked time ends, overtime tail included.
    v_end := v_start_mins;
    FOR i IN 1..COALESCE(array_length(v_ord_to, 1), 0) LOOP
        IF v_ord_to[i] > v_ord_from[i] THEN v_end := GREATEST(v_end, v_ord_to[i]); END IF;
    END LOOP;
    FOR i IN 1..COALESCE(array_length(v_ott, 1), 0) LOOP
        IF v_ott[i] > v_otf[i] THEN v_end := GREATEST(v_end, v_ott[i]); END IF;
    END LOOP;

    v_dow      := EXTRACT(DOW FROM p_shift_date)::int;
    v_next_dow := (v_dow + 1) % 7;
    v_is_ph      := EXISTS (SELECT 1 FROM public.public_holidays h
                             WHERE h.holiday_date = p_shift_date AND h.jurisdiction = 'AU-NSW');
    v_next_is_ph := EXISTS (SELECT 1 FROM public.public_holidays h
                             WHERE h.holiday_date = p_shift_date + 1 AND h.jurisdiction = 'AU-NSW');

    -- cl 43: one night rate for the whole shift, from the day it CONCLUDES.
    v_conclusion := CASE WHEN v_end > 1440 THEN v_next_dow ELSE v_dow END;
    v_night_over := public.fn_eba_night_multiplier(v_conclusion, v_is_casual)
                    - CASE WHEN v_is_casual THEN 0.25 ELSE 0 END;

    -- Each ordinary span, split at midnight so each calendar day is priced on
    -- its own day-of-week + public-holiday status. A span can begin after
    -- midnight (the half resuming after a break taken across 00:00).
    FOR i IN 1..COALESCE(array_length(v_ord_to, 1), 0) LOOP
        FOR j IN 1..2 LOOP
            IF j = 1 THEN
                v_seg_from := v_ord_from[i];
                v_seg_to   := LEAST(v_ord_to[i], 1440);
                v_seg_dow  := v_dow;      v_seg_ph := v_is_ph;
            ELSE
                v_seg_from := GREATEST(v_ord_from[i], 1440);
                v_seg_to   := v_ord_to[i];
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

    -- cl 29.1(a) higher-duties minimum: a shift paid at a higher level for under
    -- 4 paid hours is topped up to 4 at the engagement-day rate (standard.ts).
    IF p_higher_duties AND v_net_h > 0 AND v_paid_ord_h < 4 THEN
        v_ord_cost   := v_ord_cost + (4 - v_paid_ord_h) * v_start_pen_rate;
        v_paid_ord_h := 4;
    END IF;

    -- cl 42 overtime: 1.5x for the first 3h of the run, 2.0x after, with a 2.5x
    -- floor on public-holiday hours. Each OT span (two when the break falls in
    -- the overtime) is split at midnight, in order, so only hours actually ON a
    -- holiday get the PH floor while the 1.5/2.0 tiering stays cumulative.
    IF v_ot_h > 0 THEN
        FOR i IN 1..COALESCE(array_length(v_ott, 1), 0) LOOP
            FOR j IN 1..2 LOOP
                IF j = 1 THEN
                    v_seg_ot_h := GREATEST(0, LEAST(v_ott[i], 1440) - v_otf[i]) / 60.0;
                    v_seg_ph   := v_is_ph;
                ELSE
                    v_seg_ot_h := GREATEST(0, v_ott[i] - GREATEST(v_otf[i], 1440)) / 60.0;
                    v_seg_ph   := v_next_is_ph;
                END IF;
                CONTINUE WHEN v_seg_ot_h <= 0;

                v_tiered := GREATEST(0, LEAST(v_cum + v_seg_ot_h, 3) - LEAST(v_cum, 3)) * 1.5
                          + GREATEST(0, (v_cum + v_seg_ot_h) - GREATEST(v_cum, 3)) * 2.0;

                v_ot_cost := v_ot_cost + v_ord_rate
                    * CASE WHEN v_seg_ph THEN GREATEST(v_tiered, v_seg_ot_h * 2.5) ELSE v_tiered END;
                v_cum := v_cum + v_seg_ot_h;
            END LOOP;
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

ALTER FUNCTION public.fn_eba_estimate_shift_cost(date, time without time zone, integer, integer, numeric, text, boolean, boolean, boolean, boolean, time without time zone, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_eba_estimate_shift_cost(date, time without time zone, integer, integer, numeric, text, boolean, boolean, boolean, boolean, time without time zone, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_eba_estimate_shift_cost(date, time without time zone, integer, integer, numeric, text, boolean, boolean, boolean, boolean, time without time zone, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_eba_estimate_shift_cost(date, time without time zone, integer, integer, numeric, text, boolean, boolean, boolean, boolean, time without time zone, integer) IS
    'SQL port of the TypeScript Standard EBA engine (standard.ts). Prices the hours WORKED around the unpaid meal break (p_break_start, p_unpaid_break_minutes): cl 43 night and cl 41 day loadings attach to worked hours. No break ⇒ legacy layout (break at the end). Golden figures: sql-port-parity.test.ts.';

-- internal.shift_cost: pass the rostered window. Everything else verbatim.
CREATE OR REPLACE FUNCTION internal.shift_cost(s shifts, p_net_minutes integer)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    t        record;
    v_span_h numeric;
    v_ord_h  numeric;
    v_ot_h   numeric;
    v_ot_rate numeric;
    v_cost   numeric;
BEGIN
    SELECT * INTO t FROM internal.shift_pay_terms(s);
    IF t.base_rate IS NULL THEN
        RETURN NULL;
    END IF;
    IF p_net_minutes IS NULL OR p_net_minutes <= 0 THEN
        RETURN 0;
    END IF;

    -- Outside the EA: the salary's hourly equivalent, no EA loadings.
    IF t.pay_basis = 'salary' THEN
        RETURN ROUND(p_net_minutes / 60.0 * t.base_rate, 2);
    END IF;

    -- Sch 2 §2 / Sch 3: meal breaks are paid, so the full span is priced; 12h
    -- ordinary at the annualised rate, beyond that overtime on the ORDINARY
    -- rate (1.5x first 3h, 2.0x after). Mirrors security.ts's annualised path.
    IF t.pay_basis = 'eba_security_annualised' THEN
        v_span_h := (p_net_minutes + COALESCE(s.unpaid_break_minutes, 0)) / 60.0;
        v_ord_h  := LEAST(v_span_h, 12);
        v_ot_h   := GREATEST(v_span_h - 12, 0);
        v_cost   := v_ord_h * t.base_rate;
        IF t.higher_duties AND v_ord_h < 4 THEN
            v_cost := v_cost + (4 - v_ord_h) * t.base_rate;
        END IF;
        IF v_ot_h > 0 THEN
            SELECT er.ordinary_hourly_rate INTO v_ot_rate
              FROM public.eba_rate er
             WHERE er.classification = 'SECURITY_LEVEL_' || t.paid_level::text
               AND er.employment_basis = 'annualised'
               AND er.effective_from <= s.shift_date
             ORDER BY er.effective_from DESC
             LIMIT 1;
            v_cost := v_cost + COALESCE(v_ot_rate, 0)
                * (LEAST(v_ot_h, 3) * 1.5 + GREATEST(v_ot_h - 3, 0) * 2.0);
        END IF;
        RETURN ROUND(v_cost, 2);
    END IF;

    RETURN public.fn_eba_estimate_shift_cost(
        s.shift_date,
        s.start_time,
        p_net_minutes,
        s.scheduled_length_minutes,
        t.base_rate,
        t.employment_type,
        COALESCE(s.target_requires_flexible, false),
        COALESCE(s.is_training, false),
        -- Computed field: functional notation, since s is a PL/pgSQL row variable.
        COALESCE(public.is_first_aid_duty(s), false),
        t.higher_duties AND t.pay_basis = 'eba_level',
        -- cl 41 / 43 attach to hours WORKED: price around the rostered meal break.
        s.break_start,
        COALESCE(s.unpaid_break_minutes, 0));
END;
$function$;

COMMIT;
