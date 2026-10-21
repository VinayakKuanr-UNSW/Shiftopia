-- Access suites, step 1 of 3: tighten.
--
-- The access model now has three suites (docs/architecture/access-suites-plan.md):
--   Personal   alpha, beta                 own data, every sub-department contracted to
--   Managerial beta  Timesheets, view-only
--              gamma full, one sub-department
--              delta VIEW-ONLY, one department and its sub-departments
--              epsilon VIEW-ONLY, the organization
--              zeta  full, everything
--   Admin      zeta only: Labor Demand, Compliance Rejections, Users
--
-- This migration only takes access away (delta and epsilon writes, epsilon's admin
-- powers, gamma's scope-free reads, beta's roster/broadcast rows). Step 2 adds the new
-- actions and gamma's missing rights; step 3 moves the personal scope onto contracts.
--
-- Every write keeps going through the matrix by place. Where a READ was only reachable
-- through a write action, it moves to roster.view so view-only levels keep seeing what
-- they are responsible for. Edited function bodies are pg_get_functiondef() copies with
-- one line changed each.

-- ── 1. Matrix ────────────────────────────────────────────────────────────────
DELETE FROM public.rbac_permissions
 WHERE access_level IN ('delta', 'epsilon')
   AND action_code IN ('bid.assign', 'bid.close', 'broadcast.create', 'contract.manage',
                       'leave.approve', 'roster.edit', 'roster.publish', 'shift.assign',
                       'shift.create', 'shift.delete', 'shift.edit', 'shift.publish',
                       'swap.approve', 'timesheet.approve', 'user.edit');

-- Beta's managerial reach is Timesheets alone. It keeps timesheet.view, plus the shift
-- and profile rows those timesheets are drawn from.
DELETE FROM public.rbac_permissions
 WHERE access_level = 'beta' AND action_code IN ('roster.view', 'broadcast.view');

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.rbac_permissions
                WHERE access_level IN ('delta', 'epsilon') AND action_code NOT LIKE '%.view') THEN
        RAISE EXCEPTION 'delta/epsilon still hold a write action';
    END IF;
END $$;

-- ── 2. Helpers that decided by level, not by the matrix ──────────────────────

-- Org structure, pay periods, work rules, system config, cleanup rules: Admin Suite.
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  -- Admin Suite is zeta's alone (access suites, 2026-10-14). Was epsilon+.
  RETURN public.is_zeta();
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  -- Zeta only. Was zeta, or epsilon of p_org_id, or a contract carrying epsilon/zeta
  -- (contracts can no longer carry a level: user_contracts_no_access_level).
  SELECT auth.uid() IS NOT NULL AND public.is_zeta();
$function$;

-- Templates: editing any template anywhere is zeta's; gamma edits its own sub-department's
-- through auth_can_create_template. Was gamma+ anywhere.
CREATE OR REPLACE FUNCTION public.auth_can_manage_templates()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RETURN public.is_zeta();
END;
$function$;

