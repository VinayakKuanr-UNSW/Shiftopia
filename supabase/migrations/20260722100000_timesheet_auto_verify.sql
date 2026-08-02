-- ============================================================================
-- Timesheets AutoPilot — auto-verify (ON/OFF) + lifecycle audit
--
-- AutoPilot is a simple per-org ON/OFF switch (no shadow mode — a point-in-time
-- "would-decide" log is obsolete because the real action re-evaluates at commit).
-- When ON, the worker auto-approves zero-variance timesheets; everything else
-- routes to a manager.
--
--   shift becomes timesheet-reviewable  ──(enqueue trigger, gated to enabled)──▶
--   timesheet_review_queue  ──(auto-verify-timesheets worker + cron)──▶
--   sm_timesheet_auto_decide  ──▶ timesheet_decisions (bot log) + commits approval
--
-- LIFECYCLE AUDIT: `timesheet_audit_log` is the single provenance timeline for
-- every timesheet — CREATED / SUBMITTED / AUTO_APPROVED / MANUALLY_APPROVED /
-- REJECTED / EDITED / REOPENED / NO_SHOW — populated by a trigger on `timesheets`
-- so NO write path can bypass it (bot, manual API, edits all land here). Bot vs
-- manual is disambiguated by a session GUC the decide RPC sets (mirrors the
-- existing app.audit.via_gateway pattern). This audit is independent of AutoPilot
-- — it records manual approvals + edits even when AutoPilot is OFF.
--
-- Safety: enabled=false default; enqueue trigger EXCEPTION -> RETURN NEW (never
-- blocks a shift); gated to an enabled policy (inert until opt-in);
-- extensions.digest() schema-qualified; approval commit still passes
-- trg_enforce_timesheet_review_gate.
-- ============================================================================

