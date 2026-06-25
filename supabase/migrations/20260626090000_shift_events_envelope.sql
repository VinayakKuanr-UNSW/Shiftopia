-- =====================================================================
-- Event-envelope enrichment — part 1/3: additive columns + indexes.
-- =====================================================================
--
-- Adds a small "event envelope" to the immutable public.shift_events ledger so
-- analytics (Agent B's KPI RPC) can slice by WHO acted, WHICH domain the event
-- belongs to, and WHICH assignment attempt (episode) it falls in, WITHOUT having
-- to re-derive these from event_type / metadata on every read.
--
-- This migration is ADDITIVE and DECOUPLED:
--   * It does NOT touch the gateway (sm_apply_shift_op), the capture trigger
--     (fn_capture_shift_event), the validator (fn_validate_shift_event), or the
--     episode view (v_shift_assignment_episodes).
--   * `actor_id` ALREADY EXISTS (20260621100000_shift_events_actor.sql) and is
--     NOT re-added here. actor_id = who PERFORMED the event; employee_id = who it
--     is ABOUT.
--   * All 7 new columns are nullable, so existing INSERT paths keep working
--     untouched. A BEFORE-INSERT enrich trigger (part 3/3) fills the cheap ones;
--     a one-time backfill (part 2/3) populates history (incl. episode_seq).
--
-- Idempotent: every ALTER uses ADD COLUMN IF NOT EXISTS and every index uses
-- CREATE INDEX IF NOT EXISTS, so re-running is a no-op.
--
-- Apply order:
--   20260626090000_shift_events_envelope.sql           <- THIS FILE
--   20260626090050_shift_events_envelope_backfill.sql  <- one-time history fill
--   20260626090100_shift_events_enrich_trigger.sql     <- forward-fill trigger
-- =====================================================================

-- ─── Envelope columns (all nullable, additive) ──────────────────────────────

ALTER TABLE public.shift_events
  ADD COLUMN IF NOT EXISTS actor_role      text,
  ADD COLUMN IF NOT EXISTS domain          text,
  ADD COLUMN IF NOT EXISTS episode_seq     integer,
  ADD COLUMN IF NOT EXISTS correlation_id  uuid,
  ADD COLUMN IF NOT EXISTS causation_id    uuid,
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS shift_version   integer;

-- ─── Column documentation ───────────────────────────────────────────────────
-- NOTE: actor_role / domain backfill values are APPROXIMATE heuristics derived
-- from event_type (the historical ledger predates explicit envelope stamping).
-- New write paths SHOULD set these explicitly; the enrich trigger only fills
-- them when NULL, so an explicit value always wins.

COMMENT ON COLUMN public.shift_events.actor_role IS
  'Role of the actor who performed this event: ''manager'' | ''employee'' | ''system''. '
  'BACKFILL HEURISTIC — derived from event_type for historical rows; new write '
  'paths should set it explicitly. Approximate, not authoritative provenance.';

COMMENT ON COLUMN public.shift_events.domain IS
  'Event domain bucket: ''shift'' | ''assignment'' | ''offer'' | ''trade''. '
  'Deterministically mapped from event_type (offer<-OFFERED/ACCEPTED/REJECTED/'
  'IGNORED; trade<-SWAPPED_IN/SWAPPED_OUT; assignment<-ASSIGNED/UNASSIGNED/'
  'EMERGENCY_ASSIGNED/CANCELLED/LATE_CANCELLED/NO_SHOW/CHECKED_IN/LATE_IN/'
  'EARLY_OUT; shift<-OP_APPLIED and anything else).';

COMMENT ON COLUMN public.shift_events.episode_seq IS
  'Per-shift assignment-attempt sequence (1-based) this event belongs to, mirroring '
  'v_shift_assignment_episodes gaps-and-islands boundary logic. NULL for events that '
  'precede the first opening event (episode_seq 0 in the view). Populated by the '
  'one-time backfill; NOT computed in the enrich trigger (a single-row trigger '
  'cannot see the per-shift event history needed for the cumulative boundary sum).';

COMMENT ON COLUMN public.shift_events.correlation_id IS
  'Saga / workflow correlation id grouping all events produced by one logical '
  'operation (e.g. a bid-selection run or a swap approval). Nullable; reserved for '
  'future write paths — not backfilled (no reliable historical signal).';

COMMENT ON COLUMN public.shift_events.causation_id IS
  'Id of the event that directly caused this one (event-causation chain). Nullable; '
  'reserved for future write paths — not backfilled.';

COMMENT ON COLUMN public.shift_events.idempotency_key IS
  'Idempotency uuid that produced this event. Backfilled from metadata->>''idem'' '
  '(the gateway sm_apply_shift_op stamps it). NULL when the producing path did not '
  'supply one.';

COMMENT ON COLUMN public.shift_events.shift_version IS
  'Optimistic-concurrency shift.version AFTER the op that produced this event. '
  'Backfilled from metadata->>''to_version'' (stamped by the gateway). NULL when '
  'the producing path did not carry a version.';

-- ─── Indexes ────────────────────────────────────────────────────────────────
-- (actor_id, event_time): "what did this actor do, in order" — actor activity feeds.
CREATE INDEX IF NOT EXISTS idx_shift_events_actor_time
  ON public.shift_events (actor_id, event_time);

-- (domain, event_type, event_time): KPI RPC slices by domain + type over a window.
CREATE INDEX IF NOT EXISTS idx_shift_events_domain_type_time
  ON public.shift_events (domain, event_type, event_time);

-- (shift_id, episode_seq): pull all events for a given attempt of a shift.
CREATE INDEX IF NOT EXISTS idx_shift_events_shift_episode
  ON public.shift_events (shift_id, episode_seq);
