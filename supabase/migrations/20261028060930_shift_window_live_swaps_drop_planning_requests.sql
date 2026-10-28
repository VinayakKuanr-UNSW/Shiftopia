-- get_employee_shift_window: let the parties to a live swap read each other's
-- roster, and drop the dead planning_requests lineage.
--
-- 20261027100556 meant to allow "the two parties to a LIVE swap", but pointed
-- the rule at planning_requests / planning_offers. Those tables have never held
-- a row: live swaps are shift_swaps + swap_offers (sm_create_swap_request,
-- sm_accept_trade, swaps.api.ts). So the branch could never match. (Correction,
-- same day: swap compliance did not call this function at the time; it read
-- shifts under RLS, which shows an employee almost none of the counterparty's
-- roster. swaps.api.ts now reads both parties' history through this function,
-- which is what makes the rule below load-bearing. trg_shift_eba_compliance
-- still checks every resulting assignment at commit.)
--
-- The rule is the one 20261027100556 stated, on the tables that hold swaps:
-- while a swap is open (OPEN, OFFER_SELECTED, MANAGER_PENDING), its requester
-- and its target, or its requester and any employee with a live offer on it
-- (SUBMITTED, SELECTED), may read each other's window. Everything else in the
-- guard is unchanged; this body is the live pg_get_functiondef with that one
-- branch replaced.
--
-- The planning lineage goes with it: the client code was deleted on
-- 2026-10-28, both tables are empty, and sm_finalize_planning_request and
-- can_act_on_planning_request have no other caller. The tables' policies and
-- updated_at triggers are dropped with them (set_updated_at is shared, kept).

CREATE OR REPLACE FUNCTION public.get_employee_shift_window(p_employee_id uuid, p_start_date date, p_end_date date, p_exclude_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, shift_date date, start_time time without time zone, end_time time without time zone, unpaid_break_minutes integer, user_contract_id uuid, paid_break_minutes integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.sm_request_is_system() AND p_employee_id IS DISTINCT FROM v_uid THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;

    IF NOT (
      EXISTS (
        SELECT 1
        FROM public.app_access_certificates ac
        JOIN public.rbac_permissions rp ON rp.access_level = ac.access_level
        WHERE ac.user_id = v_uid AND ac.is_active
          AND rp.action_code = 'shift.view' AND rp.scope::text <> 'SELF'
        UNION ALL
        SELECT 1
        FROM public.user_contracts uc
        JOIN public.rbac_permissions rp ON rp.access_level = uc.access_level
        WHERE uc.user_id = v_uid AND uc.status = 'Active'
          AND rp.action_code = 'shift.view' AND rp.scope::text <> 'SELF'
      )
      OR EXISTS (
        SELECT 1
        FROM public.shift_swaps r
        WHERE r.status IN ('OPEN', 'OFFER_SELECTED', 'MANAGER_PENDING')
          AND (
               (r.requester_id = v_uid AND r.target_id = p_employee_id)
            OR (r.requester_id = p_employee_id AND r.target_id = v_uid)
            OR EXISTS (
                 SELECT 1 FROM public.swap_offers o
                 WHERE o.swap_request_id = r.id
                   AND o.status IN ('SUBMITTED', 'SELECTED')
                   AND ((r.requester_id = v_uid AND o.offerer_id = p_employee_id)
                     OR (r.requester_id = p_employee_id AND o.offerer_id = v_uid)))
          )
      )
    ) THEN
      RAISE EXCEPTION 'not authorised to read this employee''s roster'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.shift_date,
    s.start_time,
    s.end_time,
    s.unpaid_break_minutes,
    s.user_contract_id,
    s.paid_break_minutes
  FROM public.shifts s
  WHERE s.assigned_employee_id = p_employee_id
    AND s.shift_date >= p_start_date
    AND s.shift_date <= p_end_date
    AND s.lifecycle_status != 'Cancelled' -- Correct column name
    AND s.deleted_at IS NULL
    AND (p_exclude_id IS NULL OR s.id != p_exclude_id);
END;
$function$;

DROP FUNCTION public.sm_finalize_planning_request(uuid, uuid, uuid, text, timestamp with time zone, timestamp with time zone);
DROP TABLE public.planning_offers;
DROP TABLE public.planning_requests;
DROP FUNCTION public.can_act_on_planning_request(text, uuid);
