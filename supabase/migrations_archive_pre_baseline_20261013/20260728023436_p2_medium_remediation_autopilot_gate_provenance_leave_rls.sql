-- ─────────────────────────────────────────────────────────────────────────────
-- Backfilled into version control 2026-08-02 from the PRODUCTION migration
-- ledger (supabase_migrations.schema_migrations @ version 20260728023436).
--
-- This migration was applied DIRECTLY to prod via the Supabase MCP during the
-- 2026-07-27/28 security & payroll audit and had no committed source file until
-- now. It is ALREADY APPLIED in prod — do not re-run against production.
-- Context: docs/investigations/2026-08-02_migration-reconciliation.md
-- ─────────────────────────────────────────────────────────────────────────────

-- Audit M-13: is_timesheet_autopilot_active's schedule-gate columns had drifted
-- from the JSON `rules` config (schedule_enabled column=false, rules JSON=true
-- on the live ICC Sydney row), and COALESCE picked the stale column first —
-- meaning if AutoPilot were ever re-enabled, the "off-hours only" restriction
-- would be silently bypassed (active 24/7). Make the JSON the primary source
-- (nothing in the live app writes either field yet, so there is no "current
-- writer" to defer to) and reconcile the existing row's columns to match.
CREATE OR REPLACE FUNCTION public.is_timesheet_autopilot_active(p_org_id uuid, p_dept_id uuid DEFAULT NULL::uuid, p_eval_time timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_rule public.timesheet_approval_rules%ROWTYPE;
  v_local_time time;
  v_sched_enabled boolean;
  v_start_time time;
  v_end_time time;
  v_tz text;
BEGIN
  SELECT * INTO v_rule
    FROM public.timesheet_approval_rules
   WHERE organization_id = p_org_id
     AND (department_id = p_dept_id OR department_id IS NULL)
   ORDER BY department_id NULLS LAST
   LIMIT 1;

  IF NOT FOUND OR v_rule.enabled IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- audit M-13: JSON `rules` is primary (it's the more complete/intentional
  -- config surface), the flat columns are a legacy fallback only used when
  -- the JSON key is absent.
  v_sched_enabled := COALESCE((v_rule.rules->>'schedule_enabled')::boolean, v_rule.schedule_enabled, false);
  v_start_time    := COALESCE((v_rule.rules->>'start_time_local')::time, v_rule.start_time_local, '18:00'::time);
  v_end_time      := COALESCE((v_rule.rules->>'end_time_local')::time, v_rule.end_time_local, '06:00'::time);
  v_tz            := COALESCE(v_rule.rules->>'timezone', NULLIF(v_rule.timezone, ''), 'Australia/Sydney');

  IF v_sched_enabled IS NOT TRUE THEN
    RETURN true;
  END IF;

  BEGIN
    v_local_time := (p_eval_time AT TIME ZONE v_tz)::time;
  EXCEPTION WHEN OTHERS THEN
    v_local_time := (p_eval_time AT TIME ZONE 'Australia/Sydney')::time;
  END;

  IF v_start_time > v_end_time THEN
    RETURN (v_local_time >= v_start_time OR v_local_time < v_end_time);
  ELSE
    RETURN (v_local_time >= v_start_time AND v_local_time < v_end_time);
  END IF;
END; $function$;

-- Reconcile the existing drifted row so a raw column read also agrees (belt
-- and braces alongside the JSON-primary function fix above).
UPDATE public.timesheet_approval_rules
SET schedule_enabled = COALESCE((rules->>'schedule_enabled')::boolean, schedule_enabled),
    start_time_local = COALESCE((rules->>'start_time_local')::time, start_time_local),
    end_time_local   = COALESCE((rules->>'end_time_local')::time, end_time_local),
    timezone         = COALESCE(rules->>'timezone', timezone)
WHERE rules IS NOT NULL;

-- Audit M-18: the timesheet provenance trigger logged EVERY approval as
-- 'MANUALLY_APPROVED' regardless of actor — a bot-driven AutoPilot approval
-- (auth.uid() IS NULL, service-role context) was indistinguishable from a
-- real manager's decision in the audit trail. Use the existing
-- v_human_source discriminator (already correctly computed) to pick the
-- event_type too, not just the `source` column.
CREATE OR REPLACE FUNCTION public.fn_timesheet_provenance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_new text := lower(COALESCE(NEW.status::text, ''));
  v_old text := '';
  v_human_source text := CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END;
  v_is_bot boolean := v_actor IS NULL;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
    VALUES (NEW.id, NEW.shift_id,
            CASE WHEN v_new = 'submitted' THEN 'SUBMITTED'
                 WHEN v_new = 'no_show'   THEN 'NO_SHOW'
                 WHEN v_new = 'approved'  THEN (CASE WHEN v_is_bot THEN 'AUTO_APPROVED' ELSE 'MANUALLY_APPROVED' END)
                 WHEN v_new = 'rejected'  THEN 'REJECTED'
                 ELSE 'CREATED' END,
            CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END, v_actor,
            jsonb_build_object('status', v_new));
    RETURN NEW;
  END IF;

  v_old := lower(COALESCE(OLD.status::text, ''));

  IF v_new IS DISTINCT FROM v_old THEN
    IF v_new = 'approved' THEN
      INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
      VALUES (NEW.id, NEW.shift_id, CASE WHEN v_is_bot THEN 'AUTO_APPROVED' ELSE 'MANUALLY_APPROVED' END, v_human_source, v_actor, jsonb_build_object('from', v_old));
    ELSIF v_new = 'rejected' THEN
      INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
      VALUES (NEW.id, NEW.shift_id, 'REJECTED', v_human_source, v_actor, jsonb_build_object('reason', NEW.rejected_reason));
    ELSIF v_new = 'no_show' THEN
      INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
      VALUES (NEW.id, NEW.shift_id, 'NO_SHOW', v_human_source, v_actor, '{}'::jsonb);
    ELSIF v_old = 'approved' AND v_new IN ('submitted', 'draft') THEN
      INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
      VALUES (NEW.id, NEW.shift_id, 'REOPENED', v_human_source, v_actor, jsonb_build_object('to', v_new));
    ELSIF v_new = 'submitted' THEN
      INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
      VALUES (NEW.id, NEW.shift_id, 'SUBMITTED', v_human_source, v_actor, '{}'::jsonb);
    END IF;
  END IF;

  IF NEW.start_time IS DISTINCT FROM OLD.start_time
     OR NEW.end_time IS DISTINCT FROM OLD.end_time
     OR NEW.paid_break_minutes IS DISTINCT FROM OLD.paid_break_minutes
     OR NEW.unpaid_break_minutes IS DISTINCT FROM OLD.unpaid_break_minutes THEN
    INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
    VALUES (NEW.id, NEW.shift_id, 'EDITED', v_human_source, v_actor,
            jsonb_build_object(
              'before', jsonb_build_object('start_time', OLD.start_time, 'end_time', OLD.end_time,
                                           'paid_break', OLD.paid_break_minutes, 'unpaid_break', OLD.unpaid_break_minutes),
              'after',  jsonb_build_object('start_time', NEW.start_time, 'end_time', NEW.end_time,
                                           'paid_break', NEW.paid_break_minutes, 'unpaid_break', NEW.unpaid_break_minutes),
              'arrival_variance_reason',   NEW.arrival_variance_reason,
              'departure_variance_reason', NEW.departure_variance_reason));
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_timesheet_provenance swallowed (timesheet=%): %', NEW.id, SQLERRM;
  RETURN NEW;
END; $function$;

-- Audit M-16: legacy (0-row, unused-in-app) employee_leave_balances table has
-- a public-read RLS policy (roles={public}, qual=true) plus GRANT ALL to
-- anon/authenticated. Superseded by leave_balances; nothing reads or writes
-- this table from the application. Lock it down the same way the 2026-07-19
-- remediation closed comparable no-policy/always-true gaps.
DROP POLICY IF EXISTS "Public read for employee_leave_balances" ON public.employee_leave_balances;
REVOKE ALL ON public.employee_leave_balances FROM anon, authenticated;

-- Audit M-17: accrue_leave_balances() (the nightly accrual cron body) is
-- anonymously executable. It's self-limiting against double-accrual
-- (as_of_date < CURRENT_DATE guards), but an unauthorized forced-recompute is
-- still an unnecessary DoS-adjacent surface with no legitimate caller other
-- than the pg_cron job itself (which runs as the job owner, not anon/
-- authenticated, so this revoke does not affect the schedule).
REVOKE EXECUTE ON FUNCTION public.accrue_leave_balances() FROM anon, authenticated;
