-- The contract a shift links to must be on the shift's employment target.
--
-- Pricing now reads the linked contract (20261008104434), and both the SQL
-- resolver and the TS copy take the employment type from the shift's target.
-- That is only the same thing as "the contract's type" if the link picks a
-- contract on that target. Three gaps:
--
--   1. The link ranked role and sub-department ABOVE employment type, so a
--      person holding an FT contract in this sub-department and a Casual one
--      with no sub-department could have a Casual-target shift linked to the
--      FT contract. fn_enforce_shift_employment_target guarantees a contract on
--      the target exists in scope (path 1: the role's contract IS on the
--      target; path 2: some in-scope contract is) — so ranking the target
--      FIRST always finds it, and the role contract still wins the tie.
--   2. It did not re-link when target_employment_type changed.
--   3. It fired BEFORE trg_shift_employment_target_1_resolve and
--      trg_shift_placement (same-timing triggers fire in name order and
--      'tr_' < 'trg'), so on INSERT it could rank on a target the template
--      had not filled in yet. Renamed so it fires after them. No other BEFORE
--      trigger reads user_contract_id (checked 2026-10-08).
--
-- Body from pg_get_functiondef() (md5 27ba3ea1026ced82b7679f48b589131f);
-- changes are the target_employment_type line in the no-op check and the
-- ORDER BY.

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
       AND NEW.assigned_employee_id   IS NOT DISTINCT FROM OLD.assigned_employee_id
       AND NEW.role_id                IS NOT DISTINCT FROM OLD.role_id
       AND NEW.sub_department_id      IS NOT DISTINCT FROM OLD.sub_department_id
       AND NEW.target_employment_type IS NOT DISTINCT FROM OLD.target_employment_type
       AND NEW.user_contract_id       IS NOT DISTINCT FROM OLD.user_contract_id
       AND NEW.user_contract_id       IS NOT NULL
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

    -- Otherwise: the assignee's active contract on the shift's employment
    -- target — for this role, else in this sub-department — the same scopes
    -- fn_enforce_shift_employment_target accepts.
    NEW.user_contract_id := (
        SELECT uc.id
          FROM hr.user_contracts uc
         WHERE uc.user_id = NEW.assigned_employee_id
           AND uc.status = 'Active'
           AND ( NEW.sub_department_id IS NULL
              OR uc.sub_department_id = NEW.sub_department_id
              OR uc.sub_department_id IS NULL )
         ORDER BY (public.fn_normalize_employment_type(uc.employment_status::text)
                       IS NOT DISTINCT FROM NEW.target_employment_type) DESC,
                  (uc.role_id IS NOT DISTINCT FROM NEW.role_id) DESC,
                  (uc.sub_department_id IS NOT DISTINCT FROM NEW.sub_department_id) DESC,
                  uc.remuneration_level DESC NULLS LAST,
                  uc.id
         LIMIT 1);
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_link_shift_to_contract() FROM PUBLIC, anon, authenticated;

DROP TRIGGER tr_auto_link_shift_contract ON public.shifts;
-- 'trg_shift_z…' sorts after every trigger that fills in the target, role or
-- sub-department, so the link ranks on the final values.
CREATE TRIGGER trg_shift_z_link_contract
    BEFORE INSERT OR UPDATE OF assigned_employee_id, user_contract_id, role_id, sub_department_id, target_employment_type
    ON public.shifts
    FOR EACH ROW EXECUTE FUNCTION public.auto_link_shift_to_contract();
