-- ============================================================================
-- Swaps AutoPilot — drop shadow mode (ON/OFF)
--
-- Removes the shadow branch from sm_swap_auto_decide so `enabled` means the bot
-- ACTS (approve / reject / route-to-manual). A point-in-time "would-decide" log
-- is obsolete because the real action re-evaluates at commit anyway.
--
-- ⚠️ PROD SAFETY: swap auto-approve is live in prod and has been soaking in
-- shadow (enabled=true, shadow_mode=true). Removing the shadow branch would make
-- any such org act immediately. So this migration first DISABLES every currently
-- shadow-enabled policy — a human must deliberately re-enable (which now means
-- ON / act-for-real). The shadow_mode column is retained (now ignored) to avoid a
-- risky column drop on a live table.
-- ============================================================================

-- Safety: turn OFF any policy that was enabled while still in shadow, so nothing
-- silently transitions shadow -> live on deploy.
UPDATE public.swap_approval_rules
   SET enabled = false, updated_at = now()
 WHERE enabled = true AND shadow_mode = true;

-- Replace the decide RPC with the shadow branch removed.
CREATE OR REPLACE FUNCTION public.sm_swap_auto_decide(
    p_swap_id uuid, p_idempotency_key text, p_payload jsonb DEFAULT '{}'::jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_swap public.shift_swaps%ROWTYPE;
  v_org uuid; v_dept uuid;
  v_policy public.swap_approval_rules%ROWTYPE;
  v_decision public.swap_auto_decision_kind;
  v_req_ver int;
  v_gateway jsonb; v_decision_id uuid; v_existing uuid;
BEGIN
  IF v_caller IS NOT NULL AND NOT (
       public.is_admin()
       OR EXISTS (SELECT 1 FROM public.app_access_certificates c
                  WHERE c.user_id = v_caller AND c.is_active = true
                    AND c.access_level IN ('gamma','delta','epsilon','zeta'))
     ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  SELECT id INTO v_existing FROM public.swap_decisions WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'IDEMPOTENT_REPLAY', 'decision_id', v_existing);
  END IF;

  SELECT * INTO v_swap FROM public.shift_swaps WHERE id = p_swap_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'GONE'); END IF;
  IF v_swap.status <> 'MANAGER_PENDING' THEN
    INSERT INTO public.swap_audit_log (swap_id, event_type, actor, detail)
    VALUES (p_swap_id, 'SKIPPED_NOT_PENDING', 'system', jsonb_build_object('status', v_swap.status));
    RETURN jsonb_build_object('ok', true, 'code', 'NOT_PENDING', 'status', v_swap.status);
  END IF;

  SELECT organization_id, department_id INTO v_org, v_dept
  FROM public.shifts WHERE id = v_swap.requester_shift_id;
  SELECT * INTO v_policy FROM public.swap_approval_rules
  WHERE organization_id = v_org AND (department_id = v_dept OR department_id IS NULL)
  ORDER BY department_id NULLS LAST LIMIT 1;

  IF NOT FOUND OR v_policy.enabled IS NOT TRUE THEN
    INSERT INTO public.swap_audit_log (swap_id, event_type, actor, detail)
    VALUES (p_swap_id, 'KILLSWITCH_OFF', 'system', jsonb_build_object('policy_found', FOUND));
    RETURN jsonb_build_object('ok', true, 'code', 'DISABLED');
  END IF;

  v_decision := (p_payload->>'decision')::public.swap_auto_decision_kind;

  -- ON: log the decision (shadow column retained but always false) …
  INSERT INTO public.swap_decisions(
    swap_id, idempotency_key, decision, guard_result, eligibility_result,
    solver_result, reason, policy_version, engine_version,
    requester_shift_version, offered_shift_version, shadow, committed)
  VALUES (
    p_swap_id, p_idempotency_key, v_decision,
    COALESCE(p_payload->'guard_result','{}'::jsonb),
    COALESCE(p_payload->'eligibility_result','{}'::jsonb),
    COALESCE(p_payload->'solver_result','{}'::jsonb),
    p_payload->>'reason',
    COALESCE((p_payload->>'policy_version')::int, v_policy.version),
    COALESCE(p_payload->>'engine_version','unknown'),
    (p_payload->>'requester_shift_version')::int,
    (p_payload->>'offered_shift_version')::int,
    false, false)
  RETURNING id INTO v_decision_id;

  -- … and act on it via the gateway.
  v_req_ver := (p_payload->>'requester_shift_version')::int;

  IF v_decision = 'AUTO_APPROVE' THEN
    v_gateway := public.sm_apply_shift_op(v_swap.requester_shift_id, v_req_ver, 'approve_trade',
                   jsonb_build_object('compliance_ok', true), NULL);
  ELSIF v_decision = 'AUTO_REJECT' THEN
    v_gateway := public.sm_apply_shift_op(v_swap.requester_shift_id, v_req_ver, 'reject_trade',
                   jsonb_build_object('reason', COALESCE(p_payload->>'reason','Auto-rejected')), NULL);
  ELSE
    UPDATE public.shift_swaps SET review_flag = true, auto_decision_id = v_decision_id, updated_at = now()
      WHERE id = p_swap_id;
    INSERT INTO public.swap_audit_log (swap_id, decision_id, event_type, actor, detail)
    VALUES (p_swap_id, v_decision_id, 'DECIDED_MANUAL_REVIEW', 'system', jsonb_build_object('reason', p_payload->>'reason'));
    RETURN jsonb_build_object('ok', true, 'code', 'MANUAL_REVIEW', 'decision_id', v_decision_id);
  END IF;

  IF COALESCE((v_gateway->>'ok')::boolean, false) THEN
    UPDATE public.swap_decisions SET committed = true WHERE id = v_decision_id;
    UPDATE public.shift_swaps SET auto_decision_id = v_decision_id, updated_at = now() WHERE id = p_swap_id;
    INSERT INTO public.swap_audit_log (swap_id, decision_id, event_type, actor, detail)
    VALUES (p_swap_id, v_decision_id, 'COMMITTED', 'system', jsonb_build_object('decision', v_decision, 'gateway', v_gateway));
    RETURN jsonb_build_object('ok', true, 'code', 'COMMITTED', 'decision', v_decision, 'decision_id', v_decision_id);
  ELSE
    INSERT INTO public.swap_audit_log (swap_id, decision_id, event_type, actor, detail)
    VALUES (p_swap_id, v_decision_id, 'GATEWAY_REFUSED', 'system', jsonb_build_object('gateway', v_gateway));
    RETURN jsonb_build_object('ok', false, 'code', COALESCE(v_gateway->>'code','GATEWAY_REFUSED'),
                              'decision_id', v_decision_id, 'gateway', v_gateway);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sm_swap_auto_decide failed (swap=%, key=%): %', p_swap_id, p_idempotency_key, SQLERRM;
  RETURN jsonb_build_object('ok', false, 'code', 'ERROR', 'error', SQLERRM);
END; $$;

COMMENT ON FUNCTION public.sm_swap_auto_decide(uuid, text, jsonb) IS 'ON/OFF commit gateway for swap auto-approve: idempotency + kill-switch; acts via sm_apply_shift_op (approve_trade / reject_trade) when enabled. Shadow mode removed 2026-07-23.';
