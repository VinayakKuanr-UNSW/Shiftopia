-- Shift pricing on the CONTRACT's terms.
--
-- Until now every cost function priced a shift off the SHIFT's own level and
-- employment target. The user's rule (2026-10-08): someone on a level is paid
-- that level. So an ASSIGNED shift is now priced on the assignee's contract —
-- the pay terms in force on the shift date (hr.contract_pay_terms_on):
--
--   • eba_level — paid at the HIGHER of the contract level and the shift's
--     level. Shift level above the contract level is higher duties (cl 29):
--     the whole shift at the higher rate, topped up to 4 paid hours when shorter
--     (cl 29.1(a)) — the reading standard.ts already implements. Apprentice /
--     trainee / supported-wage contracts get no higher-duties uplift (their rates
--     are schedule-derived, as in standard.ts).
--   • eba_security_annualised — Full-Time Security, Sch 2 §2 / Sch 3: the full
--     span at the annualised rate, 12h ordinary cap, overtime on the ordinary
--     rate. No penalties, night loadings or minimum engagement (in lieu).
--   • salary — outside the EA: budget cost = hours × salary / 52 / weekly hours.
--     No EA penalties or overtime.
--   An UNASSIGNED (or unlinked) shift is priced as before: its own level and
--   employment target. Per-shift rate overrides (actual_hourly_rate,
--   remuneration_rate) no longer override contract pay — NULL on every prod
--   shift, and no code writes them.
--
-- Also fixed here — auto_link_shift_to_contract only linked a shift to a
-- contract when it had NO link yet. Unassigning left the old link behind, and
-- reassigning kept the PREVIOUS person's contract, so contract-based pricing
-- would have paid the new assignee at the old assignee's level. It now re-links
-- on every assignment/role change, clears on unassign, keeps an explicit link
-- only when it belongs to the assignee, and runs SECURITY DEFINER so a manager
-- who cannot read the assignee's contract (RLS) still links it.
--
-- PRIVACY: resolving pay terms reads contracts — for a salaried contract, its
-- salary. The resolver runs SECURITY DEFINER (so the roster footer total does
-- not depend on whose contracts the viewer can read) but lives in schema
-- `internal`, which is NOT in pgrst.db_schemas: no API client can call it, and
-- only aggregate cost functions use it. fn_eba_shift_cost(shifts) — which the
-- API could call per shift as a computed field — is closed to clients; only the
-- SECURITY DEFINER insight RPCs call it.
--
-- Prod has 0 shifts today, so no existing figure moves.

-- ── 1. A schema the Data API does not expose ────────────────────────────────
CREATE SCHEMA IF NOT EXISTS internal;
COMMENT ON SCHEMA internal IS
  'Helpers for SQL functions only. NOT in pgrst.db_schemas — never reachable through the Data API. Grant EXECUTE per function.';
REVOKE ALL ON SCHEMA internal FROM PUBLIC;
GRANT USAGE ON SCHEMA internal TO authenticated, service_role;

