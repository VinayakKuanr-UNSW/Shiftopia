-- Pay-terms resolver: same answers, ~20x cheaper per shift.
--
-- internal.resolve_pay_terms and internal.shift_pay_terms (20261008104434) were
-- LANGUAGE sql functions returning TABLE. A set-returning SQL function is
-- re-planned on EVERY call, so internal.shift_cost cost 1.25 ms per shift
-- (resolve_pay_terms alone 0.60 ms) against 0.08 ms for the EA engine itself.
-- get_roster_planner_stats calls it twice per shift: an 8,000-shift view would
-- spend ~20 s resolving pay terms. Measured 2026-10-09; prod had no shifts yet,
-- so nothing was slow in practice.
--
-- PL/pgSQL caches its statement plans per session. Bodies are a line-for-line
-- port — same NULL handling (CASE / GREATEST / string concatenation with a NULL
-- level), same lookups. Checked against the 18-case golden matrix that
-- payroll/__tests__/shiftPayTerms.test.ts pins the TS copy to.

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
        v_rate := public.fn_eba_resolve_shift_rate(v_paid, v_emp, p_shift_date, NULL, NULL);
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

REVOKE ALL ON FUNCTION internal.resolve_pay_terms(date, smallint, text, text, smallint, numeric, text, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION internal.resolve_pay_terms(date, smallint, text, text, smallint, numeric, text, numeric, boolean) TO authenticated, service_role;

-- SECURITY DEFINER as before: reads the linked contract and its pay history
-- whatever the caller's contract visibility. Only the assignee's own contract.
CREATE OR REPLACE FUNCTION internal.shift_pay_terms(s public.shifts)
 RETURNS TABLE (
    pay_basis         text,
    employment_type   text,
    substantive_level smallint,
    paid_level        smallint,
    higher_duties     boolean,
    base_rate         numeric)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
#variable_conflict use_column
DECLARE
    c hr.user_contracts;
    h hr.contract_pay_terms;
BEGIN
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
        s.remuneration_level,
        s.target_employment_type,
        CASE WHEN c.id IS NULL THEN NULL ELSE COALESCE(h.pay_basis, c.pay_basis) END,
        CASE WHEN h.pay_basis IS NOT NULL THEN h.remuneration_level ELSE c.remuneration_level END,
        CASE WHEN h.pay_basis IS NOT NULL THEN h.annual_salary ELSE c.annual_salary END,
        c.employment_status::text,
        c.contracted_weekly_hours,
        COALESCE(c.is_apprentice, false) OR COALESCE(c.is_trainee, false) OR COALESCE(c.is_sws, false));
END;
$function$;

REVOKE ALL ON FUNCTION internal.shift_pay_terms(public.shifts) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION internal.shift_pay_terms(public.shifts) TO authenticated, service_role;
