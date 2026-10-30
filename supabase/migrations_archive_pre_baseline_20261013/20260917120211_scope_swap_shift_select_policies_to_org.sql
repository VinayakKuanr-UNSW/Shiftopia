-- `shifts_select_offered_swaps` and `shifts_select_open_swaps` had NO viewer
-- predicate: their USING clause was a property of the ROW alone ("this shift is
-- part of an open swap"), so every authenticated user in the database could read
-- every shift involved in a swap, regardless of organisation.
--
-- Latent rather than live when found — the database holds one organisation and
-- zero open swaps — but it is a cross-tenant read the moment a second
-- organisation exists.
--
-- Fix: require an Active contract in the SAME organisation, which is exactly the
-- predicate `shifts_select_bidding` already uses for the equivalent "browse
-- other people's shifts" case.
--
-- Safe because every PARTICIPANT in a swap is covered by a different policy:
--   requester (owns the shift) .. shifts_select_rbac (assigned_employee_id = uid)
--   managers ................... shifts_select_rbac (user_has_action_in_scope)
--   offerers, both directions .. shifts_select_swap_offers_v2
--                                shifts_select_swap_requester_for_offerers
-- These two only ever served the "browse available swaps" case, and
-- `swapsApi.getAvailableSwaps` already requires an organizationId — so the org
-- conjunct removes nothing a caller could legitimately have used.
--
-- After this, all six SELECT policies on `public.shifts` reference auth.uid();
-- none is a bare row-property test.

DROP POLICY IF EXISTS "shifts_select_offered_swaps" ON public.shifts;
CREATE POLICY "shifts_select_offered_swaps" ON public.shifts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shift_swaps
      WHERE shift_swaps.target_shift_id = shifts.id
        AND shift_swaps.status = ANY (ARRAY['OPEN'::swap_request_status, 'MANAGER_PENDING'::swap_request_status])
    )
    AND EXISTS (
      SELECT 1 FROM public.user_contracts uc
      WHERE uc.user_id = (SELECT auth.uid())
        AND uc.status = 'Active'
        AND uc.organization_id = shifts.organization_id
    )
  );

DROP POLICY IF EXISTS "shifts_select_open_swaps" ON public.shifts;
CREATE POLICY "shifts_select_open_swaps" ON public.shifts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shift_swaps
      WHERE shift_swaps.requester_shift_id = shifts.id
        AND shift_swaps.status = 'OPEN'::swap_request_status
    )
    AND EXISTS (
      SELECT 1 FROM public.user_contracts uc
      WHERE uc.user_id = (SELECT auth.uid())
        AND uc.status = 'Active'
        AND uc.organization_id = shifts.organization_id
    )
  );