-- ── Generic AutoPilot enums (shared across domains) ─────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'autopilot_decision_kind') THEN
    CREATE TYPE public.autopilot_decision_kind AS ENUM ('AUTO_APPROVE', 'MANUAL_REVIEW', 'AUTO_REJECT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'autopilot_queue_status') THEN
    CREATE TYPE public.autopilot_queue_status AS ENUM ('PENDING', 'CLAIMED', 'DONE', 'DLQ');
  END IF;
END $$;

-- ── Policy (ON/OFF; no shadow_mode) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.timesheet_approval_rules (
    id                             uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    organization_id                uuid NOT NULL,
    department_id                  uuid,
    enabled                        boolean DEFAULT false NOT NULL,
    tolerance_minutes              integer DEFAULT 5  NOT NULL,
    max_auto_per_employee_per_week integer DEFAULT 20 NOT NULL,
    require_no_overtime            boolean DEFAULT true NOT NULL,
    rules                          jsonb DEFAULT '{}'::jsonb NOT NULL,
    version                        integer DEFAULT 1 NOT NULL,
    updated_by                     uuid,
    updated_at                     timestamptz DEFAULT now() NOT NULL,
    created_at                     timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT timesheet_rules_tolerance_check CHECK (tolerance_minutes >= 0 AND tolerance_minutes <= 240),
    CONSTRAINT timesheet_rules_max_auto_check  CHECK (max_auto_per_employee_per_week >= 0),
    CONSTRAINT timesheet_rules_rules_is_object CHECK (jsonb_typeof(rules) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS timesheet_rules_org_default_uniq
    ON public.timesheet_approval_rules (organization_id) WHERE department_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS timesheet_rules_org_dept_uniq
    ON public.timesheet_approval_rules (organization_id, department_id) WHERE department_id IS NOT NULL;

-- ── Bot decision log (no shadow) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.timesheet_decisions (
    id                uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    shift_id          uuid NOT NULL,
    timesheet_id      uuid,
    idempotency_key   text NOT NULL UNIQUE,
    decision          public.autopilot_decision_kind NOT NULL,
    reason            text,
    detail            jsonb DEFAULT '{}'::jsonb NOT NULL,
    variance_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    policy_version    integer NOT NULL,
    engine_version    text NOT NULL,
    employee_id       uuid,
    work_date         date,
    subtitle          text,
    committed         boolean DEFAULT false NOT NULL,
    reverted_at       timestamptz,
    reverted_by       uuid,
    created_at        timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS timesheet_decisions_shift_idx   ON public.timesheet_decisions (shift_id, created_at DESC);
CREATE INDEX IF NOT EXISTS timesheet_decisions_created_idx ON public.timesheet_decisions (created_at DESC);

-- ── Unified lifecycle audit / provenance timeline (append-only) ─────────────
CREATE TABLE IF NOT EXISTS public.timesheet_audit_log (
    id           uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    timesheet_id uuid,
    shift_id     uuid NOT NULL,
    event_type   text NOT NULL,   -- CREATED SUBMITTED AUTO_APPROVED MANUALLY_APPROVED REJECTED EDITED REOPENED REVERTED NO_SHOW
    source       text NOT NULL DEFAULT 'system',  -- bot | manager | employee | system
    actor        uuid,
    actor_label  text,
    detail       jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at   timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS timesheet_audit_ts_idx    ON public.timesheet_audit_log (timesheet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS timesheet_audit_shift_idx ON public.timesheet_audit_log (shift_id, created_at DESC);

-- ── Work queue ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.timesheet_review_queue (
    id              uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    shift_id        uuid NOT NULL,
    idempotency_key text NOT NULL,
    status          public.autopilot_queue_status DEFAULT 'PENDING' NOT NULL,
    attempts        integer DEFAULT 0 NOT NULL,
    max_attempts    integer DEFAULT 5 NOT NULL,
    next_attempt_at timestamptz DEFAULT now() NOT NULL,
    locked_by       text,
    locked_at       timestamptz,
    last_error      text,
    created_at      timestamptz DEFAULT now() NOT NULL,
    updated_at      timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT timesheet_queue_shift_key_uniq UNIQUE (shift_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS timesheet_queue_pending_idx
    ON public.timesheet_review_queue (next_attempt_at) WHERE status = 'PENDING';

-- ── Policy version bump ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bump_timesheet_policy_version() RETURNS trigger
    LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF NEW.* IS DISTINCT FROM OLD.* THEN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_bump_timesheet_policy_version ON public.timesheet_approval_rules;
CREATE TRIGGER trg_bump_timesheet_policy_version
    BEFORE UPDATE ON public.timesheet_approval_rules
    FOR EACH ROW EXECUTE FUNCTION public.fn_bump_timesheet_policy_version();

-- ── LIFECYCLE PROVENANCE trigger on timesheets (captures every write path) ──
-- SECURITY DEFINER so it can append to the audit log regardless of the writer's
-- RLS. Best-effort: an audit failure must never block a timesheet write.
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
      -- A manager reopening an approved timesheet vs the auto-verify undo path.
      INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
      VALUES (NEW.id, NEW.shift_id, CASE WHEN v_revert THEN 'REVERTED' ELSE 'REOPENED' END, v_human_source, v_actor,
              jsonb_build_object('to', v_new));
    ELSIF v_new = 'submitted' THEN
      INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
      VALUES (NEW.id, NEW.shift_id, 'SUBMITTED', CASE WHEN v_actor IS NULL THEN 'system' ELSE 'employee' END, v_actor, '{}'::jsonb);
    END IF;
  END IF;

  -- Billable-time / break edits (independent of a status change)
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
                                           'paid_break', NEW.paid_break_minutes, 'unpaid_break', NEW.unpaid_break_minutes)));
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_timesheet_provenance swallowed (timesheet=%): %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_timesheet_provenance ON public.timesheets;
CREATE TRIGGER trg_timesheet_provenance
    AFTER INSERT OR UPDATE ON public.timesheets
    FOR EACH ROW EXECUTE FUNCTION public.fn_timesheet_provenance();

-- ── Append-only guard on the audit log ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_timesheet_audit_append_only() RETURNS trigger
    LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog'
    AS $$
BEGIN
  RAISE EXCEPTION 'timesheet_audit_log is append-only (% blocked)', TG_OP;
END; $$;

DROP TRIGGER IF EXISTS trg_timesheet_audit_append_only ON public.timesheet_audit_log;
CREATE TRIGGER trg_timesheet_audit_append_only
    BEFORE UPDATE OR DELETE ON public.timesheet_audit_log
    FOR EACH ROW EXECUTE FUNCTION public.fn_timesheet_audit_append_only();

-- ── Enqueue trigger: shift crossing into a timesheet-reviewable terminal state ─
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

DROP TRIGGER IF EXISTS trg_enqueue_timesheet_auto_verify ON public.shifts;
CREATE TRIGGER trg_enqueue_timesheet_auto_verify
    AFTER UPDATE ON public.shifts
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_timesheet_auto_verify();

-- ── Queue RPCs (service-role only) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sm_timesheet_queue_claim(p_worker text, p_limit integer DEFAULT 10)
    RETURNS SETOF public.timesheet_review_queue
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
BEGIN
  RETURN QUERY
  UPDATE public.timesheet_review_queue q
     SET status = 'CLAIMED', locked_by = p_worker, locked_at = now(),
         attempts = q.attempts + 1, updated_at = now()
   WHERE q.id IN (
     SELECT id FROM public.timesheet_review_queue
      WHERE (status = 'PENDING' AND next_attempt_at <= now())
         OR (status = 'CLAIMED' AND locked_at < now() - interval '5 minutes')
      ORDER BY next_attempt_at
      FOR UPDATE SKIP LOCKED
      LIMIT GREATEST(p_limit, 0)
   )
  RETURNING q.*;
END; $$;

CREATE OR REPLACE FUNCTION public.sm_timesheet_queue_complete(p_id uuid, p_status text, p_error text DEFAULT NULL)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_row public.timesheet_review_queue%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.timesheet_review_queue WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

  IF p_status = 'DONE' THEN
    UPDATE public.timesheet_review_queue SET status = 'DONE', last_error = NULL, updated_at = now() WHERE id = p_id;
  ELSIF v_row.attempts >= v_row.max_attempts THEN
    UPDATE public.timesheet_review_queue SET status = 'DLQ', last_error = p_error, updated_at = now() WHERE id = p_id;
  ELSE
    UPDATE public.timesheet_review_queue
       SET status = 'PENDING', last_error = p_error, locked_by = NULL, locked_at = NULL,
           next_attempt_at = now() + (interval '1 minute' * power(2, LEAST(v_row.attempts, 6))),
           updated_at = now()
     WHERE id = p_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'code', 'SETTLED');
END; $$;

-- ── Decide RPC — ON/OFF commit gateway (idempotency / kill-switch, no shadow) ─
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

  -- AUTO_APPROVE with a timesheet row → commit. The GUC lets the provenance
  -- trigger tag the resulting write AUTO_APPROVED (source=bot) + link this decision.
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

  -- Not auto-approved: record the bot's "needs a manager" call in the shift's own
  -- history timeline (source=bot), so provenance lives on the shift, not in a
  -- separate global list. (Committed auto-approvals are logged AUTO_APPROVED by
  -- trg_timesheet_provenance instead.)
  INSERT INTO public.timesheet_audit_log (timesheet_id, shift_id, event_type, source, actor, detail)
  VALUES (v_ts_id, p_shift_id, 'BOT_REVIEW', 'bot', NULL,
          jsonb_build_object('decision_id', v_decision_id, 'reason', p_payload->>'reason'));

  RETURN jsonb_build_object('ok', true, 'code', 'MANUAL_REVIEW', 'decision', v_decision, 'decision_id', v_decision_id);

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_timesheet_auto_decide failed (shift=%, key=%): %', p_shift_id, p_idempotency_key, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END; $$;

-- ── Revert RPC — undo a committed auto-verification (approved -> submitted) ──
CREATE OR REPLACE FUNCTION public.sm_timesheet_auto_revert(p_decision_id uuid, p_actor uuid)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_dec public.timesheet_decisions%ROWTYPE;
BEGIN
  IF v_caller IS NOT NULL AND NOT (
       public.is_admin()
       OR EXISTS (SELECT 1 FROM public.app_access_certificates c
                  WHERE c.user_id = v_caller AND c.is_active = true
                    AND c.access_level IN ('gamma','delta','epsilon','zeta'))
     ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_dec FROM public.timesheet_decisions WHERE id = p_decision_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF v_dec.decision <> 'AUTO_APPROVE' OR v_dec.committed IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_REVERTABLE', 'note', 'Only a committed AUTO_APPROVE can be reverted');
  END IF;
  IF v_dec.reverted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_REVERTED');
  END IF;

  IF v_dec.timesheet_id IS NOT NULL THEN
    -- approved -> submitted; the GUC makes the provenance trigger log REVERTED
    -- (rather than REOPENED) for this write — one accurate audit row, not two.
    PERFORM set_config('app.timesheet.revert', '1', true);
    UPDATE public.timesheets
       SET status = 'submitted', approved_at = NULL, approved_by = NULL, updated_at = now()
     WHERE id = v_dec.timesheet_id AND status = 'approved';
    PERFORM set_config('app.timesheet.revert', '', true);
  END IF;

  UPDATE public.timesheet_decisions SET reverted_at = now(), reverted_by = p_actor WHERE id = p_decision_id;
  RETURN jsonb_build_object('ok', true, 'code', 'REVERTED', 'decision_id', p_decision_id);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_timesheet_auto_revert failed (decision=%): %', p_decision_id, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END; $$;

-- ── RLS (gamma+ read on decisions/audit; org-scoped ALL on rules) ───────────
ALTER TABLE public.timesheet_approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_decisions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_audit_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_review_queue   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS timesheet_rules_admin_all ON public.timesheet_approval_rules;
CREATE POLICY timesheet_rules_admin_all ON public.timesheet_approval_rules
  USING (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.app_access_certificates c
     WHERE c.user_id = auth.uid() AND c.is_active = true
       AND c.access_level IN ('gamma','delta','epsilon','zeta')
       AND c.organization_id = timesheet_approval_rules.organization_id))
  WITH CHECK (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.app_access_certificates c
     WHERE c.user_id = auth.uid() AND c.is_active = true
       AND c.access_level IN ('gamma','delta','epsilon','zeta')
       AND c.organization_id = timesheet_approval_rules.organization_id));

DROP POLICY IF EXISTS timesheet_decisions_read ON public.timesheet_decisions;
CREATE POLICY timesheet_decisions_read ON public.timesheet_decisions FOR SELECT
  USING (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.app_access_certificates c
     WHERE c.user_id = auth.uid() AND c.is_active = true
       AND c.access_level IN ('gamma','delta','epsilon','zeta')));

DROP POLICY IF EXISTS timesheet_audit_read ON public.timesheet_audit_log;
CREATE POLICY timesheet_audit_read ON public.timesheet_audit_log FOR SELECT
  USING (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.app_access_certificates c
     WHERE c.user_id = auth.uid() AND c.is_active = true
       AND c.access_level IN ('gamma','delta','epsilon','zeta')));

-- ── Grants (RLS is the gate; anon revoked on functions) ─────────────────────
GRANT SELECT, INSERT, UPDATE ON TABLE public.timesheet_approval_rules TO authenticated, service_role;
GRANT SELECT                 ON TABLE public.timesheet_decisions      TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.timesheet_decisions      TO service_role;
GRANT SELECT                 ON TABLE public.timesheet_audit_log      TO authenticated;
GRANT SELECT, INSERT         ON TABLE public.timesheet_audit_log      TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.timesheet_review_queue   TO service_role;

REVOKE ALL ON FUNCTION public.sm_timesheet_auto_decide(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sm_timesheet_auto_revert(uuid, uuid)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sm_timesheet_queue_claim(text, integer)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sm_timesheet_queue_complete(uuid, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sm_timesheet_auto_decide(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.sm_timesheet_auto_revert(uuid, uuid)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sm_timesheet_queue_claim(text, integer)     TO service_role;
GRANT EXECUTE ON FUNCTION public.sm_timesheet_queue_complete(uuid, text, text) TO service_role;

COMMENT ON TABLE public.timesheet_approval_rules IS 'Per-org Timesheets AutoPilot policy (auto-verify). enabled = ON (bot acts) / OFF. No shadow mode.';
COMMENT ON TABLE public.timesheet_audit_log IS 'Append-only lifecycle provenance for every timesheet (bot + manual approvals + edits), populated by trg_timesheet_provenance. Independent of AutoPilot.';
COMMENT ON FUNCTION public.sm_timesheet_auto_decide(uuid, text, jsonb) IS 'ON/OFF commit gateway for timesheet auto-verify: idempotency + kill-switch; commits AUTO_APPROVE via the gated timesheets write (tagged AUTO_APPROVED by the provenance trigger via the app.timesheet.autopilot GUC).';
