-- ============================================================================
-- Trading T4 — no edits while published (docs/design/shift-trading/01-trading-fsm.md D8).
-- A published shift (S3-S7) is frozen: every field the shift form can change,
-- notes and display order included, and the person on it. To change anything
-- a manager unpublishes (which ends any trade and offer) and edits the draft.
-- trg_shift_published_frozen is the backstop for every writer — the gateway,
-- sm_move_shift and the client's raw table updates alike.
-- Still allowed on a published shift: filling it (unassigned -> assigned),
-- emptying it (drop / reject / expiry), a trade approval swapping assignees,
-- and every lifecycle / trading / offer / bidding change.
-- Also drops trg_shift_edit_cascade: it rejected bids and cancelled legacy
-- swap_requests when a published shift's time changed, which can no longer
-- happen.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_shift_published_frozen()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF OLD.lifecycle_status <> 'Published' OR NEW.lifecycle_status <> 'Published' THEN
    RETURN NEW;
  END IF;

  IF (NEW.shift_date, NEW.start_time, NEW.end_time, NEW.unpaid_break_minutes, NEW.paid_break_minutes,
      NEW.break_start, NEW.break_end, NEW.unpaid_breaks, NEW.role_id, NEW.organization_id,
      NEW.department_id, NEW.sub_department_id, NEW.shift_group_id, NEW.roster_subgroup_id,
      NEW.timezone, NEW.is_training, NEW.required_skills, NEW.required_licenses, NEW.notes,
      NEW.display_order, NEW.event_ids, NEW.target_employment_type, NEW.target_requires_flexible)
     IS DISTINCT FROM
     (OLD.shift_date, OLD.start_time, OLD.end_time, OLD.unpaid_break_minutes, OLD.paid_break_minutes,
      OLD.break_start, OLD.break_end, OLD.unpaid_breaks, OLD.role_id, OLD.organization_id,
      OLD.department_id, OLD.sub_department_id, OLD.shift_group_id, OLD.roster_subgroup_id,
      OLD.timezone, OLD.is_training, OLD.required_skills, OLD.required_licenses, OLD.notes,
      OLD.display_order, OLD.event_ids, OLD.target_employment_type, OLD.target_requires_flexible) THEN
    RAISE EXCEPTION 'UNPUBLISH_TO_EDIT: a published shift cannot be edited — unpublish it first'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.assigned_employee_id IS NOT NULL
     AND NEW.assigned_employee_id IS NOT NULL
     AND NEW.assigned_employee_id IS DISTINCT FROM OLD.assigned_employee_id
     AND OLD.trading_status IS DISTINCT FROM 'TradeAccepted' THEN
    RAISE EXCEPTION 'UNPUBLISH_TO_REASSIGN: a published shift cannot change hands — unpublish it first'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_shift_published_frozen
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_shift_published_frozen();

CREATE OR REPLACE FUNCTION public.fsm_op_is_legal(p_state text, p_op text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE p_op
    WHEN 'select_winner' THEN p_state IN ('S5')
    WHEN 'publish' THEN p_state IN ('S1', 'S2')
    WHEN 'unpublish' THEN p_state IN ('S3', 'S4', 'S5', 'S6', 'S7')

    -- assign: unassigned (S1/S5) or a draft reassign (S2). A published assigned
    -- shift (S3/S4) changes person only after an unpublish (D8).
    WHEN 'assign' THEN p_state IN ('S1', 'S2', 'S5')

    -- unassign: inverse of assign, DRAFT-only. S2 (Draft+assigned) → S1. A published
    -- assigned shift (S3/S4) must be unpublished first (no defined unassigned-published
    -- FSM state), so it is NOT admitted here.
    WHEN 'unassign' THEN p_state IN ('S2')

    WHEN 'approve_trade' THEN p_state IN ('S7')
    WHEN 'reject_trade'  THEN p_state IN ('S7')
    WHEN 'delete' THEN p_state IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7')
    -- edit: drafts only. A published shift (S3-S7) is unpublished first (D8).
    WHEN 'edit' THEN p_state IN ('S1', 'S2')
    ELSE false
  END;
$function$;

DROP TRIGGER trg_shift_edit_cascade ON public.shifts;
DROP FUNCTION public.trg_shift_edit_cascade_fn();

REVOKE ALL ON FUNCTION public.fn_shift_published_frozen() FROM PUBLIC, anon, authenticated;
