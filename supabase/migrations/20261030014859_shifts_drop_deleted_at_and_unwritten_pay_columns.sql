-- Drop shifts.deleted_at (Phase 2c) and the three pay columns nothing writes (Phase 1b).
--
-- Applied only after the code that stopped reading them is live: the frontend
-- on Vercel production and the redeployed get-roster-view edge function. Until
-- then the deployed app selected these columns, and PostgREST fails a whole
-- select on one missing column.
--
--   deleted_at: CHECK shifts_no_soft_delete kept it NULL on every row; Phase 2a
--     and 2b removed every reader. get_shift_delta still returned it, so it is
--     recreated without that output column (a changed return type needs DROP +
--     CREATE), keeping SECURITY INVOKER and its grants.
--   currency, actual_hourly_rate, remuneration_rate: never written (NULL or the
--     default 'AUD' on every row); a shift is priced from its level only.
--     fn_eba_resolve_shift_rate's same-named parameters are its own, and its one
--     caller passes NULL.
--
-- Plan: docs/handover/2026-10-30-shifts-table-plan.md.
-- Test: supabase/tests/shifts_phase2c_columns_dropped.sql.

-- The premise, checked at apply time: nothing is lost.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.shifts
             WHERE deleted_at IS NOT NULL OR actual_hourly_rate IS NOT NULL OR remuneration_rate IS NOT NULL
                OR (currency IS NOT NULL AND currency <> 'AUD')) THEN
    RAISE EXCEPTION 'shifts holds data in a column this migration drops';
  END IF;
END $$;

DROP FUNCTION public.get_shift_delta(uuid, timestamp with time zone, uuid[], date, date);

CREATE FUNCTION public.get_shift_delta(p_org_id uuid, p_since timestamp with time zone, p_dept_ids uuid[] DEFAULT NULL::uuid[], p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS TABLE(id uuid, updated_at timestamp with time zone, shift_date date, start_time time without time zone, end_time time without time zone, lifecycle_status shift_lifecycle, assignment_status shift_assignment_status, assigned_employee_id uuid, version integer, department_id uuid, sub_department_id uuid, role_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT
        s.id,
        s.updated_at,
        s.shift_date,
        s.start_time,
        s.end_time,
        s.lifecycle_status,
        s.assignment_status,
        s.assigned_employee_id,
        s.version,
        s.department_id,
        s.sub_department_id,
        s.role_id
    FROM shifts s
    WHERE
        s.organization_id = p_org_id
        AND s.updated_at > p_since
        AND (p_dept_ids IS NULL OR s.department_id = ANY(p_dept_ids))
        AND (p_start_date IS NULL OR s.shift_date >= p_start_date)
        AND (p_end_date   IS NULL OR s.shift_date <= p_end_date)
    ORDER BY s.updated_at ASC
    LIMIT 500;
$function$;

REVOKE ALL ON FUNCTION public.get_shift_delta(uuid, timestamp with time zone, uuid[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shift_delta(uuid, timestamp with time zone, uuid[], date, date) TO authenticated, service_role;

-- Two trigger definitions name deleted_at (not their function bodies): the
-- EBA check's UPDATE OF list (no writer ever sets the column) and TOIL's WHEN
-- clause (OLD and NEW are both NULL). Recreated without it; otherwise identical.
DROP TRIGGER trg_shift_eba_compliance ON public.shifts;
CREATE CONSTRAINT TRIGGER trg_shift_eba_compliance AFTER INSERT OR UPDATE OF assigned_employee_id, shift_date, start_time, end_time, break_start, break_end, unpaid_break_minutes, role_id, sub_department_id, target_employment_type, target_requires_flexible, is_training, user_contract_id, required_skills, required_licenses, lifecycle_status, is_cancelled ON public.shifts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION internal.trg_shift_eba_compliance();
DROP TRIGGER trg_toil_shift_change ON public.shifts;
CREATE TRIGGER trg_toil_shift_change AFTER UPDATE ON public.shifts FOR EACH ROW WHEN (((old.actual_start IS DISTINCT FROM new.actual_start) OR (old.actual_end IS DISTINCT FROM new.actual_end) OR (old.unpaid_break_minutes IS DISTINCT FROM new.unpaid_break_minutes) OR (old.user_contract_id IS DISTINCT FROM new.user_contract_id) OR (old.assigned_employee_id IS DISTINCT FROM new.assigned_employee_id) OR (old.shift_date IS DISTINCT FROM new.shift_date) OR (old.start_time IS DISTINCT FROM new.start_time) OR (old.end_time IS DISTINCT FROM new.end_time) OR (old.is_cancelled IS DISTINCT FROM new.is_cancelled))) EXECUTE FUNCTION internal.trg_toil_shift();

ALTER TABLE public.shifts
  DROP CONSTRAINT shifts_no_soft_delete,
  DROP COLUMN deleted_at,
  DROP COLUMN currency,
  DROP COLUMN actual_hourly_rate,
  DROP COLUMN remuneration_rate;
