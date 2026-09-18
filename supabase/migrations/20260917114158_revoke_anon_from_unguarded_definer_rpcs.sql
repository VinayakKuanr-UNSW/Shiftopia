-- =============================================================================
-- Close an UNAUTHENTICATED read of shift data.
--
-- `get_employees_shift_window_bulk` is SECURITY DEFINER with no authorization
-- check of any kind — its body is a bare
--     SELECT ... FROM public.shifts WHERE assigned_employee_id = ANY($1)
-- and DEFINER means it runs as the owner, so the `shifts_select_rbac` policy
-- (which requires `user_has_action_in_scope('shift.view', ...)` OR
-- `assigned_employee_id = auth.uid()`) never applies.
--
-- Supabase auto-GRANTs EXECUTE to `anon` on every function created in schema
-- public, so the endpoint was reachable with nothing but the publishable anon
-- key. Verified against production on 2026-09-17:
--
--   GET  /rest/v1/shifts            -> 42501 permission denied   (RLS holds)
--   POST /rest/v1/rpc/get_employees_shift_window_bulk
--        {"p_employee_ids":[<any uuid>], ...}
--                                   -> 200, real shift rows      (RLS bypassed)
--
-- Same root cause as 20260720075804_phase2b_revoke_anon_from_swap_rpcs.sql;
-- these four were missed because they are not swap RPCs.
--
-- Only the four functions that take arguments (i.e. are genuinely callable over
-- PostgREST) are revoked here. The remaining anon-executable definer functions
-- flagged by the linter are trigger bodies, which PostgREST refuses to invoke.
-- =============================================================================

-- 1. Reads another employee's roster. The one with real disclosure impact.
REVOKE EXECUTE ON FUNCTION "public"."get_employees_shift_window_bulk"("uuid"[], "date", "date") FROM "anon";

-- 2. Leaks a per-shift boolean to an unauthenticated caller.
REVOKE EXECUTE ON FUNCTION "public"."is_shift_timesheet_reviewable"("uuid") FROM "anon";

-- 3+4. VOLATILE — an unauthenticated caller can drive recomputation on demand.
REVOKE EXECUTE ON FUNCTION "public"."refresh_employee_performance_metrics"("uuid") FROM "anon";
-- `integer` is unquoted on purpose: it is a SQL alias, not a pg_type name, so
-- "integer" parses as an identifier and errors with 42704 type does not exist.
-- (`uuid`, `text` and `date` are real pg_type names, so quoting those is fine.)
REVOKE EXECUTE ON FUNCTION "public"."compute_prediction_outcomes"(integer, "text") FROM "anon";

-- =============================================================================
-- Defence in depth: the grant is the hole, but the function should not trust
-- its caller either. A revoked grant can be re-added by the next
-- `GRANT ... ON ALL FUNCTIONS`, and this function is the one that matters.
--
-- `auth.uid() IS NULL` is the correct test. NOT `current_user`, which inside a
-- SECURITY DEFINER body is always the function OWNER and therefore never
-- identifies the caller — the mistake recorded in the prod privilege-escalation
-- fix.
--
-- NOTE — deliberately NOT tightened further. Any authenticated user can still
-- ask for any employee's window. Narrowing that to
-- `user_has_action_in_scope('shift.view', ...)` is the right end state, but this
-- function is called by the auto-scheduler (`scheduling/data/roster-fetcher.ts`)
-- and changing its result set could silently starve the solver of rostered
-- hours. Left as a follow-up so this migration stays safe to apply immediately.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_employees_shift_window_bulk(
  p_employee_ids uuid[],
  p_start_date   date,
  p_end_date     date
)
RETURNS TABLE(
  id                   uuid,
  assigned_employee_id uuid,
  shift_date           date,
  start_time           time without time zone,
  end_time             time without time zone,
  unpaid_break_minutes integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.assigned_employee_id,
    s.shift_date,
    s.start_time,
    s.end_time,
    s.unpaid_break_minutes
  FROM public.shifts s
  WHERE s.assigned_employee_id = ANY(p_employee_ids)
    AND s.shift_date >= p_start_date
    AND s.shift_date <= p_end_date
    AND s.lifecycle_status != 'Cancelled'
    AND s.deleted_at IS NULL;
END;
$function$;

-- CREATE OR REPLACE re-applies the default grants, so revoke again, last.
REVOKE EXECUTE ON FUNCTION "public"."get_employees_shift_window_bulk"("uuid"[], "date", "date") FROM "anon";
REVOKE EXECUTE ON FUNCTION "public"."get_employees_shift_window_bulk"("uuid"[], "date", "date") FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION "public"."get_employees_shift_window_bulk"("uuid"[], "date", "date") TO "authenticated";
GRANT  EXECUTE ON FUNCTION "public"."get_employees_shift_window_bulk"("uuid"[], "date", "date") TO "service_role";
