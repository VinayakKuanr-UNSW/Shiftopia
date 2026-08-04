-- ============================================================================
-- AutoPilot RDT Ownership Engine — shared schema + helper functions
--
-- Evolves the swap/bid AutoPilot scheduler from a blunt "act anywhere in the
-- 18:00–06:00 window, FIFO" model into a Required-Decision-Time (RDT) engine:
--   * every queued item carries an RDT — the LATEST instant the bot may still
--     safely act, bounded by the universal 4h TTS lock that process_shift_timers
--     already enforces (after shift_start−4h the item is reverted/expired).
--   * a single deterministic classifier (autopilot_queue_disposition) decides,
--     per item, whether the bot must ACT_NOW (this is the last overnight drain
--     before the deadline), may WAIT (a later drain still precedes RDT — defer
--     for freshest compliance), must RETURN_TO_MANAGER (deadline lands in a
--     daytime the bot can't reach), or has EXPIRED.
--   * explicit per-item ownership (MANAGER | AUTOPILOT) so exactly one party
--     owns an item; the flip to AUTOPILOT is atomic at claim time (next migration).
--
-- This migration is ADDITIVE and INERT: columns default owner='MANAGER', and
-- nothing reads the new disposition until the claim/guard/sweep migration
-- (20260802160200) wires it in. Window stays hardcoded Australia/Sydney to match
-- is_autopilot_window_open() (20260802140000) and process_shift_timers.
-- ============================================================================

-- ── Ownership enum (shared by both queue tables) ────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'autopilot_owner') THEN
    CREATE TYPE public.autopilot_owner AS ENUM ('MANAGER', 'AUTOPILOT');
  END IF;
END $$;

-- ── Per-item RDT + ownership columns on BOTH queues ─────────────────────────
-- (bid_review_queue uses public.autopilot_queue_status; swap_review_queue uses
--  public.swap_queue_status — the ownership columns are enum-agnostic.)
ALTER TABLE public.bid_review_queue
  ADD COLUMN IF NOT EXISTS rdt             timestamptz,
  ADD COLUMN IF NOT EXISTS owner           public.autopilot_owner NOT NULL DEFAULT 'MANAGER',
  ADD COLUMN IF NOT EXISTS owner_since     timestamptz,
  ADD COLUMN IF NOT EXISTS returned_reason text;

ALTER TABLE public.swap_review_queue
  ADD COLUMN IF NOT EXISTS rdt             timestamptz,
  ADD COLUMN IF NOT EXISTS owner           public.autopilot_owner NOT NULL DEFAULT 'MANAGER',
  ADD COLUMN IF NOT EXISTS owner_since     timestamptz,
  ADD COLUMN IF NOT EXISTS returned_reason text;

-- Soonest-RDT-first claim ordering + dashboard scans.
CREATE INDEX IF NOT EXISTS idx_bid_review_queue_status_rdt  ON public.bid_review_queue(status, rdt);
CREATE INDEX IF NOT EXISTS idx_swap_review_queue_status_rdt ON public.swap_review_queue(status, rdt);

-- ── Time helper: the upcoming 18:00 Australia/Sydney (next window OPEN) ──────
-- If local wall-clock is before today 18:00 → today 18:00; otherwise tomorrow
-- 18:00. DST-safe via AT TIME ZONE round-trip.
CREATE OR REPLACE FUNCTION public.autopilot_next_window_open_after(p_now timestamptz DEFAULT now())
  RETURNS timestamptz
  LANGUAGE sql STABLE
  SET search_path TO 'pg_catalog', 'public'
AS $$
  WITH loc AS (SELECT (p_now AT TIME ZONE 'Australia/Sydney') AS v),
       base AS (SELECT v, date_trunc('day', v) + interval '18 hours' AS today18 FROM loc)
  SELECT (CASE WHEN v < today18 THEN today18 ELSE today18 + interval '1 day' END)
           AT TIME ZONE 'Australia/Sydney'
  FROM base;
