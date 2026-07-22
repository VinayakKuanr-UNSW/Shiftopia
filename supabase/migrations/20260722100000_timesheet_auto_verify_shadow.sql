-- ============================================================================
-- Timesheets AutoPilot — auto-verify (shadow-first)
--
-- Brings Timesheets up to the same autonomous pipeline as swap auto-approve:
--   shift becomes timesheet-reviewable  ──(enqueue trigger, gated to enabled)──▶
--   timesheet_review_queue  ──(auto-verify-timesheets Edge worker + cron)──▶
--   sm_timesheet_auto_decide  ──▶  timesheet_decisions (+ audit) / commit approval
--
-- Rule: ZERO-VARIANCE CLEAN PUNCHES (evaluated in the worker; see variance.ts).
--   AUTO_APPROVE only when: terminal attendance state AND clock-in/out within
--   tolerance of schedule AND no overtime AND no manual billable edits.
--   Everything else -> MANUAL_REVIEW. Timesheets are never auto-rejected.
--
-- Safety, mirroring swap_auto_approve_shadow:
--   * enabled=false / shadow_mode=true defaults  -> logs only, never commits
--   * enqueue trigger wrapped EXCEPTION -> RETURN NEW  -> can NEVER block a shift
--   * gated to enqueue only when an ENABLED policy exists  -> inert until opt-in
--   * extensions.digest() schema-qualified (pgcrypto lives in extensions)
--   * approval commit still passes through trg_enforce_timesheet_review_gate
--
-- Reuses generic autopilot_* enums so Open Bids can share them later.
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

