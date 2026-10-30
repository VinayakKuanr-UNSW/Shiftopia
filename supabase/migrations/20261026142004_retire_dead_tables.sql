-- Retire eight tables with no reader or writer anywhere (app, edge functions,
-- ml, optimizer-service, DB functions, views, triggers, inbound FKs), checked
-- live on 2026-10-27. Several were readable by every signed-in user, so
-- dropping beats hardening. No CASCADE: if anything still depends on one of
-- them, this migration fails instead of taking it down.
--
--   employee_reliability_metrics  500 seed rows of per-person no-show/late/cancel
--                                 rates, USING (true); written only by the seed script
--   rest_period_violations        0 rows, USING (true)
--   shift_event_tags              0 rows, USING (true)
--   shift_bid_windows             0 rows; bid windows live on shifts
--   employee_leave_balances       0 rows, deny-all; the app uses leave_balances
--   swap_approvals                0 rows, legacy swap chain
--   broadcast_group_members       0 rows; membership lives in group_participants
--   shift_templates               0 rows; any user could UPDATE drafts. Its one
--                                 reader (rostersApi.createRostersFromTemplate) is dead

-- delete_user_entirely, from the live definition (md5 ac9cea9d8929609fc603d5ee0f99579b),
-- minus the DELETE on employee_leave_balances.
CREATE OR REPLACE FUNCTION public.delete_user_entirely(user_uuid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Users can only be deleted from the database, not from the app.';
  END IF;

  PERFORM set_config('app.shift_purge', 'user', true);
  DELETE FROM public.shifts WHERE assigned_employee_id = user_uuid;
  PERFORM set_config('app.shift_purge', '', true);

  UPDATE public.shifts
     SET cancelled_by_user_id = NULLIF(cancelled_by_user_id, user_uuid),
         published_by_user_id = NULLIF(published_by_user_id, user_uuid),
         emergency_assigned_by = NULLIF(emergency_assigned_by, user_uuid),
         dropped_by_id = NULLIF(dropped_by_id, user_uuid)
   WHERE cancelled_by_user_id = user_uuid OR published_by_user_id = user_uuid
      OR emergency_assigned_by = user_uuid OR dropped_by_id = user_uuid;
  UPDATE public.timesheets SET approved_by = NULL WHERE approved_by = user_uuid;
  UPDATE public.rosters SET published_by = NULL, created_by = NULL WHERE published_by = user_uuid OR created_by = user_uuid;
  UPDATE public.availabilities SET approved_by = NULL WHERE approved_by = user_uuid;
  UPDATE public.shift_swaps SET approved_by = NULL WHERE approved_by = user_uuid;
  UPDATE public.leave_requests SET approved_by = NULL WHERE approved_by = user_uuid;
  UPDATE public.roster_templates
     SET last_edited_by = NULL, published_by = NULL, created_by = NULL
   WHERE last_edited_by = user_uuid OR published_by = user_uuid OR created_by = user_uuid;
  UPDATE public.app_access_certificates SET created_by = NULL WHERE created_by = user_uuid;
  UPDATE public.roster_template_batches SET applied_by = NULL WHERE applied_by = user_uuid;
  UPDATE public.shift_bids SET reviewed_by = NULL WHERE reviewed_by = user_uuid;

  DELETE FROM public.cancellation_history WHERE employee_id = user_uuid;
  DELETE FROM public.attendance_records WHERE employee_id = user_uuid;
  DELETE FROM public.autoschedule_assignments WHERE employee_id = user_uuid;
  DELETE FROM public.leave_requests WHERE employee_id = user_uuid;
  DELETE FROM public.template_shifts WHERE assigned_employee_id = user_uuid;
  DELETE FROM public.app_access_certificates WHERE user_id = user_uuid;
  DELETE FROM public.user_contracts WHERE user_id = user_uuid;

  DELETE FROM public.profiles WHERE id = user_uuid;
  DELETE FROM auth.users WHERE id = user_uuid;
END;
$function$;

DROP TABLE public.employee_reliability_metrics;
DROP TABLE public.rest_period_violations;
DROP TABLE public.shift_event_tags;
DROP TABLE public.shift_bid_windows;
DROP TABLE public.employee_leave_balances;
DROP TABLE public.swap_approvals;
DROP TABLE public.broadcast_group_members;
DROP TABLE public.shift_templates;
