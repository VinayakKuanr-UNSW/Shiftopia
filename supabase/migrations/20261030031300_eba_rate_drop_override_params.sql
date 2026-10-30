-- fn_eba_resolve_shift_rate loses its two dead rate-override parameters.
--
-- p_actual_hourly_rate and p_remuneration_rate fed "an explicit per-shift rate
-- always wins". Their only caller, internal.resolve_pay_terms, passed NULL for
-- both, and the shifts columns they mirrored are dropped (20261030014859): a
-- shift is priced from its level only. The function is recreated with the three
-- live parameters (dropped first: a 3-arg version beside the 5-arg one with
-- defaults would make every 3-arg call ambiguous) and its EXECUTE grants kept.
-- resolve_pay_terms is rebuilt from its live definition with only the call
-- changed. Same rate for every input.
--
-- Test: supabase/tests/eba_rate_has_no_override.sql.

CREATE OR REPLACE FUNCTION internal.resolve_pay_terms(p_shift_date date, p_shift_level smallint, p_shift_employment_type text, p_contract_pay_basis text, p_contract_level smallint, p_annual_salary numeric, p_contract_employment_status text, p_contract_weekly_hours numeric, p_uses_wage_scheme boolean)
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
         WHERE er.classification = 'SECURITY_LEVEL_' || v_paid::text
           AND er.employment_basis = 'annualised'
           AND er.effective_from <= p_shift_date
         ORDER BY er.effective_from DESC
         LIMIT 1;
    ELSE
        v_rate := public.fn_eba_resolve_shift_rate(v_paid, v_emp, p_shift_date);
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

DROP FUNCTION public.fn_eba_resolve_shift_rate(smallint, text, date, numeric, numeric);

CREATE FUNCTION public.fn_eba_resolve_shift_rate(p_remuneration_level smallint, p_target_employment_type text, p_shift_date date)
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
     WHERE er.classification = CASE
               WHEN p_remuneration_level = 0 THEN 'TRAINEE'
               ELSE 'LEVEL_' || p_remuneration_level::text END
       AND er.employment_basis = CASE
               WHEN p_target_employment_type = 'Casual' THEN 'casual'
               ELSE 'permanent' END
       AND er.effective_from <= p_shift_date
     ORDER BY er.effective_from DESC
     LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_eba_resolve_shift_rate(smallint, text, date) TO PUBLIC, anon, authenticated, service_role;
