-- Pay rate cards, phase 1 (database): rates belong to an organization's card
-- (docs/architecture/multi-organization.md §4).
--
-- A rate card is one pay agreement of one organization (e.g. the ICC Sydney EA).
-- It holds the NUMBERS — rate lines, allowances, trainee schedule, all still
-- effective-dated in the eba_* tables, which keep their names (P5) — and names
-- the rule set its pay is computed under; the rules stay code (P2): today only
-- 'icc_sydney_ea'. An organization with no default card is NOT priced (P4):
-- shift pay terms and cost come back NULL rather than another venue's rates.
-- Holidays are priced in the shift's own jurisdiction (P6), not 'AU-NSW'.
--
-- Not here (YAGNI / later phases): a contract naming its own card; writes from
-- the app (service role only, as for eba_* today); the client engine and rate
-- admin (phase 2: the embedded RATE_SCHEDULE copies go, the worker reads cards).

-- ── 1. Cards ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pay_rate_cards (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
    code            text NOT NULL,
    name            text NOT NULL,
    currency        text NOT NULL DEFAULT 'AUD' CHECK (currency ~ '^[A-Z]{3}$'),
    rule_set        text NOT NULL CHECK (rule_set IN ('icc_sydney_ea')),
    term_start      date,   -- the agreement's nominal term: informational
    term_end        date,
    is_default      boolean NOT NULL DEFAULT false,
    retired_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pay_rate_cards_code_per_org UNIQUE (organization_id, code),
    CONSTRAINT pay_rate_cards_term_in_order CHECK (term_end IS NULL OR term_start IS NULL OR term_end >= term_start),
    CONSTRAINT pay_rate_cards_default_not_retired CHECK (NOT (is_default AND retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS pay_rate_cards_one_default_per_org
    ON public.pay_rate_cards (organization_id) WHERE is_default;
DROP TRIGGER IF EXISTS update_pay_rate_cards_updated_at ON public.pay_rate_cards;
CREATE TRIGGER update_pay_rate_cards_updated_at
    BEFORE UPDATE ON public.pay_rate_cards
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.pay_rate_cards ENABLE ROW LEVEL SECURITY;
-- Members read their organization's cards; only the service role writes.
DROP POLICY IF EXISTS pay_rate_cards_select ON public.pay_rate_cards;
CREATE POLICY pay_rate_cards_select ON public.pay_rate_cards
    FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
REVOKE ALL ON public.pay_rate_cards FROM anon, authenticated;
GRANT SELECT ON public.pay_rate_cards TO authenticated;

-- ICC Sydney's agreement becomes its default card (no-op on an empty database).
INSERT INTO public.pay_rate_cards (organization_id, code, name, currency, rule_set, term_start, is_default)
SELECT o.id, 'ICC-EA', 'ICC Sydney Enterprise Agreement', 'AUD', 'icc_sydney_ea', DATE '2025-01-01', true
  FROM public.organizations o
 WHERE o.code = 'ICCSYD'
ON CONFLICT (organization_id, code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.organization_rate_card(p_organization_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    -- The organization's default card, or NULL: no card means not priced (P4).
    SELECT c.id FROM public.pay_rate_cards c
     WHERE c.organization_id = p_organization_id AND c.is_default AND c.retired_at IS NULL;
$function$;
REVOKE ALL ON FUNCTION public.organization_rate_card(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_rate_card(uuid) TO authenticated, service_role;

-- ── 2. Rates belong to a card ────────────────────────────────────────────────
ALTER TABLE public.eba_rate             ADD COLUMN IF NOT EXISTS rate_card_id uuid REFERENCES public.pay_rate_cards (id) ON DELETE RESTRICT;
ALTER TABLE public.eba_allowance        ADD COLUMN IF NOT EXISTS rate_card_id uuid REFERENCES public.pay_rate_cards (id) ON DELETE RESTRICT;
ALTER TABLE public.eba_trainee_schedule ADD COLUMN IF NOT EXISTS rate_card_id uuid REFERENCES public.pay_rate_cards (id) ON DELETE RESTRICT;

-- Every existing rate is ICC Sydney's.
UPDATE public.eba_rate             SET rate_card_id = (SELECT c.id FROM public.pay_rate_cards c JOIN public.organizations o ON o.id = c.organization_id WHERE o.code = 'ICCSYD' AND c.code = 'ICC-EA') WHERE rate_card_id IS NULL;
UPDATE public.eba_allowance        SET rate_card_id = (SELECT c.id FROM public.pay_rate_cards c JOIN public.organizations o ON o.id = c.organization_id WHERE o.code = 'ICCSYD' AND c.code = 'ICC-EA') WHERE rate_card_id IS NULL;
UPDATE public.eba_trainee_schedule SET rate_card_id = (SELECT c.id FROM public.pay_rate_cards c JOIN public.organizations o ON o.id = c.organization_id WHERE o.code = 'ICCSYD' AND c.code = 'ICC-EA') WHERE rate_card_id IS NULL;

ALTER TABLE public.eba_rate             ALTER COLUMN rate_card_id SET NOT NULL;
ALTER TABLE public.eba_allowance        ALTER COLUMN rate_card_id SET NOT NULL;
ALTER TABLE public.eba_trainee_schedule ALTER COLUMN rate_card_id SET NOT NULL;

-- Keys and lookups are per card (the card leads, so it also covers the FK).
ALTER TABLE public.eba_rate DROP CONSTRAINT IF EXISTS eba_rate_uniq,
    ADD CONSTRAINT eba_rate_uniq UNIQUE (rate_card_id, effective_from, classification, employment_basis);
DROP INDEX IF EXISTS public.idx_eba_rate_lookup;
CREATE INDEX idx_eba_rate_lookup ON public.eba_rate (rate_card_id, classification, employment_basis, effective_from);

ALTER TABLE public.eba_allowance DROP CONSTRAINT IF EXISTS eba_allowance_uniq,
    ADD CONSTRAINT eba_allowance_uniq UNIQUE (rate_card_id, effective_from, code);
DROP INDEX IF EXISTS public.idx_eba_allowance_lookup;
CREATE INDEX idx_eba_allowance_lookup ON public.eba_allowance (rate_card_id, code, effective_from);

ALTER TABLE public.eba_trainee_schedule DROP CONSTRAINT IF EXISTS eba_trainee_schedule_pkey,
    ADD CONSTRAINT eba_trainee_schedule_pkey PRIMARY KEY (rate_card_id, effective_from);

-- Rates are readable by members of the card's organization (were: everyone).
DROP POLICY IF EXISTS "Everyone can view EBA rates" ON public.eba_rate;
CREATE POLICY eba_rate_select ON public.eba_rate FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.pay_rate_cards c WHERE c.id = eba_rate.rate_card_id AND public.is_org_member(c.organization_id)));
DROP POLICY IF EXISTS "Everyone can view EBA allowances" ON public.eba_allowance;
CREATE POLICY eba_allowance_select ON public.eba_allowance FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.pay_rate_cards c WHERE c.id = eba_allowance.rate_card_id AND public.is_org_member(c.organization_id)));
DROP POLICY IF EXISTS "Everyone can view EBA trainee rates" ON public.eba_trainee_schedule;
CREATE POLICY eba_trainee_schedule_select ON public.eba_trainee_schedule FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.pay_rate_cards c WHERE c.id = eba_trainee_schedule.rate_card_id AND public.is_org_member(c.organization_id)));

