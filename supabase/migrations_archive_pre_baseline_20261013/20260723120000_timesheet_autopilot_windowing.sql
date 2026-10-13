-- ============================================================================
-- Timesheets AutoPilot — Schedule Windowing & Backlog Sweeping
--
-- Enables time-of-day windowing (e.g. 6:00 PM – 6:00 AM Australia/Sydney) for
-- AutoPilot mode, along with backlog sweeping for zero-variance shifts that
-- completed during daytime managerial hours.
-- ============================================================================

-- ── 1. Schema Extensions for Windowing Policy ────────────────────────────────
ALTER TABLE public.timesheet_approval_rules
  ADD COLUMN IF NOT EXISTS schedule_enabled       boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS start_time_local       time DEFAULT '18:00' NOT NULL,
  ADD COLUMN IF NOT EXISTS end_time_local         time DEFAULT '06:00' NOT NULL,
  ADD COLUMN IF NOT EXISTS timezone               text DEFAULT 'Australia/Sydney' NOT NULL,
  ADD COLUMN IF NOT EXISTS sweep_daytime_backlog boolean DEFAULT true NOT NULL;

-- ── 2. Timezone Window Active Evaluation Function ────────────────────────────
CREATE OR REPLACE FUNCTION public.is_timesheet_autopilot_active(
    p_org_id uuid,
    p_dept_id uuid DEFAULT NULL,
    p_eval_time timestamptz DEFAULT now()
) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
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

  -- Dual read: top-level columns OR rules JSONB fallback
  v_sched_enabled := COALESCE(v_rule.schedule_enabled, (v_rule.rules->>'schedule_enabled')::boolean, false);
  v_start_time    := COALESCE(v_rule.start_time_local, (v_rule.rules->>'start_time_local')::time, '18:00'::time);
  v_end_time      := COALESCE(v_rule.end_time_local, (v_rule.rules->>'end_time_local')::time, '06:00'::time);
  v_tz            := COALESCE(NULLIF(v_rule.timezone, ''), v_rule.rules->>'timezone', 'Australia/Sydney');

  -- If time windowing is disabled, Autopilot runs 24/7 when enabled=true
  IF v_sched_enabled IS NOT TRUE THEN
    RETURN true;
  END IF;

  -- Convert timestamp instant to local time in configured timezone (handles AEST/AEDT DST)
  BEGIN
    v_local_time := (p_eval_time AT TIME ZONE v_tz)::time;
  EXCEPTION WHEN OTHERS THEN
    v_local_time := (p_eval_time AT TIME ZONE 'Australia/Sydney')::time;
  END;

  -- Overnight window comparison (e.g. 18:00 to 06:00)
  IF v_start_time > v_end_time THEN
    RETURN (v_local_time >= v_start_time OR v_local_time < v_end_time);
  ELSE
    RETURN (v_local_time >= v_start_time AND v_local_time < v_end_time);
  END IF;
END; $$;

-- ── 3. Update Enqueue Trigger Function ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_timesheet_auto_verify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_new_ok boolean;
  v_old_ok boolean;
  v_pol_ver int;
  v_idem text;
BEGIN
  v_new_ok := COALESCE(
                (NEW.attendance_status IN ('no_show','auto_clock_out'))
                OR NEW.actual_end IS NOT NULL
                OR (NEW.actual_start IS NULL AND now() > COALESCE(NEW.end_at, NEW.start_at + interval '12.5 hours')),
                false);
  v_old_ok := COALESCE(
                (OLD.attendance_status IN ('no_show','auto_clock_out'))
                OR OLD.actual_end IS NOT NULL
                OR (OLD.actual_start IS NULL AND now() > COALESCE(OLD.end_at, OLD.start_at + interval '12.5 hours')),
                false);

  IF NOT v_new_ok OR v_old_ok THEN
    RETURN NEW;
  END IF;

  -- Gate check: Autopilot enabled AND active during current schedule window for org/dept
  IF NOT public.is_timesheet_autopilot_active(NEW.organization_id, NEW.department_id, now()) THEN
    RETURN NEW;
  END IF;

  SELECT version INTO v_pol_ver
  FROM public.timesheet_approval_rules
  WHERE organization_id = NEW.organization_id
    AND (department_id = NEW.department_id OR department_id IS NULL)
  ORDER BY department_id NULLS LAST
  LIMIT 1;

  IF v_pol_ver IS NULL THEN
    RETURN NEW;
  END IF;

  v_idem := encode(
    extensions.digest(
      NEW.id::text || ':' ||
      COALESCE(NEW.actual_end::text, '') || ':' ||
      COALESCE(NEW.attendance_status::text, '') || ':' ||
      v_pol_ver::text, 'sha256'), 'hex');

  INSERT INTO public.timesheet_review_queue (shift_id, idempotency_key)
  VALUES (NEW.id, v_idem)
  ON CONFLICT (shift_id, idempotency_key) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'enqueue_timesheet_auto_verify swallowed error (shift=%): %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