-- Was a check on user_contracts.access_level, which the 2026-10-11 CHECK pins to NULL, so it
-- answered false for everyone. Now: roster.edit at the template's place (gamma, zeta).
CREATE OR REPLACE FUNCTION public.auth_can_create_template(p_organization_id uuid, p_department_id uuid, p_sub_department_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    RETURN public.user_has_action_in_scope('roster.edit', p_organization_id, p_department_id, p_sub_department_id);
END;
$function$;

-- Certificates (Users page, Admin Suite): zeta grants, changes, revokes and reads.
-- Epsilon used to do all four inside its own organization.
CREATE OR REPLACE FUNCTION public.can_grant_certificate(p_user_id uuid, p_org_id uuid, p_level access_level)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT auth.uid() IS NOT NULL AND public.is_zeta();
$function$;

CREATE OR REPLACE FUNCTION public.can_change_certificate(p_user_id uuid, p_org_id uuid, p_level access_level)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT public.is_zeta();
$function$;

CREATE OR REPLACE FUNCTION public.can_read_certificates_in(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT public.is_zeta();
$function$;

-- No callers today; kept consistent so nothing can reach for it later. Was delta+.
CREATE OR REPLACE FUNCTION public.can_write_contract(p_user_id uuid, p_org_id uuid, p_level access_level)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND public.is_zeta();
$function$;

-- Open swap requests are visible to people contracted to the shift's sub-department (#8).
-- Was: anyone holding any certificate in the shift's organization.
CREATE OR REPLACE FUNCTION public.user_has_access_to_swap(_user_id uuid, _requester_shift_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.shifts s
    JOIN hr.user_contracts uc ON uc.sub_department_id = s.sub_department_id
    WHERE s.id = _requester_shift_id
      AND uc.user_id = _user_id
      AND uc.status = 'Active'
  );
END;
$function$;


-- ── 3–4. Generated: functions and policies edited in place ──────────────────
-- 3a. Clocking someone else in or out is a timesheet write: scoped, not gamma+-anywhere.
CREATE OR REPLACE FUNCTION public.sm_clock_in(p_shift_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_shift RECORD; v_state text; v_name text; v_role text;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Shift not found or deleted'); END IF;

  -- P0 fix: bind to the authenticated caller (or a manager acting on
  -- an employee's behalf), and require the target employee to
  -- actually be the one assigned to this shift.
  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT public.can_act_on_shift('timesheet.approve', p_shift_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to clock in on behalf of this employee');
  END IF;
  IF v_shift.assigned_employee_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift is not assigned to this employee');
  END IF;

  SELECT COALESCE(first_name||' '||COALESCE(last_name,''), email), COALESCE(left(lower(legacy_system_role::text),50),'employee')
    INTO v_name, v_role FROM public.profiles WHERE id = p_user_id;
  v_name := COALESCE(v_name, 'System'); v_role := COALESCE(v_role, 'employee');
  v_state := public.get_shift_fsm_state(v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome, v_shift.trading_status, v_shift.is_cancelled);
  IF v_state NOT IN ('S4', 'S9', 'S10') THEN RETURN jsonb_build_object('success', false, 'error', format('sm_clock_in requires state S4, S9 or S10, current state is %s', v_state)); END IF;
  UPDATE public.shifts SET
    lifecycle_status = 'InProgress'::public.shift_lifecycle, trading_status = 'NoTrade'::public.shift_trading,
    last_modified_by = p_user_id, updated_at = NOW()
  WHERE id = p_shift_id;
  -- shift_audit_events insert removed
  RETURN jsonb_build_object('success', true, 'from_state', v_state, 'to_state', 'S11');
END; $function$;

CREATE OR REPLACE FUNCTION public.sm_clock_out_shift(p_shift_id uuid, p_user_id uuid, p_lat double precision DEFAULT NULL::double precision, p_lon double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_shift         shifts%ROWTYPE;
  v_org           organizations%ROWTYPE;
  v_now           TIMESTAMPTZ := clock_timestamp();
  v_distance_m    DOUBLE PRECISION;
  v_net_minutes   NUMERIC;
  v_early_out     BOOLEAN;
  v_earth_radius  CONSTANT DOUBLE PRECISION := 6371000;
  v_lat1_rad      DOUBLE PRECISION;
  v_lat2_rad      DOUBLE PRECISION;
  v_dlat          DOUBLE PRECISION;
  v_dlon          DOUBLE PRECISION;
  v_a             DOUBLE PRECISION;
  v_from_state    TEXT;
  v_to_state      TEXT;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
  END IF;

  -- P0 fix: see sm_clock_in for rationale.
  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT public.can_act_on_shift('timesheet.approve', p_shift_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to clock out on behalf of this employee');
  END IF;
  IF v_shift.assigned_employee_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift is not assigned to this employee');
  END IF;

  IF v_shift.attendance_status NOT IN ('checked_in', 'late') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Must clock in before clocking out');
  END IF;

  IF v_shift.actual_end IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already clocked out');
  END IF;

  IF p_lat IS NULL OR p_lon IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Location required to clock out');
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = v_shift.organization_id;
  IF FOUND AND v_org.venue_lat IS NOT NULL AND v_org.venue_lon IS NOT NULL THEN
    v_lat1_rad := radians(v_org.venue_lat);
    v_lat2_rad := radians(p_lat);
    v_dlat     := radians(p_lat - v_org.venue_lat);
    v_dlon     := radians(p_lon - v_org.venue_lon);
    v_a        := sin(v_dlat / 2)^2
                  + cos(v_lat1_rad) * cos(v_lat2_rad) * sin(v_dlon / 2)^2;
    v_distance_m := v_earth_radius * 2 * atan2(sqrt(v_a), sqrt(1 - v_a));
    IF v_distance_m > 100 THEN
      RETURN jsonb_build_object(
        'success',    false,
        'error',      'You are too far from the venue to clock out',
        'distance_m', round(v_distance_m::NUMERIC, 1)
      );
    END IF;
  ELSE
    v_distance_m := 0;
  END IF;

  v_net_minutes := EXTRACT(EPOCH FROM (v_now - v_shift.actual_start)) / 60.0;

  v_early_out := v_shift.end_at IS NOT NULL AND v_now < v_shift.end_at - INTERVAL '5 minutes';

  v_from_state := public.get_shift_fsm_state(
    v_shift.lifecycle_status, v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status,
    v_shift.is_cancelled, v_shift.bidding_status
  );

  UPDATE shifts SET
    actual_end         = v_now,
    actual_net_minutes = round(v_net_minutes::NUMERIC, 0),
    lifecycle_status   = 'Completed',
    updated_at         = v_now
  WHERE id = p_shift_id;

  v_to_state := public.get_shift_fsm_state(
    'Completed', v_shift.assignment_status,
    v_shift.assignment_outcome, v_shift.trading_status,
    v_shift.is_cancelled, v_shift.bidding_status
  );

  INSERT INTO public.shift_events (
    shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain
  ) VALUES (
    p_shift_id,
    v_shift.assigned_employee_id,
    p_user_id,
    CASE WHEN v_early_out THEN 'EARLY_OUT' ELSE 'OP_APPLIED' END::public.shift_event_type,
    v_now,
    jsonb_build_object(
      'op', 'clock_out',
      'domain', 'attendance',
      'departure', CASE
                     WHEN v_early_out THEN 'early'
                     WHEN v_shift.end_at IS NOT NULL AND v_now > v_shift.end_at + INTERVAL '5 minutes' THEN 'late'
                     ELSE 'on_time'
                   END,
      'net_minutes', round(v_net_minutes::NUMERIC, 0),
      'from_state', v_from_state,
      'to_state',   v_to_state,
      'source', 'sm_clock_out_shift'
    ),
    'employee',
    'attendance'
  )
  ON CONFLICT (shift_id, employee_id, event_type, event_time) DO NOTHING;

  RETURN jsonb_build_object(
    'success',          true,
    'actual_end',       v_now,
    'actual_net_minutes', round(v_net_minutes::NUMERIC, 0),
    'early_out',        v_early_out,
    'distance_m',       round(v_distance_m::NUMERIC, 1)
  );
END;
$function$;

-- 3b. Another employee's performance: only for someone who views that employee's roster.
CREATE OR REPLACE FUNCTION public.get_employee_quarterly_performance(p_employee_id uuid, p_year integer, p_quarter integer)
 RETURNS TABLE(employee_id uuid, total_offers integer, accepted integer, rejected integer, expired integer, assigned integer, emergency_assigned integer, completed integer, no_show integer, swap_out integer, acceptance_rate numeric, rejection_rate numeric, ignorance_rate numeric, cancel_rate numeric, late_cancel_rate numeric, no_show_rate numeric, swap_rate numeric, reliability_score numeric, late_clock_in_rate numeric, early_clock_out_rate numeric, attendance_compliance_rate numeric, total_bids integer, bids_accepted integer, bid_success_rate numeric, trade_requests integer, performance_score numeric, engagement_score numeric, calculated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_start date;
    v_end   date;
BEGIN
    IF NOT (p_employee_id = auth.uid() OR public.can_act_on_employee('roster.view', p_employee_id)) THEN
        RAISE EXCEPTION 'insufficient_privilege: may only view your own performance, or requires managerial access';
    END IF;

    SELECT qdr.v_start, qdr.v_end INTO v_start, v_end
    FROM quarter_date_range(p_year, p_quarter) qdr;

    RETURN QUERY
    WITH
    offer_agg AS (
        SELECT
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.terminal_outcome <> 'unassigned')::int                  AS total_offers_sent,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.had_accept AND ep.terminal_outcome <> 'unassigned')::int AS total_accepted,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.terminal_outcome = 'rejected')::int                     AS total_rejected,
            COUNT(*) FILTER (WHERE ep.had_offer AND ep.terminal_outcome = 'ignored')::int                      AS total_expired
        FROM v_shift_assignment_episodes ep
        WHERE ep.employee_id = p_employee_id
          AND ep.shift_date BETWEEN v_start AND v_end
          AND ep.terminal_outcome != 'shift_deleted'
    ),
    snap_agg AS (
        SELECT
            COUNT(*) FILTER (WHERE snap.source != 'emergency')::int                   AS assigned_count,
            COUNT(*) FILTER (WHERE snap.source = 'emergency')::int                    AS emergency_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'worked')::int                   AS completed_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'dropped_std')::int              AS cancel_standard_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'dropped_late')::int             AS cancel_late_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'traded_out')::int               AS swap_out_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'no_show')::int                  AS no_show_count,
            COUNT(*) FILTER (WHERE snap.late_in AND snap.end_reason = 'worked')::int  AS late_clock_in_count,
            COUNT(*) FILTER (WHERE snap.early_out AND snap.end_reason = 'worked')::int AS early_clock_out_count,
            COUNT(*) FILTER (WHERE snap.end_reason = 'worked' AND NOT snap.late_in AND NOT snap.early_out)::int AS compliant_count,
            COUNT(*)::int                                                             AS held_count
        FROM assignment_snapshots snap
        WHERE snap.employee_id = p_employee_id
          AND snap.shift_date BETWEEN v_start AND v_end
    ),
    bid_agg AS (
        SELECT
            COUNT(*)::int                                       AS total_bids,
            COUNT(*) FILTER (WHERE sb.status = 'accepted')::int AS bids_accepted
        FROM shift_bids sb
        JOIN shifts s ON s.id = sb.shift_id
        WHERE sb.employee_id = p_employee_id
          AND s.shift_date BETWEEN v_start AND v_end
    ),
    trade_agg AS (
        SELECT COUNT(*)::int AS trade_requests
        FROM swap_requests sr
        JOIN shifts s ON s.id = sr.original_shift_id
        WHERE sr.requested_by_employee_id = p_employee_id
          AND s.shift_date BETWEEN v_start AND v_end
    ),
    raw_metrics AS (
        SELECT
            COALESCE(oa.total_offers_sent, 0)::int AS total_offers,
            COALESCE(oa.total_accepted,    0)::int AS accepted,
            COALESCE(oa.total_rejected,    0)::int AS rejected,
            COALESCE(oa.total_expired,     0)::int AS expired,
            COALESCE(sa.assigned_count,    0)::int AS assigned,
            COALESCE(sa.emergency_count,   0)::int AS emergency_assigned,
            COALESCE(sa.completed_count,   0)::int AS completed,
            COALESCE(sa.no_show_count,     0)::int AS no_show,
            COALESCE(sa.swap_out_count,    0)::int AS swap_out,

            ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
                  ELSE oa.total_accepted::numeric/oa.total_offers_sent*100 END,2)::numeric AS acceptance_rate,
            ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
                  ELSE oa.total_rejected::numeric/oa.total_offers_sent*100 END,2)::numeric AS rejection_rate,
            ROUND(CASE WHEN COALESCE(oa.total_offers_sent,0)=0 THEN 0
                  ELSE oa.total_expired::numeric/oa.total_offers_sent*100 END,2)::numeric  AS ignorance_rate,

            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.cancel_standard_count,0)::numeric/sa.held_count*100 END,2)::numeric AS cancel_rate,
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.cancel_late_count,0)::numeric/sa.held_count*100 END,2)::numeric AS late_cancel_rate,
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.no_show_count,0)::numeric/sa.held_count*100 END,2)::numeric AS no_show_rate,
            ROUND(CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                  ELSE COALESCE(sa.swap_out_count,0)::numeric/sa.held_count*100 END,2)::numeric AS swap_rate,

            GREATEST(0,LEAST(100,ROUND(
                100
                -CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                      ELSE (COALESCE(sa.cancel_standard_count,0)+COALESCE(sa.cancel_late_count,0))::numeric/sa.held_count*30 END
                -CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0
                      ELSE COALESCE(sa.cancel_late_count,0)::numeric/sa.held_count*20 END
                -CASE WHEN COALESCE(sa.held_count,0)=0 THEN 0 ELSE COALESCE(sa.no_show_count,0)::numeric/sa.held_count*40 END
                -CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                      ELSE COALESCE(sa.late_clock_in_count,0)::numeric/sa.completed_count*5 END
                -CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                      ELSE COALESCE(sa.early_clock_out_count,0)::numeric/sa.completed_count*5 END
            ,2)))::numeric AS reliability_score,

            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.late_clock_in_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS late_clock_in_rate,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE COALESCE(sa.early_clock_out_count,0)::numeric/sa.completed_count*100 END,2)::numeric AS early_clock_out_rate,
            ROUND(CASE WHEN COALESCE(sa.completed_count,0)=0 THEN 0
                  ELSE sa.compliant_count::numeric/sa.completed_count*100 END, 2)::numeric AS attendance_compliance_rate,

            COALESCE(ba.total_bids, 0)::int AS total_bids,
            COALESCE(ba.bids_accepted, 0)::int AS bids_accepted,
            ROUND(CASE WHEN COALESCE(ba.total_bids,0)=0 THEN 0
                  ELSE ba.bids_accepted::numeric/ba.total_bids*100 END, 2)::numeric AS bid_success_rate,

            COALESCE(ta.trade_requests, 0)::int AS trade_requests
        FROM offer_agg oa, snap_agg sa, bid_agg ba, trade_agg ta
    )
    SELECT
        p_employee_id,
        rm.total_offers,
        rm.accepted,
        rm.rejected,
        rm.expired,
        rm.assigned,
        rm.emergency_assigned,
        rm.completed,
        rm.no_show,
        rm.swap_out,
        rm.acceptance_rate,
        rm.rejection_rate,
        rm.ignorance_rate,
        rm.cancel_rate,
        rm.late_cancel_rate,
        rm.no_show_rate,
        rm.swap_rate,
        rm.reliability_score,
        rm.late_clock_in_rate,
        rm.early_clock_out_rate,
        rm.attendance_compliance_rate,
        rm.total_bids,
        rm.bids_accepted,
        rm.bid_success_rate,
        rm.trade_requests,
        -- Same weighting as get_quarterly_performance_report(): keep these two in sync.
        ROUND(
            (rm.reliability_score * 0.35) +
            (rm.acceptance_rate * 0.25) +
            (rm.attendance_compliance_rate * 0.20) +
            (rm.bid_success_rate * 0.20),
            2
        )::numeric AS performance_score,
        GREATEST(0, LEAST(100, ROUND(
            (rm.total_bids + rm.trade_requests * 1.5 + rm.total_offers * 1.25)
            / GREATEST(rm.completed, 1)
            * 30,
            2
        )))::numeric AS engagement_score,
        now() AS calculated_at
    FROM raw_metrics rm;
