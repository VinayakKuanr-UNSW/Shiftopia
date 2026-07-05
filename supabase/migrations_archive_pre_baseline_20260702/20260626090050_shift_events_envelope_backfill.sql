-- =====================================================================
-- Event-envelope enrichment — part 2/3: one-time history backfill.
-- =====================================================================
--
-- Populates the envelope columns added in 20260626090000 for the EXISTING rows of
-- public.shift_events. Runs AFTER that ALTER migration has committed.
--
-- Every statement is guarded with `WHERE <col> IS NULL`, so this file is SAFE TO
-- RE-RUN: already-populated rows are skipped, and any explicit values written by
-- new paths (or the enrich trigger) are never overwritten.
--
-- THREE backfills:
--   1. domain          — deterministic map from event_type (authoritative).
--   2. actor_role       — APPROXIMATE heuristic map from event_type (see note).
--   3. idempotency_key / shift_version — pulled from gateway metadata.
--   4. episode_seq      — per-event attempt number, mirroring the EXACT boundary
--                         logic of public.v_shift_assignment_episodes.
--
-- This migration does NOT touch the gateway, capture trigger, validator, or the
-- episode view. It only UPDATEs data in shift_events.
-- =====================================================================

SET search_path TO 'pg_catalog', 'public';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. domain  (DETERMINISTIC — event_type fully determines the bucket)
--    offer      <- OFFERED, ACCEPTED, REJECTED, IGNORED
--    assignment <- ASSIGNED, UNASSIGNED, EMERGENCY_ASSIGNED, CANCELLED,
--                  LATE_CANCELLED, NO_SHOW, CHECKED_IN, LATE_IN, EARLY_OUT
--    trade      <- SWAPPED_IN, SWAPPED_OUT
--    shift      <- OP_APPLIED and anything else (catch-all)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.shift_events
SET domain = CASE event_type
        WHEN 'OFFERED'             THEN 'offer'
        WHEN 'ACCEPTED'            THEN 'offer'
        WHEN 'REJECTED'            THEN 'offer'
        WHEN 'IGNORED'             THEN 'offer'
        WHEN 'ASSIGNED'            THEN 'assignment'
        WHEN 'UNASSIGNED'          THEN 'assignment'
        WHEN 'EMERGENCY_ASSIGNED'  THEN 'assignment'
        WHEN 'CANCELLED'           THEN 'assignment'
        WHEN 'LATE_CANCELLED'      THEN 'assignment'
        WHEN 'NO_SHOW'             THEN 'assignment'
        WHEN 'CHECKED_IN'          THEN 'assignment'
        WHEN 'LATE_IN'             THEN 'assignment'
        WHEN 'EARLY_OUT'           THEN 'assignment'
        WHEN 'SWAPPED_IN'          THEN 'trade'
        WHEN 'SWAPPED_OUT'         THEN 'trade'
        ELSE 'shift'   -- OP_APPLIED + any future/unknown type
    END
WHERE domain IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. actor_role  (APPROXIMATE BACKFILL HEURISTIC — NOT authoritative provenance)
--    The historical ledger predates actor_id stamping, so we infer the likely
--    actor role from event_type:
--      manager  <- ASSIGNED, EMERGENCY_ASSIGNED, OFFERED, UNASSIGNED
--      employee <- ACCEPTED, REJECTED, CANCELLED, LATE_CANCELLED,
--                  SWAPPED_OUT, SWAPPED_IN, CHECKED_IN, LATE_IN, EARLY_OUT
--      system   <- IGNORED, NO_SHOW, OP_APPLIED  (auto/ambiguous)
--    New write paths should set actor_role explicitly; the enrich trigger only
--    fills it when NULL, so this heuristic never clobbers a real value.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.shift_events
SET actor_role = CASE event_type
        WHEN 'ASSIGNED'            THEN 'manager'
        WHEN 'EMERGENCY_ASSIGNED'  THEN 'manager'
        WHEN 'OFFERED'             THEN 'manager'
        WHEN 'UNASSIGNED'          THEN 'manager'
        WHEN 'ACCEPTED'            THEN 'employee'
        WHEN 'REJECTED'            THEN 'employee'
        WHEN 'CANCELLED'           THEN 'employee'
        WHEN 'LATE_CANCELLED'      THEN 'employee'
        WHEN 'SWAPPED_OUT'         THEN 'employee'
        WHEN 'SWAPPED_IN'          THEN 'employee'
        WHEN 'CHECKED_IN'          THEN 'employee'
        WHEN 'LATE_IN'             THEN 'employee'
        WHEN 'EARLY_OUT'           THEN 'employee'
        WHEN 'IGNORED'             THEN 'system'
        WHEN 'NO_SHOW'             THEN 'system'
        ELSE 'system'   -- OP_APPLIED + any future/unknown type
    END
WHERE actor_role IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. idempotency_key  <- (metadata->>'idem')::uuid  where present & valid uuid
--    shift_version    <- (metadata->>'to_version')::int where present & numeric
--    Both keys are stamped by the gateway sm_apply_shift_op. We guard the casts
--    so a malformed value never aborts the whole UPDATE.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.shift_events
SET idempotency_key = (metadata->>'idem')::uuid
WHERE idempotency_key IS NULL
  AND metadata ? 'idem'
  AND metadata->>'idem' IS NOT NULL
  AND metadata->>'idem' <> ''
  -- only cast strings that look like a uuid (avoid 22P02 on bad data)
  AND metadata->>'idem' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