$$;

-- ── Shift start instant — same COALESCE(start_at, naive→zoned) expression that
--    process_shift_timers uses, so RDT and the timer agree byte-for-byte. ─────
CREATE OR REPLACE FUNCTION public.autopilot_shift_start_ts(p_shift_id uuid)
  RETURNS timestamptz
  LANGUAGE sql STABLE
  SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT COALESCE(
           s.start_at,
           ((s.shift_date::text || ' ' || s.start_time::text)::timestamp
              AT TIME ZONE COALESCE(s.timezone, 'Australia/Sydney'))
         )
  FROM public.shifts s
  WHERE s.id = p_shift_id;
$$;

-- ── Bid RDT = shift_start − 4h (TTS lock) − 15m safety margin ────────────────
CREATE OR REPLACE FUNCTION public.autopilot_bid_rdt(p_shift_id uuid)
  RETURNS timestamptz
  LANGUAGE sql STABLE
  SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT public.autopilot_shift_start_ts(p_shift_id)
           - interval '4 hours' - interval '15 minutes';
$$;

-- ── Swap RDT = LEAST(expires_at, requester_shift_start − 4h) − 15m ───────────
CREATE OR REPLACE FUNCTION public.autopilot_swap_rdt(p_swap_id uuid)
  RETURNS timestamptz
  LANGUAGE sql STABLE
  SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT LEAST(
           COALESCE(sw.expires_at, 'infinity'::timestamptz),
           public.autopilot_shift_start_ts(sw.requester_shift_id) - interval '4 hours'
         ) - interval '15 minutes'
  FROM public.shift_swaps sw
  WHERE sw.id = p_swap_id;
$$;

-- ── The classifier — the whole "strategize for RDT" in one function ─────────
--   NULL rdt        -> WAIT  (can't compute yet; never fail-open into an action)
--   rdt <= now      -> EXPIRED
--   window OPEN  (overnight):  rdt <= next-open ? ACT_NOW : WAIT
--   window CLOSED (daytime):   rdt <= next-open ? RETURN_TO_MANAGER : WAIT
-- next-open is the upcoming 18:00; "rdt <= next-open" means THIS window is the
-- last chance before the deadline.
CREATE OR REPLACE FUNCTION public.autopilot_queue_disposition(
    p_rdt timestamptz, p_now timestamptz DEFAULT now())
  RETURNS text
  LANGUAGE plpgsql STABLE
  SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_next timestamptz;
BEGIN
  IF p_rdt IS NULL THEN RETURN 'WAIT'; END IF;
  IF p_rdt <= p_now THEN RETURN 'EXPIRED'; END IF;

  v_next := public.autopilot_next_window_open_after(p_now);

  IF public.is_autopilot_window_open(p_now) THEN
    RETURN CASE WHEN p_rdt <= v_next THEN 'ACT_NOW' ELSE 'WAIT' END;
  ELSE
    RETURN CASE WHEN p_rdt <= v_next THEN 'RETURN_TO_MANAGER' ELSE 'WAIT' END;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.autopilot_queue_disposition(timestamptz, timestamptz) IS
  'AutoPilot windowed-RDT classifier: ACT_NOW | WAIT | RETURN_TO_MANAGER | EXPIRED. Drives claim eligibility (bids/swaps) and the return-to-manager sweep.';

-- ── Grants: invoker-rights read helpers (RLS applies for managers; workers are
--    RLS-blind under service_role). No SECURITY DEFINER ⇒ no anon-grant gotcha. ─
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.autopilot_next_window_open_after(timestamptz)',
    'public.autopilot_shift_start_ts(uuid)',
    'public.autopilot_bid_rdt(uuid)',
    'public.autopilot_swap_rdt(uuid)',
    'public.autopilot_queue_disposition(timestamptz, timestamptz)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon;', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role;', fn);
  END LOOP;
END $$;
