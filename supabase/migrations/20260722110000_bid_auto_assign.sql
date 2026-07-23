-- ============================================================================
-- Open Bids AutoPilot — auto-assign (ON/OFF)
--
-- Brings Open Bids up to the same autonomous pipeline as swap auto-approve and
-- timesheet auto-verify. AutoPilot is a per-org ON/OFF switch (no shadow mode).
--   shift bidding closes with no winner  ──(enqueue trigger, gated to enabled)──▶
--   bid_review_queue  ──(auto-assign-bids /tick worker + cron)──▶
--   sm_bid_auto_decide  ──▶  bid_decisions (+ audit) / commit via sm_select_bid_winner
--
-- The WINNER is chosen by the worker (first compliance-clear bidder in F3/FIFO
-- order, via the deployed evaluate-compliance engine). This RPC is the commit
-- gateway: idempotency / kill-switch, then delegates to the hardened
-- sm_select_bid_winner (FOUND / FSM / winner-pending / 4h-TTS guards +
-- version-CAS + shift_events audit). The worker never writes shifts directly.
--
-- Safety: enabled=false default; enqueue trigger EXCEPTION -> RETURN NEW (never
-- blocks a shift); gated to an enabled policy (inert until opt-in);
-- extensions.digest() schema-qualified. Reuses the generic autopilot_* enums.
-- ============================================================================

