-- ============================================================================
-- Timesheets AutoPilot — FIXED policy + billable snap-to-schedule
--
-- Supersedes the *configurable* windowing from 20260723120000. The policy is no
-- longer tunable per-org — it is one fixed rule:
--
--   • WINDOW  — AutoPilot only acts 18:00–06:00 Australia/Sydney (off-office
--               hours), DST-safe. During office hours (06:00–18:00) the bot is
--               dormant and every completed shift waits for a manager.
--   • ENQUEUE — a shift is queued the moment it becomes reviewable *whenever*
--               AutoPilot is ON (any time of day). Daytime completions sit in
--               the queue; the worker only DRAINS them overnight, so managers
--               get first crack during the day and the bot sweeps the leftovers.
--   • TOLERANCE — ±7.5 min (lives in the worker/variance.ts, not the DB).
--   • BILLABLE — the bot does NOT overwrite billable times. It only flips status
--               to 'approved'; billable is derived by the system-wide resolver
--               (billable-time.ts / grossPay) as the ACTUAL punch rounded to the
--               nearest 15 min — the same rule managers and payroll already use.
--               (Auto-verify is gated to punches within ±7.5 min, so that rounded
--               value equals the roster on a quarter-hour schedule anyway.)
--               Writing scheduled times here would masquerade as a manual
--               manager override, so we deliberately leave them untouched.
--
-- Idempotent: CREATE OR REPLACE only. The schedule_enabled / start_time_local /
-- end_time_local / timezone columns from 20260723120000 become vestigial (no
-- longer read) — left in place to avoid a destructive drop.
-- ============================================================================

-- ── 1. Window: FIXED 18:00–06:00 Australia/Sydney (config columns ignored) ───
CREATE OR REPLACE FUNCTION public.is_timesheet_autopilot_active(
    p_org_id uuid,
    p_dept_id uuid DEFAULT NULL,
    p_eval_time timestamptz DEFAULT now()
) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_enabled boolean;
  v_local_time time;
BEGIN
  SELECT enabled INTO v_enabled
    FROM public.timesheet_approval_rules
   WHERE organization_id = p_org_id
     AND (department_id = p_dept_id OR department_id IS NULL)
   ORDER BY department_id NULLS LAST
   LIMIT 1;

  IF v_enabled IS NOT TRUE THEN
    RETURN false;                       -- OFF ⇒ never acts
  END IF;

  -- DST-safe: AT TIME ZONE resolves AEST/AEDT for this instant.
  BEGIN
    v_local_time := (p_eval_time AT TIME ZONE 'Australia/Sydney')::time;
  EXCEPTION WHEN OTHERS THEN
    v_local_time := (p_eval_time AT TIME ZONE 'UTC')::time;
  END;

  -- Fixed off-office window: on from 18:00, off at 06:00.
  RETURN v_local_time >= TIME '18:00' OR v_local_time < TIME '06:00';
END; $$;

COMMENT ON FUNCTION public.is_timesheet_autopilot_active(uuid, uuid, timestamptz) IS
  'Timesheets AutoPilot active-window gate: enabled AND now() within the fixed 18:00-06:00 Australia/Sydney off-office window (DST-safe). Not configurable.';

-- ── 2. Enqueue whenever ON (any time of day) — worker gates on the window ────
CREATE OR REPLACE FUNCTION public.enqueue_timesheet_auto_verify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_new_ok boolean;
  v_old_ok boolean;
  v_pol_ver int;
  v_enabled boolean;
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

  SELECT version, enabled INTO v_pol_ver, v_enabled
  FROM public.timesheet_approval_rules
  WHERE organization_id = NEW.organization_id
    AND (department_id = NEW.department_id OR department_id IS NULL)
  ORDER BY department_id NULLS LAST
  LIMIT 1;

  -- Enqueue whenever AutoPilot is ON, regardless of the time of day. The worker
  -- only drains the queue inside the 18:00-06:00 window, so a daytime completion
  -- waits (available to managers first) and is swept the same night.
  IF v_pol_ver IS NULL OR v_enabled IS NOT TRUE THEN
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