-- ── 4. Daytime Backlog Sweep RPC ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sm_timesheet_enqueue_backlog(
    p_org_id uuid,
    p_lookback_days integer DEFAULT 1
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_pol_ver int;
  v_count int := 0;
  r RECORD;
  v_idem text;
BEGIN
  IF NOT public.is_timesheet_autopilot_active(p_org_id, NULL, now()) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OUTSIDE_WINDOW', 'enqueued', 0);
  END IF;

  SELECT version INTO v_pol_ver
    FROM public.timesheet_approval_rules
   WHERE organization_id = p_org_id
   ORDER BY department_id NULLS LAST
   LIMIT 1;

  IF v_pol_ver IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISABLED', 'enqueued', 0);
  END IF;

  FOR r IN
    SELECT DISTINCT s.id AS shift_id, s.actual_end, s.attendance_status
      FROM public.shifts s
     WHERE s.organization_id = p_org_id
       AND s.updated_at >= (now() - (p_lookback_days || ' days')::interval)
       AND (
         s.attendance_status IN ('no_show','auto_clock_out')
         OR s.actual_end IS NOT NULL
       )
       -- Exclude already finalized timesheets
       AND NOT EXISTS (
         SELECT 1 FROM public.timesheets t
          WHERE t.shift_id = s.id AND t.status IN ('approved', 'rejected', 'no_show')
       )
       -- Exclude shifts previously reverted by a manager
       AND NOT EXISTS (
         SELECT 1 FROM public.timesheet_decisions d
          WHERE d.shift_id = s.id AND d.reverted_at IS NOT NULL
       )
  LOOP
    v_idem := encode(
      extensions.digest(
        r.shift_id::text || ':' ||
        COALESCE(r.actual_end::text, '') || ':' ||
        COALESCE(r.attendance_status::text, '') || ':' ||
        v_pol_ver::text, 'sha256'), 'hex');

    INSERT INTO public.timesheet_review_queue (shift_id, idempotency_key)
    VALUES (r.shift_id, v_idem)
    ON CONFLICT (shift_id, idempotency_key) DO NOTHING;

    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'code', 'SWEEP_COMPLETE', 'enqueued', v_count);
END; $$;

