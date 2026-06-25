-- =====================================================================
-- Event-envelope enrichment — part 3/3: forward-fill BEFORE INSERT trigger.
-- =====================================================================
--
-- fn_enrich_shift_event() runs BEFORE INSERT on public.shift_events and FILLS
-- ONLY-IF-NULL the cheap, row-local envelope fields so EVERY new event carries a
-- domain / actor_role / idempotency_key / shift_version without the producing
-- path having to know about them:
--
--   * domain          <- deterministic map from event_type (same map as backfill)
--   * actor_role       <- approximate heuristic map from event_type (same as backfill)
--   * idempotency_key  <- (metadata->>'idem')::uuid       when present & valid
--   * shift_version    <- (metadata->>'to_version')::int  when present & numeric
--
-- DESIGN CONTRACT:
--   * FILL-IF-NULL ONLY. If a (future) write path sets any of these columns
--     explicitly, the explicit value WINS — the trigger touches a column only
--     when NEW.<col> IS NULL. This lets authoritative provenance (a real
--     actor_role, a real domain) override the heuristic.
--   * episode_seq is NOT computed here. A single-row BEFORE trigger cannot see
--     the per-shift event history required for the gaps-and-islands cumulative
--     boundary sum. episode_seq is owned by the one-time backfill
--     (20260626090050); a periodic/again-run of that backfill (or an offline
--     recompute) keeps new rows' episode_seq populated. Documented limitation.
--   * correlation_id / causation_id are NOT touched (reserved; no row-local source).
--
-- INTERACTION WITH EXISTING TRIGGERS (verified):
--   * BEFORE INSERT: the baseline trg_validate_shift_event (fn_validate_shift_event)
--     also runs. PostgreSQL fires per-row BEFORE triggers in trigger-NAME order;
--     'trg_enrich_shift_event' sorts BEFORE 'trg_validate_shift_event', so enrich
--     runs first. Enrich only sets envelope columns (never employee_id /
--     event_type), so it cannot change the validator's outcome either way — order
--     is immaterial to correctness.
--   * AFTER INSERT: trg_refresh_snapshots (fn_refresh_snapshots_on_event) reads the
--     v_shift_assignment_episodes VIEW, not the episode_seq COLUMN, so a NULL
--     episode_seq at insert time does not affect snapshot projection.
--   * fn_capture_shift_event is a trigger on public.shifts (NOT shift_events) and
--     is unaffected.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS / CREATE TRIGGER.
-- Runs AFTER the envelope columns (20260626090000) exist.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_enrich_shift_event()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
    -- domain (deterministic) — fill only if the caller left it NULL.
    IF NEW.domain IS NULL THEN
        NEW.domain := CASE NEW.event_type
            WHEN 'OFFERED'            THEN 'offer'
            WHEN 'ACCEPTED'           THEN 'offer'
            WHEN 'REJECTED'           THEN 'offer'
            WHEN 'IGNORED'            THEN 'offer'
            WHEN 'ASSIGNED'           THEN 'assignment'
            WHEN 'UNASSIGNED'         THEN 'assignment'
            WHEN 'EMERGENCY_ASSIGNED' THEN 'assignment'
            WHEN 'CANCELLED'          THEN 'assignment'
            WHEN 'LATE_CANCELLED'     THEN 'assignment'
            WHEN 'NO_SHOW'            THEN 'assignment'
            WHEN 'CHECKED_IN'         THEN 'assignment'
            WHEN 'LATE_IN'            THEN 'assignment'
            WHEN 'EARLY_OUT'          THEN 'assignment'
            WHEN 'SWAPPED_IN'         THEN 'trade'
            WHEN 'SWAPPED_OUT'        THEN 'trade'
            ELSE 'shift'   -- OP_APPLIED + any future/unknown type
        END;
    END IF;

    -- actor_role (APPROXIMATE HEURISTIC) — fill only if the caller left it NULL,
    -- so an explicit, authoritative role from the write path always wins.
    IF NEW.actor_role IS NULL THEN
        NEW.actor_role := CASE NEW.event_type
            WHEN 'ASSIGNED'           THEN 'manager'
            WHEN 'EMERGENCY_ASSIGNED' THEN 'manager'
            WHEN 'OFFERED'            THEN 'manager'
            WHEN 'UNASSIGNED'         THEN 'manager'
            WHEN 'ACCEPTED'           THEN 'employee'
            WHEN 'REJECTED'           THEN 'employee'
            WHEN 'CANCELLED'          THEN 'employee'
            WHEN 'LATE_CANCELLED'     THEN 'employee'
            WHEN 'SWAPPED_OUT'        THEN 'employee'
            WHEN 'SWAPPED_IN'         THEN 'employee'
            WHEN 'CHECKED_IN'         THEN 'employee'
            WHEN 'LATE_IN'            THEN 'employee'
            WHEN 'EARLY_OUT'          THEN 'employee'
            WHEN 'IGNORED'            THEN 'system'
            WHEN 'NO_SHOW'            THEN 'system'
            ELSE 'system'   -- OP_APPLIED + any future/unknown type
        END;
    END IF;

    -- idempotency_key <- metadata->>'idem' (gateway-stamped), fill-if-null.
    -- Guard the cast so a malformed value can never abort the INSERT.
    IF NEW.idempotency_key IS NULL
       AND NEW.metadata ? 'idem'
       AND NEW.metadata->>'idem' IS NOT NULL
       AND NEW.metadata->>'idem' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN
        NEW.idempotency_key := (NEW.metadata->>'idem')::uuid;
    END IF;

    -- shift_version <- metadata->>'to_version' (gateway-stamped), fill-if-null.
    -- Guard the cast so a non-integer value can never abort the INSERT.
    IF NEW.shift_version IS NULL
       AND NEW.metadata ? 'to_version'
       AND NEW.metadata->>'to_version' IS NOT NULL
       AND NEW.metadata->>'to_version' ~ '^-?[0-9]+$'
    THEN
        NEW.shift_version := (NEW.metadata->>'to_version')::int;
    END IF;

    -- NOTE: episode_seq, correlation_id, causation_id are intentionally left
    -- untouched (see header). episode_seq requires per-shift history (backfill).

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.fn_enrich_shift_event() OWNER TO postgres;

-- Match grant posture of the sibling shift_events triggers in the baseline.
GRANT ALL ON FUNCTION public.fn_enrich_shift_event() TO anon;
GRANT ALL ON FUNCTION public.fn_enrich_shift_event() TO authenticated;
GRANT ALL ON FUNCTION public.fn_enrich_shift_event() TO service_role;

-- Name sorts before 'trg_validate_shift_event' so enrich runs first (order is
-- immaterial to correctness; see header). DROP+CREATE for idempotency.
DROP TRIGGER IF EXISTS trg_enrich_shift_event ON public.shift_events;
CREATE TRIGGER trg_enrich_shift_event
    BEFORE INSERT ON public.shift_events
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_enrich_shift_event();

COMMENT ON FUNCTION public.fn_enrich_shift_event() IS
  'BEFORE INSERT on shift_events: fills-if-null the row-local envelope fields '
  '(domain, actor_role, idempotency_key, shift_version) from event_type/metadata. '
  'No-op when a field is already set, so explicit write-path values win. Does NOT '
  'compute episode_seq (needs per-shift history — owned by the backfill).';
