-- =====================================================================
-- Shift Audit System — per-shift event timeline read path.
-- =====================================================================
--
-- Adds the DB read-path for the Shift Audit System on top of the EXISTING
-- immutable ledger public.shift_events. Mirrors the per-EMPLOYEE timeline
-- function get_employee_event_timeline (baseline ~6596), but pivots on
-- shift_id and surfaces the audit-relevant envelope + metadata fields
-- (op / from_state / to_state / changes / reason / domain / actor).
--
-- This migration is ADDITIVE and DECOUPLED:
--   * It does NOT mutate the ledger, its triggers, or any write path.
--   * It only adds read-side indexes and a single read RPC.
--
-- Security posture (IMPORTANT — read before changing):
--   get_employee_event_timeline is SECURITY INVOKER and leans on the two
--   SELECT RLS policies on public.shift_events:
--     * "Managers can view all shift events" — alpha..zeta contract OR
--       user_has_delta_access(auth.uid())
--     * "Users can view their own shift events" — employee_id = auth.uid()
--   This RPC is SECURITY DEFINER (so it can read the ledger with a stable,
--   index-friendly plan regardless of per-row RLS), therefore it MUST
--   re-implement that SAME gate in its body — we do NOT widen access. A
--   caller who is neither a manager nor a subject of the shift's events
--   receives zero rows, exactly as RLS would yield under INVOKER.
--
-- Idempotent: indexes use CREATE INDEX IF NOT EXISTS; the function uses
-- CREATE OR REPLACE. Safe to re-run.
--
-- NOT applied to remote — file-only deliverable.
-- =====================================================================

-- ─── Read-path indexes ──────────────────────────────────────────────────────
-- (shift_id, event_time): the timeline RPC's primary access path — pull every
-- event for one shift in chronological order.
CREATE INDEX IF NOT EXISTS idx_shift_events_shift_id_event_time
  ON public.shift_events (shift_id, event_time);

-- (employee_id, event_time DESC): "what happened to this worker, most recent
-- first" — subject-scoped audit feeds.
CREATE INDEX IF NOT EXISTS idx_shift_events_employee_id_event_time_desc
  ON public.shift_events (employee_id, event_time DESC);

-- (actor_id, event_time DESC): "what did this actor do, most recent first" —
-- actor-scoped audit feeds.
CREATE INDEX IF NOT EXISTS idx_shift_events_actor_id_event_time_desc
  ON public.shift_events (actor_id, event_time DESC);

-- partial ((metadata->>'idem')) WHERE metadata ? 'idem': idempotency-key probe
-- over only the rows that actually carry one (keeps the index small).
CREATE INDEX IF NOT EXISTS idx_shift_events_metadata_idem
  ON public.shift_events ((metadata->>'idem'))
  WHERE metadata ? 'idem';

-- (domain): standalone domain filter for audit slicing.
CREATE INDEX IF NOT EXISTS idx_shift_events_domain
  ON public.shift_events (domain);

-- ─── Per-shift event timeline RPC ───────────────────────────────────────────
-- Drop first: the RETURNS TABLE shape includes from_version/to_version, and a
-- changed OUT signature cannot go through CREATE OR REPLACE. DROP IF EXISTS is a
-- no-op on a fresh DB and lets the migration re-run cleanly.
DROP FUNCTION IF EXISTS "public"."get_shift_event_timeline"("p_shift_id" "uuid");

CREATE OR REPLACE FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid")
RETURNS TABLE(
    "event_id"   "uuid",
    "event_time" timestamp with time zone,
    "domain"     "text",
    "event_type" "public"."shift_event_type",
    "op"         "text",
    "actor_id"   "uuid",
    "actor_role" "text",
    "employee_id" "uuid",
    "from_state" "text",
    "to_state"   "text",
    "from_version" "text",
    "to_version" "text",
    "changes"    "jsonb",
    "reason"     "text"
)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Replicate the shift_events SELECT RLS gate (see header). SECURITY DEFINER
    -- bypasses RLS, so authorize explicitly: managers see any shift's timeline;
    -- a non-manager only sees a shift they are a subject of. Unauthorized
    -- callers fall through to zero rows.
    IF NOT (
        EXISTS (
            SELECT 1
            FROM public.user_contracts uc
            WHERE uc.user_id = (SELECT auth.uid())
              AND uc.access_level = ANY (ARRAY[
                    'alpha'::public.access_level,
                    'beta'::public.access_level,
                    'gamma'::public.access_level,
                    'delta'::public.access_level,
                    'epsilon'::public.access_level,
                    'zeta'::public.access_level])
              AND uc.status = 'Active'
        )
        OR public.user_has_delta_access((SELECT auth.uid()))
        OR EXISTS (
            SELECT 1
            FROM public.shift_events se_auth
            WHERE se_auth.shift_id = p_shift_id
              AND se_auth.employee_id = (SELECT auth.uid())
        )
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        se.id                                       AS event_id,
        se.event_time                               AS event_time,
        COALESCE(se.domain, se.metadata->>'domain') AS domain,
        se.event_type                               AS event_type,
        se.metadata->>'op'                          AS op,
        se.actor_id                                 AS actor_id,
        se.actor_role                               AS actor_role,
        se.employee_id                              AS employee_id,
        se.metadata->>'from_state'                  AS from_state,
        se.metadata->>'to_state'                    AS to_state,
        se.metadata->>'from_version'                AS from_version,
        se.metadata->>'to_version'                  AS to_version,
        se.metadata->'changes'                      AS changes,
        se.metadata->>'reason'                      AS reason
    FROM public.shift_events se
    WHERE se.shift_id = p_shift_id
    ORDER BY se.event_time ASC, se.created_at ASC;
END;
$$;


ALTER FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid") IS
  'Shift Audit System read path: ordered event timeline for one shift from the '
  'public.shift_events ledger. SECURITY DEFINER but re-implements the shift_events '
  'SELECT RLS gate (manager OR subject-of-shift) so access is not widened.';


-- ─── Grants (match get_employee_event_timeline) ─────────────────────────────
GRANT ALL ON FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_shift_event_timeline"("p_shift_id" "uuid") TO "service_role";