-- ── 3. Pricing reads the shift's organization's card ─────────────────────────
-- The inner functions take the card (and the estimator the jurisdiction) as a
-- parameter; signatures change, so drop and recreate, then restore grants.
DROP FUNCTION IF EXISTS public.fn_eba_resolve_shift_rate(smallint, text, date);
DROP FUNCTION IF EXISTS internal.resolve_pay_terms(date, smallint, text, text, smallint, numeric, text, numeric, boolean);
DROP FUNCTION IF EXISTS public.fn_eba_estimate_shift_cost(date, time without time zone, integer, integer, numeric, text, boolean, boolean, boolean, boolean, time without time zone, integer);

CREATE FUNCTION public.fn_eba_resolve_shift_rate(p_remuneration_level smallint, p_target_employment_type text, p_shift_date date, p_rate_card_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    -- The effective-dated EBA rate for this classification + basis.
    -- `paid_hourly_rate` already carries the 25% casual loading; the engine
    -- de-loads it internally. Level 0 is stored as 'TRAINEE' in eba_rate
    -- (Schedule 2 "ICC Sydney Trainee").
    SELECT er.paid_hourly_rate
      FROM public.eba_rate er
     WHERE er.rate_card_id = p_rate_card_id
       AND er.classification = CASE
               WHEN p_remuneration_level = 0 THEN 'TRAINEE'
               ELSE 'LEVEL_' || p_remuneration_level::text END
       AND er.employment_basis = CASE
               WHEN p_target_employment_type = 'Casual' THEN 'casual'
               ELSE 'permanent' END
       AND er.effective_from <= p_shift_date
     ORDER BY er.effective_from DESC
     LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.fn_eba_resolve_shift_rate(smallint, text, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_eba_resolve_shift_rate(smallint, text, date, uuid) TO authenticated, service_role;


CREATE FUNCTION internal.resolve_pay_terms(p_shift_date date, p_shift_level smallint, p_shift_employment_type text, p_contract_pay_basis text, p_contract_level smallint, p_annual_salary numeric, p_contract_employment_status text, p_contract_weekly_hours numeric, p_uses_wage_scheme boolean, p_rate_card_id uuid)
 RETURNS TABLE(pay_basis text, employment_type text, substantive_level smallint, paid_level smallint, higher_duties boolean, base_rate numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
#variable_conflict use_column
DECLARE
    v_basis text := COALESCE(p_contract_pay_basis, 'eba_level');
    v_emp   text := COALESCE(NULLIF(p_shift_employment_type, ''),
                             public.fn_normalize_employment_type(p_contract_employment_status));
    v_sub   smallint := CASE WHEN p_contract_pay_basis IS NULL THEN p_shift_level
                             ELSE p_contract_level END;
    v_paid  smallint;
    v_rate  numeric;
BEGIN
    IF v_basis = 'salary' THEN
        v_paid := NULL;
    ELSIF v_basis = 'eba_security_annualised' THEN
        -- Annualised rates exist for Levels 3–6 only (Sch 2 §2).
        v_paid := CASE WHEN p_shift_level BETWEEN 3 AND 6 AND p_shift_level > v_sub
                       THEN p_shift_level ELSE v_sub END;
    ELSIF p_contract_pay_basis IS NULL OR COALESCE(p_uses_wage_scheme, false) THEN
        v_paid := v_sub;
    ELSE
        v_paid := GREATEST(v_sub, COALESCE(p_shift_level, v_sub));
    END IF;

    IF v_basis = 'salary' THEN
        v_rate := p_annual_salary / 52.0
                  / COALESCE(NULLIF(CASE WHEN v_emp = 'FT' THEN 38 ELSE p_contract_weekly_hours END, 0), 38);
    ELSIF v_basis = 'eba_security_annualised' THEN
        SELECT er.paid_hourly_rate INTO v_rate
          FROM public.eba_rate er
         WHERE er.rate_card_id = p_rate_card_id
           AND er.classification = 'SECURITY_LEVEL_' || v_paid::text
           AND er.employment_basis = 'annualised'
           AND er.effective_from <= p_shift_date
         ORDER BY er.effective_from DESC
         LIMIT 1;
    ELSE
        v_rate := public.fn_eba_resolve_shift_rate(v_paid, v_emp, p_shift_date, p_rate_card_id);
    END IF;

    pay_basis         := v_basis;
    employment_type   := v_emp;
    substantive_level := CASE WHEN v_basis = 'salary' THEN NULL ELSE v_sub END;
    paid_level        := v_paid;
    higher_duties     := COALESCE(v_paid > v_sub, false);
    base_rate         := v_rate;
    RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION internal.resolve_pay_terms(date, smallint, text, text, smallint, numeric, text, numeric, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION internal.resolve_pay_terms(date, smallint, text, text, smallint, numeric, text, numeric, boolean, uuid) TO authenticated, service_role;


CREATE FUNCTION public.fn_eba_estimate_shift_cost(p_shift_date date, p_start_time time without time zone, p_net_minutes integer, p_scheduled_minutes integer, p_base_rate numeric, p_employment_type text, p_requires_flexible boolean DEFAULT false, p_is_training boolean DEFAULT false, p_first_aid boolean DEFAULT false, p_higher_duties boolean DEFAULT false, p_break_start time without time zone DEFAULT NULL::time without time zone, p_unpaid_break_minutes integer DEFAULT 0, p_rate_card_id uuid DEFAULT NULL::uuid, p_jurisdiction text DEFAULT NULL::text)
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
    -- The card and jurisdiction default only because they follow defaulted
    -- parameters; every caller must pass them.
    IF p_rate_card_id IS NULL OR p_jurisdiction IS NULL THEN
        RAISE EXCEPTION 'fn_eba_estimate_shift_cost needs the rate card and jurisdiction' USING ERRCODE = '22004';
    END IF;
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
                             WHERE h.holiday_date = p_shift_date AND h.jurisdiction = ANY (public.jurisdiction_lineage(p_jurisdiction)));
    v_next_is_ph := EXISTS (SELECT 1 FROM public.public_holidays h
                             WHERE h.holiday_date = p_shift_date + 1 AND h.jurisdiction = ANY (public.jurisdiction_lineage(p_jurisdiction)));

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
             WHERE a.rate_card_id = p_rate_card_id AND a.code = 'meal' AND a.effective_from <= p_shift_date
             ORDER BY a.effective_from DESC LIMIT 1), 0);
    END IF;

    -- cl 28.2 first aid: "paid for ordinary hours". Priced on PAID ordinary hours
    -- (post-floor, overtime excluded), the same basis as standard.ts.
    IF p_first_aid THEN
        v_allow_cost := v_allow_cost + v_paid_ord_h * COALESCE((
            SELECT a.amount FROM public.eba_allowance a
             WHERE a.rate_card_id = p_rate_card_id AND a.code = 'first_aid_per_hour' AND a.effective_from <= p_shift_date
             ORDER BY a.effective_from DESC LIMIT 1), 0);
    END IF;

    RETURN ROUND(v_ord_cost + v_night_cost + v_ot_cost + v_allow_cost, 2);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_eba_estimate_shift_cost(date, time without time zone, integer, integer, numeric, text, boolean, boolean, boolean, boolean, time without time zone, integer, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_eba_estimate_shift_cost(date, time without time zone, integer, integer, numeric, text, boolean, boolean, boolean, boolean, time without time zone, integer, uuid, text) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION internal.shift_pay_terms(s shifts)
 RETURNS TABLE(pay_basis text, employment_type text, substantive_level smallint, paid_level smallint, higher_duties boolean, base_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
#variable_conflict use_column
DECLARE
    c hr.user_contracts;
    h hr.contract_pay_terms;
    v_card uuid := public.organization_rate_card(s.organization_id);
BEGIN
    -- No default card: not priced (P4), rather than another venue's rates.
    IF v_card IS NULL THEN
        RETURN;
    END IF;
    IF s.user_contract_id IS NOT NULL THEN
        SELECT * INTO c
          FROM hr.user_contracts uc
         WHERE uc.id = s.user_contract_id
           AND uc.user_id = s.assigned_employee_id;
    END IF;
    IF c.id IS NOT NULL THEN
        h := hr.contract_pay_terms_on(c.id, s.shift_date);
    END IF;

    RETURN QUERY
    SELECT * FROM internal.resolve_pay_terms(
        s.shift_date,
        NULL::smallint,
        s.target_employment_type,
        CASE WHEN c.id IS NULL THEN NULL ELSE COALESCE(h.pay_basis, c.pay_basis) END,
        CASE WHEN h.pay_basis IS NOT NULL THEN h.remuneration_level ELSE c.remuneration_level END,
        CASE WHEN h.pay_basis IS NOT NULL THEN h.annual_salary ELSE c.annual_salary END,
        c.employment_status::text,
        c.contracted_weekly_hours,
        COALESCE(c.is_apprentice, false) OR COALESCE(c.is_trainee, false) OR COALESCE(c.is_sws, false),
        v_card);
END;
$function$;


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
    v_card   uuid := public.organization_rate_card(s.organization_id);
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
             WHERE er.rate_card_id = v_card
               AND er.classification = 'SECURITY_LEVEL_' || t.paid_level::text
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
        COALESCE(s.unpaid_break_minutes, 0),
        v_card,
        public.organization_jurisdiction(s.organization_id));
END;
$function$;


CREATE OR REPLACE FUNCTION public.fn_eba_shift_cost(s shifts)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    -- NULL, not 0, for an organization with no rate card (P4): unpriced is not free.
    SELECT CASE WHEN public.organization_rate_card(s.organization_id) IS NULL THEN NULL
                ELSE COALESCE(internal.shift_cost(s, s.net_length_minutes), 0) END;
$function$;
