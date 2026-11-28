-- Pay rate cards: the loadings move onto the card
-- (docs/architecture/multi-organization.md §11.1 R10, §12).
--
-- Until now a card held only base rates; every loading — weekend and public-
-- holiday penalties, night loadings, overtime tiers, the casual loading, the
-- minimum engagements — was an ICC Sydney figure typed into SQL (and into the
-- client engine). They become one row per card in pay_rate_card_loadings, read
-- by the pricing functions. The rule STRUCTURE stays code under the card's
-- rule_set ('icc_sydney_ea'): cl 41.4 non-cumulative maximum, the night rate by
-- the day the shift concludes, the midnight split, the 22:00–06:00 window.
--
-- Values are stored exactly as the old literals were written (unconstrained
-- numeric), so prices are unchanged to the cent: the casual divisor is
-- 1 + 0.25 = 1.25 as before.
--
-- Casual night loadings are NOT stored: the EA's casual rates (45/50/75%) are
-- the permanent ones (20/25/50%) plus the 25% casual loading, and the engine
-- always subtracted that loading again. Storing both would let them disagree.
--
-- New API: update_rate_card_loadings(card, jsonb) edits a DRAFT's loadings
-- (payroll.manage in the card's organization). Roll-forward copies them
-- unchanged (the multiplier scales money, not percentages); publish refuses a
-- card without them; discard removes them.
--
-- Client engines (standard.ts, security.ts, min-engagement-floor.ts) accept
-- RateCardLoadings via options / AwardContext, falling back to
-- ICC_SYDNEY_EA_LOADINGS; a vitest guard compares it with the seeded ICC cards.

-- ── 1. One row of loadings per card ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pay_rate_card_loadings (
    rate_card_id                          uuid PRIMARY KEY
                                          REFERENCES public.pay_rate_cards (id) ON DELETE RESTRICT,
    -- fractions over the ordinary rate
    casual_loading                        numeric NOT NULL,  -- 0.25
    saturday_loading                      numeric NOT NULL,  -- cl 41: 0.25
    sunday_loading                        numeric NOT NULL,  -- cl 41: 0.5
    public_holiday_loading                numeric NOT NULL,  -- cl 41: 1.5
    night_loading_mon_thu                 numeric NOT NULL,  -- cl 43, by the day the shift concludes: 0.20
    night_loading_fri                     numeric NOT NULL,  -- 0.25
    night_loading_sat_sun                 numeric NOT NULL,  -- 0.50
    annual_leave_loading                  numeric NOT NULL,  -- cl 44.7: 0.175
    -- overtime (cl 42.2; Sch 3 §4.2(c) for annualised security)
    overtime_first_hours                  numeric NOT NULL,  -- 3
    overtime_first_multiplier             numeric NOT NULL,  -- 1.5
    overtime_after_multiplier             numeric NOT NULL,  -- 2.0
    overtime_public_holiday_multiplier    numeric NOT NULL,  -- floor on PH overtime: 2.5
    ordinary_daily_cap_hours              numeric NOT NULL,  -- cl 42: 12
    security_ordinary_cap_hours           numeric NOT NULL,  -- Sch 2 §2 / Sch 3 annualised: 12
    -- minimum paid engagement (cl 12 / 56.2), in minutes
    min_engagement_minutes                integer NOT NULL,  -- 180
    min_engagement_sunday_minutes         integer NOT NULL,  -- 240
    min_engagement_public_holiday_minutes integer NOT NULL,  -- 240
    min_engagement_training_minutes       integer NOT NULL,  -- 120
    higher_duties_min_hours               numeric NOT NULL,  -- cl 29.1(a): 4
    meal_allowance_trigger_hours          numeric NOT NULL,  -- cl 28.1: 2.0
    created_at                            timestamptz NOT NULL DEFAULT now(),
    updated_at                            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pay_rate_card_loadings_fractions CHECK (
        casual_loading BETWEEN 0 AND 1
        AND annual_leave_loading BETWEEN 0 AND 1
        AND saturday_loading BETWEEN 0 AND 3 AND sunday_loading BETWEEN 0 AND 3
        AND public_holiday_loading BETWEEN 0 AND 3
        AND night_loading_mon_thu BETWEEN 0 AND 3 AND night_loading_fri BETWEEN 0 AND 3
        AND night_loading_sat_sun BETWEEN 0 AND 3),
    CONSTRAINT pay_rate_card_loadings_overtime CHECK (
        overtime_first_hours BETWEEN 0 AND 24
        AND overtime_first_multiplier BETWEEN 1 AND 4
        AND overtime_after_multiplier BETWEEN overtime_first_multiplier AND 4
        AND overtime_public_holiday_multiplier BETWEEN 1 AND 4),
    CONSTRAINT pay_rate_card_loadings_hours CHECK (
        ordinary_daily_cap_hours > 0 AND ordinary_daily_cap_hours <= 24
        AND security_ordinary_cap_hours > 0 AND security_ordinary_cap_hours <= 24
        AND higher_duties_min_hours BETWEEN 0 AND 24
        AND meal_allowance_trigger_hours BETWEEN 0 AND 24),
    CONSTRAINT pay_rate_card_loadings_minutes CHECK (
        min_engagement_minutes BETWEEN 0 AND 720
        AND min_engagement_sunday_minutes BETWEEN 0 AND 720
        AND min_engagement_public_holiday_minutes BETWEEN 0 AND 720
        AND min_engagement_training_minutes BETWEEN 0 AND 720)
);
COMMENT ON TABLE public.pay_rate_card_loadings IS
    'The numeric loadings of one rate card (rule_set icc_sydney_ea); the rule structure stays in the pricing functions.';

DROP TRIGGER IF EXISTS update_pay_rate_card_loadings_updated_at ON public.pay_rate_card_loadings;
CREATE TRIGGER update_pay_rate_card_loadings_updated_at
    BEFORE UPDATE ON public.pay_rate_card_loadings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Same visibility as the card's other lines: members see published cards,
-- payroll.manage also sees drafts. Writes only through the API (definer).
ALTER TABLE public.pay_rate_card_loadings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pay_rate_card_loadings_select ON public.pay_rate_card_loadings;
CREATE POLICY pay_rate_card_loadings_select ON public.pay_rate_card_loadings
    FOR SELECT TO authenticated USING (public.can_read_rate_card(rate_card_id));
REVOKE ALL ON public.pay_rate_card_loadings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pay_rate_card_loadings TO authenticated;
GRANT ALL ON public.pay_rate_card_loadings TO service_role;

-- ── 2. Every existing card gets the ICC Sydney EA figures ────────────────────
-- Literals exactly as the replaced code wrote them. No-op on an empty database:
-- the seed carries cards and loadings there.
INSERT INTO public.pay_rate_card_loadings (
    rate_card_id, casual_loading, saturday_loading, sunday_loading, public_holiday_loading,
    night_loading_mon_thu, night_loading_fri, night_loading_sat_sun, annual_leave_loading,
    overtime_first_hours, overtime_first_multiplier, overtime_after_multiplier,
    overtime_public_holiday_multiplier, ordinary_daily_cap_hours, security_ordinary_cap_hours,
    min_engagement_minutes, min_engagement_sunday_minutes, min_engagement_public_holiday_minutes,
    min_engagement_training_minutes, higher_duties_min_hours, meal_allowance_trigger_hours)
SELECT c.id, 0.25, 0.25, 0.5, 1.5,
       0.20, 0.25, 0.50, 0.175,
       3, 1.5, 2.0,
       2.5, 12, 12,
       180, 240, 240,
       120, 4, 2.0
  FROM public.pay_rate_cards c
 WHERE c.rule_set = 'icc_sydney_ea'
ON CONFLICT (rate_card_id) DO NOTHING;

-- ── 3. The rule structure, reading the card's figures ───────────────────────
-- Only fn_eba_estimate_shift_cost calls these three; the old signatures go.
DROP FUNCTION IF EXISTS public.fn_eba_penalty_loading(integer, boolean);
DROP FUNCTION IF EXISTS public.fn_eba_night_multiplier(integer, boolean);
DROP FUNCTION IF EXISTS public.fn_eba_min_engagement_minutes(text, boolean, boolean, boolean, boolean);

CREATE OR REPLACE FUNCTION public.fn_eba_penalty_loading(p_dow integer, p_is_holiday boolean, l public.pay_rate_card_loadings)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    -- cl 41: the weekend / public-holiday loading over the ordinary rate; the
    -- figures are the card's.
    SELECT CASE
        WHEN p_is_holiday THEN l.public_holiday_loading
        WHEN p_dow = 6    THEN l.saturday_loading
        WHEN p_dow = 0    THEN l.sunday_loading
        ELSE 0
    END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_eba_night_multiplier(p_conclusion_dow integer, l public.pay_rate_card_loadings)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    -- cl 43: the night loading over the ordinary rate, by the day the shift
    -- CONCLUDES. The EA's casual rates are these plus the casual loading, which
    -- the casual base already carries, so one set serves both.
    SELECT CASE WHEN p_conclusion_dow BETWEEN 1 AND 4 THEN l.night_loading_mon_thu
                WHEN p_conclusion_dow = 5             THEN l.night_loading_fri
                ELSE l.night_loading_sat_sun END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_eba_min_engagement_minutes(p_employment_type text, p_requires_flexible boolean, p_is_training boolean, p_is_sunday boolean, p_is_public_holiday boolean, l public.pay_rate_card_loadings)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    -- cl 12 / 56.2: which floor applies is the rule; its length is the card's.
    SELECT CASE
        WHEN p_employment_type = 'FT'        THEN NULL
        WHEN COALESCE(p_is_training, false)  THEN l.min_engagement_training_minutes
        WHEN p_is_public_holiday             THEN l.min_engagement_public_holiday_minutes
        WHEN p_is_sunday AND NOT (p_employment_type = 'PT'
                                  AND NOT COALESCE(p_requires_flexible, false)) THEN l.min_engagement_sunday_minutes
        ELSE l.min_engagement_minutes
    END;
$function$;

REVOKE ALL ON FUNCTION public.fn_eba_penalty_loading(integer, boolean, public.pay_rate_card_loadings) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_eba_penalty_loading(integer, boolean, public.pay_rate_card_loadings) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_eba_night_multiplier(integer, public.pay_rate_card_loadings) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_eba_night_multiplier(integer, public.pay_rate_card_loadings) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_eba_min_engagement_minutes(text, boolean, boolean, boolean, boolean, public.pay_rate_card_loadings) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_eba_min_engagement_minutes(text, boolean, boolean, boolean, boolean, public.pay_rate_card_loadings) TO authenticated, service_role;

-- ── 4. Both pricing paths read the card's loadings ──────────────────────────
CREATE OR REPLACE FUNCTION public.fn_eba_estimate_shift_cost(p_shift_date date, p_start_time time without time zone, p_net_minutes integer, p_scheduled_minutes integer, p_base_rate numeric, p_employment_type text, p_requires_flexible boolean DEFAULT false, p_is_training boolean DEFAULT false, p_first_aid boolean DEFAULT false, p_higher_duties boolean DEFAULT false, p_break_start time without time zone DEFAULT NULL::time without time zone, p_unpaid_break_minutes integer DEFAULT 0, p_rate_card_id uuid DEFAULT NULL::uuid, p_jurisdiction text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_is_casual   boolean := (p_employment_type = 'Casual');
    v_l           public.pay_rate_card_loadings;
    v_base_mult   numeric;
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
    -- The card and jurisdiction default only because they follow defaulted
    -- parameters; every caller must pass them.
    IF p_rate_card_id IS NULL OR p_jurisdiction IS NULL THEN
        RAISE EXCEPTION 'fn_eba_estimate_shift_cost needs the rate card and jurisdiction' USING ERRCODE = '22004';
    END IF;
    IF p_base_rate IS NULL OR p_net_minutes IS NULL OR p_net_minutes <= 0 THEN
        RETURN 0;
    END IF;
    -- The loadings are the card's. A published card always has them
    -- (publish_rate_card refuses otherwise); none ⇒ unpriced, not ICC's.
    SELECT * INTO v_l FROM public.pay_rate_card_loadings WHERE rate_card_id = p_rate_card_id;
    IF v_l.rate_card_id IS NULL THEN
        RETURN NULL;
    END IF;
    v_base_mult := CASE WHEN v_is_casual THEN 1 + v_l.casual_loading ELSE 1.0 END;

    -- De-load exactly as standard.ts does: ordinaryRate = isCasual ? base/(1 + casual loading) : base.
    v_ord_rate := CASE WHEN v_is_casual THEN p_base_rate / v_base_mult ELSE p_base_rate END;

    v_net_h   := p_net_minutes / 60.0;
    v_sched_h := COALESCE(p_scheduled_minutes, 0) / 60.0;

    -- cl 42 daily overtime, computed BEFORE ordinary so the two never overlap.
    IF NOT v_is_casual AND v_sched_h > 0 THEN
        v_ot_h := GREATEST(0, v_net_h - v_sched_h, v_net_h - v_l.ordinary_daily_cap_hours);
    ELSE
        v_ot_h := GREATEST(0, v_net_h - v_l.ordinary_daily_cap_hours);
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
                             WHERE h.holiday_date = p_shift_date AND h.jurisdiction = ANY (public.jurisdiction_lineage(p_jurisdiction)));
    v_next_is_ph := EXISTS (SELECT 1 FROM public.public_holidays h
                             WHERE h.holiday_date = p_shift_date + 1 AND h.jurisdiction = ANY (public.jurisdiction_lineage(p_jurisdiction)));

    -- cl 43: one night rate for the whole shift, from the day it CONCLUDES.
    v_conclusion := CASE WHEN v_end > 1440 THEN v_next_dow ELSE v_dow END;
    v_night_over := public.fn_eba_night_multiplier(v_conclusion, v_l);

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
            v_seg_pen := public.fn_eba_penalty_loading(v_seg_dow, v_seg_ph, v_l);
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
    v_start_pen_rate := v_ord_rate * (v_base_mult + public.fn_eba_penalty_loading(v_dow, v_is_ph, v_l));

    -- cl 12 / 56.2 minimum PAID engagement.
    v_paid_ord_h := v_ord_h;
    v_floor_mins := public.fn_eba_min_engagement_minutes(
        p_employment_type, p_requires_flexible, p_is_training, v_dow = 0, v_is_ph, v_l);
    IF v_floor_mins IS NOT NULL THEN
        v_floor_h := v_floor_mins / 60.0;
        IF v_paid_ord_h < v_floor_h THEN
            v_ord_cost   := v_ord_cost + (v_floor_h - v_paid_ord_h) * v_start_pen_rate;
            v_paid_ord_h := v_floor_h;
        END IF;
    END IF;

    -- cl 29.1(a) higher-duties minimum: a shift paid at a higher level for under
    -- the card's minimum paid hours is topped up to it at the engagement-day
    -- rate (standard.ts).
    IF p_higher_duties AND v_net_h > 0 AND v_paid_ord_h < v_l.higher_duties_min_hours THEN
        v_ord_cost   := v_ord_cost + (v_l.higher_duties_min_hours - v_paid_ord_h) * v_start_pen_rate;
        v_paid_ord_h := v_l.higher_duties_min_hours;
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

                v_tiered := GREATEST(0, LEAST(v_cum + v_seg_ot_h, v_l.overtime_first_hours)
                                        - LEAST(v_cum, v_l.overtime_first_hours)) * v_l.overtime_first_multiplier
                          + GREATEST(0, (v_cum + v_seg_ot_h) - GREATEST(v_cum, v_l.overtime_first_hours))
                                * v_l.overtime_after_multiplier;

                v_ot_cost := v_ot_cost + v_ord_rate
                    * CASE WHEN v_seg_ph THEN GREATEST(v_tiered, v_seg_ot_h * v_l.overtime_public_holiday_multiplier)
                           ELSE v_tiered END;
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
    IF v_meal_trig >= v_l.meal_allowance_trigger_hours THEN
        v_allow_cost := v_allow_cost + COALESCE((
            SELECT a.amount FROM public.eba_allowance a
             WHERE a.rate_card_id = p_rate_card_id AND a.code = 'meal'), 0);
    END IF;

    -- cl 28.2 first aid: "paid for ordinary hours". Priced on PAID ordinary hours
    -- (post-floor, overtime excluded), the same basis as standard.ts.
    IF p_first_aid THEN
        v_allow_cost := v_allow_cost + v_paid_ord_h * COALESCE((
            SELECT a.amount FROM public.eba_allowance a
             WHERE a.rate_card_id = p_rate_card_id AND a.code = 'first_aid_per_hour'), 0);
    END IF;

    RETURN ROUND(v_ord_cost + v_night_cost + v_ot_cost + v_allow_cost, 2);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_eba_estimate_shift_cost(date, time without time zone, integer, integer, numeric, text, boolean, boolean, boolean, boolean, time without time zone, integer, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_eba_estimate_shift_cost(date, time without time zone, integer, integer, numeric, text, boolean, boolean, boolean, boolean, time without time zone, integer, uuid, text) TO authenticated, service_role;

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
    v_card   uuid := public.organization_rate_card(s.organization_id, s.shift_date);
    v_l      public.pay_rate_card_loadings;
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
        -- The card's figures: the annualised ordinary cap, the overtime tiers
        -- and the higher-duties minimum.
        SELECT * INTO v_l FROM public.pay_rate_card_loadings WHERE rate_card_id = v_card;
        IF v_l.rate_card_id IS NULL THEN
            RETURN NULL;
        END IF;
        v_span_h := (p_net_minutes + COALESCE(s.unpaid_break_minutes, 0)) / 60.0;
        v_ord_h  := LEAST(v_span_h, v_l.security_ordinary_cap_hours);
        v_ot_h   := GREATEST(v_span_h - v_l.security_ordinary_cap_hours, 0);
        v_cost   := v_ord_h * t.base_rate;
        IF t.higher_duties AND v_ord_h < v_l.higher_duties_min_hours THEN
            v_cost := v_cost + (v_l.higher_duties_min_hours - v_ord_h) * t.base_rate;
        END IF;
        IF v_ot_h > 0 THEN
            SELECT er.ordinary_hourly_rate INTO v_ot_rate
              FROM public.eba_rate er
             WHERE er.rate_card_id = v_card
               AND er.classification = 'SECURITY_LEVEL_' || t.paid_level::text
               AND er.employment_basis = 'annualised';
            v_cost := v_cost + COALESCE(v_ot_rate, 0)
                * (LEAST(v_ot_h, v_l.overtime_first_hours) * v_l.overtime_first_multiplier
                   + GREATEST(v_ot_h - v_l.overtime_first_hours, 0) * v_l.overtime_after_multiplier);
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
        COALESCE(s.unpaid_break_minutes, 0),
        v_card,
        public.organization_jurisdiction(s.organization_id));
END;
$function$;
REVOKE ALL ON FUNCTION internal.shift_cost(public.shifts, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION internal.shift_cost(public.shifts, integer) TO authenticated, service_role;

-- ── 5. The card API carries the loadings ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.roll_rate_card_forward(p_source_card_id uuid, p_code text, p_name text, p_valid_from date, p_multiplier numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_src public.pay_rate_cards;
    v_id  uuid;
BEGIN
    SELECT * INTO v_src FROM public.pay_rate_cards WHERE id = p_source_card_id;
    -- One answer for "no such card" and "not yours": no probing other tenants.
    IF v_src.id IS NULL OR NOT public.user_has_action_in_scope('payroll.manage', v_src.organization_id) THEN
        RAISE EXCEPTION 'rate card not found, or payroll.manage not held in its organization' USING ERRCODE = '42501';
    END IF;
    IF p_multiplier IS NULL OR p_multiplier <= 0 OR p_multiplier > 2 THEN
        RAISE EXCEPTION 'multiplier must be greater than 0 and at most 2, got %', p_multiplier USING ERRCODE = '22023';
    END IF;
    IF p_valid_from IS NULL OR p_valid_from <= v_src.valid_from THEN
        RAISE EXCEPTION 'the new card must start after its source (%)', v_src.valid_from USING ERRCODE = '22023';
    END IF;
    IF NULLIF(btrim(p_code), '') IS NULL OR NULLIF(btrim(p_name), '') IS NULL THEN
        RAISE EXCEPTION 'code and name are required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.pay_rate_cards (organization_id, code, name, currency, rule_set, valid_from, status, derivation)
    VALUES (v_src.organization_id, btrim(p_code), btrim(p_name), v_src.currency, v_src.rule_set, p_valid_from, 'draft',
            format('%s × %s', v_src.code, p_multiplier))
    RETURNING id INTO v_id;

    INSERT INTO public.eba_rate (rate_card_id, classification, employment_basis, ordinary_hourly_rate, paid_hourly_rate, source)
    SELECT v_id, r.classification, r.employment_basis,
           round(r.ordinary_hourly_rate * p_multiplier, 2), round(r.paid_hourly_rate * p_multiplier, 2), r.source
      FROM public.eba_rate r WHERE r.rate_card_id = v_src.id;
    INSERT INTO public.eba_allowance (rate_card_id, code, amount, unit, source)
    SELECT v_id, a.code, round(a.amount * p_multiplier, 2), a.unit, a.source
      FROM public.eba_allowance a WHERE a.rate_card_id = v_src.id;
    INSERT INTO public.eba_trainee_schedule (rate_card_id, matrix, label, source)
    SELECT v_id, internal.scale_money(t.matrix, p_multiplier), btrim(p_name), t.source
      FROM public.eba_trainee_schedule t WHERE t.rate_card_id = v_src.id;
    -- Loadings are fractions, hours and minutes: copied unchanged (the
    -- multiplier scales money, not percentages).
    INSERT INTO public.pay_rate_card_loadings
    SELECT (jsonb_populate_record(NULL::public.pay_rate_card_loadings,
              to_jsonb(l) || jsonb_build_object('rate_card_id', v_id, 'created_at', now(), 'updated_at', now()))).*
      FROM public.pay_rate_card_loadings l WHERE l.rate_card_id = v_src.id;

    RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.publish_rate_card(p_card_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v public.pay_rate_cards;
BEGIN
    SELECT * INTO v FROM public.pay_rate_cards WHERE id = p_card_id FOR UPDATE;
    IF v.id IS NULL OR NOT public.user_has_action_in_scope('payroll.manage', v.organization_id) THEN
        RAISE EXCEPTION 'rate card not found, or payroll.manage not held in its organization' USING ERRCODE = '42501';
    END IF;
    IF v.status <> 'draft' THEN
        RAISE EXCEPTION 'card % is already published', v.code USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.eba_rate r WHERE r.rate_card_id = v.id) THEN
        RAISE EXCEPTION 'card % has no rates', v.code USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.pay_rate_card_loadings l WHERE l.rate_card_id = v.id) THEN
        RAISE EXCEPTION 'card % has no loadings', v.code USING ERRCODE = '55000';
    END IF;

    UPDATE public.pay_rate_cards p SET valid_to = v.valid_from - 1
     WHERE p.organization_id = v.organization_id AND p.status = 'published'
       AND p.valid_to IS NULL AND p.valid_from < v.valid_from;
    BEGIN
        UPDATE public.pay_rate_cards
           SET status = 'published', published_at = now(), published_by = auth.uid()
         WHERE id = v.id;
    EXCEPTION WHEN exclusion_violation THEN
        RAISE EXCEPTION 'card % overlaps another published card of this organization', v.code USING ERRCODE = '23P01';
    END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.discard_rate_card(p_card_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v public.pay_rate_cards;
BEGIN
    SELECT * INTO v FROM public.pay_rate_cards WHERE id = p_card_id FOR UPDATE;
    IF v.id IS NULL OR NOT public.user_has_action_in_scope('payroll.manage', v.organization_id) THEN
        RAISE EXCEPTION 'rate card not found, or payroll.manage not held in its organization' USING ERRCODE = '42501';
    END IF;
    IF v.status <> 'draft' THEN
        RAISE EXCEPTION 'card % is published; only a draft can be discarded', v.code USING ERRCODE = '55000';
    END IF;
    DELETE FROM public.eba_rate             WHERE rate_card_id = v.id;
    DELETE FROM public.eba_allowance        WHERE rate_card_id = v.id;
    DELETE FROM public.eba_trainee_schedule WHERE rate_card_id = v.id;
    DELETE FROM public.pay_rate_card_loadings WHERE rate_card_id = v.id;
    DELETE FROM public.pay_rate_cards       WHERE id = v.id;
END;
$function$;

-- Edits a DRAFT card's loadings: p_loadings is a JSON object of column → value,
-- e.g. {"saturday_loading": 0.30}; keys not given keep their value. Published
-- cards are immutable. The table's CHECK constraints validate the result.
CREATE OR REPLACE FUNCTION public.update_rate_card_loadings(p_card_id uuid, p_loadings jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v       public.pay_rate_cards;
    l       public.pay_rate_card_loadings;
    v_bad   text;
BEGIN
    SELECT * INTO v FROM public.pay_rate_cards WHERE id = p_card_id FOR UPDATE;
    IF v.id IS NULL OR NOT public.user_has_action_in_scope('payroll.manage', v.organization_id) THEN
        RAISE EXCEPTION 'rate card not found, or payroll.manage not held in its organization' USING ERRCODE = '42501';
    END IF;
    IF v.status <> 'draft' THEN
        RAISE EXCEPTION 'card % is published; only a draft''s loadings can change', v.code USING ERRCODE = '55000';
    END IF;
    IF jsonb_typeof(p_loadings) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'loadings must be a JSON object' USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad
      FROM jsonb_object_keys(p_loadings) k
     WHERE k IN ('rate_card_id', 'created_at', 'updated_at')
        OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                        WHERE a.attrelid = 'public.pay_rate_card_loadings'::regclass
                          AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped);
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'unknown or read-only loading(s): %', v_bad USING ERRCODE = '22023';
    END IF;

    SELECT * INTO l FROM public.pay_rate_card_loadings WHERE rate_card_id = v.id FOR UPDATE;
    IF l.rate_card_id IS NULL THEN
        RAISE EXCEPTION 'card % has no loadings', v.code USING ERRCODE = '55000';
    END IF;
    l := jsonb_populate_record(l, p_loadings);

    UPDATE public.pay_rate_card_loadings SET
        casual_loading                        = l.casual_loading,
        saturday_loading                      = l.saturday_loading,
        sunday_loading                        = l.sunday_loading,
        public_holiday_loading                = l.public_holiday_loading,
        night_loading_mon_thu                 = l.night_loading_mon_thu,
        night_loading_fri                     = l.night_loading_fri,
        night_loading_sat_sun                 = l.night_loading_sat_sun,
        annual_leave_loading                  = l.annual_leave_loading,
        overtime_first_hours                  = l.overtime_first_hours,
        overtime_first_multiplier             = l.overtime_first_multiplier,
        overtime_after_multiplier             = l.overtime_after_multiplier,
        overtime_public_holiday_multiplier    = l.overtime_public_holiday_multiplier,
        ordinary_daily_cap_hours              = l.ordinary_daily_cap_hours,
        security_ordinary_cap_hours           = l.security_ordinary_cap_hours,
        min_engagement_minutes                = l.min_engagement_minutes,
        min_engagement_sunday_minutes         = l.min_engagement_sunday_minutes,
        min_engagement_public_holiday_minutes = l.min_engagement_public_holiday_minutes,
        min_engagement_training_minutes       = l.min_engagement_training_minutes,
        higher_duties_min_hours               = l.higher_duties_min_hours,
        meal_allowance_trigger_hours          = l.meal_allowance_trigger_hours
     WHERE rate_card_id = v.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.roll_rate_card_forward(uuid, text, text, date, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.publish_rate_card(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.discard_rate_card(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_rate_card_loadings(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.roll_rate_card_forward(uuid, text, text, date, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_rate_card(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.discard_rate_card(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_rate_card_loadings(uuid, jsonb) TO authenticated, service_role;
