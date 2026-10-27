-- Close four read policies that were USING (true). Found while triaging the
-- t19b-donut fork (docs/handover/2026-10-27-donut-fork-salvage-ledger.md, Tier 2);
-- predicates use our helpers, not the fork's SQL.

-- predicted_labor_demand: the public anon key could read all 500 forecast rows.
-- Nothing in the app reads it as anon; the ML service uses the service role.
-- (authenticated_read_predicted_labor_demand stays: org-level forecast data.)
DROP POLICY "Allow anon select on predicted_labor_demand" ON public.predicted_labor_demand;
REVOKE SELECT ON public.predicted_labor_demand FROM anon;

-- Broadcast acknowledgements / read status: who read or acked what was visible
-- across every group, while the rest of broadcasts is group-scoped. Now: your
-- own rows, broadcast system managers, and the group's admins/broadcasters.
-- The app only reads its own rows (broadcasts.queries.ts, v_unread_broadcasts_by_group);
-- stats come from the definer RPC get_broadcast_ack_stats.
DROP POLICY broadcast_acknowledgements_select ON public.broadcast_acknowledgements;
CREATE POLICY broadcast_acknowledgements_select ON public.broadcast_acknowledgements
  FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT auth.uid())
    OR is_broadcast_system_manager()
    OR EXISTS (
      SELECT 1 FROM public.broadcasts b
      WHERE b.id = broadcast_acknowledgements.broadcast_id
        AND get_broadcast_group_role(get_broadcast_channel_group_id(b.channel_id))
            = ANY (ARRAY['admin'::text, 'broadcaster'::text])
    )
  );

DROP POLICY broadcast_read_status_select ON public.broadcast_read_status;
CREATE POLICY broadcast_read_status_select ON public.broadcast_read_status
  FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT auth.uid())
    OR is_broadcast_system_manager()
    OR EXISTS (
      SELECT 1 FROM public.broadcasts b
      WHERE b.id = broadcast_read_status.broadcast_id
        AND get_broadcast_group_role(get_broadcast_channel_group_id(b.channel_id))
            = ANY (ARRAY['admin'::text, 'broadcaster'::text])
    )
  );

-- bulk_operations: any user could read every manager's bulk-publish summaries.
DROP POLICY "Users can view bulk operations" ON public.bulk_operations;
CREATE POLICY "Users can view bulk operations" ON public.bulk_operations
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = actor_id OR is_zeta());

-- employee_suitability_scores: open to all. Managers still need bidders' scores
-- (useShiftBids.ts), so self-only would silently zero their override map.
DROP POLICY "Authenticated users can view all suitability scores" ON public.employee_suitability_scores;
CREATE POLICY employee_suitability_scores_select ON public.employee_suitability_scores
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT auth.uid()) OR can_act_on_employee('bid.view', employee_id));