UPDATE public.shift_events
SET shift_version = (metadata->>'to_version')::int
WHERE shift_version IS NULL
  AND metadata ? 'to_version'
  AND metadata->>'to_version' IS NOT NULL
  AND metadata->>'to_version' <> ''
  -- only cast strings that are pure integers (avoid 22P02 on bad data)
  AND metadata->>'to_version' ~ '^-?[0-9]+$';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. episode_seq  (PER-EVENT attempt number)
--
-- This CTE MIRRORS the boundary logic of public.v_shift_assignment_episodes
-- EXACTLY (see 20260624090000_shift_assignment_episodes.sql):
--
--     ordered_events   -> per-shift row numbering over employee-bound events
--     classified       -> tag opening / closing event types
--     boundary_events  -> LAG over OPENING/CLOSING events only (intra events
--                         cannot break the "prev boundary was a close" signal)
--     boundary_starts  -> mark a new episode at first holder / re-open after a
--                         close / holder change
--     episode_assigned -> cumulative SUM of start-markers over ALL events; intra
--                         events contribute 0 and inherit their episode's seq
--
-- We then join the computed per-event episode_seq back to shift_events by event
-- id and write it.
--
-- PARITY NOTES (important):
--   * ordered_events filters `employee_id IS NOT NULL` — identical to the view.
--     Events with NULL employee_id (e.g. OP_APPLIED audit rows, subject-less
--     UNASSIGNED) are therefore NOT in the CTE and KEEP episode_seq = NULL. This
--     matches the view, which never assigns them an episode.
--   * The view excludes episode_seq = 0 (events before the first opening) from
--     its episode aggregation. Here we likewise write NULL for those rows
--     (NULLIF(...,0)) — episode_seq 0 means "no episode", best represented as NULL
--     on the ledger.
--   * Ordering tiebreak: the view orders by (event_time, event_id) for
--     ordered_events/episode_assigned, and by (event_time, event_id) inside the
--     boundary window. We reproduce both verbatim so the cumulative sum lands on
--     identical boundaries.
--   * RESIDUAL PARITY RISK: none on the seq value itself — the boundary CTEs are
--     copied verbatim. The only structural difference is that the view groups
--     into episodes whereas we keep the per-event seq; the per-event seq is the
--     exact value the view computes in its `episode_assigned` CTE before the
--     GROUP BY, so a join-back is faithful. If the view's boundary CTEs are ever
--     edited, THIS block must be updated in lockstep (it is a copy, not a call).
-- ─────────────────────────────────────────────────────────────────────────────
WITH
ordered_events AS (
    SELECT
        se.id           AS event_id,
        se.shift_id,
        se.employee_id,
        se.event_type,
        se.event_time
    FROM public.shift_events se
    WHERE se.employee_id IS NOT NULL
),
classified AS (
    SELECT
        oe.*,
        (oe.event_type IN ('ASSIGNED','OFFERED','EMERGENCY_ASSIGNED','SWAPPED_IN')) AS is_opening_type,
        (oe.event_type IN ('REJECTED','IGNORED','CANCELLED','LATE_CANCELLED',
                           'SWAPPED_OUT','NO_SHOW','UNASSIGNED'))                    AS is_closing_type
    FROM ordered_events oe
),
boundary_events AS (
    SELECT
        c.shift_id,
        c.event_id,
        c.event_time,
        c.employee_id,
        c.is_opening_type,
        LAG(c.is_closing_type) OVER w AS prev_boundary_was_closing,
        LAG(c.employee_id)     OVER w AS prev_boundary_employee
    FROM classified c
    WHERE c.is_opening_type OR c.is_closing_type
    WINDOW w AS (PARTITION BY c.shift_id ORDER BY c.event_time, c.event_id)
),
boundary_starts AS (
    SELECT
        be.shift_id,
        be.event_id,
        CASE
            WHEN be.is_opening_type AND (
                     be.prev_boundary_employee IS NULL          -- first holder
                  OR be.prev_boundary_was_closing               -- re-open after a close
                  OR be.employee_id IS DISTINCT FROM be.prev_boundary_employee  -- holder change
                 )
            THEN 1 ELSE 0
        END AS starts_new_episode
    FROM boundary_events be
),
episode_assigned AS (
    SELECT
        c.event_id,
        SUM(COALESCE(bs.starts_new_episode, 0))
            OVER (PARTITION BY c.shift_id ORDER BY c.event_time, c.event_id
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS episode_seq
    FROM classified c
    LEFT JOIN boundary_starts bs
           ON bs.shift_id = c.shift_id AND bs.event_id = c.event_id
)
UPDATE public.shift_events se
SET episode_seq = NULLIF(ea.episode_seq, 0)   -- 0 == "before first opening" -> NULL
FROM episode_assigned ea
WHERE ea.event_id = se.id
  AND se.episode_seq IS NULL;
