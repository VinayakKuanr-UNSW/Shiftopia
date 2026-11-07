-- Shift reads no longer pay for the whole swap history.
--
-- shifts_select_offered_swaps and shifts_select_open_swaps each ask "is this
-- shift in a live swap the caller can see?" with an EXISTS over shift_swaps.
-- That subquery runs under shift_swaps' own RLS (swaps_select_scoped), whose
-- function calls are security-barrier quals: Postgres evaluates them on every
-- swap row BEFORE the policy's status filter. The planner turns the EXISTS into
-- one hashed scan of the whole table, so the cost grew with every swap ever
-- made: 631 of 682 ms for a manager's department-week read at 8,500 swaps
-- (7,986 CANCELLED), measured on the 1M-shift bench (scripts/bench).
--
-- Each policy now calls a per-shift helper that finds that shift's live swaps
-- by index first and only then applies the visibility rule. The rule is
-- unchanged: internal.caller_can_see_swap is swaps_select_scoped written out,
-- and supabase/tests/swap_visibility_rls_per_shift.sql fails if the two ever
-- disagree.
--
-- Rollback: restore the two USING clauses quoted at the end, then drop the
-- three functions.

CREATE OR REPLACE FUNCTION internal.caller_can_see_swap(
    p_swap_id uuid, p_requester_id uuid, p_target_id uuid, p_requester_shift_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    -- Must match policy swaps_select_scoped ON public.shift_swaps. RLS reads
    -- NULL as "hidden"; coalesce says so explicitly (a swap with no target).
    SELECT coalesce(
           p_requester_id = auth.uid()
        OR p_target_id = auth.uid()
        OR public.can_act_on_shift('swap.view', p_requester_shift_id)
        OR public.user_has_swap_offer(auth.uid(), p_swap_id)
        OR public.user_has_access_to_swap(auth.uid(), p_requester_shift_id), false);
$$;

CREATE OR REPLACE FUNCTION internal.shift_is_target_of_visible_live_swap(p_shift_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.shift_swaps ss
         WHERE ss.target_shift_id = p_shift_id
           AND ss.status IN ('OPEN', 'MANAGER_PENDING')
           AND internal.caller_can_see_swap(ss.id, ss.requester_id, ss.target_id, ss.requester_shift_id));
$$;

CREATE OR REPLACE FUNCTION internal.shift_is_requester_of_visible_open_swap(p_shift_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.shift_swaps ss
         WHERE ss.requester_shift_id = p_shift_id
           AND ss.status = 'OPEN'
           AND internal.caller_can_see_swap(ss.id, ss.requester_id, ss.target_id, ss.requester_shift_id));
$$;

REVOKE ALL ON FUNCTION internal.caller_can_see_swap(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION internal.shift_is_target_of_visible_live_swap(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION internal.shift_is_requester_of_visible_open_swap(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION internal.caller_can_see_swap(uuid, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION internal.shift_is_target_of_visible_live_swap(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION internal.shift_is_requester_of_visible_open_swap(uuid) TO authenticated;

-- The sub-department check comes first: it is one hashed lookup per query, so
-- the per-shift helper only runs for shifts in the caller's own sub-departments.
ALTER POLICY shifts_select_offered_swaps ON public.shifts
  USING (
    EXISTS (SELECT 1 FROM user_contracts uc
             WHERE uc.user_id = (SELECT auth.uid()) AND uc.status = 'Active'
               AND uc.sub_department_id = shifts.sub_department_id)
    AND internal.shift_is_target_of_visible_live_swap(shifts.id));

ALTER POLICY shifts_select_open_swaps ON public.shifts
  USING (
    EXISTS (SELECT 1 FROM user_contracts uc
             WHERE uc.user_id = (SELECT auth.uid()) AND uc.status = 'Active'
               AND uc.sub_department_id = shifts.sub_department_id)
    AND internal.shift_is_requester_of_visible_open_swap(shifts.id));

-- Previous definitions (pg_policy, 2026-11-06):
--   shifts_select_offered_swaps:
--     ((EXISTS ( SELECT 1 FROM shift_swaps WHERE ((shift_swaps.target_shift_id = shifts.id) AND (shift_swaps.status = ANY (ARRAY['OPEN'::swap_request_status, 'MANAGER_PENDING'::swap_request_status]))))) AND (EXISTS ( SELECT 1 FROM user_contracts uc WHERE ((uc.user_id = ( SELECT auth.uid() AS uid)) AND (uc.status = 'Active'::text) AND (uc.sub_department_id = shifts.sub_department_id)))))
--   shifts_select_open_swaps:
--     ((EXISTS ( SELECT 1 FROM shift_swaps WHERE ((shift_swaps.requester_shift_id = shifts.id) AND (shift_swaps.status = 'OPEN'::swap_request_status)))) AND (EXISTS ( SELECT 1 FROM user_contracts uc WHERE ((uc.user_id = ( SELECT auth.uid() AS uid)) AND (uc.status = 'Active'::text) AND (uc.sub_department_id = shifts.sub_department_id)))))