-- ── Generic AutoPilot enums (shared; created by the timesheet migration too) ─
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
CREATE TABLE IF NOT EXISTS public.bid_approval_rules (
    id                    uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    organization_id       uuid NOT NULL,
    department_id         uuid,
    enabled               boolean DEFAULT false NOT NULL,
    auto_assign_warnings  boolean DEFAULT false NOT NULL,
    rules                 jsonb DEFAULT '{}'::jsonb NOT NULL,
    version               integer DEFAULT 1 NOT NULL,
    updated_by            uuid,
    updated_at            timestamptz DEFAULT now() NOT NULL,
    created_at            timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT bid_rules_rules_is_object CHECK (jsonb_typeof(rules) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS bid_rules_org_default_uniq
    ON public.bid_approval_rules (organization_id) WHERE department_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bid_rules_org_dept_uniq
    ON public.bid_approval_rules (organization_id, department_id) WHERE department_id IS NOT NULL;

-- ── Decisions ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bid_decisions (
    id                uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    shift_id          uuid NOT NULL,
    winner_id         uuid,
    idempotency_key   text NOT NULL UNIQUE,
    decision          public.autopilot_decision_kind NOT NULL,
    reason            text,
    detail            jsonb DEFAULT '{}'::jsonb NOT NULL,
    eligibility       jsonb DEFAULT '{}'::jsonb NOT NULL,
    shift_version     integer,
    policy_version    integer NOT NULL,
    engine_version    text NOT NULL,
    subtitle          text,
    committed         boolean DEFAULT false NOT NULL,
    reverted_at       timestamptz,
    reverted_by       uuid,
    created_at        timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS bid_decisions_shift_idx   ON public.bid_decisions (shift_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bid_decisions_created_idx ON public.bid_decisions (created_at DESC);

-- ── Append-only audit log ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bid_audit_log (
    id          uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    shift_id    uuid NOT NULL,
    decision_id uuid,
    event_type  text NOT NULL,
    actor       text DEFAULT 'system' NOT NULL,
    detail      jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at  timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS bid_audit_shift_idx ON public.bid_audit_log (shift_id, created_at DESC);

-- ── Work queue ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bid_review_queue (
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
    CONSTRAINT bid_queue_shift_key_uniq UNIQUE (shift_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS bid_queue_pending_idx
    ON public.bid_review_queue (next_attempt_at) WHERE status = 'PENDING';

-- ── Policy version bump ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bump_bid_policy_version() RETURNS trigger
    LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF NEW.* IS DISTINCT FROM OLD.* THEN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_bump_bid_policy_version ON public.bid_approval_rules;
CREATE TRIGGER trg_bump_bid_policy_version
    BEFORE UPDATE ON public.bid_approval_rules
    FOR EACH ROW EXECUTE FUNCTION public.fn_bump_bid_policy_version();

-- ── Enqueue trigger: a shift whose bidding closes with no winner, still
--    unassigned, with at least one pending bid, when an ENABLED policy exists.
--    Best-effort: never blocks the parent shift write.
CREATE OR REPLACE FUNCTION public.enqueue_bid_auto_assign() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_pol_ver int;
  v_enabled boolean;
  v_idem text;
BEGIN
  -- Fire only on a fresh transition INTO bidding_closed_no_winner on an
  -- unassigned shift (the clean "bidding is over, pick a winner" signal).
  IF NOT (NEW.bidding_status = 'bidding_closed_no_winner'
          AND OLD.bidding_status IS DISTINCT FROM NEW.bidding_status
          AND NEW.assignment_status = 'unassigned') THEN
    RETURN NEW;
  END IF;

  -- Must have at least one pending bid to auto-assign.
  IF NOT EXISTS (SELECT 1 FROM public.shift_bids WHERE shift_id = NEW.id AND status = 'pending') THEN
    RETURN NEW;
  END IF;

  SELECT version, enabled INTO v_pol_ver, v_enabled
  FROM public.bid_approval_rules
  WHERE organization_id = NEW.organization_id
    AND (department_id = NEW.department_id OR department_id IS NULL)
  ORDER BY department_id NULLS LAST
  LIMIT 1;

  IF v_pol_ver IS NULL OR v_enabled IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_idem := encode(
    extensions.digest(
      NEW.id::text || ':' || COALESCE(NEW.version, 0)::text || ':' ||
      NEW.bidding_status::text || ':' || v_pol_ver::text, 'sha256'), 'hex');

  INSERT INTO public.bid_review_queue (shift_id, idempotency_key)
  VALUES (NEW.id, v_idem)
  ON CONFLICT (shift_id, idempotency_key) DO NOTHING;

  INSERT INTO public.bid_audit_log (shift_id, event_type, actor, detail)
  VALUES (NEW.id, 'ENQUEUED', 'system', jsonb_build_object('idempotency_key', v_idem, 'policy_version', v_pol_ver));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'enqueue_bid_auto_assign swallowed error (shift=%): %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_enqueue_bid_auto_assign ON public.shifts;
CREATE TRIGGER trg_enqueue_bid_auto_assign
    AFTER UPDATE ON public.shifts
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_bid_auto_assign();

-- ── Queue RPCs (service-role only) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sm_bid_queue_claim(p_worker text, p_limit integer DEFAULT 10)
    RETURNS SETOF public.bid_review_queue
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
BEGIN
  RETURN QUERY
  UPDATE public.bid_review_queue q
     SET status = 'CLAIMED', locked_by = p_worker, locked_at = now(),
         attempts = q.attempts + 1, updated_at = now()
   WHERE q.id IN (
     SELECT id FROM public.bid_review_queue
      WHERE (status = 'PENDING' AND next_attempt_at <= now())
         OR (status = 'CLAIMED' AND locked_at < now() - interval '5 minutes')
      ORDER BY next_attempt_at
      FOR UPDATE SKIP LOCKED
      LIMIT GREATEST(p_limit, 0)
   )
  RETURNING q.*;
END; $$;

CREATE OR REPLACE FUNCTION public.sm_bid_queue_complete(p_id uuid, p_status text, p_error text DEFAULT NULL)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_row public.bid_review_queue%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.bid_review_queue WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

  IF p_status = 'DONE' THEN
    UPDATE public.bid_review_queue SET status = 'DONE', last_error = NULL, updated_at = now() WHERE id = p_id;
  ELSIF v_row.attempts >= v_row.max_attempts THEN
    UPDATE public.bid_review_queue SET status = 'DLQ', last_error = p_error, updated_at = now() WHERE id = p_id;
  ELSE
    UPDATE public.bid_review_queue
       SET status = 'PENDING', last_error = p_error, locked_by = NULL, locked_at = NULL,
           next_attempt_at = now() + (interval '1 minute' * power(2, LEAST(v_row.attempts, 6))),
           updated_at = now()
     WHERE id = p_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'code', 'SETTLED');
END; $$;

-- ── Decide RPC — ON/OFF commit gateway; delegates the write to sm_select_bid_winner ─
CREATE OR REPLACE FUNCTION public.sm_bid_auto_decide(
    p_shift_id uuid, p_idempotency_key text, p_payload jsonb DEFAULT '{}'::jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_shift public.shifts%ROWTYPE;
  v_policy public.bid_approval_rules%ROWTYPE;
  v_decision public.autopilot_decision_kind;
  v_winner uuid;
  v_gateway jsonb;
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

  SELECT id INTO v_existing FROM public.bid_decisions WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'IDEMPOTENT_REPLAY', 'decision_id', v_existing);
  END IF;

  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'GONE'); END IF;

  SELECT * INTO v_policy FROM public.bid_approval_rules
  WHERE organization_id = v_shift.organization_id
    AND (department_id = v_shift.department_id OR department_id IS NULL)
  ORDER BY department_id NULLS LAST LIMIT 1;

  IF NOT FOUND OR v_policy.enabled IS NOT TRUE THEN
    INSERT INTO public.bid_audit_log (shift_id, event_type, actor, detail)
    VALUES (p_shift_id, 'KILLSWITCH_OFF', 'system', jsonb_build_object('policy_found', FOUND));
    RETURN jsonb_build_object('ok', true, 'code', 'DISABLED');
  END IF;

  v_decision := COALESCE((p_payload->>'decision')::public.autopilot_decision_kind, 'MANUAL_REVIEW');
  v_winner := NULLIF(p_payload->>'winner_id', '')::uuid;

  INSERT INTO public.bid_decisions(
    shift_id, winner_id, idempotency_key, decision, reason, detail, eligibility,
    shift_version, policy_version, engine_version, subtitle, committed)
  VALUES (
    p_shift_id, v_winner, p_idempotency_key, v_decision,
    p_payload->>'reason',
    COALESCE(p_payload->'detail', '{}'::jsonb),
    COALESCE(p_payload->'eligibility', '{}'::jsonb),
    (p_payload->>'expected_version')::int,
    COALESCE((p_payload->>'policy_version')::int, v_policy.version),
    COALESCE(p_payload->>'engine_version', 'unknown'),
    p_payload->>'subtitle', false)
  RETURNING id INTO v_decision_id;

  -- ON: only AUTO_APPROVE with a winner commits, via the hardened winner RPC
  -- (FOUND / FSM / winner-pending / 4h-TTS + version-CAS + shift_events).
  IF v_decision = 'AUTO_APPROVE' AND v_winner IS NOT NULL THEN
    v_gateway := public.sm_select_bid_winner(p_shift_id, v_winner, NULL);

    IF COALESCE((v_gateway->>'success')::boolean, false) THEN
      UPDATE public.bid_decisions SET committed = true WHERE id = v_decision_id;
      INSERT INTO public.bid_audit_log (shift_id, decision_id, event_type, actor, detail)
      VALUES (p_shift_id, v_decision_id, 'COMMITTED', 'system', jsonb_build_object('winner', v_winner, 'gateway', v_gateway));
      RETURN jsonb_build_object('ok', true, 'code', 'COMMITTED', 'decision', v_decision, 'decision_id', v_decision_id);
    ELSE
      INSERT INTO public.bid_audit_log (shift_id, decision_id, event_type, actor, detail)
      VALUES (p_shift_id, v_decision_id, 'GATEWAY_REFUSED', 'system', jsonb_build_object('gateway', v_gateway));
      RETURN jsonb_build_object('ok', false, 'code', COALESCE(v_gateway->>'error', 'GATEWAY_REFUSED'),
                                'decision_id', v_decision_id, 'gateway', v_gateway);
    END IF;
  END IF;

  INSERT INTO public.bid_audit_log (shift_id, decision_id, event_type, actor, detail)
  VALUES (p_shift_id, v_decision_id, 'DECIDED_MANUAL_REVIEW', 'system',
          jsonb_build_object('decision', v_decision, 'had_winner', v_winner IS NOT NULL));
  RETURN jsonb_build_object('ok', true, 'code', 'MANUAL_REVIEW', 'decision', v_decision, 'decision_id', v_decision_id);

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_bid_auto_decide failed (shift=%, key=%): %', p_shift_id, p_idempotency_key, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END; $$;

-- ── Revert RPC — undo a committed auto-assignment (unassign via the gateway) ─
CREATE OR REPLACE FUNCTION public.sm_bid_auto_revert(p_decision_id uuid, p_actor uuid)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_dec public.bid_decisions%ROWTYPE;
  v_ver int;
  v_gateway jsonb;
BEGIN
  IF v_caller IS NOT NULL AND NOT (
       public.is_admin()
       OR EXISTS (SELECT 1 FROM public.app_access_certificates c
                  WHERE c.user_id = v_caller AND c.is_active = true
                    AND c.access_level IN ('gamma','delta','epsilon','zeta'))
     ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_dec FROM public.bid_decisions WHERE id = p_decision_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF v_dec.decision <> 'AUTO_APPROVE' OR v_dec.committed IS NOT TRUE OR v_dec.winner_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_REVERTABLE', 'note', 'Only a committed AUTO_APPROVE can be reverted');
  END IF;
  IF v_dec.reverted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_REVERTED');
  END IF;

  SELECT version INTO v_ver FROM public.shifts WHERE id = v_dec.shift_id;
  -- Unassign through the gateway (version-CAS + FSM + shift_events).
  v_gateway := public.sm_apply_shift_op(
    v_dec.shift_id, v_ver, 'unassign',
    jsonb_build_object('reason', 'Auto-assign reverted'), gen_random_uuid());

  IF NOT COALESCE((v_gateway->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', COALESCE(v_gateway->>'code', 'UNASSIGN_REFUSED'), 'gateway', v_gateway);
  END IF;

  -- Return the winning bid to the pool so it can be re-decided.
  UPDATE public.shift_bids
     SET status = 'pending', reviewed_at = NULL, reviewed_by = NULL, updated_at = now()
   WHERE shift_id = v_dec.shift_id AND employee_id = v_dec.winner_id AND status = 'accepted';

  UPDATE public.bid_decisions SET reverted_at = now(), reverted_by = p_actor WHERE id = p_decision_id;
  INSERT INTO public.bid_audit_log (shift_id, decision_id, event_type, actor, detail)
  VALUES (v_dec.shift_id, p_decision_id, 'REVERTED', p_actor::text, jsonb_build_object('by', p_actor, 'gateway', v_gateway));
  RETURN jsonb_build_object('ok', true, 'code', 'REVERTED', 'decision_id', p_decision_id);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_bid_auto_revert failed (decision=%): %', p_decision_id, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END; $$;

-- ── Append-only guard on the audit log ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bid_audit_append_only() RETURNS trigger
    LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog'
    AS $$
BEGIN
  RAISE EXCEPTION 'bid_audit_log is append-only (% blocked)', TG_OP;
END; $$;

DROP TRIGGER IF EXISTS trg_bid_audit_append_only ON public.bid_audit_log;
CREATE TRIGGER trg_bid_audit_append_only
    BEFORE UPDATE OR DELETE ON public.bid_audit_log
    FOR EACH ROW EXECUTE FUNCTION public.fn_bid_audit_append_only();

-- ── RLS (gamma+ read on decisions/audit; org-scoped ALL on rules) ───────────
ALTER TABLE public.bid_approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bid_decisions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bid_audit_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bid_review_queue   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bid_rules_admin_all ON public.bid_approval_rules;
CREATE POLICY bid_rules_admin_all ON public.bid_approval_rules
  USING (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.app_access_certificates c
     WHERE c.user_id = auth.uid() AND c.is_active = true
       AND c.access_level IN ('gamma','delta','epsilon','zeta')
       AND c.organization_id = bid_approval_rules.organization_id))
  WITH CHECK (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.app_access_certificates c
     WHERE c.user_id = auth.uid() AND c.is_active = true
       AND c.access_level IN ('gamma','delta','epsilon','zeta')
       AND c.organization_id = bid_approval_rules.organization_id));

DROP POLICY IF EXISTS bid_decisions_read ON public.bid_decisions;
CREATE POLICY bid_decisions_read ON public.bid_decisions FOR SELECT
  USING (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.app_access_certificates c
     WHERE c.user_id = auth.uid() AND c.is_active = true
       AND c.access_level IN ('gamma','delta','epsilon','zeta')));

DROP POLICY IF EXISTS bid_audit_read ON public.bid_audit_log;
CREATE POLICY bid_audit_read ON public.bid_audit_log FOR SELECT
  USING (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.app_access_certificates c
     WHERE c.user_id = auth.uid() AND c.is_active = true
       AND c.access_level IN ('gamma','delta','epsilon','zeta')));

-- queue: RLS on, no policy → SECURITY DEFINER RPCs / service_role only.

-- ── Grants (RLS is the gate; anon revoked on functions) ─────────────────────
GRANT SELECT, INSERT, UPDATE ON TABLE public.bid_approval_rules TO authenticated, service_role;
GRANT SELECT                 ON TABLE public.bid_decisions      TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.bid_decisions      TO service_role;
GRANT SELECT                 ON TABLE public.bid_audit_log      TO authenticated;
GRANT SELECT, INSERT         ON TABLE public.bid_audit_log      TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.bid_review_queue   TO service_role;

REVOKE ALL ON FUNCTION public.sm_bid_auto_decide(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sm_bid_auto_revert(uuid, uuid)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sm_bid_queue_claim(text, integer)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sm_bid_queue_complete(uuid, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sm_bid_auto_decide(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.sm_bid_auto_revert(uuid, uuid)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sm_bid_queue_claim(text, integer)     TO service_role;
GRANT EXECUTE ON FUNCTION public.sm_bid_queue_complete(uuid, text, text) TO service_role;

COMMENT ON TABLE public.bid_approval_rules IS 'Per-org Open Bids AutoPilot policy (auto-assign). enabled = ON (bot acts) / OFF. No shadow mode.';
COMMENT ON FUNCTION public.sm_bid_auto_decide(uuid, text, jsonb) IS 'ON/OFF commit gateway for bid auto-assign: idempotency + kill-switch; delegates the winner commit to the hardened sm_select_bid_winner. Worker supplies the compliance-clear winner.';