-- ── 3. Provenance trigger: fold the bot's snap into AUTO_APPROVED (no dup EDIT) ─
CREATE OR REPLACE FUNCTION public.fn_timesheet_provenance() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_autopilot text := NULLIF(current_setting('app.timesheet.autopilot', true), '');  -- decision_id when the bot is acting
  v_revert boolean := COALESCE(current_setting('app.timesheet.revert', true), '') = '1';  -- undo of a bot auto-verify
  v_new text := lower(COALESCE(NEW.status::text, ''));
  v_old text := '';   -- OLD is NULL on INSERT; assigned in the UPDATE path only
  v_human_source text := CASE WHEN v_actor IS NULL THEN 'system' ELSE 'manager' END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
    VALUES (NEW.id, NEW.shift_id,
            CASE WHEN v_new = 'submitted' THEN 'SUBMITTED' WHEN v_new = 'no_show' THEN 'NO_SHOW' ELSE 'CREATED' END,
            CASE WHEN v_actor IS NULL THEN 'system' ELSE 'employee' END, v_actor,
            jsonb_build_object('status', v_new));
    RETURN NEW;
  END IF;

  v_old := lower(COALESCE(OLD.status::text, ''));  -- safe here: UPDATE only

  -- Status transitions
  IF v_new IS DISTINCT FROM v_old THEN
    IF v_new = 'approved' THEN
      IF v_autopilot IS NOT NULL THEN
        INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
        VALUES (NEW.id, NEW.shift_id, 'AUTO_APPROVED', 'bot', NULL,
                jsonb_build_object('decision_id', v_autopilot));
      ELSE
        INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
        VALUES (NEW.id, NEW.shift_id, 'MANUALLY_APPROVED', v_human_source, v_actor,
                jsonb_build_object('from', v_old));
      END IF;
    ELSIF v_new = 'rejected' THEN
      INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
      VALUES (NEW.id, NEW.shift_id, 'REJECTED', v_human_source, v_actor,
              jsonb_build_object('reason', NEW.rejected_reason));
    ELSIF v_new = 'no_show' THEN
      INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
      VALUES (NEW.id, NEW.shift_id, 'NO_SHOW', v_human_source, v_actor, '{}'::jsonb);
    ELSIF v_old = 'approved' AND v_new IN ('submitted', 'draft') THEN
      INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
      VALUES (NEW.id, NEW.shift_id, CASE WHEN v_revert THEN 'REVERTED' ELSE 'REOPENED' END, v_human_source, v_actor,
              jsonb_build_object('to', v_new));
    ELSIF v_new = 'submitted' THEN
      INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
      VALUES (NEW.id, NEW.shift_id, 'SUBMITTED', CASE WHEN v_actor IS NULL THEN 'system' ELSE 'employee' END, v_actor, '{}'::jsonb);
    END IF;
  END IF;

  -- Billable-time / break edits (independent of a status change). The bot never
  -- edits billable times (it only flips status), but guard on v_autopilot anyway
  -- so any future bot write can't masquerade as a manager EDITED row.
  IF v_autopilot IS NULL AND (
       NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.end_time IS DISTINCT FROM OLD.end_time
       OR NEW.paid_break_minutes IS DISTINCT FROM OLD.paid_break_minutes
       OR NEW.unpaid_break_minutes IS DISTINCT FROM OLD.unpaid_break_minutes) THEN
    -- Variance reasons (added by 20260724004000) are captured here too; plpgsql
    -- late-binds the column refs, so referencing them before that migration
    -- applies is safe (and the block's EXCEPTION handler covers the gap anyway).
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
END; $$;

-- ── 4. Decide RPC: snap billable to schedule on auto-approve ─────────────────
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

  SELECT id INTO v_existing FROM public.timesheet_decisions WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'IDEMPOTENT_REPLAY', 'decision_id', v_existing);
  END IF;

  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'GONE'); END IF;

  -- Fixed off-office window (enabled + 18:00-06:00 Sydney).
  IF NOT public.is_timesheet_autopilot_active(v_shift.organization_id, v_shift.department_id, now()) THEN
    RETURN jsonb_build_object('ok', true, 'code', 'OUTSIDE_WINDOW');
  END IF;

  -- A manager who has undone a prior auto-verify wants it left alone.
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

  -- AUTO_APPROVE with a timesheet row → flip status to approved ONLY. Billable
  -- times are left untouched so the system-wide resolver derives them from the
  -- actual punch (rounded to 15 min), identical to manual review; writing
  -- scheduled times here would masquerade as a manager override. The GUC lets the
  -- provenance trigger tag the write AUTO_APPROVED (source=bot).
  IF v_decision = 'AUTO_APPROVE' AND v_ts_id IS NOT NULL THEN
    PERFORM set_config('app.timesheet.autopilot', v_decision_id::text, true);
    UPDATE public.timesheets
       SET status = 'approved',
           approved_at = now(),
           notes = COALESCE(NULLIF(notes, ''), 'Auto-verified: clean punches within ±7.5m of roster'),
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

  -- Not auto-approved: record the bot's "needs a manager" call in the shift's own
  -- history timeline (source=bot).
  INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
  VALUES (v_ts_id, p_shift_id, 'BOT_REVIEW', 'bot', NULL,
          jsonb_build_object('decision_id', v_decision_id, 'reason', p_payload->>'reason'));

  RETURN jsonb_build_object('ok', true, 'code', 'MANUAL_REVIEW', 'decision', v_decision, 'decision_id', v_decision_id);

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_timesheet_auto_decide failed (shift=%, key=%): %', p_shift_id, p_idempotency_key, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END; $$;