-- ── 2. Link a shift to the assignee's contract — correctly ──────────────────
CREATE OR REPLACE FUNCTION public.auto_link_shift_to_contract()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
BEGIN
    -- Nobody assigned: nobody's contract.
    IF NEW.assigned_employee_id IS NULL THEN
        NEW.user_contract_id := NULL;
        RETURN NEW;
    END IF;

    -- Nothing that decides the contract changed.
    IF TG_OP = 'UPDATE'
       AND NEW.assigned_employee_id IS NOT DISTINCT FROM OLD.assigned_employee_id
       AND NEW.role_id              IS NOT DISTINCT FROM OLD.role_id
       AND NEW.sub_department_id    IS NOT DISTINCT FROM OLD.sub_department_id
       AND NEW.user_contract_id     IS NOT DISTINCT FROM OLD.user_contract_id
       AND NEW.user_contract_id     IS NOT NULL
    THEN
        RETURN NEW;
    END IF;

    -- A link the caller set explicitly is kept when it is the assignee's own.
    IF NEW.user_contract_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.user_contract_id IS DISTINCT FROM OLD.user_contract_id)
       AND EXISTS (SELECT 1 FROM hr.user_contracts uc
                    WHERE uc.id = NEW.user_contract_id
                      AND uc.user_id = NEW.assigned_employee_id)
    THEN
        RETURN NEW;
    END IF;

    -- Otherwise: the assignee's active contract for this role, else one in this
    -- sub-department on the shift's employment type — the same scopes
    -- fn_enforce_shift_employment_target accepts.
    NEW.user_contract_id := (
        SELECT uc.id
          FROM hr.user_contracts uc
         WHERE uc.user_id = NEW.assigned_employee_id
           AND uc.status = 'Active'
           AND ( NEW.sub_department_id IS NULL
              OR uc.sub_department_id = NEW.sub_department_id
              OR uc.sub_department_id IS NULL )
         ORDER BY (uc.role_id IS NOT DISTINCT FROM NEW.role_id) DESC,
                  (uc.sub_department_id IS NOT DISTINCT FROM NEW.sub_department_id) DESC,
                  (public.fn_normalize_employment_type(uc.employment_status::text)
                       = NEW.target_employment_type) DESC,
                  uc.remuneration_level DESC NULLS LAST,
                  uc.id
         LIMIT 1);
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_link_shift_to_contract() FROM PUBLIC, anon, authenticated;

DROP TRIGGER tr_auto_link_shift_contract ON public.shifts;
CREATE TRIGGER tr_auto_link_shift_contract
    BEFORE INSERT OR UPDATE OF assigned_employee_id, user_contract_id, role_id, sub_department_id
    ON public.shifts
    FOR EACH ROW EXECUTE FUNCTION public.auto_link_shift_to_contract();

-- ── 3. The engine gains the cl 29.1(a) higher-duties minimum ────────────────
-- Body copied from pg_get_functiondef() on 2026-10-08; the only change is the
-- p_higher_duties parameter and the block marked "cl 29.1(a)", placed where
-- standard.ts has it: after the minimum-engagement floor, before first aid
-- (which is priced on paid ordinary hours, so it includes the top-up).
-- A new trailing parameter changes the signature, so DROP + CREATE; existing
-- 9-argument calls resolve to the default.
DROP FUNCTION public.fn_eba_estimate_shift_cost(date, time without time zone, integer, integer, numeric, text, boolean, boolean, boolean);

CREATE OR REPLACE FUNCTION public.fn_eba_estimate_shift_cost(p_shift_date date, p_start_time time without time zone, p_net_minutes integer, p_scheduled_minutes integer, p_base_rate numeric, p_employment_type text, p_requires_flexible boolean DEFAULT false, p_is_training boolean DEFAULT false, p_first_aid boolean DEFAULT false, p_higher_duties boolean DEFAULT false)
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

    -- cl 29.1(a) higher-duties minimum: a shift paid at a higher level for under
    -- 4 paid hours is topped up to 4 at the engagement-day rate (standard.ts).
    IF p_higher_duties AND v_net_h > 0 AND v_paid_ord_h < 4 THEN
        v_ord_cost   := v_ord_cost + (4 - v_paid_ord_h) * v_start_pen_rate;
        v_paid_ord_h := 4;
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

