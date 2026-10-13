-- Prospective pay terms: what a given person WOULD be paid on a shift.
--
-- shift_pay_terms (20261008232922) answers "what is this shift paid, under the
-- contract it is linked to". Bids, offers and swaps ask a different question:
-- an open shift has no assignee yet, and a swap moves a shift to someone else.
-- The answer is the contract the link trigger WOULD pick for that person
-- (trg_shift_z_link_contract: employment target first, then role, then
-- sub-department — the ORDER BY below is a copy; change both together), on
-- that contract's terms for the shift date.
--
-- AUDIENCE as before: the person themselves, or a delta-access manager (who
-- can read every contract). internal.prospective_pay_terms only ever reads a
-- contract owned by p_employee, so a hand-built row reaches nothing more.

CREATE OR REPLACE FUNCTION internal.prospective_pay_terms(s public.shifts, p_employee uuid)
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
    p public.shifts := s;
BEGIN
    -- Already theirs and linked: the linked contract decides.
    IF s.assigned_employee_id = p_employee AND s.user_contract_id IS NOT NULL THEN
        RETURN QUERY SELECT * FROM internal.shift_pay_terms(s);
        RETURN;
    END IF;

    p.assigned_employee_id := p_employee;
    p.user_contract_id := (
        SELECT uc.id
          FROM hr.user_contracts uc
         WHERE uc.user_id = p_employee
           AND uc.status = 'Active'
           AND ( s.sub_department_id IS NULL
              OR uc.sub_department_id = s.sub_department_id
              OR uc.sub_department_id IS NULL )
         ORDER BY (public.fn_normalize_employment_type(uc.employment_status::text)
                       IS NOT DISTINCT FROM s.target_employment_type) DESC,
                  (uc.role_id IS NOT DISTINCT FROM s.role_id) DESC,
                  (uc.sub_department_id IS NOT DISTINCT FROM s.sub_department_id) DESC,
                  uc.remuneration_level DESC NULLS LAST,
                  uc.id
         LIMIT 1);
    -- No contract in scope: the shift's own terms (internal.shift_pay_terms
    -- prices an unlinked row on its own level and target).
    RETURN QUERY SELECT * FROM internal.shift_pay_terms(p);
END;
$function$;

REVOKE ALL ON FUNCTION internal.prospective_pay_terms(public.shifts, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION internal.prospective_pay_terms(public.shifts, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shift_pay_terms_for(s public.shifts, p_employee uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
#variable_conflict use_column
DECLARE
    v_uid uuid := auth.uid();
    t     record;
BEGIN
    IF p_employee IS NULL OR v_uid IS NULL THEN
        RETURN NULL;
    END IF;
    IF p_employee <> v_uid AND NOT public.user_has_delta_access(v_uid) THEN
        RETURN NULL;
    END IF;

    SELECT * INTO t FROM internal.prospective_pay_terms(s, p_employee);
    RETURN jsonb_build_object(
        'pay_basis',         t.pay_basis,
        'employment_type',   t.employment_type,
        'substantive_level', t.substantive_level,
        'paid_level',        t.paid_level,
        'higher_duties',     t.higher_duties,
        'base_rate',         round(t.base_rate, 4));
END;
$function$;

REVOKE ALL ON FUNCTION public.shift_pay_terms_for(public.shifts, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_pay_terms_for(public.shifts, uuid) TO authenticated, service_role;

-- Computed field: what the VIEWER would be paid on this shift (open bids).
CREATE OR REPLACE FUNCTION public.my_shift_pay_terms(s public.shifts)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT public.shift_pay_terms_for(s, auth.uid());
$function$;

REVOKE ALL ON FUNCTION public.my_shift_pay_terms(public.shifts) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_shift_pay_terms(public.shifts) TO authenticated, service_role;

COMMENT ON FUNCTION public.my_shift_pay_terms(public.shifts) IS
  'Computed field: the pay terms the viewer would get on this shift (their own contract the link trigger would choose), same shape as shift_pay_terms. Name it explicitly in a select.';

-- Pairwise bulk form: the swap view prices each shift for the person who
-- would receive it. SECURITY INVOKER — shifts RLS decides which rows exist.
CREATE OR REPLACE FUNCTION public.get_prospective_pay_terms(p_shift_ids uuid[], p_employee_ids uuid[])
 RETURNS TABLE (shift_id uuid, employee_id uuid, pay_terms jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT s.id, x.employee_id, public.shift_pay_terms_for(s, x.employee_id)
      FROM unnest(p_shift_ids, p_employee_ids) AS x(shift_id, employee_id)
      JOIN public.shifts s ON s.id = x.shift_id
     WHERE x.employee_id IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.get_prospective_pay_terms(uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_prospective_pay_terms(uuid[], uuid[]) TO authenticated, service_role;
