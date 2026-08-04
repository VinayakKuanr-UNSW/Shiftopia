-- ============================================================================
-- AutoPilot RDT engine — re-point the bid enqueue to a LIVE entry point.
--
-- The previous enqueue keyed on shifts.bidding_status = 'bidding_closed_no_winner',
-- a dead S8 status no live code writes (removed by the archived
-- 20260618140310_remove_s8_bidding_closed_no_winner), so the bid queue never
-- filled. We now enqueue when a bid is PLACED (or reactivated to pending) on a
-- live on-bidding shift. The RDT engine does the rest: the item WAITs and is only
-- claimed on the last overnight drain before T-4h, so an early manual winner just
-- resolves the queue row as stale (the worker sees the shift left on_bidding).
--
-- "Enqueue early, act late" — safe alongside managers, and it makes the bot fire
-- for EVERY biddable shift that still has a pending bid near its deadline.
--
-- Depends on 20260802160000 (autopilot_bid_rdt). Idempotency dedups per
-- (shift, shift.version, policy_version) via the existing queue UNIQUE constraint.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enqueue_bid_auto_assign_on_bid() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_shift   public.shifts%ROWTYPE;
  v_pol_ver int;
  v_enabled boolean;
  v_idem    text;
BEGIN
  -- Only a pending bid is a candidate for auto-assign.
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_shift FROM public.shifts WHERE id = NEW.shift_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Gate: the shift must be a live, unfilled, on-bidding shift.
  IF NOT (v_shift.lifecycle_status = 'Published'
          AND v_shift.bidding_status IN ('on_bidding', 'on_bidding_normal', 'on_bidding_urgent')
          AND v_shift.assignment_status = 'unassigned'
          AND v_shift.is_cancelled = false
          AND v_shift.deleted_at IS NULL) THEN
    RETURN NEW;
  END IF;

  -- Gate: an ENABLED policy must exist for this scope (dept beats org). No policy
  -- / disabled = pipeline off = inert (zero rows on live traffic).
  SELECT version, enabled INTO v_pol_ver, v_enabled
  FROM public.bid_approval_rules
  WHERE organization_id = v_shift.organization_id
    AND (department_id = v_shift.department_id OR department_id IS NULL)
  ORDER BY department_id NULLS LAST
  LIMIT 1;

  IF v_pol_ver IS NULL OR v_enabled IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Dedup per (shift, shift.version, policy_version): a shift edit bumps version
  -- ⇒ a fresh key ⇒ a fresh row that re-evaluates against the new shift.
  v_idem := encode(
    extensions.digest(
      v_shift.id::text || ':' || COALESCE(v_shift.version, 0)::text || ':' ||
      'on_bidding:' || v_pol_ver::text, 'sha256'), 'hex');

  INSERT INTO public.bid_review_queue (shift_id, idempotency_key, rdt)
  VALUES (v_shift.id, v_idem, public.autopilot_bid_rdt(v_shift.id))
  ON CONFLICT (shift_id, idempotency_key) DO NOTHING;

  INSERT INTO public.bid_audit_log (shift_id, event_type, actor, detail)
  SELECT v_shift.id, 'ENQUEUED', 'system',
         jsonb_build_object('idempotency_key', v_idem, 'policy_version', v_pol_ver,
                            'rdt', public.autopilot_bid_rdt(v_shift.id), 'via', 'bid_placement')
  WHERE EXISTS (SELECT 1 FROM public.bid_review_queue q
                 WHERE q.shift_id = v_shift.id AND q.idempotency_key = v_idem
                   AND q.created_at > now() - interval '5 seconds');  -- only on a fresh insert

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Best-effort side effect: never block the parent bid insert.
  RAISE WARNING 'enqueue_bid_auto_assign_on_bid swallowed error (bid=%, shift=%): %',
    NEW.id, NEW.shift_id, SQLERRM;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.enqueue_bid_auto_assign_on_bid() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_enqueue_bid_on_bid ON public.shift_bids;
CREATE TRIGGER trg_enqueue_bid_on_bid
    AFTER INSERT OR UPDATE OF status ON public.shift_bids
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_bid_auto_assign_on_bid();

-- Retire the dead shifts-status enqueue trigger (its predicate never fires). The
-- enqueue_bid_auto_assign() function is left in place (harmless, unreferenced) so
-- any external call site does not break; the trigger is the thing that mattered.
DROP TRIGGER IF EXISTS trg_enqueue_bid_auto_assign ON public.shifts;

COMMENT ON FUNCTION public.enqueue_bid_auto_assign_on_bid() IS
  'AutoPilot bid enqueue (live entry point): on a pending bid for a Published/on-bidding/unassigned shift with an enabled policy, enqueues the shift with its RDT. Replaces the dead bidding_closed_no_winner trigger.';