-- Same grants as before the DROP (no anon), restated: DROP took them.
REVOKE ALL ON FUNCTION public.fn_eba_estimate_shift_cost(date, time without time zone, integer, integer, numeric, text, boolean, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_eba_estimate_shift_cost(date, time without time zone, integer, integer, numeric, text, boolean, boolean, boolean, boolean) TO authenticated, service_role;

-- ── 4. The pay-terms rule — pure, mirrored by resolveShiftPayTerms() in TS ──
-- Inputs are the shift's own terms plus the contract's terms ON THE SHIFT DATE
-- (all contract arguments NULL = unassigned or unlinked). base_rate is what the
-- cost step prices from: the EA paid rate (casual loading included) for a
-- level, the annualised hourly for annualised Security, the hourly equivalent
-- of a salary.
CREATE OR REPLACE FUNCTION internal.resolve_pay_terms(
    p_shift_date                 date,
    p_shift_level                smallint,
    p_shift_employment_type      text,
    p_contract_pay_basis         text,
    p_contract_level             smallint,
    p_annual_salary              numeric,
    p_contract_employment_status text,
    p_contract_weekly_hours      numeric,
    p_uses_wage_scheme           boolean)
 RETURNS TABLE (
    pay_basis         text,
    employment_type   text,
    substantive_level smallint,
    paid_level        smallint,
    higher_duties     boolean,
    base_rate         numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    WITH t AS (
        SELECT COALESCE(p_contract_pay_basis, 'eba_level') AS basis,
               COALESCE(NULLIF(p_shift_employment_type, ''),
                        public.fn_normalize_employment_type(p_contract_employment_status)) AS emp,
               CASE WHEN p_contract_pay_basis IS NULL THEN p_shift_level
                    ELSE p_contract_level END AS sub
    ), lv AS (
        SELECT t.*,
               CASE
                   WHEN basis = 'salary' THEN NULL::smallint
                   -- Annualised rates exist for Levels 3–6 only (Sch 2 §2).
                   WHEN basis = 'eba_security_annualised' THEN
                        CASE WHEN p_shift_level BETWEEN 3 AND 6 AND p_shift_level > sub
                             THEN p_shift_level ELSE sub END
                   WHEN p_contract_pay_basis IS NULL OR COALESCE(p_uses_wage_scheme, false) THEN sub
                   ELSE GREATEST(sub, COALESCE(p_shift_level, sub))
               END AS paid
          FROM t
    )
    SELECT lv.basis,
           lv.emp,
           CASE WHEN lv.basis = 'salary' THEN NULL::smallint ELSE lv.sub END,
           lv.paid,
           COALESCE(lv.paid > lv.sub, false),
           CASE lv.basis
               WHEN 'salary' THEN
                   p_annual_salary / 52.0
                   / COALESCE(NULLIF(CASE WHEN lv.emp = 'FT' THEN 38 ELSE p_contract_weekly_hours END, 0), 38)
               WHEN 'eba_security_annualised' THEN (
                   SELECT er.paid_hourly_rate
                     FROM public.eba_rate er
                    WHERE er.classification = 'SECURITY_LEVEL_' || lv.paid::text
                      AND er.employment_basis = 'annualised'
                      AND er.effective_from <= p_shift_date
                    ORDER BY er.effective_from DESC
                    LIMIT 1)
               ELSE public.fn_eba_resolve_shift_rate(lv.paid, lv.emp, p_shift_date, NULL, NULL)
           END
      FROM lv;
$function$;

REVOKE ALL ON FUNCTION internal.resolve_pay_terms(date, smallint, text, text, smallint, numeric, text, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION internal.resolve_pay_terms(date, smallint, text, text, smallint, numeric, text, numeric, boolean) TO authenticated, service_role;

-- ── 5. Pay terms for one shift ──────────────────────────────────────────────
-- SECURITY DEFINER: reads the linked contract and its pay history whatever the
-- caller's contract visibility, so an aggregate is the same for every viewer.
-- Only the assignee's own contract is used (guards a stale link).
CREATE OR REPLACE FUNCTION internal.shift_pay_terms(s public.shifts)
 RETURNS TABLE (
    pay_basis         text,
    employment_type   text,
    substantive_level smallint,
    paid_level        smallint,
    higher_duties     boolean,
    base_rate         numeric)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
    SELECT r.*
      FROM (SELECT 1) one
      LEFT JOIN hr.user_contracts c
             ON c.id = s.user_contract_id
            AND c.user_id = s.assigned_employee_id
      LEFT JOIN LATERAL (SELECT * FROM hr.contract_pay_terms_on(c.id, s.shift_date)) h
             ON c.id IS NOT NULL
     CROSS JOIN LATERAL internal.resolve_pay_terms(
            s.shift_date,
            s.remuneration_level,
            s.target_employment_type,
            CASE WHEN c.id IS NULL THEN NULL ELSE COALESCE(h.pay_basis, c.pay_basis) END,
            CASE WHEN h.pay_basis IS NOT NULL THEN h.remuneration_level ELSE c.remuneration_level END,
            CASE WHEN h.pay_basis IS NOT NULL THEN h.annual_salary ELSE c.annual_salary END,
            c.employment_status::text,
            c.contracted_weekly_hours,
            COALESCE(c.is_apprentice, false) OR COALESCE(c.is_trainee, false) OR COALESCE(c.is_sws, false)
         ) r;
$function$;

REVOKE ALL ON FUNCTION internal.shift_pay_terms(public.shifts) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION internal.shift_pay_terms(public.shifts) TO authenticated, service_role;

-- ── 6. Cost of one shift for a number of minutes ────────────────────────────
-- NULL when the shift cannot be priced (no level and no contract) — callers
-- count those as "uncosted". Shared by fn_eba_shift_cost (scheduled minutes)
-- and the Roster Planner (scheduled and worked minutes).
CREATE OR REPLACE FUNCTION internal.shift_cost(s public.shifts, p_net_minutes integer)
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
        t.higher_duties AND t.pay_basis = 'eba_level');
END;
$function$;

REVOKE ALL ON FUNCTION internal.shift_cost(public.shifts, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION internal.shift_cost(public.shifts, integer) TO authenticated, service_role;

-- ── 7. The cost entry points ────────────────────────────────────────────────
-- fn_eba_shift_cost keeps its signature and contract (0 when unpriced) for the
-- five insight RPCs that call it. It takes the table row, so the Data API would
-- expose it as a per-shift computed field — closed to clients.
CREATE OR REPLACE FUNCTION public.fn_eba_shift_cost(s shifts)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT COALESCE(internal.shift_cost(s, s.net_length_minutes), 0);
$function$;

REVOKE ALL ON FUNCTION public.fn_eba_shift_cost(shifts) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_eba_shift_cost(shifts) TO service_role;

-- Roster Planner: same body as 20261008095809 except pricing — the per-shift
-- rate COALESCE and the two engine calls become internal.shift_cost() on the
-- shift row, and "costed" means a price could be resolved.
CREATE OR REPLACE FUNCTION public.get_roster_planner_stats(p_organization_id uuid, p_start_date date, p_end_date date, p_department_ids uuid[] DEFAULT NULL::uuid[], p_sub_department_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(total_shifts integer, assigned_shifts integer, open_shifts integer, published_shifts integer, cancelled_shifts integer, total_net_minutes bigint, unique_employees integer, est_cost numeric, budget_cost numeric, scheduled_cost numeric, actual_cost numeric, actual_net_minutes bigint, costed_shifts integer, uncosted_shifts integer, actual_shifts integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH scoped AS (
      SELECT
          s.*,
          s AS shift_row,
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
          -- Full award pricing on the assignee's contract terms (or the shift's
          -- own terms when unassigned): cl 41 penalties, cl 41.4, cl 42 OT, cl 43
          -- night, cl 28.1 meal, cl 28.2 first aid, cl 12/56.2 minimum
          -- engagement, cl 29 higher duties, Sch 2 §2 annualised Security, salary.
          internal.shift_cost(shift_row, net_length_minutes) AS sched_shift_cost,
          CASE WHEN worked_minutes IS NULL THEN NULL
               ELSE internal.shift_cost(shift_row, worked_minutes)
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
      COUNT(*) FILTER (WHERE NOT is_cancelled AND sched_shift_cost IS NOT NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND sched_shift_cost IS NULL)::int,
      COUNT(*) FILTER (WHERE NOT is_cancelled AND worked_minutes IS NOT NULL)::int
  FROM priced;
$function$;