-- ── Policy ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.timesheet_approval_rules (
    id                             uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    organization_id                uuid NOT NULL,
    department_id                  uuid,
    enabled                        boolean DEFAULT false NOT NULL,
    shadow_mode                    boolean DEFAULT true  NOT NULL,
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

-- one org-default row (department_id IS NULL) + at most one row per dept
CREATE UNIQUE INDEX IF NOT EXISTS timesheet_rules_org_default_uniq
    ON public.timesheet_approval_rules (organization_id) WHERE department_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS timesheet_rules_org_dept_uniq
    ON public.timesheet_approval_rules (organization_id, department_id) WHERE department_id IS NOT NULL;

-- ── Decisions (one row per bot evaluation) ─────────────────────────────────
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
    shadow            boolean DEFAULT false NOT NULL,
    committed         boolean DEFAULT false NOT NULL,
    reverted_at       timestamptz,
    reverted_by       uuid,
    created_at        timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS timesheet_decisions_shift_idx   ON public.timesheet_decisions (shift_id, created_at DESC);
CREATE INDEX IF NOT EXISTS timesheet_decisions_created_idx ON public.timesheet_decisions (created_at DESC);

-- ── Append-only audit log ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.timesheet_audit_log (
    id          uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    shift_id    uuid NOT NULL,
    decision_id uuid,
    event_type  text NOT NULL,
    actor       text DEFAULT 'system' NOT NULL,
    detail      jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at  timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS timesheet_audit_shift_idx ON public.timesheet_audit_log (shift_id, created_at DESC);

-- ── Work queue (SKIP LOCKED, exp-backoff, DLQ) ─────────────────────────────
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

-- ── Enqueue trigger: a shift crossing into a timesheet-reviewable terminal
--    state, when an ENABLED policy exists for its scope. Best-effort: never
--    blocks the parent shift write. (Pure time-based no-show crossings that
--    arrive with no shift UPDATE are handled at MANUAL_REVIEW by the worker's
--    periodic scan; they are not auto-approvable anyway.)
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
  -- reviewable predicate, inlined (mirrors is_shift_timesheet_reviewable).
  -- COALESCE to false so a NULL attendance_status / start_at can never leave the
  -- expression NULL and slip past the "not a fresh crossing" guard below.
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
    RETURN NEW;  -- not a fresh crossing into reviewable
  END IF;

  -- GATE: enqueue only when an ENABLED policy exists for this scope (dept beats org).
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

  INSERT INTO public.timesheet_audit_log (shift_id, event_type, actor, detail)
  VALUES (NEW.id, 'ENQUEUED', 'system', jsonb_build_object('idempotency_key', v_idem, 'policy_version', v_pol_ver));

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

-- ── Decide RPC — the commit gateway (idempotency / kill-switch / shadow) ─────
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
  v_shadow boolean := true;
  v_ts_id uuid;
  v_decision_id uuid;
  v_existing uuid;
BEGIN
  -- authz: manager (gamma+) or service-role/system (auth.uid() null)
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
    INSERT INTO public.timesheet_audit_log (shift_id, event_type, actor, detail)
    VALUES (p_shift_id, 'SKIPPED_NOT_REVIEWABLE', 'system', '{}'::jsonb);
    RETURN jsonb_build_object('ok', true, 'code', 'NOT_REVIEWABLE');
  END IF;

  SELECT * INTO v_policy FROM public.timesheet_approval_rules
  WHERE organization_id = v_shift.organization_id
    AND (department_id = v_shift.department_id OR department_id IS NULL)
  ORDER BY department_id NULLS LAST LIMIT 1;

  IF NOT FOUND OR v_policy.enabled IS NOT TRUE THEN
    INSERT INTO public.timesheet_audit_log (shift_id, event_type, actor, detail)
    VALUES (p_shift_id, 'KILLSWITCH_OFF', 'system', jsonb_build_object('policy_found', FOUND));
    RETURN jsonb_build_object('ok', true, 'code', 'DISABLED');
  END IF;

  v_shadow := COALESCE(v_policy.shadow_mode, true);
  v_decision := COALESCE((p_payload->>'decision')::public.autopilot_decision_kind, 'MANUAL_REVIEW');

  SELECT id INTO v_ts_id FROM public.timesheets WHERE shift_id = p_shift_id ORDER BY updated_at DESC NULLS LAST LIMIT 1;

  INSERT INTO public.timesheet_decisions(
    shift_id, timesheet_id, idempotency_key, decision, reason, detail, variance_snapshot,
    policy_version, engine_version, employee_id, work_date, subtitle, shadow, committed)
  VALUES (
    p_shift_id, v_ts_id, p_idempotency_key, v_decision,
    p_payload->>'reason',
    COALESCE(p_payload->'detail', '{}'::jsonb),
    COALESCE(p_payload->'variance_snapshot', '{}'::jsonb),
    COALESCE((p_payload->>'policy_version')::int, v_policy.version),
    COALESCE(p_payload->>'engine_version', 'unknown'),
    v_shift.assigned_employee_id, v_shift.shift_date, p_payload->>'subtitle',
    v_shadow, false)
  RETURNING id INTO v_decision_id;

  -- SHADOW: log only, never touch the timesheet
  IF v_shadow THEN
    INSERT INTO public.timesheet_audit_log (shift_id, decision_id, event_type, actor, detail)
    VALUES (p_shift_id, v_decision_id, 'SHADOW_SUPPRESSED', 'system', jsonb_build_object('would_be', v_decision));
    RETURN jsonb_build_object('ok', true, 'code', 'SHADOW', 'decision', v_decision, 'decision_id', v_decision_id);
  END IF;

  -- LIVE: only AUTO_APPROVE commits; anything else routes to a human.
  IF v_decision = 'AUTO_APPROVE' AND v_ts_id IS NOT NULL THEN
    -- Passes through trg_enforce_timesheet_review_gate (reviewable => allowed).
    UPDATE public.timesheets
       SET status = 'approved',
           approved_at = now(),
           notes = COALESCE(NULLIF(notes, ''), 'Auto-verified: zero-variance clean punches'),
           updated_at = now()
     WHERE id = v_ts_id;

    UPDATE public.shifts
       SET lifecycle_status = 'Completed', updated_at = now()
     WHERE id = p_shift_id
       AND lifecycle_status NOT IN ('Completed', 'Cancelled', 'Draft');

    UPDATE public.timesheet_decisions SET committed = true WHERE id = v_decision_id;
    INSERT INTO public.timesheet_audit_log (shift_id, decision_id, event_type, actor, detail)
    VALUES (p_shift_id, v_decision_id, 'COMMITTED', 'system', jsonb_build_object('timesheet_id', v_ts_id));
    RETURN jsonb_build_object('ok', true, 'code', 'COMMITTED', 'decision', v_decision, 'decision_id', v_decision_id);
  END IF;

  -- AUTO_APPROVE with no timesheet row, or MANUAL_REVIEW / AUTO_REJECT -> human.
  INSERT INTO public.timesheet_audit_log (shift_id, decision_id, event_type, actor, detail)
  VALUES (p_shift_id, v_decision_id, 'DECIDED_MANUAL_REVIEW', 'system',
          jsonb_build_object('decision', v_decision, 'had_timesheet', v_ts_id IS NOT NULL));
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
    UPDATE public.timesheets
       SET status = 'submitted', approved_at = NULL, approved_by = NULL, updated_at = now()
     WHERE id = v_dec.timesheet_id AND status = 'approved';
  END IF;

  UPDATE public.timesheet_decisions SET reverted_at = now(), reverted_by = p_actor WHERE id = p_decision_id;
  INSERT INTO public.timesheet_audit_log (shift_id, decision_id, event_type, actor, detail)
  VALUES (v_dec.shift_id, p_decision_id, 'REVERTED', p_actor::text, jsonb_build_object('by', p_actor));
  RETURN jsonb_build_object('ok', true, 'code', 'REVERTED', 'decision_id', p_decision_id);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_timesheet_auto_revert failed (decision=%): %', p_decision_id, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END; $$;

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

-- ── RLS (mirrors swap_* : gamma+ read on decisions/audit; org-scoped ALL on rules) ─
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

-- queue has RLS enabled with NO policy: reachable only via SECURITY DEFINER RPCs / service_role.

-- ── Grants (RLS is the gate; anon revoked on functions) ─────────────────────
GRANT SELECT, INSERT, UPDATE ON TABLE public.timesheet_approval_rules TO authenticated, service_role;
GRANT SELECT           ON TABLE public.timesheet_decisions      TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.timesheet_decisions TO service_role;
GRANT SELECT           ON TABLE public.timesheet_audit_log      TO authenticated;
GRANT SELECT, INSERT   ON TABLE public.timesheet_audit_log      TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.timesheet_review_queue TO service_role;

REVOKE ALL ON FUNCTION public.sm_timesheet_auto_decide(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sm_timesheet_auto_revert(uuid, uuid)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sm_timesheet_queue_claim(text, integer)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sm_timesheet_queue_complete(uuid, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sm_timesheet_auto_decide(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.sm_timesheet_auto_revert(uuid, uuid)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sm_timesheet_queue_claim(text, integer)     TO service_role;
GRANT EXECUTE ON FUNCTION public.sm_timesheet_queue_complete(uuid, text, text) TO service_role;

COMMENT ON TABLE public.timesheet_approval_rules IS 'Per-org Timesheets AutoPilot policy (auto-verify). enabled/shadow_mode drive OFF/SHADOW/LIVE. Shadow-first defaults.';
COMMENT ON FUNCTION public.sm_timesheet_auto_decide(uuid, text, jsonb) IS 'Commit gateway for timesheet auto-verify: idempotency + kill-switch + shadow; commits AUTO_APPROVE via the gated timesheets write. Worker supplies decision + variance snapshot.';
