-- The contract pay terms on the shift row, for per-card estimates.
--
-- Roster, timesheet, My Roster and bid/swap cards price a shift in TypeScript
-- (cost/index.ts), but only ever saw the SHIFT's level and target — so an L7
-- casual on an L4 shift showed L4 pay while the budget footer and payroll paid
-- L7. This computed field hands each card the same terms internal.shift_cost
-- uses: the linked contract's on the shift date.
--
-- AUDIENCE = the contract RLS (contracts_select_own / contracts_select_delta):
-- the assignee, or a delta-access manager. Everyone else gets NULL and the card
-- prices on the shift's own terms, as before. internal.shift_pay_terms only
-- reads a contract owned by s.assigned_employee_id, so a row built by hand and
-- passed to this function can only reach a contract its caller could already
-- read — no re-read of the shift (and its six SELECT policies) per row.
--
-- base_rate is included: for a salaried contract it is the salary's hourly
-- equivalent, which this audience can already read as annual_salary.

CREATE OR REPLACE FUNCTION public.shift_pay_terms(s public.shifts)
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
    IF s.user_contract_id IS NULL OR s.assigned_employee_id IS NULL OR v_uid IS NULL THEN
        RETURN NULL;
    END IF;
    IF s.assigned_employee_id <> v_uid AND NOT public.user_has_delta_access(v_uid) THEN
        RETURN NULL;
    END IF;

    SELECT * INTO t FROM internal.shift_pay_terms(s);
    RETURN jsonb_build_object(
        'pay_basis',         t.pay_basis,
        'employment_type',   t.employment_type,
        'substantive_level', t.substantive_level,
        'paid_level',        t.paid_level,
        'higher_duties',     t.higher_duties,
        'base_rate',         round(t.base_rate, 4));
END;
$function$;

REVOKE ALL ON FUNCTION public.shift_pay_terms(public.shifts) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_pay_terms(public.shifts) TO authenticated, service_role;

COMMENT ON FUNCTION public.shift_pay_terms(public.shifts) IS
  'Computed field: the linked contract''s pay terms on the shift date (pay_basis, employment_type, substantive_level, paid_level, higher_duties, base_rate). NULL unless the caller is the assignee or has delta access. Name it explicitly in a select — * never includes computed fields.';

-- Bulk form for get-roster-view, which reads shifts with the service role and
-- caches them across users: it asks this with the CALLER's token, per request.
-- SECURITY INVOKER — shifts RLS decides which ids come back.
CREATE OR REPLACE FUNCTION public.get_shift_pay_terms(p_shift_ids uuid[])
 RETURNS TABLE (shift_id uuid, pay_terms jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT s.id, public.shift_pay_terms(s)
      FROM public.shifts s
     WHERE s.id = ANY (p_shift_ids)
       AND s.user_contract_id IS NOT NULL
       AND s.assigned_employee_id IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.get_shift_pay_terms(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shift_pay_terms(uuid[]) TO authenticated, service_role;
