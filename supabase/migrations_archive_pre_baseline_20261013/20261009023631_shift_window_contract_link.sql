-- get_employee_shift_window also returns each shift's contract link.
--
-- Compliance relaxes the cl 39/40 limits only for shifts worked under a
-- salaried contract (compliance/v8/utils/governing-contract.ts). A person's
-- HISTORY comes from this function and carried no contract, so for anyone
-- with more than one contract a past shift could not be placed and the rule
-- had to assume the strictest case. user_contract_id places it exactly — the
-- employee's contracts already carry their ids in the compliance context.
--
-- Only the opaque contract id is added: this function is deliberately
-- unguarded (cross-department history for compliance), so it does not start
-- returning role, sub-department or employment target.
--
-- Body from pg_get_functiondef() (md5 c25c5034dfcfc83967c5999b80385c07); the
-- only change is the extra column. A new return type needs DROP + CREATE, and
-- CREATE in public re-grants EXECUTE to anon by default — the original grants
-- (authenticated, service_role; not anon) are restated.

DROP FUNCTION public.get_employee_shift_window(uuid, date, date, uuid);

CREATE FUNCTION public.get_employee_shift_window(p_employee_id uuid, p_start_date date, p_end_date date, p_exclude_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, shift_date date, start_time time without time zone, end_time time without time zone, unpaid_break_minutes integer, user_contract_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.shift_date,
    s.start_time,
    s.end_time,
    s.unpaid_break_minutes,
    s.user_contract_id
  FROM public.shifts s
  WHERE s.assigned_employee_id = p_employee_id
    AND s.shift_date >= p_start_date
    AND s.shift_date <= p_end_date
    AND s.lifecycle_status != 'Cancelled' -- Correct column name
    AND s.deleted_at IS NULL
    AND (p_exclude_id IS NULL OR s.id != p_exclude_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_employee_shift_window(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employee_shift_window(uuid, date, date, uuid) TO authenticated, service_role;