END;
$function$;

-- 3c. Pay terms: delta+ keeps reading them, but only inside its own scope (was org-wide).
CREATE OR REPLACE FUNCTION public.shift_pay_terms(s shifts)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
#variable_conflict use_column
DECLARE
    v_uid uuid := auth.uid();
    t     record;
BEGIN
    IF s.user_contract_id IS NULL OR s.assigned_employee_id IS NULL OR v_uid IS NULL THEN
        RETURN NULL;
    END IF;
    IF s.assigned_employee_id <> v_uid AND NOT (public.user_has_delta_access(v_uid)
                AND public.user_has_action_in_scope('roster.view', s.organization_id, s.department_id, s.sub_department_id)) THEN
        RETURN NULL;
    END IF;

    SELECT * INTO t FROM internal.shift_pay_terms(s);
    RETURN jsonb_build_object(
        'pay_basis',         t.pay_basis,
        'employment_type',   t.employment_type,
        'substantive_level', t.substantive_level,
        'paid_level',        t.paid_level,
        'higher_duties',     t.higher_duties,
        'base_rate',         round(t.base_rate, 4));
END;
$function$;

CREATE OR REPLACE FUNCTION public.shift_pay_terms_for(s shifts, p_employee uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
#variable_conflict use_column
DECLARE
    v_uid uuid := auth.uid();
    t     record;
BEGIN
    IF p_employee IS NULL OR v_uid IS NULL THEN
        RETURN NULL;
    END IF;
    IF p_employee <> v_uid AND NOT (public.user_has_delta_access(v_uid)
                AND public.user_has_action_in_scope('roster.view', s.organization_id, s.department_id, s.sub_department_id)) THEN
        RETURN NULL;
    END IF;

    SELECT * INTO t FROM internal.prospective_pay_terms(s, p_employee);
    RETURN jsonb_build_object(
        'pay_basis',         t.pay_basis,
        'employment_type',   t.employment_type,
        'substantive_level', t.substantive_level,
        'paid_level',        t.paid_level,
        'higher_duties',     t.higher_duties,
        'base_rate',         round(t.base_rate, 4));
END;
$function$;

-- 3d. Action alerts go to someone who can act: the sub-department's gamma, else a zeta.
--     The drop alert used to fall back to a (now view-only) delta.
CREATE OR REPLACE FUNCTION public.trg_employee_drop_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_manager_id   UUID;
  v_dropper_name TEXT;
BEGIN
  IF (NEW.bidding_status::TEXT = 'on_bidding')
    AND (OLD.bidding_status IS DISTINCT FROM NEW.bidding_status)
    AND OLD.assigned_employee_id IS NOT NULL
    AND NEW.assigned_employee_id IS NULL
  THEN
    SELECT COALESCE(first_name || ' ' || last_name, email, 'An employee')
    INTO   v_dropper_name
    FROM   profiles
    WHERE  id = OLD.assigned_employee_id
    LIMIT  1;

    IF NEW.sub_department_id IS NOT NULL THEN
      SELECT user_id INTO v_manager_id
      FROM   app_access_certificates
      WHERE  sub_department_id = NEW.sub_department_id
        AND  access_level       = 'gamma'
        AND  is_active          = true
      LIMIT  1;
    END IF;

    IF v_manager_id IS NULL THEN
      SELECT user_id INTO v_manager_id
      FROM   app_access_certificates
      WHERE  access_level     = 'zeta'
        AND  is_active        = true
      ORDER  BY created_at
      LIMIT  1;
    END IF;

    IF v_manager_id IS NOT NULL THEN
      PERFORM notify_user(
        v_manager_id,
        'shift_dropped',
        'Shift dropped',
        v_dropper_name || ' dropped their shift on ' || NEW.shift_date || '. It has been re-listed for urgent bidding.',
        NEW.id,
        'shift',
        '/management/bids',
        'shift_dropped:' || NEW.id::TEXT || ':' || OLD.assigned_employee_id::TEXT
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_bidding_expired_notification_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_manager_id UUID;
BEGIN
  IF NOT (
    OLD.bidding_status IN ('on_bidding_normal', 'on_bidding_urgent', 'on_bidding')
    AND NEW.bidding_status = 'not_on_bidding'
    AND NEW.lifecycle_status = 'Draft'
    AND OLD.assigned_employee_id IS NULL
  ) THEN RETURN NEW; END IF;

  -- Nearest manager first. app_access_certificates keys the manager by
  -- `user_id`, not `profile_id` (which does not exist) — referencing the wrong
  -- column once made every qualifying UPDATE on shifts fail.
  SELECT user_id INTO v_manager_id
  FROM   app_access_certificates
  WHERE  sub_department_id = NEW.sub_department_id
    AND  access_level >= 'gamma'
    AND  is_active = true
  ORDER  BY access_level
  LIMIT 1;

  IF v_manager_id IS NULL THEN
    SELECT user_id INTO v_manager_id
    FROM   app_access_certificates
    WHERE  access_level = 'zeta' AND is_active = true
    ORDER  BY created_at
    LIMIT  1;
  END IF;

  IF v_manager_id IS NULL THEN RETURN NEW; END IF;

  PERFORM notify_user(
    v_manager_id,
    'bid_no_winner',
    'Bidding Closed — No Winner',
    format(
      'Shift on %s (start %s) expired with no bid winner. Use emergency assignment.',
      TO_CHAR(NEW.shift_date::date, 'DD Mon YYYY'),
      TO_CHAR(NEW.start_time::time, 'HH24:MI')
    ),
    '/management/bids',
    'shift',
    NEW.id::text
  );

  RETURN NEW;
END;
$function$;

-- 3e. Starting, finishing or rolling back an assignment run is a write: it needs shift.assign
--     at the run's own place. Was aa_user_manages_org (gamma+ anywhere in the org), which
--     stays for READING run history.
CREATE OR REPLACE FUNCTION public.sm_assignment_run_start(p_scope jsonb, p_engine_version text, p_policy_version integer DEFAULT 1, p_options jsonb DEFAULT '{}'::jsonb, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_org    uuid := NULLIF(p_scope->>'organization_id','')::uuid;
  v_run    public.assignment_runs%ROWTYPE;
BEGIN
  IF v_org IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'MISSING_ORG'); END IF;
  IF v_caller IS NOT NULL AND NOT public.user_has_action_in_scope('shift.assign', v_org,
        NULLIF(p_scope->>'department_id','')::uuid, NULLIF(p_scope->>'sub_department_id','')::uuid) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  INSERT INTO public.assignment_runs (
    organization_id, department_id, sub_department_id, actor_id, scope,
    dry_run, status, engine_version, policy_version, options, started_at
  ) VALUES (
    v_org, NULLIF(p_scope->>'department_id','')::uuid, NULLIF(p_scope->>'sub_department_id','')::uuid,
    COALESCE(v_caller, '00000000-0000-0000-0000-000000000000'::uuid),
    p_scope, p_dry_run, 'RUNNING', p_engine_version, p_policy_version, p_options, now()
  ) RETURNING * INTO v_run;
  INSERT INTO public.assignment_events (run_id, event_type, actor_id, metadata)
  VALUES (v_run.id, 'RUN_STARTED', v_caller,
          jsonb_build_object('scope', p_scope, 'dry_run', p_dry_run, 'options', p_options));
  RETURN jsonb_build_object('ok', true, 'run_id', v_run.id, 'status', 'RUNNING');
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_assignment_run_start error: %', SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_assignment_run_finish(p_run_id uuid, p_status text, p_summary jsonb DEFAULT NULL::jsonb, p_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_run    public.assignment_runs%ROWTYPE;
BEGIN
  IF p_status NOT IN ('COMPLETED','PARTIALLY_FAILED','ABORTED') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_STATUS');
  END IF;
  SELECT * INTO v_run FROM public.assignment_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NO_RUN'); END IF;
  IF v_caller IS NOT NULL AND NOT public.user_has_action_in_scope('shift.assign', v_run.organization_id,
        v_run.department_id, v_run.sub_department_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  UPDATE public.assignment_runs
     SET status = p_status, summary = COALESCE(p_summary, summary), error = p_error, finished_at = now()
   WHERE id = p_run_id;
  INSERT INTO public.assignment_events (run_id, event_type, actor_id, metadata)
  VALUES (p_run_id, 'RUN_FINISHED', v_caller,
          jsonb_build_object('status', p_status, 'summary', p_summary, 'error', p_error));
  RETURN jsonb_build_object('ok', true, 'run_id', p_run_id, 'status', p_status);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_assignment_run_finish error: %', SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sm_assignment_run_rollback(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_run    public.assignment_runs%ROWTYPE;
  v_dec    RECORD;
  v_shift  public.shifts%ROWTYPE;
  v_state  text;
  v_reverted jsonb := '[]'::jsonb;
  v_skipped  jsonb := '[]'::jsonb;
  v_skip   text;
BEGIN
  SELECT * INTO v_run FROM public.assignment_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NO_RUN'); END IF;
  IF v_caller IS NOT NULL AND NOT public.user_has_action_in_scope('shift.assign', v_run.organization_id,
        v_run.department_id, v_run.sub_department_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  IF v_run.status NOT IN ('COMPLETED','PARTIALLY_FAILED') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_ROLLBACKABLE', 'status', v_run.status);
  END IF;
  IF v_run.dry_run THEN RETURN jsonb_build_object('ok', false, 'code', 'DRY_RUN_HAS_NO_EFFECT'); END IF;

  FOR v_dec IN
    SELECT * FROM public.assignment_decisions
    WHERE run_id = p_run_id AND outcome = 'ASSIGNED' AND committed = true AND version_after IS NOT NULL
    ORDER BY shift_id ASC
  LOOP
    v_skip := NULL;
    SELECT * INTO v_shift FROM public.shifts WHERE id = v_dec.shift_id FOR UPDATE;
    IF NOT FOUND OR v_shift.deleted_at IS NOT NULL OR v_shift.is_cancelled THEN v_skip := 'GONE';
    ELSIF v_shift.version <> v_dec.version_after THEN v_skip := 'EDITED_SINCE';
    ELSIF v_shift.trading_status <> 'NoTrade' THEN v_skip := 'TRADED_SINCE';
    ELSIF EXTRACT(EPOCH FROM (v_shift.scheduled_start - now())) < 4 * 3600 THEN v_skip := 'TTS_LOCKED';
    END IF;
    IF v_skip IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_object('shift_id', v_dec.shift_id, 'reason', v_skip);
      CONTINUE;
    END IF;
    v_state := public.get_shift_fsm_state(
      v_shift.lifecycle_status, v_shift.assignment_status, v_shift.assignment_outcome,
      v_shift.trading_status, v_shift.is_cancelled, v_shift.bidding_status);
    IF v_state <> 'S4' THEN
      v_skipped := v_skipped || jsonb_build_object('shift_id', v_dec.shift_id, 'reason', 'STATE_' || v_state);
      CONTINUE;
    END IF;
    UPDATE public.shift_bids SET status = 'pending', updated_at = now()
     WHERE shift_id = v_dec.shift_id AND employee_id = v_dec.winner_employee_id AND status = 'accepted';
    UPDATE public.shifts SET
      assigned_employee_id = NULL, assigned_at = NULL,
      assignment_status = 'unassigned'::public.shift_assignment_status,
      assignment_outcome = NULL, confirmed_at = NULL,
      bidding_status = 'on_bidding'::public.shift_bidding_status,
      is_on_bidding = TRUE, bidding_enabled = TRUE,
      fulfillment_status = 'bidding'::public.shift_fulfillment_status,
      last_modified_by = v_caller,
      last_modified_reason = 'Auto-assign run rollback ' || p_run_id::text,
      updated_at = now()
    WHERE id = v_dec.shift_id;
    INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, metadata)
    VALUES (v_dec.shift_id, v_dec.winner_employee_id, v_caller, 'UNASSIGNED',
      jsonb_build_object('op', 'run_rollback', 'run_id', p_run_id, 'from_version', v_dec.version_after,
        'idem', extensions.uuid_generate_v5('00000000-0000-0000-0000-0000000000aa'::uuid,
                  p_run_id::text || ':rb:' || v_dec.shift_id::text)));
    INSERT INTO public.assignment_events (run_id, shift_id, event_type, actor_id, metadata)
    VALUES (p_run_id, v_dec.shift_id, 'SHIFT_ROLLBACK', v_caller,
            jsonb_build_object('version_before', v_dec.version_after));
    v_reverted := v_reverted || jsonb_build_object('shift_id', v_dec.shift_id);
  END LOOP;

  UPDATE public.assignment_runs SET status = 'ROLLED_BACK', finished_at = now() WHERE id = p_run_id;
  INSERT INTO public.assignment_events (run_id, event_type, actor_id, metadata)
  VALUES (p_run_id, 'RUN_ROLLED_BACK', v_caller,
          jsonb_build_object('reverted', v_reverted, 'skipped', v_skipped));
  RETURN jsonb_build_object('ok', true, 'run_id', p_run_id, 'status', 'ROLLED_BACK',
                            'reverted', v_reverted, 'skipped', v_skipped);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_assignment_run_rollback error: %', SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END;
$function$;

-- 4a. Personal suite (#8): open bids and swaps are visible in the sub-departments you are
--     contracted to, not across the whole organization.
ALTER POLICY "shifts_select_bidding" ON public.shifts
  USING (((bidding_status = ANY (ARRAY['on_bidding'::shift_bidding_status, 'on_bidding_normal'::shift_bidding_status, 'on_bidding_urgent'::shift_bidding_status])) AND (EXISTS ( SELECT 1
   FROM user_contracts
  WHERE ((user_contracts.user_id = ( SELECT auth.uid() AS uid)) AND (user_contracts.status = 'Active'::text) AND (user_contracts.sub_department_id = shifts.sub_department_id))))));
ALTER POLICY "shifts_select_open_swaps" ON public.shifts
  USING (((EXISTS ( SELECT 1
   FROM shift_swaps
  WHERE ((shift_swaps.requester_shift_id = shifts.id) AND (shift_swaps.status = 'OPEN'::swap_request_status)))) AND (EXISTS ( SELECT 1
   FROM user_contracts uc
  WHERE ((uc.user_id = ( SELECT auth.uid() AS uid)) AND (uc.status = 'Active'::text) AND (uc.sub_department_id = shifts.sub_department_id))))));
ALTER POLICY "shifts_select_offered_swaps" ON public.shifts
  USING (((EXISTS ( SELECT 1
   FROM shift_swaps
  WHERE ((shift_swaps.target_shift_id = shifts.id) AND (shift_swaps.status = ANY (ARRAY['OPEN'::swap_request_status, 'MANAGER_PENDING'::swap_request_status]))))) AND (EXISTS ( SELECT 1
   FROM user_contracts uc
  WHERE ((uc.user_id = ( SELECT auth.uid() AS uid)) AND (uc.status = 'Active'::text) AND (uc.sub_department_id = shifts.sub_department_id))))));

-- 4b. Reads that only a WRITE action unlocked. Delta and epsilon just lost those writes, so
--     the read moves to roster.view (gamma sub-dept, delta dept, epsilon org, zeta): every
--     level that held the write action also holds roster.view, so nobody loses a row.
ALTER POLICY "bids_select_scoped" ON public.shift_bids
  USING (((employee_id = ( SELECT auth.uid() AS uid)) OR can_act_on_shift('roster.view'::text, shift_id)));
ALTER POLICY "swaps_select_scoped" ON public.shift_swaps
  USING (((requester_id = ( SELECT auth.uid() AS uid)) OR (target_id = ( SELECT auth.uid() AS uid)) OR can_act_on_shift('roster.view'::text, requester_shift_id) OR user_has_swap_offer(( SELECT auth.uid() AS uid), id) OR user_has_access_to_swap(( SELECT auth.uid() AS uid), requester_shift_id)));
ALTER POLICY "swap_offers_select_manager" ON public.swap_offers
  USING (can_act_on_swap('roster.view'::text, swap_request_id));
ALTER POLICY "shift_offers_select_own_or_manager" ON public.shift_offers
  USING (((employee_id = ( SELECT auth.uid() AS uid)) OR can_act_on_shift('roster.view'::text, shift_id)));
ALTER POLICY "Users can view relevant planning requests" ON public.planning_requests
  USING (((( SELECT auth.uid() AS uid) = initiated_by) OR (( SELECT auth.uid() AS uid) = manager_id) OR (( SELECT auth.uid() AS uid) = target_employee_id) OR can_act_on_shift('roster.view'::text, shift_id)));
ALTER POLICY "Users can view relevant planning offers" ON public.planning_offers
  USING (((( SELECT auth.uid() AS uid) = offered_by) OR (( SELECT auth.uid() AS uid) IN ( SELECT planning_requests.initiated_by
   FROM planning_requests
  WHERE (planning_requests.id = planning_offers.request_id))) OR can_act_on_planning_request('roster.view'::text, request_id)));
ALTER POLICY "authenticated_read_cancellation_history" ON public.cancellation_history
  USING ((EXISTS ( SELECT 1
   FROM shifts s
  WHERE ((s.id = cancellation_history.shift_id) AND user_has_action_in_scope('roster.view'::text, s.organization_id, s.department_id, s.sub_department_id)))));
ALTER POLICY "baseline_ft_patterns_read" ON public.baseline_ft_patterns
  USING (user_has_action_in_scope('roster.view'::text, organization_id, department_id, sub_department_id));
ALTER POLICY "baseline_ft_runs_read" ON public.baseline_ft_runs
  USING (user_has_action_in_scope('roster.view'::text, organization_id, department_id, sub_department_id));
ALTER POLICY "baseline_ft_proposed_read" ON public.baseline_ft_proposed_shifts
  USING ((EXISTS ( SELECT 1
   FROM baseline_ft_runs r
  WHERE ((r.id = baseline_ft_proposed_shifts.run_id) AND user_has_action_in_scope('roster.view'::text, r.organization_id, r.department_id, r.sub_department_id)))));

-- ── 5. Policies that asked "gamma or above?" and never asked where ───────────

-- 5a. Availability (Grid). View: whoever views the employee's roster. Manage: whoever
--     assigns that employee's shifts. Both were gamma+ across the organization.
ALTER POLICY availability_exceptions_select ON public.availability_exceptions
  USING (profile_id = (SELECT auth.uid()) OR public.can_act_on_employee('roster.view', profile_id));
ALTER POLICY availability_exceptions_insert ON public.availability_exceptions
  WITH CHECK ((profile_id = (SELECT auth.uid()) AND severity = ANY (ARRAY['SOFT'::text, 'PREFERENCE'::text]))
              OR public.can_act_on_employee('shift.assign', profile_id));
ALTER POLICY availability_exceptions_update ON public.availability_exceptions
  USING (profile_id = (SELECT auth.uid()) OR public.can_act_on_employee('shift.assign', profile_id))
  WITH CHECK ((profile_id = (SELECT auth.uid()) AND severity = ANY (ARRAY['SOFT'::text, 'PREFERENCE'::text]))
              OR public.can_act_on_employee('shift.assign', profile_id));
ALTER POLICY availability_exceptions_delete ON public.availability_exceptions
  USING (profile_id = (SELECT auth.uid()) OR public.can_act_on_employee('shift.assign', profile_id));

ALTER POLICY availability_requests_select ON public.availability_requests
  USING (profile_id = (SELECT auth.uid()) OR public.can_act_on_employee('roster.view', profile_id));
ALTER POLICY availability_requests_insert ON public.availability_requests
  WITH CHECK (public.can_act_on_employee('shift.assign', profile_id) AND requested_by = (SELECT auth.uid()));
ALTER POLICY availability_requests_update ON public.availability_requests
  USING (public.can_act_on_employee('shift.assign', profile_id))
  WITH CHECK (public.can_act_on_employee('shift.assign', profile_id));

ALTER POLICY availability_rules_select ON public.availability_rules
  USING (profile_id = (SELECT auth.uid()) OR public.can_act_on_employee('roster.view', profile_id));
ALTER POLICY availability_slots_select ON public.availability_slots
  USING (profile_id = (SELECT auth.uid()) OR public.can_act_on_employee('roster.view', profile_id));

-- 5b. Department budgets. Read by anyone viewing the department or one of its
--     sub-departments; written by zeta (a department budget is wider than a gamma's
--     sub-department, and delta is view-only). Was one gamma+ ALL policy, no scope.
DROP POLICY dept_budgets_manager_all ON public.department_budgets;
CREATE POLICY dept_budgets_select ON public.department_budgets
  FOR SELECT TO authenticated
  USING (public.can_act_in_dept('roster.view', department_budgets.dept_id)
         OR EXISTS (SELECT 1 FROM public.sub_departments sd
                     WHERE sd.department_id = department_budgets.dept_id
                       AND public.can_act_in_subdept('roster.view', sd.id)));
CREATE POLICY dept_budgets_admin_write ON public.department_budgets
  FOR ALL TO authenticated
  USING (public.is_zeta())
  WITH CHECK (public.is_zeta());

-- 5c. Performance (KPI). Read in scope; written only by the definer jobs (no client path
--     writes these) or zeta.
ALTER POLICY perf_metrics_self_or_manager_read ON public.employee_performance_metrics
  USING (employee_id = (SELECT auth.uid()) OR public.can_act_on_employee('roster.view', employee_id));
ALTER POLICY perf_metrics_manager_insert ON public.employee_performance_metrics
  WITH CHECK (public.is_zeta());
ALTER POLICY perf_metrics_manager_update ON public.employee_performance_metrics
  USING (public.is_zeta() AND is_locked = false)
  WITH CHECK (public.is_zeta());
ALTER POLICY perf_snapshots_self_or_manager_read ON public.employee_performance_snapshots
  USING (employee_id = (SELECT auth.uid()) OR public.can_act_on_employee('roster.view', employee_id));
ALTER POLICY perf_snapshots_manager_write ON public.employee_performance_snapshots
  USING (public.is_zeta())
  WITH CHECK (public.is_zeta());

-- 5d. Payroll records: in scope (was gamma+ across the organization).
ALTER POLICY payroll_records_self_or_manager_select ON public.shift_payroll_records
  USING ((EXISTS (SELECT 1 FROM public.shifts s
                   WHERE s.id = shift_payroll_records.shift_id
                     AND s.assigned_employee_id = (SELECT auth.uid())))
         OR public.can_act_on_shift('roster.view', shift_payroll_records.shift_id));

-- 5e. Templates: drafts are visible to whoever views that place; edits need the template
--     edit right at that place (auth_can_create_template = roster.edit there).
ALTER POLICY roster_templates_select ON public.roster_templates
  USING (status = 'published'::template_status
         OR public.user_has_action_in_scope('roster.view', organization_id, department_id, sub_department_id));
ALTER POLICY roster_templates_update ON public.roster_templates
  USING (public.auth_can_manage_templates() OR public.auth_can_create_template(organization_id, department_id, sub_department_id))
  WITH CHECK (public.auth_can_manage_templates() OR public.auth_can_create_template(organization_id, department_id, sub_department_id));

-- ── 6. Admin Suite: Labor Demand and Compliance Rejections are zeta's ─────────
-- Demand templates were gamma+ by level name; synthesis runs, tensors and forecasts
-- were shift.create by place. Everything that writes them is the Labor Demand page.
ALTER POLICY manager_insert_demand_templates ON public.demand_templates WITH CHECK (public.is_zeta());
ALTER POLICY manager_update_demand_templates ON public.demand_templates USING (public.is_zeta());
ALTER POLICY manager_delete_demand_templates ON public.demand_templates USING (public.is_zeta());
ALTER POLICY authenticated_read_synthesis_runs ON public.synthesis_runs USING (public.is_zeta());
ALTER POLICY authenticated_write_synthesis_runs ON public.synthesis_runs WITH CHECK (public.is_zeta());
ALTER POLICY authenticated_update_synthesis_runs ON public.synthesis_runs
  USING (public.is_zeta()) WITH CHECK (public.is_zeta());
ALTER POLICY manager_insert_demand_tensor ON public.demand_tensor WITH CHECK (public.is_zeta());
ALTER POLICY manager_update_demand_tensor ON public.demand_tensor USING (public.is_zeta());
ALTER POLICY manager_delete_demand_tensor ON public.demand_tensor USING (public.is_zeta());
ALTER POLICY demand_forecasts_delete_run_manager ON public.demand_forecasts USING (public.is_zeta());

-- Was shift.view at the employee's place (beta and up).
ALTER POLICY managers_read_compliance_rejections ON public.compliance_rejections USING (public.is_zeta());