-- ── 5. Update Decide RPC to Re-Check Window & Reversion Protection ─────────
CREATE OR REPLACE FUNCTION public.sm_timesheet_auto_decide(
    p_shift_id uuid, p_idempotency_key text, p_payload jsonb DEFAULT '{}'::jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_shift public.shifts%ROWTYPE;
  v_policy public.timesheet_approval_rules%ROWTYPE;
  v_decision public.autopilot_decision_kind;
  v_ts_id uuid;
  v_decision_id uuid;
  v_existing uuid;
  v_reverted boolean;
BEGIN
  IF v_caller IS NOT NULL AND NOT (
       public.is_admin()
       OR EXISTS (SELECT 1 FROM public.app_access_certificates c
                  WHERE c.user_id = v_caller AND c.is_active = true
                    AND c.access_level IN ('gamma','delta','epsilon','zeta'))
     ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  -- Idempotency dedup
  SELECT id INTO v_existing FROM public.timesheet_decisions WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'IDEMPOTENT_REPLAY', 'decision_id', v_existing);
  END IF;

  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'GONE'); END IF;

  -- Active window check (department-aware)
  IF NOT public.is_timesheet_autopilot_active(v_shift.organization_id, v_shift.department_id, now()) THEN
    RETURN jsonb_build_object('ok', true, 'code', 'OUTSIDE_WINDOW');
  END IF;

  -- Check if previously reverted by manager
  SELECT EXISTS (
    SELECT 1 FROM public.timesheet_decisions
     WHERE shift_id = p_shift_id AND reverted_at IS NOT NULL
  ) INTO v_reverted;

  IF v_reverted THEN
    RETURN jsonb_build_object('ok', true, 'code', 'PREVIOUSLY_REVERTED');
  END IF;

  IF NOT public.is_shift_timesheet_reviewable(p_shift_id) THEN
    RETURN jsonb_build_object('ok', true, 'code', 'NOT_REVIEWABLE');
  END IF;

  SELECT * INTO v_policy FROM public.timesheet_approval_rules
  WHERE organization_id = v_shift.organization_id
    AND (department_id = v_shift.department_id OR department_id IS NULL)
  ORDER BY department_id NULLS LAST LIMIT 1;

  IF NOT FOUND OR v_policy.enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', true, 'code', 'DISABLED');
  END IF;

  v_decision := COALESCE((p_payload->>'decision')::public.autopilot_decision_kind, 'MANUAL_REVIEW');
  SELECT id INTO v_ts_id FROM public.timesheets WHERE shift_id = p_shift_id ORDER BY updated_at DESC NULLS LAST LIMIT 1;

  INSERT INTO public.timesheet_decisions(
    shift_id, timesheet_id, idempotency_key, decision, reason, detail, variance_snapshot,
    policy_version, engine_version, employee_id, work_date, subtitle, committed)
  VALUES (
    p_shift_id, v_ts_id, p_idempotency_key, v_decision,
    p_payload->>'reason',
    COALESCE(p_payload->'detail', '{}'::jsonb),
    COALESCE(p_payload->'variance_snapshot', '{}'::jsonb),
    COALESCE((p_payload->>'policy_version')::int, v_policy.version),
    COALESCE(p_payload->>'engine_version', 'unknown'),
    v_shift.assigned_employee_id, v_shift.shift_date, p_payload->>'subtitle', false)
  RETURNING id INTO v_decision_id;

  -- AUTO_APPROVE with a timesheet row → commit.
  IF v_decision = 'AUTO_APPROVE' AND v_ts_id IS NOT NULL THEN
    PERFORM set_config('app.timesheet.autopilot', v_decision_id::text, true);
    UPDATE public.timesheets
       SET status = 'approved',
           approved_at = now(),
           notes = COALESCE(NULLIF(notes, ''), 'Auto-verified: zero-variance clean punches'),
           updated_at = now()
     WHERE id = v_ts_id;
    PERFORM set_config('app.timesheet.autopilot', '', true);

    UPDATE public.shifts
       SET lifecycle_status = 'Completed', updated_at = now()
     WHERE id = p_shift_id
       AND lifecycle_status NOT IN ('Completed', 'Cancelled', 'Draft');

    UPDATE public.timesheet_decisions SET committed = true WHERE id = v_decision_id;
    RETURN jsonb_build_object('ok', true, 'code', 'COMMITTED', 'decision', v_decision, 'decision_id', v_decision_id);
  END IF;

  -- Not auto-approved: record bot review
  INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
  VALUES (v_ts_id, p_shift_id, 'BOT_REVIEW', 'bot', NULL,
          jsonb_build_object('decision_id', v_decision_id, 'reason', p_payload->>'reason'));

  RETURN jsonb_build_object('ok', true, 'code', 'MANUAL_REVIEW', 'decision', v_decision, 'decision_id', v_decision_id);

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_timesheet_auto_decide failed (shift=%, key=%): %', p_shift_id, p_idempotency_key, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END; $$;

-- ── 6. Grants & Permissions ─────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.is_timesheet_autopilot_active(uuid, uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sm_timesheet_enqueue_backlog(uuid, integer)           FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_timesheet_autopilot_active(uuid, uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sm_timesheet_enqueue_backlog(uuid, integer)           TO service_role;
